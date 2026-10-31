// 拦停截断 × 表现队列排空回归钉(#882):真实单机通路(LocalController 进程内房间编排)
// 走完整条「半路杀出拦检 → 拼点胜拦停 → 行人止步截断」链,钉两条不变量:
//   ① 截断结算批播完后 pendingChunks 必清(fx.playing 回落)——#882 假设 (a)
//     「表现块泄漏致 fx 门恒真」的活体反证:泄漏/无界 await 一律在此红;
//   ② 排空时限 ≤ 一个权威反应窗(REACTION_WINDOW_MS.MarchPassedCity)——权威窗不被
//     演出预算饿死的下界口径:答完到队列闲必须发生在窗寿之内,超窗即红。
// #882 定性结论(证据链见票):e2e 三分支走查挂起根因是场景前提破缺(后续 bot 自然骰
// 买走停靠格,人类行军批与 bot 链合并单块,块播时长超过横幅展示寿命,应答交集变空),
// 表现层收支闭合无泄漏——本例即无泄漏侧的常驻单测证词。
// 流程(seed 50 × huanyou,与 react-reaction 三分支走查同款开局):选都 9 建业 →
// 自动起摇落 10 会稽(购地停靠)→ 种植(持半路杀出/bot 挪都城前一格/拼点骰 [6,1])→
// endDecision 放行 → bot1 途经建业开拦检窗 → respondReaction(use=true)→ 拦停截断。
// bun 无 DOM:present 的 DOM/音频触点由 SnapshotEffects 捕获报错(响亮 console.error,
// local-room 同款口径),排空语义照走——队列/状态断言不受影响。
import { describe, it, expect } from "bun:test";
import { MAP } from "../scripts/engine-helpers";
import { LocalController } from "../src/app/controllers/local";
import { REACTION_WINDOW_MS } from "../src/core/constants";

// 慢例池开关:DAFUNG_SLOW=1(bun run test:slow)才跑,默认池 skip(skip 行可见);
// 判据:单例实测 3.1s(2026-10-31)≥3s 且墙钟即用例本体——开局自动起摇看门狗 1s 固定拍
// + 合并结算块的回合横幅停留窗(FX.bannerHoldMs 1000ms @sc=1)皆生产节拍,不可压缩。
const itSlow = it.skipIf(!process.env.DAFUNG_SLOW);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 轮询等待谓词成立(真实定时器驱动的编排链,快照/队列都非同步可达)。 */
async function waitFor(desc: string, probe: () => boolean, timeoutMs: number): Promise<number> {
  const start = performance.now();
  const deadline = start + timeoutMs;
  while (performance.now() < deadline) {
    if (probe()) return performance.now() - start;
    await sleep(20);
  }
  throw new Error(`${desc}:等待超时(${timeoutMs}ms)`);
}

function makeController(): LocalController {
  return new LocalController(MAP, {
    seats: [
      { name: "诸侯1", isBot: false, guohao: "魏" },
      { name: "诸侯2", isBot: true },
      { name: "诸侯3", isBot: true },
      { name: "诸侯4", isBot: true },
    ],
    seed: 50,
    mapId: "huanyou",
    botStepMs: 0, // 单测预算按 0ms bot 连锁书写(#730 配速不进既有用例)
    encounter: { enabled: false, baseRates: { good: 0, neutral: 0, bad: 0 } },
  });
}

describe("拦停截断 × 表现队列排空(#882 回归钉)", () => {
  itSlow(
    "拼点胜拦停截断:结算批播完 pendingChunks 必清,排空耗时不超权威反应窗",
    async () => {
      const c = makeController();
      try {
        const e = c.engine;
        // 开局:进程内房间编排把对局驱动到人类选都;选盘面序最小候选(seed 50 = 9 建业,
        // 与 react-reaction 三分支走查的 DOM 首格同格)。
        expect(e.phase).toBe("Setup");
        c.setupPickCapital(Math.min(...e.offeredCapitals));
        expect(e.players[0].capitalIndex).toBe(9);
        // 等购地停靠(自动起摇看门狗 1s 固定拍 → 掷骰落 10 会稽 → 可购决策)。
        await waitFor(
          "开局购地停靠",
          () =>
            e.phase === "Playing" && e.decisionOwner === 0 && e.turnPhase === "AwaitingDecision",
          15_000,
        );
        // 种植(分支一形态):人类持半路杀出;三 bot 挪人类都城前一格(掷 ≥1 即途经);
        // 拼点骰 [6,1](城主胜,点差 ≥3 大胜)。
        e.players[0].jinnangHand = ["半路杀出"];
        for (let i = 1; i < e.players.length; i++)
          e.players[i].position = (e.players[0].capitalIndex + e.board.count - 1) % e.board.count;
        const origRollDie = e.dice.rollDie.bind(e.dice);
        const queue = [6, 1];
        e.dice.rollDie = () => {
          const v = queue.shift();
          if (queue.length === 0) e.dice.rollDie = origRollDie;
          return v ?? origRollDie();
        };
        // 放行购地卷轴 → bot 链:bot1 自 8 途经 9 建业开拦检窗(挂停,等真人应答)。
        c.dispatchCommand({ type: "endDecision" });
        await waitFor(
          "拦检窗开启",
          () => e.turnPhase === "AwaitingReaction" && e.pendingReaction?.view?.kind === "march",
          15_000,
        );
        const mover = e.pendingReaction!.view.userSeat;
        expect(mover).toBe(1);
        // 应答须经控制器交互门(interactive 依赖 pending 锁,下行拍到达才解锁——
        // 命令在锁内提交会被静默丢弃,e2e answerMarchCounter 的按钮点击同门)。
        await waitFor("应答交互门开启", () => c.interactive, 5_000);
        const tAnswer = performance.now();
        c.dispatchCommand({ type: "respondReaction", seat: 0, use: true, cardId: "半路杀出" });
        // 引擎同步段:拼点胜 → 行人止步首都格(截断)。
        expect(e.players[mover].position).toBe(e.players[0].capitalIndex);
        // ①②表现队列排空:排空耗时不超权威窗长(窗寿是应答预算的上界口径)。
        const windowMs = REACTION_WINDOW_MS.MarchPassedCity;
        const drainMs = await waitFor(
          "表现队列排空(pendingChunks 清零)",
          () => !c.fxBusy,
          windowMs,
        );
        expect(drainMs).toBeLessThan(windowMs);
        expect(c.fxBusy).toBe(false);
        expect((c as unknown as { fx: { pendingChunks: number } }).fx.pendingChunks).toBe(0);
        // 截断即终局稳定:此后不挪(后续 bot 链不再轮到该 bot;牌子随闭窗扣走)。
        expect(e.players[0].jinnangHand.includes("半路杀出")).toBe(false);
        expect(performance.now() - tAnswer).toBeLessThan(windowMs);
      } finally {
        c.destroy();
      }
    },
    30_000,
  );
});
