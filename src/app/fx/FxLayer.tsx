// 瞬时表现层:浮动金额(+/− 与铜钱雨)、回合横幅、朱砂印章。
// D1/D4 改造:浮字/印章/铜钱不再走 HTML 覆盖层 + getScreenCTM 一次性换算
// (拖拽/缩放后即脱锚),而是直接渲染进棋盘 SVG 的 #bv-fx 层(BoardFxLayer,
// 由 BoardView 挂载)——坐标系与棋盘天然一致,pan/zoom 时随视图一起变换,
// 字号随视图缩放、按当前缩放设 12px 等效下限。
// FxLayer(HTML)仅保留回合横幅——它是屏幕居中元素,不属于棋盘坐标系。
import { useFxStore } from "./fxStore";
import { formatFloater } from "./orchestrator";
import "./fx.css";

/** 浮字基准字号(SVG 逻辑单位;总览(1 unit≈0.4px)下约等于旧版 26px 屏幕字的观感)。 */
const FLOATER_BASE_UNITS = 26;
/** 浮字等效屏幕像素下限(D4:高倍缩小视图时也不小于 12px)。 */
const FLOATER_MIN_PX = 12;

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

/** 棋盘内 SVG 特效层(BoardView 挂在 #bv-fx 内):浮字 + 铜钱雨 + 朱砂印章。 */
export function BoardFxLayer() {
  const floaters = useFxStore((s) => s.floaters);
  const seals = useFxStore((s) => s.seals);
  const fontSize = floaterFontSize();

  return (
    <>
      {/* 浮动金额 + 铜钱雨:逻辑坐标直接使用,无需换算 */}
      {floaters.map((f) => (
        <g key={f.id}>
          <text
            className={`fx-svg-floater ${f.amount >= 0 ? "pos" : "neg"}`}
            x={f.x}
            y={f.y}
            fontSize={fontSize}
            textAnchor="middle"
          >
            {formatFloater(f.amount)}
          </text>
          {f.coins &&
            Array.from({ length: 6 }, (_, i) => (
              <g
                key={i}
                className="fx-svg-coin"
                transform={`translate(${f.x} ${f.y})`}
                style={{ ["--dx" as string]: `${Math.round((Math.random() - 0.5) * 60)}px` }}
              >
                {/* D3:铜钱雨用「泉」字(金色圆底 + 墨字),替换与水墨语言相斥的 🪙 emoji */}
                <circle r={11} />
                <text y={4} textAnchor="middle">泉</text>
              </g>
            ))}
        </g>
      ))}
      {/* 朱砂印章:红底米白字方印,坐标即逻辑坐标 */}
      {seals.map((s) => (
        <g key={s.id} className="fx-svg-seal" transform={`translate(${s.x} ${s.y})`}>
          <rect x={-29} y={-29} width={58} height={58} rx={9} />
          <text y={11} textAnchor="middle" fontSize={32}>{s.char}</text>
        </g>
      ))}
    </>
  );
}

/** 屏幕级特效覆盖层(GameScreen 挂在 board-wrap 内):仅回合旌旗横幅(屏幕居中,不属于棋盘系)。 */
export function FxLayer() {
  const banner = useFxStore((s) => s.banner);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-fx-layer>
      {/* 回合旌旗横幅:key=id 保证同一玩家连续两回合也能重启动画 */}
      {banner && (
        <div
          key={banner.id}
          className="fx-turn-banner"
          style={{ ["--player-color" as string]: banner.color }}
        >
          【{banner.guohao}】之回合
        </div>
      )}
    </div>
  );
}
