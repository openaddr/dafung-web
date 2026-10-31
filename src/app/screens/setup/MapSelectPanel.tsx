// 地图选择面板(首页内嵌二级屏):列出全部可选地图(内置 + 自建),
// 点击条目展开简化 SVG 预览(主路双层描折线 + 城池方形小印),确认后回传 mapId。
// 对照旧实现 src/render/ui.ts createMapSelectionScreen;预览不复用重型 createBoardSvg,
// 而是直接基于 MapData 的 pos 坐标画简版(延迟加载:点选时才 loadMapData)。
// #173:弹层壳(遮罩/居中/焦点陷阱/Esc/点外关/还焦手柄)收口到 ui/dialog
// (Base UI 底件),面板本体(内容/testid/水墨皮)原样保留。
// #832:矮横屏(844×390)首帧可视两刀——①确认/取消行 sticky 钉弹层可视底
// (配方抄 setup.css .su-actions:sticky+渐隐墨底,负 margin 出血到弹层左右缘,
// 桌面档无外滚时自然收尾不表态),②预览收幅 40vh→20vh;MiniMap 换玄墨制式
// (深纹底+主路双层描+城点方形小印,质感对齐 DESIGN §5.4 印盘/界格语言)。
// 矮档密度收放(清单/预览段间距)单源 ./MapSelectPanel.css。
import { useEffect, useState } from "react";
import type { MapEntry, MapSource } from "@core/map-source";
import type { MapData } from "@core/board-loader";
import { formatMoney } from "@core/money";
import { getMapSource } from "@app/map-sources";
import { Dialog, DialogContent } from "@app/components/ui/dialog";
import { DialogDragHandle } from "@app/hooks/use-dialog-drag";
import { TID } from "./testids";
import { TESTIDS } from "../game/testids";
// 空态器物件(#768):清单加载=墨滴呼吸三点 / 清单空=斜放朱印+短注(制式单源 shared)
import { InkBreathe, SealEmpty } from "@app/screens/shared/ArtifactEmpty";
// S1(#34):面板入场复用现成卷轴展开动画(0.35s;reduced-motion 由 app.css 全局兜层瞬时化)。
// 本面板被首页/配置页/大厅三处复用,css 在此引入保证每个宿主屏都带动画定义。
import "@app/screens/game/scroll/scroll.css";
// #832:矮横屏档密度收放(清单 34vh/预览段 8px),本面板专属不进共享文件。
import "./MapSelectPanel.css";

export interface MapSelectPanelProps {
  /** 地图源(默认进程级复合源;测试可注入内存实现)。 */
  mapSource?: MapSource;
  /** 进来时已选中的地图 id;null = 房间尚未选图,无预选(不兜底选第一张)。 */
  currentMapId: string | null;
  onConfirm: (mapId: string, name: string) => void;
  onCancel: () => void;
}

/** 预览画布归一目标(数据较大的一维映射到该值;画布紧贴数据外沿,#832)。
 *  旧固定 800×600 画布在非 4:3 地图上两侧吃死留白,同一收幅内路网渲染缩水;
 *  改贴外沿后 viewBox 纵横比随地图,20vh 条幅内画得更大。留白 PAD 同旧档。 */
const NORM_MAX = 720;
const PAD = 40;

/** 由 MapData 生成简化 SVG 预览节点:主路双层描折线(按 tiles 顺序)+ 城池方形小印。
 *  简版预览按数组顺序连线,视觉近似即可,精确棋盘留给对局渲染。
 *  #832 玄墨制式:深纹底(bg-deep + 界格淡线网纹,§5.4 手札界格语言)+ 主路
 *  双层描(晕宽底带 + 提亮面线)+ 城点方形小印(paper 印面 + 文楷单字,§5.4
 *  印盘语言)。深纹底以越界大矩形铺满元素视口:SVG 只裁元素盒不裁 viewBox,
 *  条幅 letterbox 区同底色,预览读作一条完整「地图横卷」。 */
function MiniMap({ data }: { data: MapData }) {
  const pts = data.tiles.map((t) => ({ x: t.pos[0], y: t.pos[1], name: t.name }));
  if (!pts.length) return null;
  // 坐标归一化:平移 + 等比缩放(保持纵横比,避免形变),画布贴数据外沿
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const dataW = Math.max(1, maxX - minX);
  const dataH = Math.max(1, maxY - minY);
  const scale = Math.min(NORM_MAX / dataW, NORM_MAX / dataH);
  const vbW = dataW * scale + PAD * 2;
  const vbH = dataH * scale + PAD * 2;
  const map = (p: { x: number; y: number }) => ({
    x: (p.x - minX) * scale + PAD,
    y: (p.y - minY) * scale + PAD,
  });
  const path = pts
    .map((p, i) => {
      const q = map(p);
      return `${i === 0 ? "M" : "L"}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      data-testid={TID.mapPreview}
      viewBox={`0 0 ${vbW.toFixed(0)} ${vbH.toFixed(0)}`}
      className="w-full max-h-[20vh] rounded-[3px] border border-gold/25 bg-[var(--color-bg-deep)]"
      role="img"
      aria-label="地图预览"
    >
      <defs>
        {/* 界格淡线网纹:每格上/左缘发丝金线,opacity 压到 0.1 只留「纹」感
            (0.06 实拍不可辨,#832 定位截图) */}
        <pattern id="msp-weave" width={44} height={44} patternUnits="userSpaceOnUse">
          <path
            d="M44 0H0V44"
            fill="none"
            stroke="var(--color-gold)"
            strokeOpacity={0.1}
            strokeWidth={1}
          />
        </pattern>
      </defs>
      {/* 深纹底:越界大矩形铺满元素视口(letterbox 区同底色) */}
      <rect x={-200000} y={-200000} width={400000} height={400000} fill="var(--color-bg-deep)" />
      <rect x={-200000} y={-200000} width={400000} height={400000} fill="url(#msp-weave)" />
      {/* 主路双层描:底层晕宽墨带 + 面层提亮主描。strokeWidth 走 CSS px
          (non-scaling-stroke,#832):画布单位随地图纵横伸缩,固定单位描边在
          环游图(≈0.18 缩放)上细若发丝、小图上更细——双描制式必须屏尺寸恒定
          才在任何地图上可读。 */}
      <path
        d={path}
        fill="none"
        stroke="var(--color-road-main)"
        strokeWidth={4}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.3}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={path}
        fill="none"
        stroke="var(--color-road-main)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.95}
        vectorEffect="non-scaling-stroke"
      />
      {pts.map((p, i) => {
        const q = map(p);
        return (
          <g key={i}>
            {/* 城点=方形小印(§5.4 印盘语言):paper 印面 + 墨发丝边(屏尺寸恒定)
                + 文楷单字印文(随图缩放,近距可辨即可) */}
            <rect
              x={q.x - 6.5}
              y={q.y - 6.5}
              width={13}
              height={13}
              rx={2}
              fill="var(--color-paper-hi)"
              stroke="var(--color-paper-dim)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={q.x}
              y={q.y + 4}
              textAnchor="middle"
              fontSize={11}
              fill="var(--color-paper)"
              fontFamily="var(--font-wenkai)"
            >
              {p.name.slice(0, 1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function MapSelectPanel({
  mapSource = getMapSource(),
  currentMapId,
  onConfirm,
  onCancel,
}: MapSelectPanelProps) {
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
        className="map-select-panel scroll-anim-unroll note-card block w-[min(680px,92vw)] max-h-[86dvh] overflow-y-auto rounded-[8px] p-5 shadow-[var(--ink-shadow-lg)]!"
      >
        {/* 笺头制式(视觉重做 v2):「图」字朱印 + 标签 + 发丝线(用法同 game/StatusBar);
            兼拖动把手(#674,DialogDragHandle 消费 DialogContent 下发的原语) */}
        <DialogDragHandle
          as="h3"
          className="msp-head note-head mb-3 text-xs tracking-[0.25em] text-paper-dim"
          testid={TESTIDS.modalDragHandle}
        >
          <i>图</i>
          <span>选择地图</span>
        </DialogDragHandle>

        {/* 加载/空态(#768 空态器物化):「载入地图清单…」「暂无可用地图。」一行
            小字退役——加载=墨滴呼吸三点(语义走 role=status),空=斜放朱印+短注。 */}
        {!entries && !error && (
          <div className="flex justify-center py-6">
            <InkBreathe title="载入地图清单" />
          </div>
        )}
        {error && (
          <div className="flex items-center gap-3 py-2">
            <p className="text-danger text-sm">加载失败:{error}</p>
            {/* S-4:失败态提供重试(重新 listMaps) */}
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="note-btn rounded-[3px] px-4 min-h-[40px] font-wenkai text-paper cursor-pointer"
            >
              重试
            </button>
          </div>
        )}
        {entries && entries.length === 0 && (
          <div className="flex justify-center py-6">
            <SealEmpty char="空" note="尚无图志" title="暂无可用地图" />
          </div>
        )}

        {entries && entries.length > 0 && (
          <>
            {/* msp-list:矮横屏档密度收放锚点(MapSelectPanel.css 34vh,桌面档 38vh) */}
            <div className="msp-list flex flex-col gap-2 max-h-[38vh] overflow-y-auto pr-1">
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
                        ? // #497 ④:选中金色档与 SegmentedSelect 统一 gold/25(漂移收敛)
                          "border-gold bg-gold/25"
                        : "border-paper/25 bg-bg/60 hover:border-gold/60")
                    }
                  >
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="font-wenkai text-[15px] font-bold text-paper">
                        {e.name}
                        {e.custom ? (
                          <span className="ml-2 text-xs text-paper-dim">自建</span>
                        ) : null}
                      </span>
                      <span className="text-xs text-paper-dim shrink-0">
                        {e.tileCount} 城 · 目标 {formatMoney(e.targetNetWorth)}
                      </span>
                    </div>
                    <div className="text-xs text-paper-dim mt-1">{e.desc}</div>
                  </button>
                );
              })}
            </div>

            {/* R3-A3(#66):条件渲染——未加载(无预选且未点选)时不渲染死虚线空槽。
                msp-preview:矮横屏档间距收放锚点(MapSelectPanel.css mt/pt 8px)。 */}
            {(previewLoading || preview) && (
              <div className="msp-preview mt-3 border-t border-dashed border-paper/25 pt-3">
                {previewLoading && (
                  <p className="font-wenkai text-xs text-paper-dim py-2">预览加载中…</p>
                )}
                {preview && !previewLoading && <MiniMap data={preview.data} />}
              </div>
            )}

            {/* #832 主行动钉底:配方抄 setup.css .su-actions(sticky 锚 bottom=
                --safe-bottom + 渐隐墨底),内容外滚时确认/取消恒钉弹层可视底;
                负 margin 出血到弹层左右缘(px-5 补回内容对齐),滚动清单从渐隐带
                下穿过;桌面档无外滚时 sticky 不表态,自然收尾同旧。 */}
            <div className="msp-actions mt-4 sticky bottom-[var(--safe-bottom)] -mx-5 flex justify-end gap-2.5 bg-[linear-gradient(180deg,transparent,var(--color-panel)_35%)] px-5 pt-0.5">
              <button
                data-testid={TID.mapCancel}
                onClick={onCancel}
                className="note-btn rounded-[3px] px-4 py-2 font-wenkai text-paper cursor-pointer"
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
                // 主行动触达口径 44(#761 ⑧;次级「取消/重试」维持 40 档不动)
                className="ink-btn min-h-[44px] rounded-[5px] px-4 py-2 font-wenkai cursor-pointer disabled:opacity-40"
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
