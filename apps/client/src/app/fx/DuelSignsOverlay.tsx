// 拼点签面(#637,ADR-0030):玩家对拼的全屏骰面演出——掷骰签面(DiceOverlay)的
// 多签变体。玄墨幕渐入,每名参与者一枚骨牌大字签面并排立起(签头=玩家色底+国号),
// 蓄势预动作(两签向中缝轻推内倾,#746 条目 2)→ 并行起摇(虚影轮换逐签错相,悬念
// 并行不拉长全程,#746 条目 1)→ 依座位序错拍落定(延续既有拼点 clackGap
// 节拍)→ 判词拍(胜者金光圈+金描边、败者降饱和沉暗,中缝印落锤重钤脉冲,零「胜/负」
// 文字章,DESIGN §4.6 状态表达原则;平局双方无圈、中缝朱砂「拼」印钤变金「平」——
// 「都没圈」与「还没判」不可区分,这是文字该承载的语义例外;本机签在签内时判词段
// 己方加权——己签 scale 1.06、金圈先行,他签 0.96,#760)→ 停留渐出。点差
// ≥DUEL.blowoutMargin 判词拍震屏(DESIGN §6 拼点大胜负)。整场固定全速,不随 bot
// 半速(公共大事件非回合等待)。
// #769 判词段再分级:点差大胜档(同 isBlowout 判据)胜方点数 outBack 弹至 1.15、
// 败方字面泼墨溅;判词磬按己方视角拆胜/败双音高(旁观/平局中性单音);摇签段空签身
// 加旋转墨旋;签排 gap 随视口收紧、折行时中缝印随首行避让(构建拍量锚)。
// 大胜峰值(#849、#1540):胜签后一笔与淡金二次波共用 --duel-wave-delay /
// --duel-wave-ms。判词拍洗幕一闪(胜方玩家色 --duel-wash-color、--duel-wash-ms)+震屏
// (shakeDeskBlowout,6px/0.45s,普通档口径不动);泼墨溅挪卡角+中央挖孔(败方点数
// 可读,fx.css);时长经 overlay 内联注入(随 e2e 倍率同步,keyframe 只管形)。
// 签面收场后棋盘后效(止步/续走/银两浮字)才登场:present 串行 await 本组件返回的
// Promise 天然保证(orchestrator duelSigns case → sink.showDuelSigns)。
// 模块桥模式同 DiceOverlay:mount/unmount 归 React(挂 Game 屏一次),触发走
// duelSignsApi 模块桥——生产 sink(sinks.ts,非 React 世界)直调,实例不进 store。
import { useEffect } from "react";
import { SIGN_FACES } from "@dafung/core/engine/constants";
import { playerColor, rgba } from "@dafung/core/engine/theme";
import { useNetStore } from "@app/store/netStore";
import { TESTIDS } from "@app/screens/game/testids";
import { getAudio } from "./audio";
import { shakeDeskBlowout } from "./desk";
import { isBlowout, type DuelSignsEvent, type DuelSide } from "./presentation";
import { DUEL, delay } from "./timings";

// 在场 overlay 引用(D2 终局提前收场用;present() 串行 await,同时至多一场)。
let activeOverlay: HTMLElement | null = null;

/** 封场或卸载时撤下在场签面。播放链在当前节拍结束后清理摇签定时器并返回。 */
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
 *  轮换句柄驱动,此处留空;空签身底纹=自绘墨旋 SVG(#769,摇签段旋转、落定即撤
 *  ——显隐门纯 CSS(.duel-sign-shaking),DOM 常驻不增删)。DOM 序在 face 之后
 *  =墨旋浮在轮换虚影字上(虚影字净透明度 ~0.3,墨旋衬其上才读得出转);轮换句柄
 *  写 face.textContent 不触墨旋。 */
function buildSign(side: DuelSide): SignHandle {
  const root = document.createElement("div");
  root.className = "duel-sign"; // 幕启虚位基态(半透立起、字面缺席,fx.css)
  root.setAttribute("data-testid", TESTIDS.duelSign(side.seat));
  root.style.setProperty("--player-color", rgba(playerColor(side.colorIndex)));
  const surface = document.createElement("div");
  surface.className = "duel-sign-surface";
  surface.innerHTML = `
    <svg class="duel-sign-grain" viewBox="-70 -86 140 172" preserveAspectRatio="none"
         aria-hidden="true" focusable="false">
      <g fill="none" stroke-linecap="round">
        <path stroke="var(--color-lacquer)" stroke-width=".7" opacity=".26"
              d="M-82 -54q41 -5 61 10t59 14 45 8M-83 -49q33 -4 60 9t58 16 47 9M-82 -44q29 -3 46 5t37 11M41 -19q27 1 44 10
                 M-82 57q42 15 71 4t48 -6 44 1M-82 64q45 14 73 2t43 -7 48 4M-83 69q21 7 43 5m42 -8q23 -10 79 0
                 M-83 18q11 7 21 5m116 -5q18 -2 28 5m-141 42 7 5 9 -2 5 3 6 -2m96 -103 -4 8 -9 2 -6 5" />
        <path stroke="var(--color-paper)" stroke-width="1" opacity=".56"
              d="M-85 -47q41 -8 70 9t58 15 42 10M-78 63q32 9 66 .5t96 -1M-86 56q37 14 69 7t44 -9 55 -2
                 M-65 -2l4 3.7 4 -1.3m114 50 -3 5 -5 .5m-114 20 19 -.5m95 -115 10 1" />
      </g>
    </svg>`;
  const head = document.createElement("div");
  head.className = "duel-sign-head";
  head.textContent = side.guohao;
  const swirl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  swirl.setAttribute("viewBox", "0 0 72 72");
  swirl.classList.add("duel-sign-swirl");
  swirl.setAttribute("aria-hidden", "true");
  // 墨旋本体:交替半圆旋出三匝墨涡(零位图,stroke 吃 --color-paper,fx.css)
  swirl.innerHTML =
    '<path d="M 36 36 a 4 4 0 0 1 -8 0 a 6 6 0 0 1 12 0 a 8 8 0 0 1 -16 0 ' +
    'a 10 10 0 0 1 20 0 a 12 12 0 0 1 -24 0" fill="none" stroke-width="5" ' +
    'stroke-linecap="round"/>';
  const face = document.createElement("div");
  face.className = "duel-sign-face";
  surface.append(head, face, swirl);
  root.appendChild(surface);
  return { root, face, side };
}

/** 签后一笔只在大胜判词挂入，显隐与二次波共用现役延迟和时长。 */
function addBlowoutStroke(sign: HTMLDivElement): void {
  sign.insertAdjacentHTML(
    "afterbegin",
    `<svg class="duel-blowout-stroke" viewBox="-178 -141 356 282" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="duel-brush-fill" x1="-148" y1="71" x2="115" y2="-130" gradientUnits="userSpaceOnUse">
          <stop stop-color="var(--color-gold-wash)" stop-opacity=".07" />
          <stop offset=".29" stop-color="var(--color-gold-wash)" stop-opacity=".78" />
          <stop offset=".64" stop-color="var(--color-lacquer)" />
          <stop offset="1" stop-color="var(--color-gold)" stop-opacity=".3" />
        </linearGradient>
        <linearGradient id="duel-brush-edge" x1="-151" y1="81" x2="125" y2="-125" gradientUnits="userSpaceOnUse">
          <stop stop-color="var(--color-gold-wash)" stop-opacity="0" />
          <stop offset=".36" stop-color="var(--color-gold-deep)" stop-opacity=".75" />
          <stop offset=".7" stop-color="var(--color-gold-bright)" />
          <stop offset="1" stop-color="var(--color-gold)" stop-opacity=".24" />
        </linearGradient>
      </defs>
      <path fill="url(#duel-brush-fill)"
            d="M-166 91C-157 56 -130 13 -99 -23C-56 -72 9 -111 78 -126C100 -132 117 -131 132 -129
               C115 -126 101 -122 88 -115C81 -114 76 -111 65 -108C16 -88 -24 -56 -54 -21
               C-85 13 -113 55 -144 79C-150 83 -158 87 -168 99Z" />
      <g fill="none" stroke="url(#duel-brush-edge)" stroke-linecap="round">
        <path d="M-164 86Q-134 10 -84 -37T39 -117Q93 -137 132 -129" stroke-width="2.4" />
        <path d="M-170 96Q-153 50 -122 16T-53 -56Q-1 -102 69 -123
                 M-159 89Q-110 53 -67 -7T49 -106Q86 -120 118 -126" stroke-width="1.3" opacity=".69" />
        <path d="M-165 86Q-147 59 -128 44m242 -173 18 -2" stroke-width=".55" />
      </g>
    </svg>`,
  );
}

/** 起摇:签面入虚影态,墨字虚影按 DUEL.shakeMs/10 周期轮换+微旋(字面不落定=悬念;
 *  全段恰 10 次换签,同 DiceOverlay 摇签口径)。逐签错相(#746 条目 1):字面序列按
 *  座位偏移((swaps + seat*2 + 1) mod 签面表长),两签同拍轮换但序列错开,读作「各自掷签」
 *  而非镜像同步;时长与周期不变(600ms 恰 10 换)。返回停摇句柄(落定拍调用)。 */
function startShaking(sign: SignHandle): () => void {
  sign.root.classList.add("duel-sign-shaking");
  let swaps = 0;
  const shuffler = window.setInterval(
    () => {
      swaps += 1;
      sign.face.textContent = SIGN_FACES[(swaps + sign.side.seat * 2 + 1) % SIGN_FACES.length];
      sign.face.style.rotate = `${(Math.random() - 0.5) * 12}deg`;
    },
    Math.max(1, Math.round(DUEL.shakeMs / 10)),
  );
  return () => {
    window.clearInterval(shuffler);
    sign.face.style.rotate = "";
  };
}

/** 落定:真面 outBack 钤落 + diceLand 音(音画同拍,同掷骰签面落定口径);蓄势位移
 *  (#746 条目 2)同拍松开,transition 80ms 回中与钤落弹跳叠合——落锤把蓄势吃掉。 */
function landSign(sign: SignHandle): void {
  sign.root.classList.remove("duel-sign-shaking", "duel-sign-windup");
  sign.root.classList.add("duel-sign-land");
  sign.root.style.animationDuration = `${DUEL.landMs}ms`; // #849 棒3:keyframe 只管形,钤落弧时长随通道缩放
  sign.face.textContent = SIGN_FACES[sign.side.roll - 1];
  getAudio().play("diceLand");
}

/** 判词拍:胜负全靠状态语言——胜者金光圈+金描边(.duel-sign-win)、败者降饱和沉暗
 *  (.duel-sign-dim),零「胜/负」文字章;平局双方无圈、中缝印钤变金「平」。判词落锤
 *  (#746 条目 3):中缝印重钤脉冲+印缘金光一闪(.duel-seal-pulse),把判词音的画面锚
 *  给到中缝——verdictMs 原为纯等待空拍,脉冲 120ms 在拍内,总时长零增量。判词音换
 *  磬一记(verdictChime,与印章 stamp 的木石感分家,#746 条目 5);大胜负震屏判定=
 *  isBlowout 单源(点差 ≥blowoutMargin,边界行为单测钉死)。
 *
 *  己方加权(#760):本机签在签内时判词段加视觉权——己签 scale 1.06、他签 0.96,
 *  己方胜时金圈先行(败签沉暗延后 ~100ms,先行量在 CSS 走 token 组合表达);
 *  金光圈/沉暗/平印状态语言本身不变。本机不在签内(联机观他席)三类全不挂
 *  =全签等权,无报错无特判。
 *
 *  点差分级(#769):判据单源 isBlowout(与震屏同一处常量 DUEL.blowoutMargin,
 *  分级判据写死一处不另立档)——大胜档挂 overlay.duel-blowout,CSS 承接胜方点数
 *  outBack 弹至 1.15 + 败方字面泼墨溅(一次性);平局(点差 0)与点差 1-2 不挂类
 *  =维持现制。判词音双音高(#769):己方视角拆声——本机在签内且分出胜负时,己胜
 *  播上行高音 verdictChimeWin、己败播下行低音 verdictChimeLose;本机不在签内
 *  (旁观)或平局=中性单音 verdictChime(#746 原制)。 */
function applyVerdict(
  ev: DuelSignsEvent,
  signs: SignHandle[],
  seal: HTMLDivElement,
  overlay: HTMLDivElement,
): void {
  // 大胜看最高点与次高点的差值。同点重掷时低于最高点的签面沉暗。
  const [highest, second] = ev.sides.map(({ roll }) => roll).sort((a, b) => b - a);
  const blowout = ev.winnerSeat !== null && isBlowout(highest, second);
  if (blowout) overlay.classList.add("duel-blowout");
  if (ev.winnerSeat == null) {
    seal.dataset.verdict = "tie";
    seal.textContent = "平";
  } else seal.dataset.verdict = "win";

  for (const sign of signs) {
    if (sign.side.seat === ev.winnerSeat) {
      sign.root.classList.add("duel-sign-win");
      if (blowout) {
        addBlowoutStroke(sign.root);
        overlay.style.setProperty("--duel-wash-color", rgba(playerColor(sign.side.colorIndex)));
      }
    } else if (sign.side.roll < highest) {
      sign.root.classList.add("duel-sign-dim");
    }
  }
  // 本机 seat 投影与 GameScreen 同式(联机=netStore.mySeat,单机=本屏真人恒座 0);
  // 不是新通路,是既有「我是谁」投影在本件的同一取式。find 不中=本机不在签内,
  // 加权整体缺席(全签等权)——缺席是正常业务态,非兜底。
  const mySeat = useNetStore.getState().roomId !== "" ? useNetStore.getState().mySeat : 0;
  const self = signs.find((s) => s.side.seat === mySeat);
  if (self != null) {
    overlay.classList.add("duel-self-weighted");
    self.root.classList.add("duel-sign-self");
    if (ev.winnerSeat === mySeat) overlay.classList.add("duel-self-win");
  }
  seal.classList.remove("duel-seal-slam");
  seal.classList.add("duel-seal-pulse");
  // 判词音(#769 双音高):己方视角拆胜/败两音高,旁观局与平局保持中性单音。
  getAudio().play(
    self == null || ev.winnerSeat == null
      ? "verdictChime"
      : ev.winnerSeat === mySeat
        ? "verdictChimeWin"
        : "verdictChimeLose",
  );
  if (blowout) shakeDeskBlowout();
}

/** 整场演出:幕启→并行摇→座位序错拍落→判词→停留→渐出,节拍全走 DUEL 组
 *  (经 sc 缩放)。返回的 Promise 在渐出完成后 resolve,present() 据此串行接后效。 */
async function playDuelSigns(ev: DuelSignsEvent): Promise<void> {
  const overlay = document.createElement("div");
  overlay.className = "duel-overlay";
  const multi = ev.sides.length > 2;
  if (multi) {
    overlay.classList.add("duel-multi");
    const columns = ev.sides.length > 4 ? Math.ceil(ev.sides.length / 2) : ev.sides.length;
    overlay.style.setProperty("--duel-columns", String(columns));
  }
  overlay.setAttribute("data-testid", TESTIDS.duelOverlay);
  overlay.style.animationDuration = `${DUEL.curtainMs}ms`; // 幕启渐入与编排同拍(含 e2e 倍率)
  // 收锋与二次波共用延迟和时长，洗幕单用短拍。各值随演出倍率同步。
  overlay.style.setProperty("--duel-wave-ms", `${DUEL.blowoutWaveMs}ms`);
  overlay.style.setProperty("--duel-wave-delay", `${DUEL.blowoutWaveDelayMs}ms`);
  overlay.style.setProperty("--duel-wash-ms", `${DUEL.blowoutWashMs}ms`);
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
  overlay.append(seal, row);
  document.body.appendChild(overlay);
  if (!multi) {
    // 双签印章落在既有中缝，多席则置于签面上方。
    const overlayBox = overlay.getBoundingClientRect();
    const firstBox = signs[0].root.getBoundingClientRect();
    seal.style.top = `${firstBox.top - overlayBox.top + firstBox.height / 2}px`;
  }
  activeOverlay = overlay;
  const stillShowingAfter = async (ms: number): Promise<boolean> => {
    await delay(ms);
    return activeOverlay === overlay;
  };
  let stopShakers: (() => void)[] = [];
  try {
    // ── 幕启:玄墨幕渐入(CSS,时长=curtainMs)、两签虚位+「拼」印钤立 ──
    // 摇签不在此段起跑(#639 评审必修,ADR-0030 节拍「幕启→并行起摇」):幕启期间
    // 两签保持虚位(字面缺席),起摇等幕启落定。
    if (!(await stillShowingAfter(DUEL.curtainMs))) return;
    // ── 蓄势预动作(#746 条目 2):幕启落定→起摇之间的一拍——两签向中缝轻推 8px
    // 并朝内倾 1.5°(--ease-out,80ms),「蓄势-接触-定格」链条补第一节。位移/内倾
    // 走独立 translate/rotate 属性(不碰落定拍 transform 钤落弧);排布序=座位升序,
    // 偶数位签在左(向右推 +8px),奇数位在右(向左推 −8px)。到拍即起摇。 ──
    for (const [i, sign] of signs.entries()) {
      const inward = i % 2 === 0 ? 1 : -1;
      sign.root.style.setProperty("--windup-x", `${inward * 8}px`);
      sign.root.style.setProperty("--windup-rot", `${inward * 1.5}deg`);
      sign.root.classList.add("duel-sign-windup");
    }
    if (!(await stillShowingAfter(DUEL.windupMs))) return;
    // ── 并行起摇:骨牌合击音起手(duelClash,#746 条目 5:替换合成沙锤,拼点自此
    // 有自己的声音),虚影轮换逐签错相(全速恒定)──
    stopShakers = signs.map((s) => startShaking(s));
    getAudio().play("duelClash");
    if (!(await stillShowingAfter(DUEL.shakeMs))) return;
    // ── 依座位序错拍落定(数组序=座位升序,提取期已排;间隙=clackGap):每拍 diceLand 音 ──
    for (const [i, sign] of signs.entries()) {
      if (i > 0 && !(await stillShowingAfter(DUEL.clackGapMs))) return;
      stopShakers[i]();
      landSign(sign);
    }
    // ── 判词拍:金圈/金「平」/震屏判点差(+己方加权,#760)──
    if (!(await stillShowingAfter(DUEL.verdictMs))) return;
    applyVerdict(ev, signs, seal, overlay);
    // ── 停留 → 整幕渐出 ──
    if (!(await stillShowingAfter(DUEL.holdMs))) return;
    overlay.classList.add("duel-overlay-out");
    overlay.style.animationDuration = `${DUEL.fadeOutMs}ms`;
    await delay(DUEL.fadeOutMs);
  } finally {
    // 封场发生在摇签或错拍期间时，一并清理尚未落定的签面。
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
      finishDuelSigns();
      duelSignsApi.play = () => Promise.resolve();
    };
  }, []);
  return null;
}
