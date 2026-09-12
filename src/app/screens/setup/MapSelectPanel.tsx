// 地图选择面板(首页内嵌二级屏):列出全部可选地图(内置 + 自建),
// 点击条目展开简化 SVG 预览(主路折线 + 城池圆点),确认后回传 mapId。
// 对照旧实现 src/render/ui.ts createMapSelectionScreen;预览不复用重型 createBoardSvg,
// 而是直接基于 MapData 的 pos 坐标画简版(延迟加载:点选时才 loadMapData)。
// #173:弹层壳(遮罩/居中/焦点陷阱/Esc/点外关/还焦手柄)收口到 ui/dialog
// (Base UI 底件),面板本体(内容/testid/水墨皮)原样保留。
import { useEffect, useState } from "react";
import type { MapEntry, MapSource } from "@core/map-source";
import type { MapData } from "@core/types";
import { formatMoney } from "@core/money";
import { getMapSource } from "@app/map-sources";
import { Dialog, DialogContent } from "@app/components/ui/dialog";
import { TID } from "./testids";
// S1(#34):面板入场复用现成卷轴展开动画(0.35s;reduced-motion 由 app.css 全局兜层瞬时化)。
// 本面板被首页/配置页/大厅三处复用,css 在此引入保证每个宿主屏都带动画定义。
import "@app/screens/game/scroll/scroll.css";

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
      className="w-full max-h-[40vh] rounded-[3px] bg-bg border border-ink/20"
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
            <text x={q.x} y={q.y + 4} textAnchor="middle" fontSize={11} fill="var(--color-ink)" fontFamily="var(--font-wenkai)">
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

  // R3-A3(#66):带预选打开(首页/单机页/大厅默认路径 mapId 恒非空)时,挂载即对初始
  // picked 复用 pick() 的加载逻辑——否则预览区整块空白只剩一条死虚线。
  // alive 卸载守卫照上方清单拉取的写法,防卸载后写状态;null = 房间尚未选图,无预选不加载。
  useEffect(() => {
    if (picked === null) return;
    let alive = true;
    setPreviewLoading(true);
    setPreview(null);
    mapSource
      .loadMapData(picked)
      .then((data) => alive && setPreview({ id: picked, data }))
      .catch((err) => alive && setError((err as Error).message))
      .finally(() => alive && setPreviewLoading(false));
    return () => {
      alive = false;
    };
    // 仅挂载时对初始预选拉一次,后续预览一律走 pick(依赖数组刻意留空)
  }, []);

  return (
    // #173:壳归 ui/dialog——role=dialog、打开聚焦首个可交互件(清单未载入时为面板
    // 本体)、Tab 圈定、Esc 关、点遮罩关、关闭还焦打开前手柄,均由 Base UI 底件接管;
    // 受控 open 恒真,关闭即 onCancel → 宿主屏卸载本面板(三屏同口径)。
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogContent
        data-testid={TID.mapPanel}
        // 无独立 DialogTitle(笺头是自绘 h3),可访名走 aria-label
        aria-label="选择地图"
        // S1(#34):面板入场 scroll-anim-unroll(0.35s;max-h 内滚不变)。
        // W2-包A:换皮入控件种——note-card 笺纸材质(墨褐发丝边),弹层投影走
        // --ink-shadow-lg(DESIGN §4.2 弹层档;note-card 默认 sm 是非分层样式会压过
        // 分层 utilities,故加 ! 钉住 lg)。宽度/内滚不动;定位改由底件接管。
        // block 抵消底件 Popup 的 flex 档,保持原块级布局(内滚滚动语义不变);
        // note-card(非分层)自压底件的纸底/发丝边 utilities,水墨皮不变。
        className="scroll-anim-unroll note-card block w-[min(680px,92vw)] max-h-[86dvh] overflow-y-auto rounded-[8px] p-5 shadow-[var(--ink-shadow-lg)]!"
      >
        {/* 笺头制式(视觉重做 v2):「图」字朱印 + 标签 + 发丝线(用法同 game/StatusBar) */}
        <h3 className="note-head mb-3 text-xs tracking-[0.25em] text-ink-dim">
          <i>图</i>
          <span>选择地图</span>
        </h3>

        {!entries && !error && <p className="font-wenkai text-ink-dim py-6">载入地图清单…</p>}
        {error && (
          <div className="flex items-center gap-3 py-2">
            <p className="text-danger text-sm">加载失败:{error}</p>
            {/* S-4:失败态提供重试(重新 listMaps) */}
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="note-btn rounded-[3px] px-4 min-h-[40px] font-wenkai text-ink cursor-pointer"
            >
              重试
            </button>
          </div>
        )}
        {entries && entries.length === 0 && <p className="font-wenkai text-ink-dim py-6">暂无可用地图。</p>}

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
                    // W2-包A:小控件圆角收敛 3px(DESIGN §4.2);选中=势(金)语义保留
                    className={
                      "text-left rounded-[3px] border px-3 py-2.5 transition-colors cursor-pointer " +
                      (selected
                        ? "border-gold bg-gold/15"
                        : "border-ink/25 bg-bg/60 hover:border-gold/60")
                    }
                  >
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="font-wenkai text-[15px] font-bold text-ink">
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

            {/* R3-A3(#66):条件渲染——未加载(无预选且未点选)时不渲染死虚线空槽 */}
            {(previewLoading || preview) && (
              <div className="mt-3 border-t border-dashed border-ink/25 pt-3">
                {previewLoading && <p className="font-wenkai text-xs text-ink-dim py-2">预览加载中…</p>}
                {preview && !previewLoading && <MiniMap data={preview.data} />}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2.5">
              <button
                data-testid={TID.mapCancel}
                onClick={onCancel}
                className="note-btn rounded-[3px] px-4 py-2 font-wenkai text-ink cursor-pointer"
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
                className="ink-btn rounded-[5px] px-4 py-2 font-wenkai cursor-pointer disabled:opacity-40"
              >
                确认选择
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
