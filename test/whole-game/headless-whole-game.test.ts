// 无头整局确定性测试(#1161,票一完成门主体):确定性两跑门 + 快照往返门 + 摘要器
// 单测 + 人类座缝验证。语料 = 内置 guanzhong/zhongyuan + 夹具 yanzhou(test/fixtures/
// maps/,仓内内置图仅两张,第三图走测试夹具)× 10 种子 × 4 bot 座。
// 先红 = 有非确定源(迭代序/对象序/时钟/漏序列化状态),先消灭源再谈台账;
// 票二黄金差分(check:goldens)挂同一套语料,本文件是它的确定性前提门。
// 注意:本文件不装扩展包——bun test 单进程,顶层装载会把扩展名将灌进全局名将池,
// 污染 ADR-0036 数据完整性钉(实锤过);确定性语料只要求自洽,产品池口径属
// sim-batch/cli/server 各入口自载的职责。
import { describe, it, expect } from "bun:test";
import guanzhongData from "../../public/maps/guanzhong.json";
import zhongyuanData from "../../public/maps/zhongyuan.json";
import yanzhouData from "../fixtures/maps/yanzhou.json";
import { loadMap, type LoadedMap } from "@core/board-loader";
import { GameEngine, type SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { botAct } from "@core/bot";
import { canonicalize, hashCanonical, turnDigestOf } from "../../scripts/state-digest";
import {
  decisionSeatOf,
  driveToEnd,
  reactionQueriedSeats,
  runWholeGame,
  wholeGameConfig,
  type WholeGameOptions,
} from "../../scripts/whole-game";
import { CORPUS_MAPS, GOLDEN_SEEDS, botSeats } from "../../scripts/test-corpus";

const MAPS = CORPUS_MAPS;
const SEEDS = GOLDEN_SEEDS;
const TURN_CAP = 3000; // 与 sim-batch 同口径(单玩家回合数)

// ── 摘要器单测 ──
describe("状态摘要器", () => {
  it("同构状态必同哈希:键插入序扰动不改哈希;数组序有意义(语义序)", () => {
    const a = { b: 2, a: { d: 4, c: 3 }, e: [1, 2] };
    const b = { e: [1, 2], a: { c: 3, d: 4 }, b: 2 };
    expect(canonicalize(a)).toEqual(b);
    expect(hashCanonical(b)).toBe(hashCanonical(a));
    expect(hashCanonical({ e: [2, 1] })).not.toBe(hashCanonical({ e: [1, 2] }));
  });
  it("同引擎同状态必同哈希;rngState 随摘要走;异状态异哈希", () => {
    const map: LoadedMap = loadMap(guanzhongData);
    const e = new GameEngine(map.board, map.catalog, createDice(7), {
      seats: botSeats(4),
      targetNetWorth: map.targetNetWorth,
      startingCash: map.startingCash,
      startingTreasures: 0,
    });
    const chain = { hash: "", count: 0 };
    const d1 = turnDigestOf(e, [], chain);
    const d2 = turnDigestOf(e, [], chain);
    expect(d2.stateHash).toBe(d1.stateHash);
    expect(d1.rngState).toBe(e.dice.getRngState());
    e.players[0].cash += 1; // 同构性探针:任何内容差都必须体现在哈希
    const d3 = turnDigestOf(e, [], chain);
    expect(d3.stateHash).not.toBe(d1.stateHash);
  });
});

// 每图首个固定种子常驻默认池;完整语料仅 DAFUNG_SLOW=1 定向执行。
describe("确定性两跑门", () => {
  for (const m of MAPS) {
    for (const seed of SEEDS) {
      const runCase = seed === SEEDS[0] ? it : it.skipIf(!process.env.DAFUNG_SLOW);
      runCase(`${m.id} seed ${seed}:两跑逐位一致且终局可达`, () => {
        const map = loadMap(m.data);
        const opts: WholeGameOptions = { map, mapId: m.id, seed, seats: botSeats(4) };
        const a = runWholeGame(opts);
        const b = runWholeGame(opts);
        expect(a.finished).toBe(true); // 终局可达(触上限 = 平衡发现,红出来人工判读)
        expect(a.digests.length).toBeGreaterThan(0);
        expect(b.digests).toEqual(a.digests); // 摘要逐位(含哈希、游标与事件批)
      });
    }
  }
});

// ── 快照往返门(第 k 回合截断 → 重建续跑 = 对照逐位;漏序列化状态红到修好)──
describe("快照往返门", () => {
  const CASES = [
    { id: "guanzhong", data: guanzhongData, seed: 3001 },
    { id: "zhongyuan", data: zhongyuanData, seed: 3002 },
    { id: "yanzhou", data: yanzhouData, seed: 3003 },
  ] as const;
  const K = 8;
  for (const c of CASES) {
    it(`${c.id} seed ${c.seed}:第 ${K} 笔摘要截断 → 重建续跑 = 对照逐位`, () => {
      const map = loadMap(c.data);
      const opts: WholeGameOptions = { map, mapId: c.id, seed: c.seed, seats: botSeats(4) };
      const ref = runWholeGame(opts);
      expect(ref.finished).toBe(true);
      expect(ref.digests.length).toBeGreaterThan(K + 2); // 截断点须在局中
      const trunc = runWholeGame({ ...opts, stopAfterDigests: K });
      expect(trunc.digests.length).toBe(K);
      // 同 config 重建(wholeGameConfig 单源)→ 快照回灌 → 以截断点摘要续链
      const e2 = new GameEngine(map.board, map.catalog, createDice(c.seed), wholeGameConfig(opts));
      e2.restoreFromSnapshot(trunc.engine.snapshot());
      const anchor = trunc.digests[K - 1];
      const cont = driveToEnd(e2, {
        label: `seed ${c.seed} @ ${c.id} 续跑`,
        turnCap: TURN_CAP,
        logChain: { hash: anchor.logHash, count: anchor.logCount },
      });
      expect(cont.finished).toBe(true);
      expect(cont.digests).toEqual(ref.digests.slice(K));
    });
  }
});

// ── 人类座缝(choice-index 回放接口位,票一预留;完整重放随协议票落地)──
describe("人类座缝", () => {
  const humanSeats = (): SeatConfig[] => [
    { name: "你", isBot: false },
    { name: "黔", isBot: true },
    { name: "荆", isBot: true },
    { name: "宋", isBot: true },
  ];
  it("无缝遇人类决策当场炸(配置错误响亮,不静默代打)", () => {
    const map = loadMap(yanzhouData);
    expect(() => runWholeGame({ map, mapId: "yanzhou", seed: 3001, seats: humanSeats() })).toThrow(
      /onHumanDecision/,
    );
  });
  it("缝可代打:attended 相位 botAct 代驾 + 反应窗人类被询问逐个弃权,全局终局", () => {
    const map = loadMap(yanzhouData);
    const driveHumanSeat = (e: GameEngine): void => {
      // 确定性代打实现(示例即接口位契约):命令一律走批界入口(submitCommand)
      for (;;) {
        if (e.isOver) return;
        if (e.turnPhase === "AwaitingReaction") {
          const answered = new Set((e.pendingReaction?.answers ?? []).map((a) => a.seat));
          const next = reactionQueriedSeats(e).find(
            (s) => !answered.has(s) && e.players[s]?.isBot === false,
          );
          if (next == null) return; // 只剩 bot 座未答 = 引擎代答缺口,交主循环炸出来
          e.submitCommand({ type: "respondReaction", seat: next, use: false });
          continue;
        }
        const seat = decisionSeatOf(e);
        if (seat < 0 || e.players[seat].isBot) return; // bot 座位交还驱动器主循环
        botAct(e);
      }
    };
    const r = runWholeGame({
      map,
      mapId: "yanzhou",
      seed: 3001,
      seats: humanSeats(),
      hooks: { onHumanDecision: driveHumanSeat },
    });
    expect(r.finished).toBe(true);
    expect(r.digests.length).toBeGreaterThan(0);
  });
});
