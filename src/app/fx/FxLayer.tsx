// 瞬时表现层:浮动金额(+/− 与铜钱雨)、朱砂印章、技能浮字两档(#850 施展升档/被动小签)。
// D1/D4 改造:浮字/印章/铜钱不再走 HTML 覆盖层 + getScreenCTM 一次性换算
// (拖拽/缩放后即脱锚),而是直接渲染进棋盘 SVG 的 #bv-fx 层(BoardFxLayer,
// 由 BoardView 挂载)——坐标系与棋盘天然一致,pan/zoom 时随视图一起变换,
// 字号随视图缩放、按当前缩放设 12px 等效下限。
// #732:屏幕级知会(回合横幅/都城停条带)迁顶中知会横幅槽(screens/game/NoticeBanner),
// 本件只剩拼点签面演出桥(DuelSignsOverlay 渲染 null,仅在挂载期绑定 duelSignsApi
// 模块桥——签面 overlay 自行 append 到 body,ADR-0030)。
// #764:屏幕级再添两件(经 body portal 出 .board-area 的 overflow 裁切与几何让位,
// 坐标换算只在起飞拍做一次——飞行全程 450ms 级,pan/zoom 中途脱锚不作对抗):
//   ① 出牌窗聚光(开关态 fxStore.spotlight,HandRack 窗态选中挂摘);
//   ② 金钱飞行归账(fxStore.cashFlies,进账铜钱从来源棋子格飞向席位格,抵达 bump)。
// 席位现金 count-up 订阅(seat-cash.ts)也随本件挂载/卸载。
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { playerColor, rgba } from "@core/theme";
import { useGameStore } from "@app/store/gameStore";
import { TESTIDS } from "@app/screens/game/testids";
import { useFxStore, type CashFlyFx, type FloaterFx } from "./fxStore";
import { DuelSignsOverlay } from "./DuelSignsOverlay";
import { formatFloater } from "./orchestrator";
import { bumpSeatCash, startSeatCashCount } from "./seat-cash";
import { FX } from "./timings";
import "./fx.css";

/** 浮字基准字号(SVG 逻辑单位;总览(1 unit≈0.4px)下约等于旧版 26px 屏幕字的观感)。 */
const FLOATER_BASE_UNITS = 26;
/** 浮字等效屏幕像素下限(D4:高倍缩小视图时也不小于 12px)。 */
const FLOATER_MIN_PX = 12;
/** X3 同锚点浮字垂直错位步长(逻辑单位,≈1.4 行字高):同格同帧双浮字
 *  (如成交 −300/+300)按出现序上移错开,不再沿同一轨迹精确叠印。 */
const FLOATER_STAGGER_UNITS = 36;
/** 破产撒币枚数上限(每枚随机落点;超过不再加密度)。 */
const COIN_BURST_MAX = 12;

/** 当前缩放下 1 逻辑单位 = 多少屏幕像素(读 <svg#board> 客户宽与现行 viewBox)。 */
function pxPerUnit(): number | null {
  const svg = document.getElementById("board") as SVGSVGElement | null;
  if (!svg) return null;
  const vb = svg.getAttribute("viewBox");
  if (!vb) return null;
  const w = Number(vb.split(" ")[2]);
  const rect = svg.getBoundingClientRect();
  if (!(w > 0) || !(rect.width > 0)) return null;
  return rect.width / w;
}

/** 浮字字号(逻辑单位):基准 26,但保证屏幕等效 ≥12px。 */
function floaterFontSize(): number {
  const s = pxPerUnit();
  if (s == null) return FLOATER_BASE_UNITS;
  return Math.max(FLOATER_BASE_UNITS, FLOATER_MIN_PX / s);
}

/** 铜钱一枚(泉字金币):补给雨与撒币共用同一视觉件(金圆底+墨字)。
 *  x/y=锚点(SVG 逻辑单位,transform attribute 定位),dx/dy=随机落点
 *  (CSS 变量喂 fx-svg-coin-rain keyframe),delayMs=错拍入场(#885:撒币档由
 *  消费点喂 FX.coinStaggerMs 步进,与全长 coinRainMs 同通道缩放)。 */
function Coin({
  x,
  y,
  dx,
  dy,
  delayMs = 0,
}: {
  x: number;
  y: number;
  dx: number;
  dy: number;
  delayMs?: number;
}) {
  return (
    <g
      className="fx-svg-coin"
      transform={`translate(${x} ${y})`}
      style={{
        ["--dx" as string]: `${dx}px`,
        ["--dy" as string]: `${dy}px`,
        animationDelay: `${delayMs}ms`,
        animationDuration: `${FX.coinRainMs}ms`, // #885:keyframe 只管形,全长随通道缩放
      }}
    >
      {/* D3:铜钱雨用「泉」字(金色圆底 + 墨字),替换与水墨语言相斥的 🪙 emoji */}
      <circle r={11} />
      <text y={4} textAnchor="middle">
        泉
      </text>
    </g>
  );
}

/** 浮字渲染档(#850 技能演出补课):class/字号/玩家色变量三件随 skill 档分派——
 *  cast=施展升档(1.0× 焦墨 brush 字+玩家色细描边,--player-color 恒随件内联,
 *  CSS 侧零回退值);tag=被动技名小签(0.7× ink-dim);缺省=金额(pos/neg)或
 *  普通文案小字(msg,0.8×)。 */
function floaterLook(
  f: FloaterFx,
  fontSize: number,
): { cls: string; size: number; playerColorVar: string | null } {
  if (f.skill?.kind === "cast")
    return { cls: "skill", size: fontSize, playerColorVar: rgba(playerColor(f.skill.colorIndex)) };
  if (f.skill?.kind === "tag")
    return { cls: "tag", size: Math.round(fontSize * 0.7), playerColorVar: null };
  if (f.text) return { cls: "msg", size: Math.round(fontSize * 0.8), playerColorVar: null };
  return { cls: f.amount >= 0 ? "pos" : "neg", size: fontSize, playerColorVar: null };
}

/** 补给铜钱雨落点(定数 6 枚,横向散布)。 */
const SUPPLY_COINS = 6;

/** 棋盘内 SVG 特效层(BoardView 挂在 #bv-fx 内):浮字 + 铜钱雨 + 朱砂/漆金印章 +
 *  出牌指示线 + 落格定音金圈 + 破产墨渍/撒币(S7)。拼点演出归全屏签面
 *  (DuelSignsOverlay,ADR-0030 单通道)。 */
export function BoardFxLayer() {
  const floaters = useFxStore((s) => s.floaters);
  const seals = useFxStore((s) => s.seals);
  const jinnangLines = useFxStore((s) => s.jinnangLines);
  const pulses = useFxStore((s) => s.pulses);
  const inkBlots = useFxStore((s) => s.inkBlots);
  const coinBursts = useFxStore((s) => s.coinBursts);
  const fontSize = floaterFontSize();

  return (
    <>
      {/* 墨渍径向渐变(破产仪式第二拍):单例 defs,实例经 fill=url(#) 引用 */}
      <defs>
        <radialGradient id="fx-ink-grad">
          <stop offset="0%" stopColor="var(--color-ink)" stopOpacity="0.85" />
          <stop offset="55%" stopColor="var(--color-ink)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--color-ink)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* 浮动金额 + 铜钱雨 + 文案小字(ADR-0013)+ 技能浮字两档(#850):逻辑坐标
          直接使用,无需换算。X3:同锚点按存活序 y−idx*36 上移错位(store 追加序 = spawn 序) */}
      {floaters.map((f, i) => {
        const overlapIdx = floaters.slice(0, i).filter((g) => g.x === f.x && g.y === f.y).length;
        const y = f.y - overlapIdx * FLOATER_STAGGER_UNITS;
        const look = floaterLook(f, fontSize);
        return (
          <g key={f.id}>
            <text
              className={`fx-svg-floater ${look.cls}`}
              x={f.x}
              y={y}
              fontSize={look.size}
              textAnchor="middle"
              style={{
                ...(look.playerColorVar != null && {
                  ["--player-color" as string]: look.playerColorVar,
                }),
                // #885 时长收口:keyframe 只管形,全长随通道缩放——普通/施展/文案
                // 浮字 FX.floaterMs(清理窗=同一 getter);被动小签(#850)换
                // FX.skillTagMs 短全长,注入同在消费点
                animationDuration: `${f.skill?.kind === "tag" ? FX.skillTagMs : FX.floaterMs}ms`,
              }}
            >
              {f.text ?? formatFloater(f.amount)}
            </text>
            {f.coins &&
              Array.from({ length: SUPPLY_COINS }, (_, c) => (
                <Coin
                  key={c}
                  x={f.x}
                  y={y}
                  dx={Math.round((Math.random() - 0.5) * 60)}
                  dy={90 + Math.round(Math.random() * 30)}
                />
              ))}
          </g>
        );
      })}
      {/* 落格定音(S7):事件/机遇格落点金圈一拍。#849 棒3:keyframe 只管形,
          全长 FX.pulseRingMs 内联注入(随 e2e/追帧通道缩放,清理窗 landPulseMs 同源) */}
      {pulses.map((p) => (
        <circle
          key={p.id}
          className="fx-svg-pulse"
          cx={p.x}
          cy={p.y}
          r={26}
          style={{ animationDuration: `${FX.pulseRingMs}ms` }}
        />
      ))}
      {/* 朱砂印章(漆金档见 .fx-svg-seal-gold):坐标即逻辑坐标。#849 棒3:双动画
          各自时长(FX.sealSlamMs/sealLingerMs)按列表序逗号内联注入 */}
      {seals.map((s) => (
        <g
          key={s.id}
          className={`fx-svg-seal${s.tone === "gold" ? " fx-svg-seal-gold" : ""}`}
          transform={`translate(${s.x} ${s.y})`}
          style={{ animationDuration: `${FX.sealSlamMs}ms, ${FX.sealLingerMs}ms` }}
        >
          <rect x={-29} y={-29} width={58} height={58} rx={9} />
          <text y={11} textAnchor="middle" fontSize={32}>
            {s.char}
          </text>
        </g>
      ))}
      {/* 破产仪式(S7):铭牌墨渍晕开 + 铜钱撒落(8–12 枚一次性径向抛散)。
          #885 时长收口:墨渍全长 FX.inkBloomMs 内联注入(清理窗 inkBlotMs 同通道);
          撒币错拍步长 FX.coinStaggerMs(c%4 三步封顶,随通道缩放)。 */}
      {inkBlots.map((b) => (
        <circle
          key={b.id}
          className="fx-svg-inkblot"
          cx={b.x}
          cy={b.y}
          r={34}
          fill="url(#fx-ink-grad)"
          style={{ animationDuration: `${FX.inkBloomMs}ms` }}
        />
      ))}
      {coinBursts.map((b) =>
        Array.from({ length: Math.min(b.count, COIN_BURST_MAX) }, (_, c) => (
          <Coin
            key={`${b.id}-${c}`}
            x={b.x}
            y={b.y}
            dx={Math.round((Math.random() - 0.5) * 150)}
            dy={Math.round(Math.random() * 130) - 20}
            delayMs={(c % 4) * FX.coinStaggerMs}
          />
        )),
      )}
      {/* 出牌指示线(#281 P2-E;#849 棒2 提粗三件套):「使用者→目标」水墨墨线 +
          起点小圆锚点 + 终点箭羽(棋盘驿道人字羽同语,StaticLayers ROAD_ARROW_D 同形)。
          组管生死(opacity+金晕 drop-shadow)、线管生长(dashoffset),锚点/箭羽随组同寿、
          箭羽于生长段末张羽——三条 keyframes 同长,全长单源 FX.jinnangLineMs,#849 棒3
          起由本消费点内联注入三条 animationDuration(清理窗=同一 getter,追帧压缩
          天然同步)。端点错位/零长线不设防(零兜底):坐标提取拍已烤定,错位是
          提取侧 bug 该当场露形。data-fx-jinnang-line 供 e2e 单次 evaluate 采样,仍在
          <line> 上(契约不变);fx 层内部 data 属性不进 TESTIDS 单源,同层 data-fx-layer
          先例;pathLength=1 归一化供生长动画。 */}
      {jinnangLines.map((l) => (
        <g
          key={l.id}
          className="fx-svg-jline"
          style={{ animationDuration: `${FX.jinnangLineMs}ms` }}
        >
          <line
            className="fx-svg-jline-stroke"
            data-fx-jinnang-line=""
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            pathLength={1}
            style={{ animationDuration: `${FX.jinnangLineMs}ms` }}
          />
          <circle className="fx-svg-jline-anchor" cx={l.x1} cy={l.y1} r={5} />
          <path
            className="fx-svg-jline-feather"
            d="M -9,-7 L 5,0 L -9,7"
            fill="none"
            transform={`translate(${l.x2} ${l.y2}) rotate(${
              (Math.atan2(l.y2 - l.y1, l.x2 - l.x1) * 180) / Math.PI
            })`}
            style={{ animationDuration: `${FX.jinnangLineMs}ms` }}
          />
        </g>
      ))}
    </>
  );
}

/** 棋盘逻辑坐标 → 屏幕像素(起飞拍一次性换算,旧 getScreenCTM 方案#764 复用):
 *  矩阵换算自带 preserveAspectRatio letterboxing 与现行取景,比手拆 viewBox 稳。 */
function boardToScreen(x: number, y: number): { x: number; y: number } {
  const svg = document.getElementById("board") as SVGSVGElement | null;
  if (!svg) throw new Error("cash-fly:#board 不在文档(对局屏接线 bug)");
  const ctm = svg.getScreenCTM();
  if (!ctm) throw new Error("cash-fly:#board getScreenCTM 不可用");
  const p = new DOMPoint(x, y).matrixTransform(ctm);
  return { x: p.x, y: p.y };
}

/** 归账铜钱一枚(#764):起飞拍换算「来源格中心 → 席位现金数字中心」屏幕几何,
 *  沿上抛二次贝塞尔弧飞(FX.cashFlyMs 内联注入时长,DuelSignsOverlay 同法);
 *  抵达拍(animationend)席位现金数字 bump 一拍 + 自摘。渲染走 store→React,
 *  零直改 DOM(铜钱本体);bump 是对既有 testid span 的类挂摘,见 seat-cash.ts。 */
function FlyCoin({ fly }: { fly: CashFlyFx }) {
  const snap = useGameStore((s) => s.snapshot);
  // 快照缺位 = 对局屏接线 bug(本件只在对局屏挂载),炸出不兜底(零兜底)。
  if (snap == null) throw new Error("cash-fly:快照缺位(接线 bug)");
  const seat = snap.players.findIndex((p) => p.id === fly.playerId);
  // 收账玩家不在快照 = 提取/投影接线 bug,炸出不兜底(零兜底)。
  if (seat < 0) throw new Error(`cash-fly:收账玩家 ${fly.playerId} 不在快照(接线 bug)`);
  const [geo, setGeo] = useState<{ path: string; ms: number } | null>(null);
  useLayoutEffect(() => {
    const from = boardToScreen(fly.x, fly.y);
    const el = document.querySelector(`[data-testid="${TESTIDS.seatCash(seat)}"]`);
    if (!el) throw new Error(`cash-fly:席位 #${seat} 的现金数字元素不存在(接线 bug)`);
    const r = el.getBoundingClientRect();
    const x1 = r.left + r.width / 2;
    const y1 = r.top + r.height / 2;
    // 控制点 = 线段中点沿法线上抛:弧顶朝上(法线取 y 分量向上的一支),抬升量随
    // 距离收窄(近飞浅弧、远飞高抛,上限 90px 不出屏)。棋盘格与席位格几何上恒不
    // 重合,长度为零无防御分支(零兜底:真到了就是布局 bug,NaN 会当场炸出)。
    const dx = x1 - from.x;
    const dy = y1 - from.y;
    const len = Math.hypot(dx, dy);
    const lift = Math.min(90, 40 + len * 0.18);
    let nx = -dy / len;
    let ny = dx / len;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const cx = (from.x + x1) / 2 + nx * lift;
    const cy = (from.y + y1) / 2 + ny * lift;
    setGeo({
      path: `path('M ${from.x} ${from.y} Q ${cx} ${cy} ${x1} ${y1}')`,
      ms: FX.cashFlyMs,
    });
  }, [fly.id, fly.x, fly.y, seat]);
  if (!geo) return null;
  return (
    <svg
      className="fx-cash-fly"
      data-fx-cash-fly=""
      viewBox="-12 -12 24 24"
      width={24}
      height={24}
      aria-hidden="true"
      style={{ offsetPath: geo.path, animationDuration: `${geo.ms}ms` }}
      onAnimationEnd={() => {
        bumpSeatCash(seat);
        useFxStore.getState().removeCashFly(fly.id);
      }}
    >
      {/* 铜钱雨同款素材语言:泉字金币(金圆底+墨字,#764 复用,色吃 token) */}
      <circle r={11} />
      <text y={4} textAnchor="middle">
        泉
      </text>
    </svg>
  );
}

/** 屏幕级特效覆盖层(GameScreen 挂在 board-wrap 内):拼点签面演出桥
 *  (DuelSignsOverlay 渲染 null,仅在挂载期绑定 duelSignsApi 模块桥——签面
 *  overlay 自行 append 到 body,ADR-0030)。#732 起回合横幅/都城停条带已迁
 *  顶中知会横幅槽(NoticeBanner),本层不再渲染知会件。
 *  #764:聚光层 + 金钱飞行归账经 body portal 出 .board-area(overflow:hidden
 *  裁切与右缘 104px 让位都会剪掉飞往席位格的铜钱;z 序:聚光 z-3 压盘面、让位
 *  席位/手牌/动作条,铜钱 z-8 全程可见)。席位现金 count-up 订阅随挂载起、随卸载收。 */
export function FxLayer() {
  const cashFlies = useFxStore((s) => s.cashFlies);
  const spotlight = useFxStore((s) => s.spotlight);
  // 席位现金 count-up(#764):订阅随本件挂载起、随卸载收(与对局屏同生命周期)。
  useEffect(() => startSeatCashCount(), []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-fx-layer>
      <DuelSignsOverlay />
      {createPortal(
        <>
          {/* 出牌窗聚光(#764):常驻 DOM 开关态(fx-spotlight.on),opacity 过渡
              --dur-med;reduced-motion 由 app.css M-4 兜层压瞬时=直切。 */}
          <div className={"fx-spotlight" + (spotlight ? " on" : "")} data-fx-spotlight="" />
          {cashFlies.map((f) => (
            <FlyCoin key={f.id} fly={f} />
          ))}
        </>,
        document.body,
      )}
    </div>
  );
}
