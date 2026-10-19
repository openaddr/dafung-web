// #615 回归与定向:问询开窗延迟到派发稳定点。根因两层(票面)——
//  ① 扩展效果在时机派发流中段调 askInquiry 直接置 pendingInquiry 并覆写 turnPhase,
//     外层流程(招贤/锦囊→行军→落城交涉)继续跑把相位覆写回去,不变量
//     「pendingInquiry≠null ⟺ turnPhase=AwaitingInquiry」被破坏;
//  ② endTurn 入口挡板见挂起直接 return 但不切相位,引擎停在
//     「AwaitingTreasureOwner + treasureVisitor=null」非法态,resolveInquiry 相位断言
//     永久拒绝,bot 驱动下 treasure-flow 的 g.treasureVisitor! 空引用崩溃。
// 修复拍板:askInquiry 在派发中(深度>0)只入队(deferredInquiries),endTurn 入口与
// resolveInquiry 尾端两个稳定点排空开窗。真实样本 = 太史慈「信义盲选」(HeroRecruited
// 时机 askInquiry),回归配方 = seed 2064 全 bot 局装载真实 extensions/ 跑到 GameOver。
import { describe, it, expect, afterAll, afterEach } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig, TurnPhase } from "@core/authority";
import { createDice } from "@core/dice";
import { botAct } from "@core/bot";
import { ENCOUNTER_PRODUCT_DEFAULTS } from "@core/encounters";
import { loadExtensionPackages } from "@core/extension-loader";
import {
  registerExtensionAuthorityModule,
  unregisterExtensionPackage,
} from "@core/extension-registry";
import type { ExtensionAuthorityModule, ExtensionInquiry } from "@core/extension-contract";
import type { HeroDef } from "@core/heroes";
import type { ChoiceOption } from "@core/choices";
import type { GameMoment } from "@core/timing";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "@core/board-loader";
import { resolve } from "node:path";

const MAP = loadMap(huanyouData);

/** 相位读经函数取值:破除 TS 对 e.turnPhase 的赋值字面量收窄(收窄后 toBe 只收窄字面型)。 */
const phaseOf = (e: GameEngine): TurnPhase => e.turnPhase;

// ── 装载真实扩展目录(太史慈:派发中段 askInquiry 的现实样本;afterAll 精确卸载)──
const loaded = await loadExtensionPackages(resolve(import.meta.dir, "../extensions"));
expect(loaded.map((m) => m.id)).toContain("hero-taishici");
afterAll(() => unregisterExtensionPackage("hero-taishici"));

// ── 全 bot 局驱动(回归配方;范式同 invariant-soak)──
const STEP_LIMIT = 40_000;

function makeAllBotEngine(seed: number, seatCount = 4): GameEngine {
  const seats: SeatConfig[] = Array.from({ length: seatCount }, (_, i) => ({
    name: `Bot${i + 1}`,
    isBot: true,
  }));
  const cfg: EngineConfig = {
    seats,
    targetNetWorth: 30000, // 产品默认(targetNetWorth 缺省),与票面复现配方同口径
    encounter: ENCOUNTER_PRODUCT_DEFAULTS,
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

/** #615 核心不变量:任意命令返回后 pendingInquiry≠null ⟺ turnPhase=AwaitingInquiry。 */
function assertInquiryPhaseInvariant(e: GameEngine, tag: string): void {
  const pending = e.pendingInquiry != null;
  const phased = e.turnPhase === "AwaitingInquiry";
  if (pending !== phased)
    throw new Error(
      `不变量违规·问询相位一致(${tag}):pendingInquiry=${e.pendingInquiry?.id ?? "null"} turnPhase=${e.turnPhase}`,
    );
}

function driveSetup(e: GameEngine): void {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 100) {
    if (e.currentSetupPlayerIndex < 0) break;
    e.aiSetupStep();
  }
}

function driveToOver(e: GameEngine, tag: string): void {
  assertInquiryPhaseInvariant(e, `${tag} 开局`);
  let guard = 0;
  while (!e.isOver) {
    if (guard++ >= STEP_LIMIT)
      throw new Error(
        `${tag}:步数打满 ${STEP_LIMIT} 仍未终局(round=${e.round} phase=${e.phase} turnPhase=${e.turnPhase})`,
      );
    botAct(e);
    assertInquiryPhaseInvariant(e, tag);
  }
}

// ── 假包工装(定向用例;id 随机唯一防同进程冲突,用例自清理)──
const seq = () => Math.random().toString(36).slice(2, 8);
const toUnload: string[] = [];
afterEach(() => {
  while (toUnload.length > 0) unregisterExtensionPackage(toUnload.pop()!);
});

function blindOptions(n: number): ChoiceOption[] {
  return Array.from({ length: n }, (_, i): ChoiceOption => ({
    id: `blind:${i}`,
    label: `暗牌·第${i + 1}张`,
    available: true,
  }));
}

/** 带若干 HeroRecruited 触发技的名将 def(直接塞 offeredHeroes 驱动 resolveHeroPick)。 */
function momentHero(uid: string, skills: { when: GameMoment; effect: string }[]): HeroDef {
  return {
    id: `test-hero-${uid}`,
    name: "试探名将",
    title: "",
    image: "",
    skills: skills.map((s, i) => ({
      id: `test-skill-${uid}-${i}`,
      name: `技${i}`,
      desc: "测试用",
      when: s.when,
      effect: s.effect,
      scope: "self",
    })),
  };
}

/** 准备好常规对局(2 bot,开完局清掉开局锦囊卷轴)。 */
function prepared(seed = 7): GameEngine {
  const seats: SeatConfig[] = [
    { name: "A", isBot: true },
    { name: "B", isBot: true },
  ];
  const cfg: EngineConfig = { seats, targetNetWorth: 30000 };
  const e = new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
  driveSetup(e);
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return e;
}

describe("#615 问询开窗延迟到派发稳定点", () => {
  it("回归:seed 2064 全 bot 局(真实 extensions)跑到 GameOver,问询相位不变量逐步成立", () => {
    const e = makeAllBotEngine(2064);
    driveSetup(e);
    driveToOver(e, "seed=2064");
    expect(e.isOver).toBe(true);
    expect(e.winner).not.toBeNull();
    expect(["LastStanding", "TargetNetWorth"]).toContain(e.winReason);
  });

  it("盲选开窗延迟到 endTurn 边界:派发中段不动相位/载荷,入口排空开窗,应答后补完收口", () => {
    const uid = seq();
    const inquiryId = `test-defer-${uid}`;
    const observed: { phase: TurnPhase; pending: string | null }[] = [];
    registerExtensionAuthorityModule({
      manifest: {
        id: `test-defer-pkg-${uid}`,
        name: "假延期问询包",
        version: "0.0.1",
        entry: "index.js",
      },
      heroes: [],
      effects: {
        [`test-defer-effect-${uid}`]: (engine) => {
          engine.askInquiry(inquiryId, { n: 2 });
          // 发起时刻观测:派发中段不得覆写相位/挂起载荷(入队延期)
          observed.push({ phase: engine.turnPhase, pending: engine.pendingInquiry?.id ?? null });
          return true;
        },
      },
      inquiries: [
        {
          id: inquiryId,
          askPlayer: (ctx) => blindOptions(ctx.params.n ?? 0),
          resolve: () => {},
        },
      ],
    } satisfies ExtensionAuthorityModule);
    toUnload.push(`test-defer-pkg-${uid}`);

    const e = prepared();
    e.turnPhase = "AwaitingHeroPick";
    e.offeredHeroes = [
      momentHero(uid, [{ when: "HeroRecruited", effect: `test-defer-effect-${uid}` }]),
    ];
    e.resolveHeroPick(0);

    // 派发中段:相位未被覆写(仍 AwaitingHeroPick),载荷未挂
    expect(observed).toEqual([{ phase: "AwaitingHeroPick", pending: null }]);
    // resolveHeroPick 尾端 endTurn:入口排空 → 开窗(而非派发中段)
    expect(phaseOf(e)).toBe("AwaitingInquiry");
    expect(e.pendingInquiry?.id).toBe(inquiryId);
    expect(e.deferredInquiries).toEqual([]);
    const activeBefore = e.activeIndex;
    // 应答:回灌后队列已空 → 补完被延期的收口
    e.submitCommand({ type: "resolveInquiry", optionId: "blind:0" });
    expect(e.pendingInquiry).toBeNull();
    expect(e.turnPhase).not.toBe("AwaitingInquiry");
    expect(e.activeIndex).not.toBe(activeBefore);
  });

  it("队列积压多条:逐条开窗,应答后先排空下一条再补完收口(收口不吞积压问询)", () => {
    const uid = seq();
    const id1 = `test-q1-${uid}`;
    const id2 = `test-q2-${uid}`;
    const answers: string[] = [];
    const blind = (id: string): ExtensionInquiry => ({
      id,
      askPlayer: (ctx) => blindOptions(ctx.params.n ?? 0),
      resolve: (_ctx, optionId) => void answers.push(optionId),
    });
    registerExtensionAuthorityModule({
      manifest: {
        id: `test-queue-pkg-${uid}`,
        name: "假积压问询包",
        version: "0.0.1",
        entry: "index.js",
      },
      heroes: [],
      effects: {
        [`test-q1-effect-${uid}`]: (engine) => {
          engine.askInquiry(id1, { n: 2 });
          return true;
        },
        [`test-q2-effect-${uid}`]: (engine) => {
          engine.askInquiry(id2, { n: 2 });
          return true;
        },
      },
      inquiries: [blind(id1), blind(id2)],
    } satisfies ExtensionAuthorityModule);
    toUnload.push(`test-queue-pkg-${uid}`);

    const e = prepared();
    e.turnPhase = "AwaitingHeroPick";
    e.offeredHeroes = [
      momentHero(uid, [
        { when: "HeroRecruited", effect: `test-q1-effect-${uid}` },
        { when: "HeroRecruited", effect: `test-q2-effect-${uid}` },
      ]),
    ];
    e.resolveHeroPick(0);

    // 技能序确定性:第一条已开窗,第二条仍在队(积压)
    expect(phaseOf(e)).toBe("AwaitingInquiry");
    expect(e.pendingInquiry?.id).toBe(id1);
    expect(e.deferredInquiries.map((q) => q.id)).toEqual([id2]);
    const activeBefore = e.activeIndex;
    // 应答第一条:不立即收口,先排空积压的第二条开窗
    e.submitCommand({ type: "resolveInquiry", optionId: "blind:0" });
    expect(answers).toEqual(["blind:0"]);
    expect(e.pendingInquiry?.id).toBe(id2);
    expect(phaseOf(e)).toBe("AwaitingInquiry");
    expect(e.deferredInquiries).toEqual([]);
    expect(e.activeIndex).toBe(activeBefore); // 收口仍延期
    // 应答第二条:队列空 → 收口补完
    e.submitCommand({ type: "resolveInquiry", optionId: "blind:1" });
    expect(answers).toEqual(["blind:0", "blind:1"]);
    expect(e.pendingInquiry).toBeNull();
    expect(e.activeIndex).not.toBe(activeBefore);
  });

  it("语义:入队到开窗/应答期间手牌可变,选项集与结算均以开窗/应答时刻现算(askPlayer 回调)", () => {
    const uid = seq();
    const inquiryId = `test-live-${uid}`;
    const resolved: Array<{ optionId: string; handLen: number }> = [];
    registerExtensionAuthorityModule({
      manifest: {
        id: `test-live-pkg-${uid}`,
        name: "假活手牌问询包",
        version: "0.0.1",
        entry: "index.js",
      },
      heroes: [],
      effects: {
        // 技能 0:按当前手牌数发起盲选( taishici 同式,askPlayer 读实时手牌)
        [`test-live-ask-${uid}`]: (engine) => {
          engine.askInquiry(inquiryId);
          return true;
        },
        // 技能 1:同一派发流内后序技能改手牌(+1)——发起与开窗之间手牌变化的现实样本
        [`test-live-draw-${uid}`]: (engine, ctx) => {
          engine.drawJinnang(ctx.owner, 1);
          return true;
        },
      },
      inquiries: [
        {
          id: inquiryId,
          askPlayer: (ctx) => blindOptions(ctx.engine.players[ctx.seat].jinnangHandCount),
          resolve: (ctx, optionId) =>
            void resolved.push({
              optionId,
              handLen: ctx.engine.players[ctx.seat].jinnangHand.length,
            }),
        },
      ],
    } satisfies ExtensionAuthorityModule);
    toUnload.push(`test-live-pkg-${uid}`);

    const e = prepared();
    const seat = e.activeIndex;
    e.drawJinnang(seat, 2); // 发起时刻手牌 = 开局存量 + 2(经引擎公共方法,计数同步)
    const askTimeHand = e.activePlayer.jinnangHandCount; // askPlayer 读的就是这个计数
    e.turnPhase = "AwaitingHeroPick";
    e.offeredHeroes = [
      momentHero(uid, [
        { when: "HeroRecruited", effect: `test-live-ask-${uid}` },
        { when: "HeroRecruited", effect: `test-live-draw-${uid}` },
      ]),
    ];
    e.resolveHeroPick(0);

    // 开窗(=排空时刻)手牌已 +1(同派发流后序技能):选项集按现手牌现算,
    // 不按发起时刻快照(无陈旧集)
    const optionIds = (n: number) => Array.from({ length: n }, (_, i) => `blind:${i}`);
    expect(phaseOf(e)).toBe("AwaitingInquiry");
    expect(e.choicesFor().map((o) => o.id)).toEqual(optionIds(askTimeHand + 1));
    // 应答时刻再变手牌(+1):选项集与结算都以应答时刻为准
    e.drawJinnang(seat, 1);
    expect(e.choicesFor().map((o) => o.id)).toEqual(optionIds(askTimeHand + 2));
    e.submitCommand({ type: "resolveInquiry", optionId: "blind:1" });
    expect(resolved).toEqual([{ optionId: "blind:1", handLen: askTimeHand + 2 }]);
  });

  it("序列化:延期队列随快照 roundtrip 保真;派发深度为纯运行时态不入快照(恢复后天然 0)", () => {
    const uid = seq();
    const inquiryId = `test-snap-${uid}`;
    registerExtensionAuthorityModule({
      manifest: {
        id: `test-snap-pkg-${uid}`,
        name: "假快照问询包",
        version: "0.0.1",
        entry: "index.js",
      },
      heroes: [],
      effects: {},
      inquiries: [
        {
          id: inquiryId,
          askPlayer: (ctx) => blindOptions(ctx.params.n ?? 0),
          resolve: () => {},
        },
      ],
    } satisfies ExtensionAuthorityModule);
    toUnload.push(`test-snap-pkg-${uid}`);

    const e = prepared();
    // 白盒置非空队列(真实流程中队列存续于派发中段至排空点之间,载荷等价同构)
    e.deferredInquiries.push({ id: inquiryId, params: { n: 2 } });
    const snap = e.snapshot();
    expect(snap.deferredInquiries).toEqual([{ id: inquiryId, params: { n: 2 } }]);

    const seats: SeatConfig[] = [
      { name: "A", isBot: true },
      { name: "B", isBot: true },
    ];
    const e2 = new GameEngine(MAP.board, MAP.catalog, createDice(7), {
      seats,
      targetNetWorth: 30000,
    } satisfies EngineConfig);
    e2.restoreFromSnapshot(snap);
    expect(e2.deferredInquiries).toEqual([{ id: inquiryId, params: { n: 2 } }]);
    expect(e2.momentDispatchDepth).toBe(0); // 深度纯运行时态:恢复后天然 0(不在派发中)
    expect(e2.turnPhase).not.toBe("AwaitingInquiry"); // 队列≠开窗:恢复后不凭空弹问询
    // 恢复后的引擎在下一收口边界照常排空开窗
    e2.endTurn();
    expect(e2.turnPhase).toBe("AwaitingInquiry");
    expect(e2.pendingInquiry?.id).toBe(inquiryId);
  });
});
