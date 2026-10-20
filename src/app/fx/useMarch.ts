// 令牌行军播放(哑渲染,ADR-0029 不变量①「提取即定格」/#608):keyframes 已在提取
// 拍烤死整条行走序列(起点中心→弧线途经→终点含落格槽位偏移+驿道流光折线),本模块
// 只做逐帧消费——按 timings.MARCH 现算段时长(匀速 ∝ 距离,保 scStage 缩放)写
// transform,连棋盘对象都不摸(FxSink 签名已编译期禁引擎)。
// 单写者(ADR-0029 不变量②/#609):每枚棋子的视觉位置同一时刻只有一个写入者,归属
// 单位 = per-id 行军会话(sessions:棋子 id → 会话)。会话持令牌与待播段队列:
//   - 同批(anchorMarches 同一轮 openMarchBatch)内同 id 重复锚定 = 同会话追加段,
//     顺序播(#608 后每段本就是成品坐标序列,相邻段起终点天然衔接);
//   - 跨批新锚 = 顶替:旧会话令牌随 Map 覆写作废,旧动画在段边界因身份比对失败
//     自终止,新会话从自己的 keyframes 首帧直切到位(禁 glide);
//   - 边界(abandonMarch/abandonAllMarches/resetFx)按 id 作废会话。
// 介质与接管机制(与旧版一致):React 版棋子由 TokenLayer 声明式渲染,行军期间通过
// 两条机制"接管":
//   ① fxStore.marching(id) → GameScreen 传 BoardView.skipTokenIds → TokenLayer 不再
//      对该棋子做声明式定位(等价旧 updateTokens(engine, skipPlayerId));
//   ② marchPos 模块 Map(棋子 id → 当前帧坐标):TokenLayer 对"被接管但仍有坐标"的
//      棋子照常渲染(transform 取 marchPos)——行军中任何 store 同步触发的重渲都会
//      把 transform 设为「当前帧目标」,与命令式写入值一致,棋子不会被拽回起点/终点。
// 动画本体命令式:直接改 data-token-player 节点的 style.transform + transitionDuration
// (CSS transition 见 board.css .bv-token)。
import type { BoardPos } from "@core/board";
import { useFxStore } from "./fxStore";
import { getAudio } from "./audio";
import { delay, FX, MARCH, nextFrame } from "./timings";
import type { MarchSegmentFrames } from "./presentation";

/** 行军接管中的棋子当前坐标(逻辑系)。只在 beginMarch/帧推进时写入,被 TokenLayer 读取。 */
export const marchPos = new Map<string, { x: number; y: number }>();

// ── per-id 行军会话(单写者归属单位,#609)──
/** 会话:令牌 = 对象身份(sessions.get(id) === session 即在册),段队列 = 同批追加的
 *  keyframes 序列。batch = 会话所属锚定批(openMarchBatch 递增),同批判定挂批到达序,
 *  不挂墙钟(ADR-0029 §2)。 */
interface MarchSession {
  batch: number;
  segments: Array<readonly MarchSegmentFrames[]>;
}
const sessions = new Map<string, MarchSession>();
let marchBatch = 0;

/** 会话表只读查询口(#611 交互锁解绑,ADR-0029 §4):该棋子的行军会话是否仍在途
 *  (未落定)。canAct 的本座位演出锁消费此口——语义化查询,不翻 sessions 内部结构;
 *  落定 = 播完/追帧放完/吸附或边界作废任一路径删会话后,即查即否。 */
export function isMarching(playerId: string): boolean {
  return sessions.has(playerId);
}

/** 开新锚定批(anchorMarches 每轮调用):此后至下一批的同 id 重复锚定 = 同会话追加段;
 *  此前的在途会话 = 跨批顶替对象。 */
export function openMarchBatch(): void {
  marchBatch++;
}

// C5 取消通道:fxStore.marching 是行军接管的对外投影,投影收缩(resetFx 清场 /
// removeMarching)时按被移除的 id 派发取消——会话作废 + marchPos 清除,在途循环在
// 下个段边界因身份比对失败自终止。selector 订阅:marching 集按身份变更才触发,
// 不随浮字/印章等每次 set 空转。endMarch/顶替/abandon 已先行删除会话,此处对已删
// id 的派发为幂等空转(marching 集是投影,簿记跟随投影对齐,非容错)。
useFxStore.subscribe(
  (s) => s.marching,
  (marching, prev) => {
    for (const id of prev) {
      if (!marching.has(id)) {
        sessions.delete(id);
        marchPos.delete(id);
      }
    }
  },
);

/** 帧时长:匀速(时长 ∝ 距离),夹在 [minSegMs, maxSegMs](旧 animate.ts 的口径)。 */
function segDuration(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.min(MARCH.maxSegMs, Math.max(MARCH.minSegMs, (dist / MARCH.speed) * 1000));
}

/** 切换点直切(#598 Q2,禁 glide):新会话锚定拍把棋子节点 transition:none 直写新
 *  首帧——.bv-token 的 CSS 过渡与动画内联时长是「乱跳」观感的物理通道,顶替/锚定
 *  切换点焊死;豁免一帧后由回调交还(animateMove 的逐帧写入随后接管)。节点未挂载
 *  (锚定先于 React 渲染接管态)= 无可直写,首渲自会按 marchPos 落位,无过渡可言。 */
function cutTokenTo(moverId: string, start: { x: number; y: number }): void {
  if (typeof document === "undefined") return; // 无 DOM 运行时(bun 单测)无渲染面,同 timings 的环境判定口径
  const token = document.querySelector<SVGGElement>(`#bv-tokens [data-token-player="${moverId}"]`);
  if (token == null) return;
  token.style.transition = "none";
  token.style.transform = `translate(${start.x}px, ${start.y}px)`;
  void nextFrame().then(() => {
    if (token.isConnected) token.style.transition = "";
  });
}

/** 取消路径的落位直切(#609 复审 F6,与 cutTokenTo 同一「豁免-交还」舞步、方向相反):
 *  接管期间 animateMove 逐帧写内联 transitionDuration,段中途被作废时残留值不清,
 *  随后的声明式落位会踩着残留时长滑行——吸附/顶替/边界作废的落位必须真直切
 *  (ADR-0029 §2 禁 glide 的取消侧半边)。先清内联时长再 transition:none 一帧:
 *  React 写入引擎终态 transform 落在无过渡窗内,两拍 rAF 后交还 .bv-token 类默认
 *  过渡。无 DOM 运行时(bun 单测)无渲染面,同本文件既有 typeof document 判定口径。 */
function releaseTokenCut(moverId: string): void {
  if (typeof document === "undefined") return;
  const token = document.querySelector<SVGGElement>(`#bv-tokens [data-token-player="${moverId}"]`);
  if (token == null) return;
  token.style.transitionDuration = "";
  token.style.transition = "none";
  void nextFrame().then(() => {
    if (token.isConnected) token.style.transition = "";
  });
}

/** 命令提交后、sync 渲染前调用(生产入口 = anchorMarches 经 sink.marchBegin):把
 *  mover 放进接管集并锚定在 keyframes 首帧(不变量①:提取烤好的起点坐标随事件走)。
 *  会话语义(#609):同批重复锚定 = 追加段(锚点不覆写——旧「有锚即覆写」正是同批
 *  双预塞错接起点的病根);跨批 = 顶替(旧会话作废,新会话首帧直切)。 */
export function beginMarch(moverId: string, keyframes: readonly MarchSegmentFrames[]): void {
  const existing = sessions.get(moverId);
  if (existing != null && existing.batch === marchBatch) {
    existing.segments.push(keyframes); // 同批多段:段队列衔接
    return;
  }
  const start = keyframes[0].points[0];
  sessions.set(moverId, { batch: marchBatch, segments: [keyframes] }); // 跨批顶替 = 覆写令牌
  marchPos.set(moverId, { x: start.x, y: start.y });
  cutTokenTo(moverId, start);
  useFxStore.getState().addMarching(moverId);
}

/** 驿道流光:行军每跨一格,沿该段烤好的弧线(flow 折线)叠加一条金色流光
 *  (旧 highlightSegment;坐标提取拍已烤进事件,不再读棋盘)。 */
function highlightSegment(flow: readonly BoardPos[]): void {
  const layer = document.querySelector<SVGGElement>("#bv-flow");
  if (!layer) return;
  const d = flow.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("class", "road-flow active");
  p.setAttribute("d", d);
  layer.appendChild(p);
  setTimeout(() => p.remove(), FX.roadFlowMs);
}

/**
 * 行军播放:逐帧消费烤好的 keyframes(不变量①),每帧写 transform;
 * - 段时长 ∝ 帧间距(匀速节奏),常量在 timings.MARCH,现算不烤(保 scStage 缩放);
 * - 单写者门(#609):本段 keyframes 必须是现主会话段队列的成员——旧批演出(已被
 *   顶替)或无会话(已被边界作废)在此自终止,不触 DOM、不作收尾(接管归属新主)。
 *   自愈式现场补锚随会话化退役:生产锚定恒先于播放(anchorMarches),无主 = 演出
 *   已作废;同批多段在末段收会话,非末段保持接管衔接下段。
 */
export async function animateMove(
  moverId: string,
  keyframes: readonly MarchSegmentFrames[],
): Promise<void> {
  const session = sessions.get(moverId);
  if (session == null || !session.segments.includes(keyframes)) return;
  const alive = (): boolean => sessions.get(moverId) === session;
  /** 会话收尾判据:本段 = 段队列末段才收会话;非末段保持接管,衔接同会话下一段。 */
  const endIfLast = (): void => {
    if (session.segments[session.segments.length - 1] !== keyframes) return;
    endMarch(moverId, session);
  };
  // 无 DOM 运行时(bun 单测):无渲染面可写,段簿记照走真实收尾语义。
  if (typeof document === "undefined") {
    endIfLast();
    return;
  }
  // 等 React 把「跳过声明式定位 + marchPos 起点」渲染出来,再拿节点开始动画。
  await nextFrame();
  const token = document.querySelector<SVGGElement>(`#bv-tokens [data-token-player="${moverId}"]`);
  if (!token || !token.isConnected || !alive()) {
    endMarch(moverId, session); // 节点失联=无接管可交接,收会话;会话已死则幂等空转
    return;
  }
  token.style.transition = ""; // 锚定直切的内联豁免到此为止,逐帧过渡交还动画
  // #26 行军启动音:轻嗒瞬态(audio.ts 内置 50ms 去重 + 连发音量衰减,高频不吵)。
  // 挪到节点确认之后,取消/未挂载的行军不出声。
  getAudio().play("marchStart");

  /** 单帧推进:设置 transitionDuration → 写 transform(命令式)→ 同步 marchPos(供重渲对齐)。
   *  返回本帧结束后动画是否仍存活(会话身份比对:C5 取消/顶替即止)。 */
  const step = async (x: number, y: number): Promise<boolean> => {
    const from = marchPos.get(moverId)!; // 会话在册 ⇒ marchPos 在册(收尾路径同拍双删)
    const dur = segDuration(from, { x, y });
    token.style.transitionDuration = `${dur / 1000}s`;
    token.style.transform = `translate(${x}px, ${y}px)`;
    marchPos.set(moverId, { x, y });
    await delay(dur + MARCH.segSlackMs);
    return alive() && token.isConnected;
  };

  for (const seg of keyframes) {
    for (let i = 1; i < seg.points.length; i++) {
      if (!(await step(seg.points[i].x, seg.points[i].y))) {
        endMarch(moverId, session); // 会话已死→幂等空转;节点失联→无接管可交接,收会话
        return;
      }
    }
    highlightSegment(seg.flow);
  }

  token.style.transitionDuration = "";
  endIfLast();
}

/** 结束接管:仅会话主人可收尾(顶替/作废后旧循环不得动新主的 marchPos/marching)。
 *  正常收尾(末段)/取消(C5)/边界作废统一走此——先注销会话再 removeMarching,
 *  订阅器对已删会话的派发为幂等空转。内联 transitionDuration 无需在此清理:末段
 *  正常收尾已在循环尾清空(animateMove 尾),节点失联路径无可清之面,段中途被外部
 *  作废的脏退场走 abandonMarch 的 releaseTokenCut(F6)——会话已被删时本函数按
 *  身份比对空转,不与新主/清理舞步抢写。 */
function endMarch(moverId: string, session: MarchSession): void {
  if (sessions.get(moverId) !== session) return;
  sessions.delete(moverId);
  marchPos.delete(moverId);
  useFxStore.getState().removeMarching(moverId);
}

/** 作废单个行军会话(终局封场收队专用,orchestrator.present 收队路径调用):
 *  anchorMarches 在 play() 拍就把批内全部 tokenMoved 预塞接管,截断后不再播的行军
 *  若不收回,棋子会被 TokenLayer 冻结在起点挂行军金边直到整页 reload。per-id 操作
 *  (#609 会话化前是全局代际一退全退):只作废目标 id,他 id 在途会话不殃及;目标
 *  id 恰有在途动画时,令牌即删,在途循环下个段边界自终止。落位直切:releaseTokenCut
 *  清内联过渡残留,棋子直切引擎终态(F6,「吸附落位真直切」的取消侧)。 */
export function abandonMarch(moverId: string): void {
  sessions.delete(moverId);
  marchPos.delete(moverId);
  releaseTokenCut(moverId);
  useFxStore.getState().removeMarching(moverId);
}

/** 作废全部在途会话(断线重连边界:SnapshotEffects.resetEventFace/dropStalledBatch)
 *  ——「旧演出无因果意义」(ADR-0029 §2/③同族语义);与 #610 的清待播队列共用动作,
 *  本票只清会话,不动队列。 */
export function abandonAllMarches(): void {
  // 迭代中只删当前 key(Map 语义安全),无需快照数组
  for (const id of sessions.keys()) abandonMarch(id);
}
