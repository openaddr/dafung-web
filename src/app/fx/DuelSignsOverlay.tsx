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
// 签面收场后棋盘后效(止步/续走/银两浮字)才登场:present 串行 await 本组件返回的
// Promise 天然保证(orchestrator duelSigns case → sink.showDuelSigns)。
// 模块桥模式同 DiceOverlay:mount/unmount 归 React(挂 Game 屏一次),触发走
// duelSignsApi 模块桥——生产 sink(sinks.ts,非 React 世界)直调,实例不进 store。
import { useEffect } from "react";
import { SIGN_FACES } from "@core/constants";
import { playerColor, rgba } from "@core/theme";
import { useNetStore } from "@app/store/netStore";
import { TESTIDS } from "@app/screens/game/testids";
import { getAudio } from "./audio";
import { shakeDesk } from "./desk";
import { isBlowout, type DuelSignsEvent, type DuelSide } from "./presentation";
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
 *  轮换句柄驱动,此处留空;空签身底纹=自绘墨旋 SVG(#769,摇签段旋转、落定即撤
 *  ——显隐门纯 CSS(.duel-sign-shaking),DOM 常驻不增删)。DOM 序在 face 之后
 *  =墨旋浮在轮换虚影字上(虚影字净透明度 ~0.3,墨旋衬其上才读得出转);轮换句柄
 *  写 face.textContent 不触墨旋。 */
function buildSign(side: DuelSide): SignHandle {
  const root = document.createElement("div");
  root.className = "duel-sign"; // 幕启虚位基态(半透立起、字面缺席,fx.css)
  root.setAttribute("data-testid", TESTIDS.duelSign(side.seat));
  root.style.setProperty("--player-color", rgba(playerColor(side.colorIndex)));
  const head = document.createElement("div");
  head.className = "duel-sign-head";
  head.textContent = side.guohao;
  const swirl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  swirl.setAttribute("viewBox", "0 0 72 72");
  swirl.classList.add("duel-sign-swirl");
  swirl.setAttribute("aria-hidden", "true");
  // 墨旋本体:交替半圆旋出三匝墨涡(零位图,stroke 吃 --color-ink,fx.css)
  swirl.innerHTML =
    '<path d="M 36 36 a 4 4 0 0 1 -8 0 a 6 6 0 0 1 12 0 a 8 8 0 0 1 -16 0 ' +
    'a 10 10 0 0 1 20 0 a 12 12 0 0 1 -24 0" fill="none" stroke-width="5" ' +
    'stroke-linecap="round"/>';
  const face = document.createElement("div");
  face.className = "duel-sign-face";
  root.appendChild(head);
  root.appendChild(face);
  root.appendChild(swirl);
  return { root, face, side };
}

/** 起摇:签面入虚影态,墨字虚影按 DUEL.shakeMs/10 周期轮换+微旋(字面不落定=悬念;
 *  全段恰 10 次换签,同 DiceOverlay 摇签口径)。逐签错相(#746 条目 1):字面序列按
 *  座位偏移((swaps + seat*2 + 1) mod 6),两签同拍轮换但序列错开,读作「各自掷签」
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
  if (ev.winnerSeat == null) {
    seal.dataset.verdict = "tie";
    seal.textContent = "平";
  } else {
    seal.dataset.verdict = "win";
    for (const s of signs) {
      s.root.classList.add(s.side.seat === ev.winnerSeat ? "duel-sign-win" : "duel-sign-dim");
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
  // 点差分级(#769):判定读事件里既有的两签点数(禁新兜底通道),单源 isBlowout。
  // 点差≥3 必有胜者(平局点差恒 0),不另设 winnerSeat 前置判。
  if (isBlowout(ev.sides[0].roll, ev.sides[1].roll)) overlay.classList.add("duel-blowout");
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
  if (isBlowout(ev.sides[0].roll, ev.sides[1].roll)) shakeDesk();
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
  // 中缝印随首行定位(#769 折行避让):构建拍量首行签卡中点注入 top——单行时行即
  // 首行,与旧 CSS top:50% 恒等;折行(N 签窄视口成两行)时印锚在首行中点,不再
  // absolute 居中压两行之间。横向恒 left:50%:首行 justify-content:center 居中
  // 排布,双签(拼点恒二签,resolveDuel 二元)与四签 2+2 折行的中缝 gap 都恰落
  // 视口中线;3+1 折行形态 50% 落首行中签上——预留通路(ADR-0030 N>2)今天的
  // 引擎不可达,注释钉死不改口。构建拍量一次,演出期布局不动(幕启动画只走 opacity)。
  const overlayBox = overlay.getBoundingClientRect();
  const firstBox = signs[0].root.getBoundingClientRect();
  seal.style.top = `${firstBox.top - overlayBox.top + firstBox.height / 2}px`;
  activeOverlay = overlay;
  let stopShakers: (() => void)[] = [];
  try {
    // ── 幕启:玄墨幕渐入(CSS,时长=curtainMs)、两签虚位+「拼」印钤立 ──
    // 摇签不在此段起跑(#639 评审必修,ADR-0030 节拍「幕启→并行起摇」):幕启期间
    // 两签保持虚位(字面缺席),起摇等幕启落定。
    await delay(DUEL.curtainMs);
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
    await delay(DUEL.windupMs);
    // ── 并行起摇:骨牌合击音起手(duelClash,#746 条目 5:替换合成沙锤,拼点自此
    // 有自己的声音),虚影轮换逐签错相(全速恒定)──
    stopShakers = signs.map((s) => startShaking(s));
    getAudio().play("duelClash");
    await delay(DUEL.shakeMs);
    // ── 依座位序错拍落定(数组序=座位升序,提取期已排;间隙=clackGap):每拍 diceLand 音 ──
    for (const [i, sign] of signs.entries()) {
      stopShakers[i]();
      if (i > 0) await delay(DUEL.clackGapMs);
      landSign(sign);
    }
    // ── 判词拍:金圈/金「平」/震屏判点差(+己方加权,#760)──
    await delay(DUEL.verdictMs);
    applyVerdict(ev, signs, seal, overlay);
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
