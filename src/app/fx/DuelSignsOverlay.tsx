// 拼点签面(#637,ADR-0030):玩家对拼的全屏骰面演出——掷骰签面(DiceOverlay)的
// 多签变体。玄墨幕渐入,每名参与者一枚骨牌大字签面并排立起(签头=玩家色底+国号),
// 并行起摇(虚影轮换,悬念并行不拉长全程)→ 依座位序错拍落定(延续既有拼点 clackGap
// 节拍)→ 判词拍(胜者金光圈+金描边、败者降饱和沉暗,零「胜/负」文字章,DESIGN §4.6
// 状态表达原则;平局双方无圈、中缝朱砂「拼」印钤变金「平」——「都没圈」与「还没判」
// 不可区分,这是文字该承载的语义例外)→ 停留渐出。点差 ≥DUEL.blowoutMargin 判词拍
// 震屏(DESIGN §6 拼点大胜负)。整场固定全速,不随 bot 半速(公共大事件非回合等待)。
// 签面收场后棋盘后效(止步/续走/银两浮字)才登场:present 串行 await 本组件返回的
// Promise 天然保证(orchestrator duelSigns case → sink.showDuelSigns)。
// 模块桥模式同 DiceOverlay:mount/unmount 归 React(挂 Game 屏一次),触发走
// duelSignsApi 模块桥——生产 sink(sinks.ts,非 React 世界)直调,实例不进 store。
import { useEffect } from "react";
import { SIGN_FACES } from "@core/constants";
import { playerColor, rgba } from "@core/theme";
import { TESTIDS } from "@app/screens/game/testids";
import { getAudio } from "./audio";
import { shakeDesk } from "./desk";
import type { DuelSignsEvent, DuelSide } from "./presentation";
import { DUEL, delay } from "./timings";

// 在场 overlay 引用(D2 终局提前收场用;present() 串行 await,同时至多一场)。
let activeOverlay: HTMLElement | null = null;

/** D2:签面演出提前收场(生产调用口 = orchestrator.finishPresentation,胜利屏
 *  挂载封场整个表现层时连带调用)。生命周期规则而非兜底:对局结束 = 表现层使命
 *  终结——立即移除在场 overlay,防 z-45 残留压住胜利屏。节拍定时器不取消:闭包只
 *  触碰自己的 overlay 节点,节点移除后均为无害操作(delay 链照常走完),play() 的
 *  Promise 照常 resolve,不会吊死 present() 编排链。overlay 类名由本模块创建且唯一。 */
export function finishDuelSigns(): void {
  activeOverlay?.remove();
  activeOverlay = null;
}

/** 单枚签面的 DOM 手柄:根签卡 + 签身字面(摇签轮换写面、落定写真面)。 */
interface SignHandle {
  root: HTMLDivElement;
  face: HTMLDivElement;
  side: DuelSide;
}

/** 骨牌大字签面(签头=玩家色底+国号,签身=毛笔大字虚位)。字面内容摇签期由
 *  轮换句柄驱动,此处留空。 */
function buildSign(side: DuelSide): SignHandle {
  const root = document.createElement("div");
  root.className = "duel-sign"; // 幕启虚位基态(半透立起、字面缺席,fx.css)
  root.setAttribute("data-testid", TESTIDS.duelSign(side.seat));
  root.style.setProperty("--player-color", rgba(playerColor(side.colorIndex)));
  const head = document.createElement("div");
  head.className = "duel-sign-head";
  head.textContent = side.guohao;
  const face = document.createElement("div");
  face.className = "duel-sign-face";
  root.appendChild(head);
  root.appendChild(face);
  return { root, face, side };
}

/** 起摇:签面入虚影态,墨字虚影按 DUEL.shakeMs/10 周期轮换+微旋(字面不落定=悬念;
 *  全段恰 10 次换签,同 DiceOverlay 摇签口径)。返回停摇句柄(落定拍调用)。 */
function startShaking(sign: SignHandle): () => void {
  sign.root.classList.add("duel-sign-shaking");
  let swaps = 0;
  const shuffler = window.setInterval(
    () => {
      swaps += 1;
      sign.face.textContent = SIGN_FACES[swaps % SIGN_FACES.length];
      sign.face.style.rotate = `${(Math.random() - 0.5) * 12}deg`;
    },
    Math.max(1, Math.round(DUEL.shakeMs / 10)),
  );
  return () => {
    window.clearInterval(shuffler);
    sign.face.style.rotate = "";
  };
}

/** 落定:真面 outBack 钤落 + diceLand 音(音画同拍,同掷骰签面落定口径)。 */
function landSign(sign: SignHandle): void {
  sign.root.classList.remove("duel-sign-shaking");
  sign.root.classList.add("duel-sign-land");
  sign.face.textContent = SIGN_FACES[sign.side.roll - 1];
  getAudio().play("diceLand");
}

/** 判词拍:胜负全靠状态语言——胜者金光圈+金描边(.duel-sign-win)、败者降饱和沉暗
 *  (.duel-sign-dim),零「胜/负」文字章;平局双方无圈、中缝印钤变金「平」(重播钤落)。
 *  合印 stamp 音同拍(ADR-0030 判词拍);点差 ≥blowoutMargin 震屏,<3 不震。 */
function applyVerdict(ev: DuelSignsEvent, signs: SignHandle[], seal: HTMLDivElement): void {
  if (ev.winnerSeat == null) {
    seal.dataset.verdict = "tie";
    seal.textContent = "平";
    seal.classList.remove("duel-seal-slam");
    void seal.offsetWidth; // 强制 reflow:钤落弧重播(平印重钤)
    seal.classList.add("duel-seal-slam");
  } else {
    seal.dataset.verdict = "win";
    for (const s of signs) {
      s.root.classList.add(s.side.seat === ev.winnerSeat ? "duel-sign-win" : "duel-sign-dim");
    }
  }
  getAudio().play("stamp");
  const [a, b] = [ev.sides[0].roll, ev.sides[1].roll];
  if (Math.abs(a - b) >= DUEL.blowoutMargin) shakeDesk();
}

/** 整场演出:幕启→并行摇→座位序错拍落→判词→停留→渐出,节拍全走 DUEL 组
 *  (经 sc 缩放)。返回的 Promise 在渐出完成后 resolve,present() 据此串行接后效。 */
async function playDuelSigns(ev: DuelSignsEvent): Promise<void> {
  const overlay = document.createElement("div");
  overlay.className = "duel-overlay";
  overlay.setAttribute("data-testid", TESTIDS.duelOverlay);
  overlay.style.animationDuration = `${DUEL.curtainMs}ms`; // 幕启渐入与编排同拍(含 e2e 倍率)
  const row = document.createElement("div");
  row.className = "duel-signs";
  const seal = document.createElement("div");
  seal.className = "duel-seal duel-seal-slam"; // 中缝「拼」印随幕启钤立(锚对抗关系)
  seal.setAttribute("data-testid", TESTIDS.duelVerdict);
  seal.dataset.verdict = "pending";
  seal.textContent = "拼";
  const signs = ev.sides.map((side) => {
    const sign = buildSign(side);
    row.appendChild(sign.root);
    return sign;
  });
  overlay.appendChild(row);
  overlay.appendChild(seal);
  document.body.appendChild(overlay);
  activeOverlay = overlay;
  const stopShakers = signs.map((s) => startShaking(s));
  try {
    // ── 幕启:玄墨幕渐入(CSS,时长=curtainMs)、两签虚位+「拼」印钤立 ──
    await delay(DUEL.curtainMs);
    // ── 并行起摇:沙锤音起手,虚影轮换(全速恒定)──
    getAudio().play("diceRoll");
    await delay(DUEL.shakeMs);
    // ── 依座位序错拍落定(数组序=aSeat 先落,间隙=clackGap):每拍 diceLand 音 ──
    for (const [i, sign] of signs.entries()) {
      stopShakers[i]();
      if (i > 0) await delay(DUEL.clackGapMs);
      landSign(sign);
    }
    // ── 判词拍:金圈/金「平」/震屏判点差 ──
    await delay(DUEL.verdictMs);
    applyVerdict(ev, signs, seal);
    // ── 停留 → 整幕渐出 ──
    await delay(DUEL.holdMs);
    overlay.classList.add("duel-overlay-out");
    overlay.style.animationDuration = `${DUEL.fadeOutMs}ms`;
    await delay(DUEL.fadeOutMs);
  } finally {
    // 摇签句柄兜底清:正常路径各落定拍已停,封场(finishDuelSigns 摘除 overlay)时
    // delay 链照常走完也会停——此为资源清理,非错误兜底。
    for (const stop of stopShakers) stop();
    overlay.remove();
    if (activeOverlay === overlay) activeOverlay = null;
  }
}

/** 拼点签面命令桥:Game 屏挂载期间绑定真实实现,卸载后回退 no-op(StrictMode
 *  双挂载安全:cleanup 先还原桥,再由 React 走下一次挂载;同 diceApi 模式)。 */
export const duelSignsApi: {
  play(ev: DuelSignsEvent): Promise<void>;
} = {
  play: () => Promise.resolve(),
};

/** 不渲染任何 DOM(签面 overlay 拼点时 append 到 body)。挂进 Game 屏一次即可。 */
export function DuelSignsOverlay() {
  useEffect(() => {
    duelSignsApi.play = playDuelSigns;
    return () => {
      duelSignsApi.play = () => Promise.resolve();
    };
  }, []);
  return null;
}
