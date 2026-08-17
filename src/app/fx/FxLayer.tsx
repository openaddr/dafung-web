// 瞬时表现层:浮动金额(+/− 与铜钱雨)、回合横幅、朱砂印章。
// 渲染在 #board-wrap 内的绝对定位覆盖层;fxStore 存逻辑坐标(SVG 系),此处渲染时
// 经 getScreenCTM 换算成容器像素(对照旧 svgCoordHelpers + logicToClient)——
// pan/zoom 后的下一次重渲自动对位,无需编排侧维护屏幕坐标。
import { useFxStore } from "./fxStore";
import { formatFloater } from "./orchestrator";
import "./fx.css";

/** SVG 逻辑坐标 → board-wrap 容器像素(旧 logicToClient 的移植)。 */
function logicToContainer(x: number, y: number): { left: number; top: number } | null {
  const svg = document.getElementById("board") as SVGSVGElement | null;
  const wrap = document.getElementById("board-wrap");
  if (!svg || !wrap) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = x;
  pt.y = y;
  const s = pt.matrixTransform(ctm);
  const r = wrap.getBoundingClientRect();
  return { left: s.x - r.left, top: s.y - r.top };
}

export function FxLayer() {
  const floaters = useFxStore((s) => s.floaters);
  const seals = useFxStore((s) => s.seals);
  const banner = useFxStore((s) => s.banner);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-fx-layer>
      {/* 浮动金额 + 铜钱雨 */}
      {floaters.map((f) => {
        const c = logicToContainer(f.x, f.y);
        if (!c) return null;
        return (
          <div key={f.id}>
            <div className={`fx-floater ${f.amount >= 0 ? "pos" : "neg"}`} style={{ left: c.left, top: c.top }}>
              {formatFloater(f.amount)}
            </div>
            {f.coins &&
              Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="fx-coin"
                  style={{ left: c.left, top: c.top, ["--dx" as string]: `${Math.round((Math.random() - 0.5) * 60)}px` }}
                >
                  🪙
                </div>
              ))}
          </div>
        );
      })}
      {/* 朱砂印章 */}
      {seals.map((s) => {
        const c = logicToContainer(s.x, s.y);
        if (!c) return null;
        return (
          <div key={s.id} className="fx-seal" style={{ left: c.left, top: c.top }}>
            {s.char}
          </div>
        );
      })}
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
