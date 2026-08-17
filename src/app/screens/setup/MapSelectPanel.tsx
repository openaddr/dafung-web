// 地图选择面板(首页内嵌二级屏):列出全部可选地图(内置 + 自建),
// 点击条目展开简化 SVG 预览(主路折线 + 城池圆点),确认后回传 mapId。
// 对照旧实现 src/render/ui.ts createMapSelectionScreen;预览不复用重型 createBoardSvg,
// 而是直接基于 MapData 的 pos 坐标画简版(延迟加载:点选时才 loadMapData)。
import { useEffect, useState } from "react";
import type { MapEntry, MapSource } from "@core/map-source";
import type { MapData } from "@core/types";
import { formatMoney } from "@core/money";
import { getMapSource } from "@app/map-sources";
import { TID } from "./testids";

export interface MapSelectPanelProps {
  /** 地图源(默认进程级复合源;测试可注入内存实现)。 */
  mapSource?: MapSource;
  /** 进来时已选中的地图 id;null = 房间尚未选图,无预选(不兜底选第一张)。 */
  currentMapId: string | null;
  onConfirm: (mapId: string, name: string) => void;
  onCancel: () => void;
}

/** 预览图固定 viewBox 尺寸(等比缩放,SVG 自动适配容器宽)。
 *  旧地图 pos 坐标量级约在几百,取 800×600 画布,边界留白 40。 */
const VIEW_W = 800;
const VIEW_H = 600;
const PAD = 40;

/** 由 MapData 生成简化 SVG 预览节点:主路折线(按 tiles 顺序)+ 城池点。
 *  分岔辅路格(pos 存在但不构成主路序列)暂无法从 MapTile 区分——简版预览
 *  按数组顺序连线,视觉近似即可,精确棋盘留给对局渲染。 */
function MiniMap({ data }: { data: MapData }) {
  const pts = data.tiles.map((t) => ({ x: t.pos[0], y: t.pos[1], name: t.name }));
  if (!pts.length) return null;
  // 坐标归一化到 viewBox:平移 + 等比缩放(保持纵横比,避免形变)
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(
    (VIEW_W - PAD * 2) / Math.max(1, maxX - minX),
    (VIEW_H - PAD * 2) / Math.max(1, maxY - minY),
  );
  const offX = (VIEW_W - (maxX - minX) * scale) / 2;
  const offY = (VIEW_H - (maxY - minY) * scale) / 2;
  const map = (p: { x: number; y: number }) => ({
    x: (p.x - minX) * scale + offX,
    y: (p.y - minY) * scale + offY,
  });
  const path = pts.map((p, i) => {
    const q = map(p);
    return `${i === 0 ? "M" : "L"}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg
      data-testid={TID.mapPreview}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full max-h-[40vh] rounded-md bg-bg border border-ink/20"
      role="img"
      aria-label="地图预览"
    >
      {/* 主路:水墨棕折线 */}
      <path d={path} fill="none" stroke="var(--color-road-main)" strokeWidth={4} strokeLinejoin="round" opacity={0.85} />
      {pts.map((p, i) => {
        const q = map(p);
        return (
          <g key={i}>
            <circle cx={q.x} cy={q.y} r={7} fill="var(--color-panel)" stroke="var(--color-ink-dim)" strokeWidth={2} />
            <text x={q.x} y={q.y + 4} textAnchor="middle" fontSize={11} fill="var(--color-ink)" fontFamily="var(--font-deco)">
              {p.name.slice(0, 1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function MapSelectPanel({ mapSource = getMapSource(), currentMapId, onConfirm, onCancel }: MapSelectPanelProps) {
  const [entries, setEntries] = useState<MapEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 临时选中态:确认后才回传(与旧二级屏行为一致,取消不改变外层选择)
  const [picked, setPicked] = useState<string | null>(currentMapId);
  // 预览数据:点选时异步 loadMapData,一次只保留一张
  const [preview, setPreview] = useState<{ id: string; data: MapData } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 挂载时拉清单一次(fetch 内置清单 + localStorage 自建图,均可能失败需兜底提示);
  // S-4:清单拉取收敛为 reload,失败态可点「重试」重新拉取
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);
    mapSource
      .listMaps()
      .then((list) => alive && setEntries(list))
      .catch((err) => alive && setError((err as Error).message));
    return () => {
      alive = false;
    };
  }, [mapSource, reloadKey]);

  // S-4:Esc 关闭弹层(与「取消」等价)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const pick = (entry: MapEntry) => {
    setPicked(entry.id);
    setPreviewLoading(true);
    setPreview(null);
    mapSource
      .loadMapData(entry.id)
      .then((data) => setPreview({ id: entry.id, data }))
      .catch((err) => setError((err as Error).message))
      .finally(() => setPreviewLoading(false));
  };

  return (
    <div
      data-testid={TID.mapPanel}
      // S-4:遮罩点击关闭(弹体 stopPropagation 防误关)
      onClick={onCancel}
      className="fixed inset-0 z-20 flex items-center justify-center bg-ink/40 backdrop-blur-[1px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(680px,92vw)] max-h-[86vh] overflow-y-auto rounded-lg border border-gold/60 bg-panel p-5 shadow-2xl"
      >
        <h3 className="font-brush text-xl tracking-[0.3em] text-ink mb-3">选择地图</h3>

        {!entries && !error && <p className="font-deco text-ink-dim py-6">载入地图清单…</p>}
        {error && (
          <div className="flex items-center gap-3 py-2">
            <p className="text-danger text-sm">加载失败:{error}</p>
            {/* S-4:失败态提供重试(重新 listMaps) */}
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="rounded border border-ink/30 bg-panel-hi px-4 min-h-[40px] font-deco text-ink cursor-pointer hover:bg-bg-deep"
            >
              重试
            </button>
          </div>
        )}
        {entries && entries.length === 0 && <p className="font-deco text-ink-dim py-6">暂无可用地图。</p>}

        {entries && entries.length > 0 && (
          <>
            <div className="flex flex-col gap-2 max-h-[38vh] overflow-y-auto pr-1">
              {entries.map((e) => {
                const selected = e.id === picked;
                return (
                  <button
                    key={e.id}
                    data-testid={TID.mapItem(e.id)}
                    onClick={() => pick(e)}
                    // S-9:选中态语义化(切换语义用 aria-pressed 而非 aria-selected)
                    aria-pressed={selected}
                    className={
                      "text-left rounded-lg border px-3 py-2.5 transition-colors cursor-pointer " +
                      (selected
                        ? "border-gold bg-gold/15"
                        : "border-ink/25 bg-bg/60 hover:border-gold/60")
                    }
                  >
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="font-deco text-[15px] font-bold text-ink">
                        {e.name}
                        {e.custom ? <span className="ml-2 text-xs text-ink-dim">自建</span> : null}
                      </span>
                      <span className="text-xs text-ink-dim shrink-0">
                        {e.tileCount} 城 · 目标 {formatMoney(e.targetNetWorth)}
                      </span>
                    </div>
                    <div className="text-xs text-ink-dim mt-1">{e.desc}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 border-t border-dashed border-ink/25 pt-3">
              {previewLoading && <p className="font-deco text-xs text-ink-dim py-2">预览加载中…</p>}
              {preview && !previewLoading && <MiniMap data={preview.data} />}
            </div>

            <div className="mt-4 flex justify-end gap-2.5">
              <button
                data-testid={TID.mapCancel}
                onClick={onCancel}
                className="rounded border border-ink/30 bg-panel-hi px-4 py-1.5 font-deco text-ink cursor-pointer hover:bg-bg-deep"
              >
                取消
              </button>
              <button
                data-testid={TID.mapConfirm}
                onClick={() => {
                  if (picked === null) return; // 未选时按钮已禁用,此行为类型收窄守卫
                  const entry = entries.find((x) => x.id === picked);
                  onConfirm(picked, entry ? entry.name : picked);
                }}
                disabled={picked === null}
                className="rounded border border-gold bg-gold/80 px-4 py-1.5 font-deco text-ink cursor-pointer hover:bg-gold disabled:opacity-40"
              >
                确认选择
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
