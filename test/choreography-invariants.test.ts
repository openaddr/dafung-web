// 编排不变量锁定(#117 收编批次):JS 侧编排时长唯一收口 fx/timings.ts(演出编排族经
// scStage、界面/节拍族经 sc 包裹,无 localStorage 键且追帧倍率 1 时逐位等于字面量),
// CSS 侧时长唯一源 core/theme.ts Motion
// (经 gen:theme 产出 tokens.css)。本测试钉死常量「之间」的编排关系,防止调参或后续
// 收编时悄悄破坏演出语义:
//   横幅 — FX.bannerMs 必须大于 CSS 演出全长 Motion.dur.banner(余量为正,播完有余再清),
//          FX.bannerHoldMs 必须小于 FX.bannerMs(停留窗是编排窗的子区间);
//   骰子 — DICE.holdMs + DICE.fadeOutMs ≥ 300(timings.ts 注释原文:任何掷骰
//          (含 bot)结束后都有 ≥300ms 可读结果;终局封场豁免:胜利屏挂载即封场
//          (orchestrator.finishPresentation),终局局的骰子可在事件边界被整体截断,
//          是生命周期规则不是回归);S7 两段式 bot 半速语义(bot 摇签
//          严格短于人类摇签);
//   S7 仪式 — 破产三拍时间轴递增(墨渍拍 < 撒币拍 < 收口),拼点签面节拍有序
//          (幕启 < 摇、错拍落 < 判词);
//   行军/bot — 段时长夹取区间必须有序、bot 回合节奏必须真实等待;
//   倍率地板 — TIME_SCALE_FLOOR_MS ≥ 100(headless+软渲的可观察下限不被悄悄调低)。
// 数值本身的逐位锁定在 test/e2e-time-scale.test.ts(生产恒等快照),本文件只管关系。
//
// ADR-0029 起(#608)本文件兼守演出自洽不变量的运行时面(类型面守卫 =
// FxSink 签名编译期摸不到引擎):「提取即定格」——提取完成后引擎继续推进/篡改
// players,再播放,memorySink 逐帧坐标与提取拍预计算完全一致,防提取器内藏
// 活引用延迟求值(播放期现算即本不变量禁绝的旧病)。
import { describe, it, expect } from "bun:test";
import { BOT, CEREMONY, DICE, DUEL, FX, MARCH, TIME_SCALE_FLOOR_MS } from "../src/app/fx/timings";
import { Motion } from "../src/core/theme";
import { GameEngine } from "../src/core/authority";
import type { EngineConfig } from "../src/core/authority";
import { createDice } from "../src/core/dice";
import { TOKEN_SLOT_OFFSETS } from "../src/core/constants";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "../src/core/board-loader";
import { testEngine } from "../src/core/testing";
import { anchorMarches, extractBatchEvents } from "../src/app/fx/event-extract";
import { present, resetFxOrchestration } from "../src/app/fx/orchestrator";
import { createMemorySink } from "../src/app/fx/sinks";
import type { MarchSegmentFrames, PresentationEvent } from "../src/app/fx/presentation";

describe("编排不变量(fx/timings.ts 收口与 core/theme.ts Motion 的关系)", () => {
  it("横幅余量为正:FX.bannerMs > Motion.dur.banner(CSS 演出播完有余再清)", () => {
    expect(FX.bannerMs).toBeGreaterThan(Motion.dur.banner);
  });

  it("横幅停留窗是编排窗的子区间:FX.bannerHoldMs < FX.bannerMs", () => {
    expect(FX.bannerHoldMs).toBeLessThan(FX.bannerMs);
  });

  it("骰子可读结果:DICE.holdMs + DICE.fadeOutMs >= 300(任何掷骰(含 bot)结束后有 ≥300ms 可读结果)", () => {
    expect(DICE.holdMs + DICE.fadeOutMs).toBeGreaterThanOrEqual(300);
  });

  it("骰签两段式 bot 半速语义(S7):bot 摇签严格短于人类摇签,bot 停留严格短于人类停留", () => {
    expect(DICE.botShakeMs).toBeLessThan(DICE.shakeMs);
    expect(DICE.botHoldMs).toBeLessThan(DICE.holdMs);
  });

  it("破产仪式三拍时间轴递增(S7):墨渍拍 < 撒币拍 < 收口,倒旗全长落在收口窗内", () => {
    expect(CEREMONY.blotAtMs).toBeLessThan(CEREMONY.coinsAtMs);
    expect(CEREMONY.coinsAtMs).toBeLessThan(CEREMONY.settleMs);
    expect(CEREMONY.fallMs).toBeLessThanOrEqual(CEREMONY.settleMs);
  });

  it("拼点签面节拍有序(#637,ADR-0030):幕启 < 摇,错拍落 < 判词,判词停留与收场渐出俱为正", () => {
    expect(DUEL.curtainMs).toBeGreaterThan(0); // 幕启:玄墨幕渐入+两签虚位(摇签等幕启后起跑)
    expect(DUEL.curtainMs).toBeLessThan(DUEL.shakeMs); // 幕启 < 并行起摇
    expect(DUEL.clackGapMs).toBeLessThan(DUEL.verdictMs); // 座位序错拍落 < 判词拍(错拍=clackGap 间隙,延续既有拼点节拍)
    expect(DUEL.holdMs).toBeGreaterThan(0); // 判词停留(金圈/金平可读窗)
    expect(DUEL.fadeOutMs).toBeGreaterThan(0); // 整幕渐出
  });

  // 大胜负点差档(blowoutMargin)的行为断言归位 test/presentation.test.ts isBlowout
  // 边界两支(#639)——此处原「>= 1」近恒真断言已删(测试宁缺毋滥)。

  it("行军段时长夹取区间有序:MARCH.minSegMs < MARCH.maxSegMs", () => {
    expect(MARCH.minSegMs).toBeLessThan(MARCH.maxSegMs);
  });

  it("bot 回合节奏真实等待:BOT.stepDelayMs > 0", () => {
    expect(BOT.stepDelayMs).toBeGreaterThan(0);
  });

  it("倍率地板不被悄悄调低:TIME_SCALE_FLOOR_MS >= 100", () => {
    expect(TIME_SCALE_FLOOR_MS).toBeGreaterThanOrEqual(100);
  });
});

// ─────────────── 不变量①提取即定格(ADR-0029,#608)───────────────
const CHOREO_MAP = loadMap(huanyouData);

function choreoEngine(seed = 7): GameEngine {
  const cfg: EngineConfig = {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 8000,
  };
  return new GameEngine(CHOREO_MAP.board, CHOREO_MAP.catalog, createDice(seed), cfg);
}

/** 选都到完成(照 presentation.test 的构造:人类选第一个空城,bot 自动)。 */
function choreoSetup(e: GameEngine) {
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
  e.players.forEach((p) => {
    p.jinnangHand = [];
    p.jinnangHandCount = 0;
  });
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
}

/** 独立规格:落格槽位偏移(批终占用,分组=剔破产、组内序=玩家数组序、取模槽位圆周)。
 *  本函数是公式锚:提取烤制与 TokenLayer 声明式分组必须与之同源,任一侧分叉先在此红。 */
function specSlotOffset(
  players: readonly { id: string; position: number; isBankrupt: boolean }[],
  self: { id: string; position: number },
): { x: number; y: number } {
  const mates = players
    .filter((p) => !p.isBankrupt && p.position === self.position)
    .map((p) => p.id);
  const idx = Math.max(0, mates.indexOf(self.id));
  return TOKEN_SLOT_OFFSETS[idx % TOKEN_SLOT_OFFSETS.length];
}

/** 定格场景(合成批,无掷骰随机性):座 1 行军 4 格,座 0 先占其落格——mover 在
 *  同格分组中排第 2,槽位偏移取 TOKEN_SLOT_OFFSETS[1] 而非 [0],规格断言才有区分度。 */
function frozenMarchScene(seed = 7): {
  e: GameEngine;
  events: PresentationEvent[];
  march: Extract<PresentationEvent, { kind: "tokenMoved" }>;
  startTile: number;
} {
  const e = choreoEngine(seed);
  choreoSetup(e);
  const mover = e.players[1];
  const startTile = (mover.capitalIndex + 3) % e.board.count; // 避开己都城:4 格无截断
  const path = e.board.computePath(startTile, 4, mover.capitalIndex);
  testEngine(e).place(0, path.landIndex); // 批终占用:座 0 恰在 mover 落格(同格双人)
  testEngine(e).place(1, path.landIndex);
  const events = extractBatchEvents(
    e,
    [{ kind: "marchArrived", seat: 1, round: 1, turn: 1, tileIndex: path.landIndex, path }],
    [null, startTile], // 转移前位置:座 1 在路径起点
  );
  const march = events.find(
    (ev): ev is Extract<PresentationEvent, { kind: "tokenMoved" }> => ev.kind === "tokenMoved",
  );
  if (march == null) throw new Error("定格场景未产出行军表现(合成 marchArrived 必产)");
  return { e, events, march, startTile };
}

describe("不变量①提取即定格(ADR-0029 #608)", () => {
  it("提取拍烤 keyframes:段序列=起点中心→弧线途经→终点,末帧=批终落位中心+槽位偏移(与声明式分组同源规格)", () => {
    const { e, march, startTile } = frozenMarchScene();
    const board = e.board;
    const path = board.computePath(startTile, 4, e.players[1].capitalIndex);
    // 段数 = 实走格数;首帧 = 起点中心
    expect(march.keyframes.length).toBe(path.traversed.length);
    expect(march.keyframes[0].points[0]).toEqual(board.positionOf(path.from));
    // 逐段:流光折线两端=格中心(不含槽位偏移),途经数与行走点一致
    let prev = path.from;
    for (const [i, seg] of march.keyframes.entries()) {
      const tile = path.traversed[i];
      const wps = board.edgeWaypoints(prev, tile);
      expect(seg.flow.length).toBe(wps.length + 2);
      expect(seg.flow[0]).toEqual(board.positionOf(prev));
      expect(seg.flow[seg.flow.length - 1]).toEqual(board.positionOf(tile));
      expect(seg.points.length).toBe(seg.flow.length);
      expect(seg.points[0]).toEqual(board.positionOf(prev));
      prev = tile;
    }
    // 末帧 = 批终落位中心 + 槽位偏移(独立规格复算:mover 与座 0 同格、排位第 2 → 槽 1)
    const off = specSlotOffset(e.players, e.players[1]);
    expect(off).toBe(TOKEN_SLOT_OFFSETS[1]); // 场景确有区分度:不是槽 0
    const last = march.keyframes[march.keyframes.length - 1];
    expect(last.points[last.points.length - 1]).toEqual({
      x: board.positionOf(path.landIndex).x + off.x,
      y: board.positionOf(path.landIndex).y + off.y,
    });
    // 末段流光终点仍是格中心(落格槽位偏移不污染驿道流光弧线)
    expect(last.flow[last.flow.length - 1]).toEqual(board.positionOf(path.landIndex));
  });

  it("定格:提取后引擎继续推进+篡改 players 位置,再播放(marchBegin/marchToken)逐帧坐标与提取拍预计算完全一致", async () => {
    resetFxOrchestration(); // 防并行测试文件的封场态泄漏(bun test 单进程顺序跑)
    const { e, events, march } = frozenMarchScene();
    const frozen = structuredClone(march.keyframes) as MarchSegmentFrames[];
    expect(Array.isArray(frozen)).toBe(true); // 形状守卫:旧形状(path)在此即红,防空洞通过
    // 引擎继续推进+篡改:两子改泊他格且再度同格——若 keyframes 内藏活引用或播放期
    // 现算槽位/路径,此处的占用/位置改写必然泄入播放坐标
    const far = (e.players[0].position + 9) % e.board.count;
    testEngine(e).place(0, far);
    testEngine(e).place(1, far);
    const sink = createMemorySink();
    anchorMarches(events, sink); // play() 拍的锚定:与 marchToken 同 keyframes
    await present(events, sink);
    const begin = sink.calls.find((c) => c.op === "marchBegin");
    const played = sink.calls.find((c) => c.op === "march");
    if (begin == null || played == null) throw new Error("播放未产出行军 sink 调用");
    if (begin.op !== "marchBegin" || played.op !== "march") throw new Error("unreachable");
    expect(begin.keyframes).toEqual(frozen);
    expect(played.keyframes).toEqual(frozen);
  });
});
