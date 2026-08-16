// 地图编辑器屏(阶段 9,React 版):对照旧实现 src/render/editor.ts 的 createEditor。
// 布局同旧版:左侧棋盘(可拖拽城池改 pos)+ 右侧 380px 侧栏(工具条 + 属性面板 + 试玩)。
// 行为对齐点:
// - 拖拽改坐标:旧版在 SVG 根上监听 pointerdown,命中 [data-tile] 即选中并开拖
//   (没有长按阈值——城池命中优先于空白 pan/zoom,空白处仍 pan/zoom)。此处用包裹层
//   捕获阶段拦截 .bv-tile 的 pointerdown,stopPropagation 后自行接管拖拽,
//   BoardView 内部 pan(zoom)只处理空白处,与旧版「城池拖拽优先」一致。
//   拖动中以 HTML 幽灵标记跟手(旧版直接挪 SVG g;React 下不可改动 BoardView 内部
//   节点,幽灵层是等价的视觉反馈),松手换算成 SVG viewBox 坐标写回 MapTile.pos。
// - undo:快照式,深度 50(旧版 history 上限 50);额外提供 redo(旧版没有,React 迁移
//   顺手补上,快照栈天然支持)。
// - 保存前校验:复用 core/board-loader 的 loadMap 严格模式(非 lenient),失败禁用
//   保存/试玩并显示错误(对照旧版试玩按钮的 disabled 逻辑)。
// - 重叠城检测:MIN_TILE_DIST + findTooClosePairs(与旧版共用 core 几何工具),
//   以红圈覆盖层高亮(SVG 根追加 circle 节点,React 不管的外来节点)。
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapData, MapTile, TileType } from "@core/types";
import { loadMap } from "@core/board-loader";
import { MIN_TILE_DIST } from "@core/constants";
import { findTooClosePairs } from "@core/geometry";
import { formatMoney } from "@core/money";
import { getMapSource } from "@app/map-sources";
import { BoardView } from "@app/components/board/BoardView";
import { TID } from "./testids";

export interface EditorScreenProps {
  /** 起编地图(深拷贝由调用方负责;编辑器内部所有变更均产生新对象)。 */
  initialMap: MapData;
  /** 保存回调(已通过严格校验的 MapData;持久化方式由接线方决定)。 */
  onSave: (data: MapData) => void;
  /** 退出编辑器(不自动保存,对照旧版「← 返回」)。 */
  onExit: () => void;
  /** 试玩回调(可选;未传则不显示试玩按钮)。 */
  onStart?: (data: MapData) => void;
}

/** 旧编辑器 undo 历史深度上限。 */
const HISTORY_MAX = 50;

/** 格子类型选项(中文标签对照旧棋盘渲染配色语义)。 */
const TILE_TYPES: ReadonlyArray<{ value: TileType; label: string }> = [
  { value: "Property", label: "城池(地产)" },
  { value: "Chance", label: "锦囊(机会)" },
  { value: "Fate", label: "天命" },
  { value: "Tax", label: "赋税" },
  { value: "Stock", label: "市易(股票)" },
  { value: "Wolong", label: "卧龙" },
  { value: "TreasureCity", label: "宝物城" },
];

/** 文本/数字字段定义(旧版 renderPanel 的 strFields + numFields,外加 type 下拉)。 */
interface FieldDef {
  key: keyof MapTile;
  label: string;
  kind: "text" | "number";
}

const FIELDS: ReadonlyArray<FieldDef> = [
  { key: "name", label: "城名", kind: "text" },
  { key: "id", label: "id", kind: "text" },
  { key: "group", label: "分组(a-h)", kind: "text" },
  { key: "region", label: "区域", kind: "text" },
  { key: "price", label: "价格", kind: "number" },
  { key: "upgrade", label: "升级费", kind: "number" },
  { key: "buildCost", label: "筑城费", kind: "number" },
];

/** 客户端坐标 → SVG viewBox 坐标(考虑 preserveAspectRatio="xMidYMid meet" 的留边)。
 *  BoardView 未暴露当前 viewBox(pan/zoom 在其内部 hook),但 viewBox 作为 prop 会
 *  同步到 <svg viewBox> 属性,拖拽时直接读属性即可拿到实时值。 */
function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const vb = (svg.getAttribute("viewBox") ?? "0 0 1 1").split(/\s+/).map(Number);
  const [vx, vy, vw, vh] = [vb[0] || 0, vb[1] || 0, vb[2] || 1, vb[3] || 1];
  const rect = svg.getBoundingClientRect();
  const scale = Math.min(rect.width / vw, rect.height / vh); // meet:取较小边
  const offX = (rect.width - vw * scale) / 2;
  const offY = (rect.height - vh * scale) / 2;
  return {
    x: vx + (clientX - rect.left - offX) / scale,
    y: vy + (clientY - rect.top - offY) / scale,
  };
}

/** 深拷贝快照(与旧版 JSON.parse(JSON.stringify(...)) 同手段)。 */
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 棋盘渲染错误边界:BoardView 内部走严格 loadMap,编辑中途两城暂时重叠等情况会抛错,
 *  旧版此时显示「地图校验失败」文案;React 下必须用边界兜住,否则整屏白屏。
 *  key 绑 map 序列化,地图一变就重试渲染(重叠拉开后棋盘自动恢复)。 */
class BoardBoundary extends React.Component<
  { mapKey: string; children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { error: (err as Error).message };
  }
  componentDidUpdate(prev: { mapKey: string }) {
    if (prev.mapKey !== this.props.mapKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return <div className="p-10 font-deco text-[#b23a2e]">地图校验失败:{this.state.error}</div>;
    }
    return this.props.children;
  }
}

export function EditorScreen({ initialMap, onSave, onExit, onStart }: EditorScreenProps) {
  const [map, setMap] = useState<MapData>(() => clone(initialMap));
  const [selected, setSelected] = useState(0);
  // 快照式 undo/redo:past 顶 = 上一状态,future = redo 待恢复栈
  const past = useRef<MapData[]>([]);
  const future = useRef<MapData[]>([]);
  const [historyTick, setHistoryTick] = useState(0); // 触发 canUndo/canRedo 重算
  // 拖拽状态:index = 被拖城池;ghost = 幽灵标记的客户端坐标
  const dragRef = useRef<{ index: number; pointerId: number } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; name: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // 表单编辑的「编辑前快照」:焦点进入时记下,失焦时若内容变过则作为一个 undo 步
  // (对照旧版 input change 事件在失焦/回车才触发 → 一次编辑 = 一步 undo)
  const focusSnapshot = useRef<MapData | null>(null);

  // map 的同步引用(避免在 setMap updater 内做栈操作——StrictMode 下 updater 会跑两遍,
  // 历史栈会被压入重复快照;所有历史操作都在 updater 外基于 mapRef 完成)
  const mapRef = useRef(map);
  mapRef.current = map;

  /** 压栈 + 清 redo(深 50 截断,对照旧版 history.shift)。 */
  const pushHistory = useCallback((snapshot: MapData) => {
    past.current.push(snapshot);
    if (past.current.length > HISTORY_MAX) past.current.shift();
    future.current = [];
    setHistoryTick((t) => t + 1);
  }, []);

  /** 应用新状态并压入 undo 栈。 */
  const apply = useCallback(
    (next: MapData) => {
      pushHistory(mapRef.current);
      setMap(next);
    },
    [pushHistory],
  );

  const undo = useCallback(() => {
    if (past.current.length === 0) return;
    const prev = past.current.pop()!;
    future.current.push(mapRef.current);
    setMap(prev);
    setHistoryTick((t) => t + 1);
  }, []);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    const next = future.current.pop()!;
    past.current.push(mapRef.current);
    setMap(next);
    setHistoryTick((t) => t + 1);
  }, []);
  void historyTick; // 仅用于让 canUndo/canRedo 在栈变动后重新求值

  // ── 校验:严格模式 loadMap(非 lenient,含重叠/租金长度/负价检查)──
  const validation = useMemo(() => {
    try {
      loadMap(map);
      return { ok: true as const, error: null as string | null };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  }, [map]);

  // 重叠城索引(与旧版同款工具函数;lenient 预览下允许暂近,红圈提示)
  const overlapping = useMemo(() => {
    const pts = map.tiles.map((t) => ({ x: t.pos[0], y: t.pos[1] }));
    return [...new Set(findTooClosePairs(pts, MIN_TILE_DIST).flat())];
  }, [map]);

  // 红圈高亮:向 BoardView 的 SVG 根追加外来 circle 节点(React 不回收非自有子节点,
  // 每次地图变动先清旧圈再画新圈;与旧编辑器 rerender 时重画等价)
  useEffect(() => {
    const svg = wrapRef.current?.querySelector("svg");
    if (!svg) return;
    const stale = svg.querySelectorAll("circle[data-editor-overlap]");
    stale.forEach((n) => n.remove());
    for (const idx of overlapping) {
      const [x, y] = map.tiles[idx].pos;
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", String(x));
      c.setAttribute("cy", String(y));
      c.setAttribute("r", "50");
      c.setAttribute("fill", "none");
      c.setAttribute("stroke", "#b23a2e");
      c.setAttribute("stroke-width", "3");
      c.setAttribute("stroke-dasharray", "6 4");
      c.setAttribute("opacity", "0.85");
      c.setAttribute("data-editor-overlap", "");
      svg.appendChild(c);
    }
  }, [overlapping, map.tiles]);

  // ── 拖拽(捕获阶段拦截城池 pointerdown;空白处不拦截 → BoardView 内部照常 pan)──
  const onPointerDownCapture = useCallback((ev: React.PointerEvent<HTMLDivElement>) => {
    const tileEl = (ev.target as Element).closest(".bv-tile");
    if (!tileEl) return; // 空白:放行给 BoardView 的 pan/zoom
    const index = Number(tileEl.getAttribute("data-tile"));
    if (!Number.isInteger(index)) return;
    // 城池命中即选中 + 开拖(旧版无长按阈值,城池优先于平移;此处的「防误触」由
    // 命中区域本身保证:只有点中城池图形才算拖拽,点空白永远是 pan)
    ev.stopPropagation();
    dragRef.current = { index, pointerId: ev.pointerId };
    setSelected(index);
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore:极端环境下 capture 失败仍可按 pointermove 兜底 */
    }
  }, []);

  const onPointerMove = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== ev.pointerId) return;
      const t = map.tiles[d.index];
      if (t) setGhost({ x: ev.clientX, y: ev.clientY, name: t.name });
    },
    [map.tiles],
  );

  const finishDrag = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== ev.pointerId) return;
      dragRef.current = null;
      setGhost(null);
      const svg = wrapRef.current?.querySelector("svg");
      if (!svg) return;
      // 松手:客户端坐标 → viewBox 坐标,四舍五入写回 MapTile.pos(对照旧版 Math.round)
      const p = clientToSvg(svg, ev.clientX, ev.clientY);
      const next = clone(mapRef.current);
      next.tiles[d.index] = { ...next.tiles[d.index], pos: [Math.round(p.x), Math.round(p.y)] };
      apply(next);
    },
    [apply],
  );

  // ── 表单字段更新(onChange 改状态,失焦时以「编辑前快照」补一条 undo 记录)──
  const setTileField = useCallback(
    (key: keyof MapTile, value: string | number | TileType | number[]) => {
      setMap((cur) => {
        const next = clone(cur);
        const t = next.tiles[selected];
        if (!t) return cur;
        next.tiles[selected] = { ...t, [key]: value } as MapTile;
        return next;
      });
    },
    [selected],
  );

  // 焦点进入表单:记下编辑前快照(同会话内切换字段不重复记)
  const onFieldFocus = useCallback(() => {
    if (focusSnapshot.current == null) focusSnapshot.current = clone(mapRef.current);
  }, []);

  // 焦点离开:若跳出了属性表单(relatedTarget 不在表单容器内)且内容变过 → 一步 undo。
  // 对照旧版 input change 事件失焦触发 → 一次字段编辑会话 = 一步 undo。
  const onFieldBlur = useCallback(
    (ev: React.FocusEvent<HTMLDivElement>) => {
      const snap = focusSnapshot.current;
      if (!snap) return;
      const stillInForm = ev.relatedTarget instanceof Node && ev.currentTarget.contains(ev.relatedTarget);
      if (stillInForm) return; // 字段间切换:会话延续,快照保留
      focusSnapshot.current = null;
      if (JSON.stringify(snap) !== JSON.stringify(mapRef.current)) pushHistory(snap);
    },
    [pushHistory],
  );

  const tile = map.tiles[selected];
  const maxLevel = map.maxLevel ?? 5;
  // 边界重试 key:任何地图变更(含把非法图修好)都触发 BoardBoundary 重渲染棋盘
  const mapKey = useMemo(() => JSON.stringify(map), [map]);

  // ── 工具条动作 ──
  const doSave = () => {
    if (!validation.ok) return; // 无效图不允许保存(对照旧版保存前无校验——此处更严格,见差异清单)
    onSave(clone(map));
    setStatus("已保存");
    window.setTimeout(() => setStatus(null), 1500);
  };

  const doSaveAs = () => {
    if (!validation.ok) return;
    // 另存新图:直接写入 localStorage 自建图库(走进程级单例,与旧版保存按钮同渠道)
    const store = getMapSource();
    const count = store.listCustomMaps().length;
    const name = (window.prompt("请输入地图名:", `自建地图 ${count + 1}`) ?? "").trim();
    if (!name) return; // 取消或空名 → 不保存(同旧版)
    store.saveCustomMap(name, clone(map));
    setStatus(`已存入图库「${name}」`);
    window.setTimeout(() => setStatus(null), 1500);
  };

  const doTryPlay = () => {
    if (!validation.ok || !onStart) return;
    onStart(clone(map));
  };

  // 重置回内置图(对照旧 editor.ts resetBtn):深拷贝 initialMap 全字段重置,
  // undo/redo 栈清空(旧版重置后不可撤销——回到起编点即"干净状态")。
  const doReset = () => {
    if (!window.confirm("重置回内置地图?当前编辑会丢失。")) return;
    past.current = [];
    future.current = [];
    focusSnapshot.current = null;
    setSelected(0);
    setMap(clone(initialMap));
    setHistoryTick((t) => t + 1);
    setStatus("已重置");
    window.setTimeout(() => setStatus(null), 1500);
  };

  // 导出 JSON(对照旧 editor.ts exportBtn):当前 MapData 下载为文件。
  const doExport = () => {
    const blob = new Blob([JSON.stringify(map, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my-map.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // 导入 JSON(对照旧 importBtn):严格 loadMap 校验 → 通过则替换编辑态(推入 undo 可撤回)。
  const onImportFile = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    ev.target.value = ""; // 允许连续导入同一文件
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as MapData;
        loadMap(data); // 严格模式:非法 JSON/结构直接抛
        apply(data);
        setSelected(0);
        setStatus("已导入");
        window.setTimeout(() => setStatus(null), 1500);
      } catch (err) {
        window.alert(`导入失败:${(err as Error).message}`);
      }
    };
    reader.readAsText(f);
  };

  // 统计行(对照旧版面板底部的平衡提示)
  const stats = useMemo(() => {
    const prices = map.tiles.map((t) => t.price ?? 0).sort((a, b) => a - b);
    const total = prices.reduce((s, v) => s + v, 0);
    return `城 ${map.tiles.length} · 辅路 ${map.branch ? map.branch.cells.length + " 格" : "无"} · 总价 ${formatMoney(total)} · 单城 ${formatMoney(prices[0] ?? 0)}~${formatMoney(prices[prices.length - 1] ?? 0)}`;
  }, [map]);

  const btn =
    "rounded border border-ink/30 px-3 py-1.5 font-deco text-sm text-ink cursor-pointer transition-colors hover:bg-ink/5 disabled:opacity-40 disabled:cursor-not-allowed";
  const primaryBtn = btn.replace("border-ink/30", "border-gold bg-gold/20");

  const inputCls = "rounded border border-ink/30 bg-bg px-2 py-1 w-full";

  return (
    <div data-testid={TID.screen} className="flex h-full overflow-hidden">
      {/* 棋盘区:外层包裹 div 负责城池拖拽(BoardView 本体不动,空白 pan/zoom 照常) */}
      <div className="relative min-w-0 flex-1">
        <div
          ref={wrapRef}
          className="h-full w-full"
          onPointerDownCapture={onPointerDownCapture}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          {/* 编辑模式:无玩家棋子(players=[]);选中城借 selectable 高亮金环。
              边界兜底:编辑中途的暂时非法图(如两城重叠)不让整屏崩,只换提示文案 */}
          <BoardBoundary mapKey={mapKey}>
            <BoardView
              map={map}
              players={[]}
              onTileClick={setSelected}
              selectableTiles={new Set([selected])}
            />
          </BoardBoundary>
        </div>
        {/* 拖拽幽灵标记:HTML 层跟手(旧版直接挪 SVG g;React 下不改 BoardView 内部节点,
            用指针位置的浮动标记做等价视觉反馈) */}
        {ghost && (
          <div
            data-testid={TID.dragGhost}
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded border border-gold bg-panel/90 px-2 py-0.5 font-deco text-sm text-ink shadow"
            style={{ left: ghost.x, top: ghost.y }}
          >
            {ghost.name}
          </div>
        )}
      </div>

      {/* 侧栏:工具条 + 属性面板 + 试玩(宽度/配色对照旧 editor-sidebar) */}
      <aside className="w-[380px] shrink-0 overflow-y-auto border-l-2 border-gold bg-gradient-to-b from-[#f7ecd0] to-[#ecdcb4] p-4">
        <div className="flex flex-wrap gap-1.5">
          <button data-testid={TID.exit} className={btn} onClick={onExit}>← 返回</button>
          <button data-testid={TID.undo} className={btn} onClick={undo} disabled={past.current.length === 0}>↶ 撤销</button>
          <button data-testid={TID.redo} className={btn} onClick={redo} disabled={future.current.length === 0}>↷ 重做</button>
          <button data-testid={TID.save} className={btn} onClick={doSave} disabled={!validation.ok}>保存</button>
          <button data-testid={TID.saveAs} className={btn} onClick={doSaveAs} disabled={!validation.ok}>另存新图</button>
          <button data-testid={TID.export} className={btn} onClick={doExport}>导出</button>
          <button data-testid={TID.import} className={btn} onClick={() => importInputRef.current?.click()}>导入</button>
          <button data-testid={TID.reset} className={btn} onClick={doReset}>重置</button>
        </div>
        {/* 导入文件选择(隐藏 input,按钮代点;对照旧版临时 input.click()) */}
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={onImportFile}
        />

        <h3 className="font-brush mb-1 mt-3 text-xl text-ink">编辑地图</h3>
        <p className="mb-3 text-xs text-ink-dim">拖拽城池改位置(松手后自动连线);点击城池编辑属性。</p>

        {/* 校验状态:严格 loadMap 失败 → 禁保存/试玩并显示原因(对照旧版试玩按钮禁用逻辑) */}
        {!validation.ok && (
          <div data-testid={TID.validationError} className="mb-3 rounded border border-[#b23a2e]/60 bg-[#b23a2e]/10 p-2 text-xs text-[#b23a2e]">
            {validation.error}
          </div>
        )}
        {overlapping.length > 0 && validation.ok && (
          <div data-testid={TID.overlapWarning} className="mb-3 rounded border border-[#b23a2e]/60 bg-[#b23a2e]/10 p-2 text-xs text-[#b23a2e]">
            第 {overlapping.map((i) => i + 1).join("、")} 城距离过近(红圈标出),保存前请拉开。
          </div>
        )}
        {status && <div className="mb-3 text-xs text-green-800">{status}</div>}

        {/* 属性面板(对照旧版 renderPanel) */}
        <div data-testid={TID.tileForm}>
          {!tile ? (
            <div className="text-sm text-ink-dim">(未选中城池)</div>
          ) : (
            <div className="flex flex-col gap-1.5 text-sm text-ink" onFocus={onFieldFocus} onBlur={onFieldBlur}>
              <h4 className="mb-1 font-deco text-base">
                #{selected} {tile.name}
              </h4>

              <label className="flex items-center gap-2">
                <span className="w-24 shrink-0">类型</span>
                <select
                  data-testid={TID.field("type")}
                  className={inputCls}
                  value={tile.type ?? "Property"}
                  onChange={(e) => setTileField("type", e.target.value as TileType)}
                >
                  {TILE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>

              {FIELDS.map((f) => (
                <label key={String(f.key)} className="flex items-center gap-2">
                  <span className="w-24 shrink-0">{f.label}</span>
                  <input
                    data-testid={TID.field(String(f.key))}
                    className={inputCls}
                    type={f.kind === "number" ? "number" : "text"}
                    value={f.kind === "number" ? String(tile[f.key] ?? 0) : String(tile[f.key] ?? "")}
                    onChange={(e) =>
                      setTileField(f.key, f.kind === "number" ? Number(e.target.value) || 0 : e.target.value)
                    }
                  />
                </label>
              ))}

              {/* 租金表:逐级数字输入(Lv0..Lv maxLevel;严格校验要求长度 ≥ maxLevel+1) */}
              <div className="mt-1 border-t border-ink/20 pt-2">
                <div className="mb-1 text-xs text-ink-dim">租金表(Lv0~Lv{maxLevel})</div>
                <div className="grid grid-cols-4 gap-1">
                  {Array.from({ length: maxLevel + 1 }, (_, lvl) => (
                    <label key={lvl} className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-ink-dim">Lv{lvl}</span>
                      <input
                        data-testid={TID.rentLevel(lvl)}
                        className="rounded border border-ink/30 bg-bg px-1 py-0.5 text-xs"
                        type="number"
                        value={String(tile.rentByLevel?.[lvl] ?? 0)}
                        onChange={(e) => {
                          const rent = [...(tile.rentByLevel ?? Array.from({ length: maxLevel + 1 }, () => 0))];
                          rent[lvl] = Number(e.target.value) || 0;
                          setTileField("rentByLevel", rent);
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-2 text-xs text-ink-dim">
                坐标:[{tile.pos[0]}, {tile.pos[1]}](拖拽城池改)
              </div>
            </div>
          )}
        </div>

        {/* 辅路摘要(只读,对照旧版:辅路由地图作者在 JSON 手配) */}
        {map.branch && (
          <div className="mt-3 border-t border-ink/20 pt-2 text-xs text-ink-dim">
            <h4 className="mb-1 font-deco text-sm text-ink">辅路(只读)</h4>
            <p>
              {map.tiles.find((t) => t.id === map.branch!.start)?.name ?? map.branch.start}
              {" → "}
              {map.tiles.find((t) => t.id === map.branch!.end)?.name ?? map.branch.end}
              {" · "}
              {map.branch.cells.length} 格
            </p>
          </div>
        )}

        <p className="mt-3 border-t border-ink/20 pt-2 text-xs text-ink-dim">{stats}</p>

        {onStart && (
          <button
            data-testid={TID.tryPlay}
            className={`${primaryBtn} mt-4 w-full`}
            onClick={doTryPlay}
            disabled={!validation.ok}
          >
            {validation.ok ? "▶ 试玩这局" : "地图无效,无法试玩"}
          </button>
        )}
      </aside>
    </div>
  );
}
