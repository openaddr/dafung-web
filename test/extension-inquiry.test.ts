// 定制问询挂点端到端(#432 词汇接通 → #424 相位化消费,ADR-0022 交互 handler):
// 假 inquiry 包断言——
//  1. askPlayer 出选项:askInquiry 置挂起载荷进 AwaitingInquiry 相位(≥2 可用),选项集经
//     PHASE_CHOICES 注册条目按 id 回调产出(决策归属座位与 params 如实送达 handler);
//  2. 快照 choices 带 id:选项统一盖 inquiryId 章,serializeGame 透出、恢复后重算一致
//     (挂起载荷随快照走,联机/恢复不丢问询);
//  3. 呈现意图查得到:快照选项的 inquiryId 经客户端呈现读口命中注册意图;
//  4. ADR-0013 分流:=1 可用自动执行(回灌 resolve,不进相位)、=0 可用作废(留痕);
//  5. 命令路由:endTurn 收口延期 → resolveInquiry 回灌 resolve → 补完收口;
//     未知/不可用选项 warn 拒绝(挂起保持);
//  6. 零兜底:未注册 id 发起即炸;挂起后卸包查无注册问询当场炸;收口期时机内发起违约炸。
// 另钉:相位计算器优先(handler 只接管 choices 无法自然表达的问询,ADR-0022 咬合口径)。
// 注册是模块级全局态:假包 id 随机唯一,用例自清理,不向同进程其他测试文件泄漏。
import { describe, it, expect, afterEach } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { botAct } from "@core/bot";
import {
  registerExtensionAuthorityModule,
  unregisterExtensionPackage,
} from "@core/extension-registry";
import type { ExtensionAuthorityModule } from "@core/extension-contract";
import type { ChoiceOption } from "@core/choices";
import {
  extensionInquiryPresentationOf,
  registerExtensionClientPackage,
  unregisterExtensionClientPackage,
} from "@app/extensions/registry";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(huanyouData);

const SEATS2: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: true },
];

function makeEngine(seed = 7, seats: SeatConfig[] = SEATS2): GameEngine {
  const cfg: EngineConfig = { seats, targetNetWorth: 30000 };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

/** 开好局并清掉开局锦囊卷轴,回到常规相位(Roll)。 */
function prepared(seed?: number, seats?: SeatConfig[]) {
  const e = makeEngine(seed, seats);
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) {
      e.aiSetupStep();
    } else {
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
    }
  }
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return e;
}

// ── 假 inquiry 包(权威侧问询 + 客户端呈现意图,随机唯一 id 防跨文件冲突)──
const seq = Math.random().toString(36).slice(2, 8);
const INQUIRY_ID = `test-blind-pick-${seq}`;
const PKG_ID = `test-inquiry-pkg-${seq}`;

/** 盲选问询:params.n 张暗牌,label 是序号不是牌面(脱敏先例同示例包);
 *  params 缺项 handler 自己炸出(包作者纪律,contract 口径)。captured 记录
 *  askPlayer 座位与 resolve 应答(#424 回灌观测位)。 */
function fakeInquiryModule(captured: {
  seat: number[];
  answers: Array<{ optionId: string; seat: number }>;
}): ExtensionAuthorityModule {
  return {
    manifest: { id: PKG_ID, name: "假问询包", version: "0.0.1", entry: "index.js" },
    inquiries: [
      {
        id: INQUIRY_ID,
        askPlayer: (ctx) => {
          captured.seat.push(ctx.seat);
          if (ctx.params.n == null) throw new Error(`问询 ${INQUIRY_ID}:缺必填 params.n`);
          return Array.from({ length: ctx.params.n }, (_, i): ChoiceOption => ({
            id: `blind:${i}`,
            label: `暗牌·第${i + 1}张`,
            available: true,
          }));
        },
        resolve: (ctx, optionId) => {
          captured.answers.push({ optionId, seat: ctx.seat });
        },
      },
    ],
  };
}

const loadedPkgs: string[] = [];
const loadedClientPkgs: string[] = [];
afterEach(() => {
  while (loadedPkgs.length > 0) unregisterExtensionPackage(loadedPkgs.pop()!);
  while (loadedClientPkgs.length > 0) unregisterExtensionClientPackage(loadedClientPkgs.pop()!);
});

/** 装载假问询包(权威侧 + 客户端呈现意图一并注册,返回 askPlayer/resolve 观测位)。 */
function loadFakeInquiry(): {
  captured: { seat: number[]; answers: Array<{ optionId: string; seat: number }> };
} {
  const captured = {
    seat: [] as number[],
    answers: [] as Array<{ optionId: string; seat: number }>,
  };
  registerExtensionAuthorityModule(fakeInquiryModule(captured));
  loadedPkgs.push(PKG_ID);
  registerExtensionClientPackage(
    { id: PKG_ID, name: "假问询包", version: "0.0.1", entry: "index.js" },
    {
      interactions: {
        inquiryPresentation: (id) => (id === INQUIRY_ID ? { blindCards: true } : null),
      },
    },
  );
  loadedClientPkgs.push(PKG_ID);
  return { captured };
}

/** 装载带不可用项的问询(命令路拒绝路径断言用):两项可用 + 一项灰置(≥2 可用才进
 *  相位,ADR-0013 分流)。返回问询 id(随机唯一)与 resolve 应答记录。 */
function loadMixedInquiry(): { id: string; answers: string[] } {
  const id = `test-mixed-${Math.random().toString(36).slice(2, 8)}`;
  const pkgId = `test-mixed-pkg-${Math.random().toString(36).slice(2, 8)}`;
  const answers: string[] = [];
  registerExtensionAuthorityModule({
    manifest: { id: pkgId, name: "假混合问询包", version: "0.0.1", entry: "index.js" },
    inquiries: [
      {
        id,
        askPlayer: () => [
          { id: "ok1", label: "可行项一", available: true },
          { id: "ok2", label: "可行项二", available: true },
          { id: "blocked", label: "不可行项", available: false, reason: "门槛未达" },
        ],
        resolve: (_ctx, optionId) => void answers.push(optionId),
      },
    ],
  });
  loadedPkgs.push(pkgId);
  return { id, answers };
}

/** 装载收口期违约问询:效果挂 TurnStart 时机(scope any),发起 ≥2 可用问询。 */
function loadTurnStartInquiry(): { inquiryId: string; heroDefId: string } {
  const inquiryId = `test-ts-${Math.random().toString(36).slice(2, 8)}`;
  const pkgId = `test-ts-pkg-${Math.random().toString(36).slice(2, 8)}`;
  const heroDefId = `test-ts-hero-${Math.random().toString(36).slice(2, 8)}`;
  registerExtensionAuthorityModule({
    manifest: { id: pkgId, name: "假收口问询包", version: "0.0.1", entry: "index.js" },
    skills: [
      {
        id: `${heroDefId}-skill`,
        name: "收口发问",
        desc: "测试用:TurnStart 时机发起定制问询(违约样本)",
        when: "TurnStart",
        effect: `${heroDefId}-effect`,
        scope: "any",
      },
    ],
    heroes: [
      {
        id: heroDefId,
        name: "试探名将",
        title: "收口期",
        image: "",
        skillPool: [`${heroDefId}-skill`],
      },
    ],
    effects: {
      [`${heroDefId}-effect`]: (engine) => {
        engine.askInquiry(inquiryId, { n: 2 });
        return true;
      },
    },
    inquiries: [
      {
        id: inquiryId,
        askPlayer: (ctx) =>
          Array.from({ length: ctx.params.n ?? 0 }, (_, i): ChoiceOption => ({
            id: `blind:${i}`,
            label: `暗牌·第${i + 1}张`,
            available: true,
          })),
        resolve: () => {},
      },
    ],
  });
  loadedPkgs.push(pkgId);
  return { inquiryId, heroDefId };
}

describe("定制问询选项集生产(#432 词汇接通)", () => {
  it("askPlayer 出选项 → 快照 choices 带 inquiryId → 呈现意图查得到;恢复 round-trip 不丢", () => {
    const { captured } = loadFakeInquiry();
    const e = prepared();
    e.askInquiry(INQUIRY_ID, { n: 2 });

    // ≥2 可用 → 进 AwaitingInquiry 相位;选项集经注册条目按 id 回调:选项来自 askPlayer
    expect(e.turnPhase).toBe("AwaitingInquiry");
    const choices = e.choicesFor();
    expect(choices).toEqual([
      { id: "blind:0", label: "暗牌·第1张", available: true, inquiryId: INQUIRY_ID },
      { id: "blind:1", label: "暗牌·第2张", available: true, inquiryId: INQUIRY_ID },
    ]);
    // 决策归属座位如实送达 handler(单机人类在座;askInquiry 分流与 choicesFor 派生
    // 各回调一次——askPlayer 纯函数,重复产出同一选项集是口径内行为)
    expect(captured.seat.every((s) => s === e.decisionOwner)).toBe(true);
    expect(captured.seat.length).toBeGreaterThanOrEqual(1);

    // 快照 choices 带 id;挂起载荷随快照走,恢复后重算一致(联机/恢复不丢问询)
    const snap = e.snapshot();
    expect(snap.choices).toEqual(choices);
    const e2 = makeEngine();
    e2.restoreFromSnapshot(snap);
    expect(e2.pendingInquiry).toEqual({ id: INQUIRY_ID, params: { n: 2 } });
    expect(e2.turnPhase).toBe("AwaitingInquiry");
    expect(e2.choicesFor()).toEqual(choices);

    // 呈现意图:客户端读口按快照选项携带的 inquiryId 命中牌背意图
    const inquiryId = snap.choices[0]!.inquiryId;
    if (inquiryId == null) throw new Error("快照选项未携带 inquiryId(词汇断链)");
    expect(extensionInquiryPresentationOf(inquiryId)).toEqual({ blindCards: true });
    expect(extensionInquiryPresentationOf("no-such-inquiry")).toBeNull();
  });

  it("相位计算器优先:handler 只接管 choices 无法自然表达的问询(注册相位不回调)", () => {
    loadFakeInquiry();
    const e = prepared();
    e.askInquiry(INQUIRY_ID, { n: 2 });
    // 已注册决策相位的选项集照常产出,不被问询劫持(测试直拨相位探针;真实流里
    // 挂起问询 ⇔ AwaitingInquiry,见 #424 不变量)
    e.turnPhase = "AwaitingTreasureOwner";
    const choices = e.choicesFor();
    expect(choices.map((o) => o.id)).toEqual(["fair", "premium", "decline"]);
    expect(choices.every((o) => o.inquiryId === undefined)).toBe(true);
    // 回到问询相位,挂起问询接管选项集
    e.turnPhase = "AwaitingInquiry";
    expect(e.choicesFor().every((o) => o.inquiryId === INQUIRY_ID)).toBe(true);
  });

  it("零兜底:未注册 id 发起即炸;挂起后卸包查无注册问询当场炸(不静默跳过)", () => {
    const e = prepared();
    expect(() => e.askInquiry("no-such-inquiry")).toThrow(/无注册问询/);

    loadFakeInquiry();
    e.askInquiry(INQUIRY_ID, { n: 2 });
    expect(e.pendingInquiry).toEqual({ id: INQUIRY_ID, params: { n: 2 } });
    // 对局中途卸包 = 挂起 id 悬空,读选项集必须炸出而不是静默回空
    unregisterExtensionPackage(PKG_ID);
    loadedPkgs.pop();
    expect(() => e.choicesFor()).toThrow(/查无注册问询/);
  });
});

describe("定制问询相位化消费与命令路由(#424)", () => {
  it("≥2 可用:进相位等应答;endTurn 收口延期;resolveInquiry 回灌 resolve 后补完收口", () => {
    const { captured } = loadFakeInquiry();
    const e = prepared();
    e.askInquiry(INQUIRY_ID, { n: 2 });
    expect(e.turnPhase).toBe("AwaitingInquiry");
    const activeBefore = e.activeIndex;

    // 收口延期:发起方流程调 endTurn 时问询未应答 → 原样返回(相位/座位/载荷不动)
    e.endTurn();
    expect(e.turnPhase).toBe("AwaitingInquiry");
    expect(e.activeIndex).toBe(activeBefore);
    expect(e.pendingInquiry).toEqual({ id: INQUIRY_ID, params: { n: 2 } });

    // 命令路应答(经 submitCommand,与 UI/联机同路):回灌 resolve → 清载荷 → 补完收口
    e.submitCommand({ type: "resolveInquiry", optionId: "blind:1" });
    expect(captured.answers).toEqual([{ optionId: "blind:1", seat: activeBefore }]);
    expect(e.pendingInquiry).toBeNull();
    expect(e.turnPhase).not.toBe("AwaitingInquiry"); // 收口已完成(轮转推进)
    expect(e.activeIndex).not.toBe(activeBefore);
    // 战报留痕:应答行可查
    expect(
      e.log.some((l) => l.detail.includes("inquiryResolve") && l.detail.includes("blind:1")),
    ).toBe(true);
  });

  it("命令路拒绝:未知选项/不可用选项 warn 拒绝,挂起问询保持(不静默吞应答)", () => {
    loadFakeInquiry();
    const mixed = loadMixedInquiry();
    const e = prepared();
    e.askInquiry(mixed.id, {});
    expect(e.turnPhase).toBe("AwaitingInquiry");
    const phase = () => e.choicesFor().map((o) => o.id);

    // 未知选项:warn 拒绝,挂起不动
    e.resolveInquiry("no-such-option");
    expect(e.pendingInquiry).toEqual({ id: mixed.id, params: {} });
    expect(phase()).toEqual(["ok1", "ok2", "blocked"]);
    // 不可用选项:warn 拒绝(可用性唯一口径在选项集),挂起不动
    e.resolveInquiry("blocked");
    expect(e.pendingInquiry).toEqual({ id: mixed.id, params: {} });
    expect(mixed.answers).toEqual([]);
    expect(e.log.some((l) => l.detail.includes("warn: ResolveInquiry"))).toBe(true);
    // 可行项应答:回灌 resolve、清载荷、续收口
    e.resolveInquiry("ok1");
    expect(mixed.answers).toEqual(["ok1"]);
    expect(e.pendingInquiry).toBeNull();
    expect(e.turnPhase).not.toBe("AwaitingInquiry");
  });

  it("ADR-0013 分流:=1 可用自动执行(不进相位);=0 可用作废留痕", () => {
    const { captured } = loadFakeInquiry();
    const e = prepared();
    // 唯一可用项:askInquiry 直接回灌 resolve,相位不动、载荷即刻清账
    e.askInquiry(INQUIRY_ID, { n: 1 });
    expect(captured.answers).toEqual([{ optionId: "blind:0", seat: e.decisionOwner }]);
    expect(e.pendingInquiry).toBeNull();
    expect(e.turnPhase).not.toBe("AwaitingInquiry");
    expect(
      e.log.some((l) => l.detail.includes("inquiryResolve") && l.detail.includes("auto")),
    ).toBe(true);
    // 自动执行轻提示宣告(#719 四件套):inquiryAutoExecuted 事件,label 随事件走
    const events = e.snapshot().events;
    const auto = events.find((v) => v.kind === "inquiryAutoExecuted");
    expect(auto).toBeDefined();
    if (auto?.kind === "inquiryAutoExecuted") {
      expect(auto.seat).toBe(e.decisionOwner);
      expect(auto.inquiryId).toBe(INQUIRY_ID);
      expect(auto.optionId).toBe("blind:0");
      expect(typeof auto.label).toBe("string");
      expect(auto.label.length).toBeGreaterThan(0);
    }
    // 零可用:问询作废(战报留痕),不留悬载荷
    e.askInquiry(INQUIRY_ID, { n: 0 });
    expect(e.pendingInquiry).toBeNull();
    expect(e.turnPhase).not.toBe("AwaitingInquiry");
    expect(e.log.some((l) => l.detail.includes("inquiryVoid"))).toBe(true);
  });

  it("收口期违约:TurnStart 等收口期时机内 askInquiry → endTurn 不变量断言当场炸", () => {
    const { inquiryId, heroDefId } = loadTurnStartInquiry();
    const e = prepared();
    // 违约样本名将入麾下(scope any:收口推进到任何座位都触发)
    e.activePlayer.heroes.push({
      id: heroDefId,
      name: "试探名将",
      title: "收口期",
      image: "",
      skillPool: [`${heroDefId}-skill`], // 技已随包注册进技表,池按 id 引用(ADR-0036)
    });
    expect(() => e.endTurn()).toThrow(/收口过程中被挂起/);
    void inquiryId;
  });

  it("bot 应答:AwaitingInquiry 相位 botAct 随机择一可用项回灌(不悬停)", () => {
    const { captured } = loadFakeInquiry();
    const e = prepared();
    e.askInquiry(INQUIRY_ID, { n: 3 });
    expect(e.turnPhase).toBe("AwaitingInquiry");
    botAct(e);
    expect(captured.answers).toHaveLength(1);
    expect(["blind:0", "blind:1", "blind:2"]).toContain(captured.answers[0]!.optionId);
    expect(e.pendingInquiry).toBeNull();
    expect(e.turnPhase).not.toBe("AwaitingInquiry");
  });
});
