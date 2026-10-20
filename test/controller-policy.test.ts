// 控制器交互策略公式表驱动单测(#433):「此刻本地玩家能不能点」上收基类
// GameController.canAct 后,策略公式只剩一份。本文件穷举公式输入空间钉死语义:
//   相位判定(EnginePhase × TurnPhase 全集)× 三把锁(pending/托管/本座位演出,8 组合)
//   × 决策方判定(决策方座位 × 人/bot)× 热座语义开关(单机/联机唯一语义差,
//   显式参数化,#433)+ AwaitingReaction 多属主例外(被询问集判定;决策方/托管/
//   演出锁在该分支全部不适用——倒计时不等演出,超时兜底在权威侧)。
//   #611 交互锁解绑(ADR-0029 §4):演出锁改绑「本座位演出落定」——生产读数 =
//   players[mySeat].id → useMarch 行军会话查询口,新增会话驱动维度表钉死接线:
//   本座在途关、他座在途/队列积压(公式无全局队列输入,结构性)开。
// 两个真实控制器只剩「参数怎么取」:LocalController(热座=true、mySeat=0)由
// test/local-room.test.ts 既有行为断言守住;OnlineController(热座=false、
// mySeat=入座分配)参数面在本文件尾部薄测。
import { describe, it, expect } from "bun:test";
import type { EnginePhase, GameEngine, TurnPhase } from "@core/authority";
import type { ReactionView } from "@core/reaction-window";
import { loadMap, type LoadedMap, type MapData } from "@core/board-loader";
import { GameController } from "@app/controllers/controller";
import { OnlineController } from "@app/controllers/online";
import { abandonAllMarches, abandonMarch, beginMarch } from "../src/app/fx/useMarch";
import type { MarchSegmentFrames } from "../src/app/fx/presentation";
import huanyouData from "../public/maps/huanyou.json" with { type: "json" };

const HUANYOU: { map: LoadedMap; data: MapData } = {
  map: loadMap(huanyouData),
  data: huanyouData as unknown as MapData,
};

/** 策略探针:基类公式的一切子类输入(座位/热座/锁)显式注入,直读 interactive 断言。
 *  fxPlaying 缺省不注入(= 走基类生产实现:本座位 id → useMarch 行军会话查询口,
 *  #611),显式传布尔才覆写——演出锁的「读数怎么来」与「公式怎么消费」分开钉。 */
class PolicyProbe extends GameController {
  private readonly p: {
    mySeat: number;
    hotSeat: boolean;
    autoPilot: boolean;
    fxPlaying?: boolean;
  };
  constructor(
    private readonly fakeEngine: GameEngine,
    p: { mySeat: number; hotSeat: boolean; autoPilot?: boolean; fxPlaying?: boolean },
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
  protected override get hotSeat(): boolean {
    return this.p.hotSeat;
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
  "AwaitingEncounter",
  "AwaitingJinnang",
  "AwaitingExhaustion",
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
    pendingReaction: o.pendingReaction ?? null,
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
    targetSeats: [0],
    queriedBySeat,
    windowMs: 8000,
  };
}

function marchView(ownerSeat: number): ReactionView {
  return { kind: "march", cardId: "card-fake", userSeat: 1, ownerSeat, windowMs: 8000 };
}

describe("控制器交互策略公式(#433 canAct 单源)", () => {
  it("相位判定:Playing × turnPhase 全集 × 锁全关 × 我的(人类)决策——除 AwaitingReaction 例外分支外恒可操作", () => {
    for (const hotSeat of [false, true]) {
      for (const turnPhase of TURN_PHASES) {
        const probe = new PolicyProbe(fakeEngine({ turnPhase }), { mySeat: 0, hotSeat });
        expect(probe.interactive).toBe(turnPhase !== "AwaitingReaction");
      }
    }
  });

  it("相位判定:非 Playing(Setup/GameOver)恒不可操作——决策方轮到本端也不放行", () => {
    for (const phase of ["Setup", "GameOver"] as const) {
      for (const hotSeat of [false, true]) {
        const probe = new PolicyProbe(fakeEngine({ phase, decisionOwner: 0 }), {
          mySeat: 0,
          hotSeat,
          fxPlaying: true,
        });
        expect(probe.interactive).toBe(false);
      }
    }
  });

  it("三把锁:主分支 pending×托管×本座位演出 全 8 组合 × 非 AwaitingReaction 的 turnPhase 全集——任一上锁即关(#611:演出锁读数=本座位未落定)", () => {
    for (const turnPhase of TURN_PHASES.filter((t) => t !== "AwaitingReaction")) {
      for (const pending of [false, true]) {
        for (const autoPilot of [false, true]) {
          for (const fxPlaying of [false, true]) {
            const probe = new PolicyProbe(fakeEngine({ turnPhase, decisionOwner: 0 }), {
              mySeat: 0,
              hotSeat: false,
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
      { mySeat: 0, hotSeat: false },
    );

  it("演出锁改绑本座位(#611):他座位行军在途不关门——决策卷轴照弹,别人的棋子照飞", () => {
    try {
      beginMarch("p2", marchKF);
      expect(sessionProbe().interactive).toBe(true);
    } finally {
      abandonAllMarches();
    }
  });

  it("演出锁改绑本座位(#611):本座位行军在途关门,会话落定(播完/作废删会话)即开门", () => {
    try {
      beginMarch("p1", marchKF);
      expect(sessionProbe().interactive).toBe(false);
      abandonMarch("p1");
      expect(sessionProbe().interactive).toBe(true);
    } finally {
      abandonAllMarches();
    }
  });

  it("演出锁读数零兜底(#611):本座位不在引擎座位表当场炸出(控制器/引擎错位是 bug,不静默当无演出)", () => {
    const probe = new PolicyProbe(
      fakeEngine({ decisionOwner: 0, players: [{ isBot: false, id: "p1" }] }),
      { mySeat: 3, hotSeat: true }, // 热座豁免决策方判定 → 公式走到演出锁读数
    );
    expect(() => probe.interactive).toThrow();
  });

  const decisionRows = [
    {
      name: "决策方=我的座位(人类):两语义都放行",
      owner: 0,
      players: [{ isBot: false }, { isBot: false }, { isBot: true }],
      online: true,
      hotSeat: true,
    },
    {
      name: "决策方=他人座位(人类):联机关、热座开(唯一真人座=isBot 判定即座位匹配)",
      owner: 1,
      players: [{ isBot: false }, { isBot: false }, { isBot: true }],
      online: false,
      hotSeat: true,
    },
    {
      name: "决策方=他人座位(bot):两语义都关",
      owner: 2,
      players: [{ isBot: false }, { isBot: false }, { isBot: true }],
      online: false,
      hotSeat: false,
    },
    {
      name: "决策方=我的座位但标 bot:两语义都关(isBot 判定独立生效)",
      owner: 0,
      players: [{ isBot: true }, { isBot: false }],
      online: false,
      hotSeat: false,
    },
  ];
  for (const row of decisionRows) {
    it(`决策方判定 × 热座语义(显式参数化):${row.name}`, () => {
      const make = (hotSeat: boolean): PolicyProbe =>
        new PolicyProbe(
          fakeEngine({
            turnPhase: "AwaitingDecision",
            decisionOwner: row.owner,
            players: row.players,
          }),
          { mySeat: 0, hotSeat },
        );
      expect(make(false).interactive).toBe(row.online);
      expect(make(true).interactive).toBe(row.hotSeat);
    });
  }

  it("反应窗例外:AwaitingReaction 只看「挂起窗存在 × 我在被询问集 × 无在途命令」——决策方/托管/演出锁与热座语义全部不适用", () => {
    const reactionRows = [
      { name: "无挂起窗", view: null as ReactionView | null, queried: false },
      { name: "锦囊窗·我在被询问集", view: jinnangView([0, 2]), queried: true },
      { name: "锦囊窗·我不在集", view: jinnangView([1]), queried: false },
      // 联机脱敏批把非己座位置换为 -1 占位(数量保留):观战端(mySeat=-1)收到的
      // 被询问集逐字拷贝后可含 -1,includes(-1) 可为真——钉死基类显式守卫(不靠
      // 「集合只含真实座位」的推理)。
      { name: "锦囊窗·被询问集含 -1 匿名占位", view: jinnangView([-1]), queried: false },
      { name: "行军拦检窗·我是城主", view: marchView(0), queried: true },
      { name: "行军拦检窗·我不是城主", view: marchView(1), queried: false },
    ];
    for (const row of reactionRows) {
      for (const mySeat of [-1, 0]) {
        for (const pending of [false, true]) {
          // 决策方=bot、托管开、演出播、热座开:四项在反应窗分支全部不适用。
          const probe = new PolicyProbe(
            fakeEngine({
              turnPhase: "AwaitingReaction",
              decisionOwner: 1,
              players: [{ isBot: false }, { isBot: true }],
              pendingReaction: row.view == null ? null : { view: row.view },
            }),
            { mySeat, hotSeat: true, autoPilot: true, fxPlaying: true },
          );
          probe.setPending(pending);
          // 观战(mySeat=-1)不可操作:基类显式守卫排除——被询问集可含 -1 匿名占位
          // (脱敏批逐字拷贝,见上行表),includes(-1) 可为真,非「天然不在集内」。
          const expected = row.view != null && row.queried && mySeat >= 0 && !pending;
          expect(probe.interactive).toBe(expected);
        }
      }
    }
  });
});

describe("OnlineController 参数面(#433 薄测:参数怎么取)", () => {
  it("未入座(mySeat=-1)+ 占位壳 Setup:不可操作;策略公式消费联机参数(热座=false、座位=入座分配)", () => {
    const c = new OnlineController(HUANYOU.map, "huanyou");
    expect(c.viewSeat).toBe(-1);
    expect(c.interactive).toBe(false);
    c.destroy();
  });
});
