import { describe, it, expect } from "bun:test";
import type { EnginePhase, GameEngine, TurnPhase } from "@dafung/core/engine/authority";
import type { ReactionView } from "@dafung/core/engine/reaction-window";
import { loadMap, type LoadedMap, type MapData } from "@dafung/core/engine/board-loader";
import { GameController } from "@app/controllers/controller";
import { OnlineController } from "@app/controllers/online";
import { abandonAllMarches, abandonMarch, beginMarch } from "../apps/client/src/app/fx/useMarch";
import type { MarchSegmentFrames } from "../apps/client/src/app/fx/presentation";
import guanzhongData from "../packages/core/maps/guanzhong.json" with { type: "json" };

const GUANZHONG: { map: LoadedMap; data: MapData } = {
  map: loadMap(guanzhongData),
  data: guanzhongData as unknown as MapData,
};

/** 策略探针:基类公式的一切子类输入(座位/锁)显式注入,直读 interactive 断言。
 *  fxPlaying 缺省不注入(= 走基类生产实现:本座位 id → useMarch 行军会话查询口,
 *  #611),显式传布尔才覆写——演出锁的「读数怎么来」与「公式怎么消费」分开钉。 */
class PolicyProbe extends GameController {
  private readonly p: {
    mySeat: number;
    autoPilot: boolean;
    fxPlaying?: boolean;
  };
  constructor(
    private readonly fakeEngine: GameEngine,
    p: { mySeat: number; autoPilot?: boolean; fxPlaying?: boolean },
  ) {
    super();
    this.p = { autoPilot: false, ...p };
  }
  get engine(): GameEngine {
    return this.fakeEngine;
  }
  get viewSeat(): number {
    return this.p.mySeat;
  }
  protected override get mySeat(): number {
    return this.p.mySeat;
  }
  protected override get fxPlaying(): boolean {
    return this.p.fxPlaying ?? super.fxPlaying;
  }
  /** 探针豁免行军会话订阅(基类构造期装订):不往公共 gameStore 灌替身引擎态。 */
  protected override watchMarching(): void {}
  /** 锁注入:pending 是基类 protected 字段(子类协议面写),探针借同族访问写。 */
  setPending(v: boolean): void {
    this.pending = v;
  }
  setDecisionPoint(point: string | null): void {
    this.decisionPoint = point;
  }
  markEntered(): void {
    this.enteredGame = true;
  }
  get presenting(): boolean {
    return this.selfPresenting;
  }
  /** 托管锁注入(基类公开读口「UI 托管中」回读,探针覆写为注入面)。 */
  override get autoPilotOn(): boolean {
    return this.p.autoPilot;
  }
  dispatchCommand(): void {
    throw new Error("探针不发命令");
  }
}

const TURN_PHASES: TurnPhase[] = [
  "Roll",
  "AwaitingDecision",
  "AwaitingHeroPick",
  "AwaitingJinnang",
  "AwaitingTreasureOwner",
  "AwaitingBankruptcySettle",
  "AwaitingReaction",
  "Land",
  "EndTurn",
  "GameOver",
];

/** 策略公式读数所需的引擎面(相位/决策方/挂起反应窗/座位表);其余字段公式不读。
 *  座位表缺省带 id(#611:演出锁生产读数走 players[mySeat].id → 行军会话口)。 */
function fakeEngine(o: {
  phase?: EnginePhase;
  turnPhase?: TurnPhase;
  decisionOwner?: number;
  pendingReaction?: { view: ReactionView } | null;
  players?: { isBot: boolean; id?: string }[];
}): GameEngine {
  return {
    phase: o.phase ?? "Playing",
    turnPhase: o.turnPhase ?? "Roll",
    decisionOwner: o.decisionOwner ?? 0,
    pendingReaction:
      o.pendingReaction == null ? null : { ...o.pendingReaction, seq: 1, answers: [] },
    players: o.players ?? [
      { isBot: false, id: "p1" },
      { isBot: true, id: "p2" },
    ],
  } as unknown as GameEngine;
}

function jinnangView(queriedBySeat: number[]): ReactionView {
  return {
    kind: "jinnang",
    cardId: "card-fake",
    userSeat: 1,
    targets: { kind: "seat", ids: [0], requiresSelection: false },
    queriedBySeat,
    windowMs: 8000,
  };
}

function marchView(ownerSeat: number): ReactionView {
  return {
    kind: "march",
    cardId: "card-fake",
    userSeat: 1,
    ownerSeat,
    tileIndex: 4,
    windowMs: 8000,
  };
}

describe("控制器交互策略公式(#433 canAct 单源)", () => {
  it("相位判定:Playing × turnPhase 全集 × 锁全关 × 我的(人类)决策——除 AwaitingReaction 例外分支外恒可操作", () => {
    for (const turnPhase of TURN_PHASES) {
      const probe = new PolicyProbe(fakeEngine({ turnPhase }), { mySeat: 0 });
      expect(probe.interactive).toBe(turnPhase !== "AwaitingReaction");
    }
  });

  it("相位判定:非 Playing(Setup/GameOver)恒不可操作——决策方轮到本端也不放行", () => {
    for (const phase of ["Setup", "GameOver"] as const) {
      const probe = new PolicyProbe(fakeEngine({ phase, decisionOwner: 0 }), {
        mySeat: 0,
        fxPlaying: true,
      });
      expect(probe.interactive).toBe(false);
    }
  });

  it("三把锁:主分支 pending×托管×本座位演出 全 8 组合 × 非 AwaitingReaction 的 turnPhase 全集——任一上锁即关(#611:演出锁读数=本座位未落定)", () => {
    for (const turnPhase of TURN_PHASES.filter((t) => t !== "AwaitingReaction")) {
      for (const pending of [false, true]) {
        for (const autoPilot of [false, true]) {
          for (const fxPlaying of [false, true]) {
            const probe = new PolicyProbe(fakeEngine({ turnPhase, decisionOwner: 0 }), {
              mySeat: 0,
              autoPilot,
              fxPlaying,
            });
            probe.setPending(pending);
            expect(probe.interactive).toBe(!pending && !autoPilot && !fxPlaying);
          }
        }
      }
    }
  });

  // ── 演出锁改绑本座位(#611,ADR-0029 §4):会话驱动维度表 ──
  // 探针不注入 fxPlaying(走基类生产读数:players[mySeat].id → useMarch 会话口),
  // 直接驱动真实行军会话钉死「读数怎么来 + 公式怎么消费」两端:
  //   本座位行军在途 → 关;他座位行军在途(队列积压的常态形态)→ 开——
  //   「队列积压但本座位无演出」对公式不可分辨 = 结构性无此输入(全局队列
  //   pendingChunks 不进公式),行为级旁证由 local-room 排空独立断言承担。
  const marchKF: MarchSegmentFrames[] = [
    {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      flow: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    },
  ];
  const sessionProbe = (): PolicyProbe =>
    new PolicyProbe(
      fakeEngine({
        turnPhase: "AwaitingDecision",
        decisionOwner: 0,
        players: [
          { isBot: false, id: "p1" },
          { isBot: true, id: "p2" },
        ],
      }),
      { mySeat: 0 },
    );

  it("演出锁改绑本座位(#611):他座位行军在途不关门——决策卷轴照弹,别人的棋子照飞", () => {
    try {
      beginMarch("p2", marchKF, { tileIndex: 0, position: marchKF[0].points[0] });
      expect(sessionProbe().interactive).toBe(true);
    } finally {
      abandonAllMarches();
    }
  });

  it("演出锁改绑本座位(#611):本座位行军在途关门,会话落定(播完/作废删会话)即开门", () => {
    try {
      beginMarch("p1", marchKF, { tileIndex: 0, position: marchKF[0].points[0] });
      expect(sessionProbe().interactive).toBe(false);
      abandonMarch("p1");
      expect(sessionProbe().interactive).toBe(true);
    } finally {
      abandonAllMarches();
    }
  });

  it("第四座收到首帧前没有本席演出，完整座位表就位后仍检查错位", () => {
    const probe = new PolicyProbe(
      fakeEngine({ decisionOwner: 3, players: [{ isBot: false, id: "p1" }] }),
      { mySeat: 3 },
    );
    expect(probe.presenting).toBe(false);
    probe.markEntered();
    expect(() => probe.presenting).toThrow("不在引擎座位表");
  });

  it("只有当前决策方的真人座位可操作", () => {
    const players = [{ isBot: false }, { isBot: false }, { isBot: true }];
    for (const [owner, mySeat, expected] of [
      [0, 0, true],
      [1, 0, false],
      [2, 2, false],
    ] as const) {
      const probe = new PolicyProbe(
        fakeEngine({ turnPhase: "AwaitingDecision", decisionOwner: owner, players }),
        { mySeat },
      );
      expect(probe.interactive).toBe(expected);
    }
  });

  it("反应窗按本席授权开启", () => {
    const reactionRows = [
      { name: "无挂起窗", view: null as ReactionView | null, queried: false },
      { name: "锦囊窗·我在被询问集", view: jinnangView([0, 2]), queried: true },
      { name: "锦囊窗·我不在集", view: jinnangView([1]), queried: false },
      // 联机脱敏批把非己座位置换为 -1 占位(数量保留):未入座端(mySeat=-1)收到的
      // 被询问集逐字拷贝后可含 -1,includes(-1) 可为真——钉死基类显式守卫(不靠
      // 「集合只含真实座位」的推理)。
      { name: "锦囊窗·被询问集含 -1 匿名占位", view: jinnangView([-1]), queried: false },
      { name: "行军拦检窗·我是城主", view: marchView(0), queried: true },
      { name: "行军拦检窗·我不是城主", view: marchView(1), queried: false },
    ];
    for (const row of reactionRows) {
      for (const mySeat of [-1, 0]) {
        for (const pending of [false, true]) {
          // 反应窗里仍可应答他人回合，行军演出由独立通路控制。
          const probe = new PolicyProbe(
            fakeEngine({
              turnPhase: "AwaitingReaction",
              decisionOwner: 1,
              players: [{ isBot: false }, { isBot: true }],
              pendingReaction: row.view == null ? null : { view: row.view },
            }),
            { mySeat, fxPlaying: true },
          );
          probe.setDecisionPoint(row.queried ? "反应窗" : null);
          probe.setPending(pending);
          // 未入座(mySeat=-1)不可操作:基类显式守卫排除——被询问集可含 -1 匿名占位
          // (脱敏批逐字拷贝,见上行表),includes(-1) 可为真,非「天然不在集内」。
          const expected = row.view != null && row.queried && mySeat >= 0 && !pending;
          expect(probe.interactive).toBe(expected);
        }
      }
    }
  });
});

describe("OnlineController 参数面(#433 薄测:参数怎么取)", () => {
  it("未入座(mySeat=-1)+ 占位壳 Setup:不可操作;策略公式消费联机参数(座位=入座分配)", () => {
    const c = new OnlineController(GUANZHONG.map, "guanzhong");
    expect(c.viewSeat).toBe(-1);
    expect(c.interactive).toBe(false);
    c.destroy();
  });
});
