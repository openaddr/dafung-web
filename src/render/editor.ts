// 地图编辑器(阶段 1):复用棋盘 SVG。城池支持长按拖拽改位置(拖拽中隐藏路线、
// 松手后 loadMap 重算避城路线再显示);侧栏属性面板编辑 name/price 等。
import { createBoardSvg } from "./board";
import { loadMap } from "@core/board-loader";
import { el, svg } from "./dom";
import { formatMoney } from "@core/money";
import { MIN_TILE_DIST } from "@core/constants";
import { findTooClosePairs } from "@core/geometry";
import { svgCoordHelpers } from "./svg-util";
import { getMapSource, getDefaultMapId } from "./map-sources";
import type { MapData } from "@core/types";

export function createEditor(root: HTMLElement, mapData: MapData, onExit: () => void, onPlay: (mapData: MapData) => void) {
  let selected = 0;
  let drag = false;
  // 撤销历史(task 4.1):每次 rerender 后 commit 当前快照(去重),undo 弹出当前恢复上一个
  const history: MapData[] = [];
  let lastSnapshot = "";
  function commit() {
    const s = JSON.stringify(mapData);
    if (s !== lastSnapshot) {
      history.push(JSON.parse(s) as MapData);
      lastSnapshot = s;
      if (history.length > 50) history.shift();
    }
  }
  function undo() {
    if (history.length < 2) return;
    history.pop();
    const prev = history[history.length - 1];
    mapData.tiles = JSON.parse(JSON.stringify(prev.tiles)) as MapData["tiles"];
    // 无脑赋值(而非 if 判断):从有辅路撤销到无辅路时,确保 branch 被清空为 null
    mapData.branch = prev.branch != null ? JSON.parse(JSON.stringify(prev.branch)) as MapData["branch"] : null;
    lastSnapshot = JSON.stringify(mapData);
    selected = Math.min(selected, mapData.tiles.length - 1);
    rerender();
    renderPanel();
  }
  // 重叠/过近城检测:与加载器共用 MIN_TILE_DIST + findTooClosePairs,红圈高亮
  function overlappingTiles(): number[] {
    const pts = mapData.tiles.map((t) => ({ x: t.pos[0], y: t.pos[1] }));
    return [...new Set(findTooClosePairs(pts, MIN_TILE_DIST).flat())];
  }

  const boardWrap = el("div", { class: "board-wrap" });
  const panel = el("div", { class: "editor-panel" });
  const exitBtn = el("button", { class: "btn", style: "flex:1" }, ["← 返回"]) as HTMLButtonElement;
  exitBtn.addEventListener("click", () => {
    // 退出编辑器(不自动保存;用户需点「保存」写入图库)。返回设置屏。
    onExit();
  });
  const exportBtn = el("button", { class: "btn", style: "flex:1" }, ["导出"]) as HTMLButtonElement;
  exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(mapData, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my-map.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const importBtn = el("button", { class: "btn", style: "flex:1" }, ["导入"]) as HTMLButtonElement;
  importBtn.addEventListener("click", () => {
    const inp = el("input", { type: "file", accept: ".json,application/json" }) as HTMLInputElement;
    inp.addEventListener("change", () => {
      const f = inp.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string) as MapData;
          loadMap(data, { lenient: true }); // 校验合法性(失败进 catch)
          Object.assign(mapData, data); // 全字段迁移(含 version/maxLevel/resupplyPerLevel)
          if (data.branch == null) mapData.branch = null;
          selected = 0;
          rerender();
          renderPanel();
        } catch {
          alert("导入失败:JSON 解析错误");
        }
      };
      reader.readAsText(f);
    });
    inp.click();
  });
  const saveBtn = el("button", { class: "btn", style: "flex:1" }, ["保存"]) as HTMLButtonElement;
  saveBtn.addEventListener("click", () => {
    // 保存到自建图库(多图,可命名)。走 getMapSource() 单例,不自起实例。
    const store = getMapSource();
    const count = store.listCustomMaps().length;
    const defaultName = `自建地图 ${count + 1}`;
    const name = (prompt("请输入地图名:", defaultName) || "").trim();
    if (!name) return; // 取消或空名 → 不保存
    store.saveCustomMap(name, mapData);
    const total = store.listCustomMaps().length;
    saveBtn.textContent = `已存!图库共 ${total} 张`;
    setTimeout(() => { saveBtn.textContent = "保存"; }, 1500);
  });
  const resetBtn = el("button", { class: "btn", style: "flex:1" }, ["重置"]) as HTMLButtonElement;
  resetBtn.addEventListener("click", async () => {
    if (!confirm("重置回内置地图?当前编辑会丢失。")) return;
    try {
      const data = await getMapSource().loadMapData(await getDefaultMapId());
      Object.assign(mapData, data); // 全字段重置(含 version/maxLevel/resupplyPerLevel)
      if (data.branch == null) mapData.branch = null;
      selected = 0;
      rerender();
      renderPanel();
    } catch {
      alert("重置失败:加载内置地图出错");
    }
  });
  const undoBtn = el("button", { class: "btn", style: "flex:1" }, ["↶ 撤销"]) as HTMLButtonElement;
  undoBtn.addEventListener("click", () => undo());
  const toolbar = el("div", { style: "display:flex;gap:6px;margin:0 0 14px;flex-wrap:wrap" }, [exitBtn, exportBtn, importBtn, saveBtn, resetBtn, undoBtn]);
  const playBtn = el("button", { class: "btn btn-primary", style: "width:100%;margin-top:6px" }, ["▶ 试玩这局"]) as HTMLButtonElement;
  playBtn.addEventListener("click", () => onPlay(mapData));
  const sidebar = el("div", {
    class: "editor-sidebar",
    style: "width:380px;padding:18px;overflow-y:auto;height:100%;min-height:0;flex-shrink:0;background:linear-gradient(180deg,#f7ecd0,#ecdcb4);border-left:2px solid var(--gold)",
  }, [
    toolbar,
    el("h3", { style: "font-family:var(--font-brush);margin:0 0 12px" }, ["编辑地图"]),
    el("div", { style: "font-size:12px;color:var(--ink-dim);margin-bottom:14px" }, ["长按拖拽城池改位置(松手后自动连线);点击城池编辑属性。"]),
    panel,
    playBtn,
  ]);
  const layout = el("div", { style: "display:flex;height:100vh;overflow:hidden;grid-column:1 / -1" }, [
    el("div", { style: "flex:1;position:relative;min-width:0" }, [boardWrap]),
    sidebar,
  ]);
  root.innerHTML = "";
  root.appendChild(layout);

  // 屏幕坐标 → SVG viewBox 坐标(形参 svgEl,避免 shadow dom 的 svg 助手)
  function svgPoint(svgEl: SVGSVGElement, clientX: number, clientY: number) {
    return svgCoordHelpers(svgEl).toSvg(clientX, clientY);
  }

  function rerender() {
    boardWrap.innerHTML = "";
    try {
      const map = loadMap(mapData, { lenient: true });
      const view = createBoardSvg(map.board, map.catalog);
      boardWrap.appendChild(view.root);
      // 3.3 重叠城红圈高亮
      for (const idx of overlappingTiles()) {
        const p = map.tiles[idx].position;
        view.root.appendChild(svg("circle", { cx: p.x, cy: p.y, r: 50, fill: "none", stroke: "#b23a2e", "stroke-width": 3, "stroke-dasharray": "6 4", opacity: "0.85" }));
      }

      // 拖拽:按下选中+开拖;拖动中城池跟手且隐藏路线;松手写 pos 并重算
      view.root.addEventListener("pointerdown", (ev) => {
        const te = (ev.target as HTMLElement).closest("[data-tile]") as HTMLElement | null;
        if (!te) return;
        selected = parseInt(te.dataset.tile!, 10);
        drag = true;
        renderPanel();
        view.root.querySelector("#roads")?.setAttribute("style", "display:none");
        view.root.querySelector("#flow")?.setAttribute("style", "display:none");
        try { view.root.setPointerCapture((ev as PointerEvent).pointerId); } catch { /* ignore */ }
      });
      view.root.addEventListener("pointermove", (ev) => {
        if (!drag) return;
        const g = view.root.querySelector(`[data-tile="${selected}"]`);
        if (g) {
          const p = svgPoint(view.root, ev.clientX, ev.clientY);
          g.setAttribute("transform", `translate(${p.x} ${p.y})`);
        }
      });
      const finish = (ev: PointerEvent) => {
        if (!drag) return;
        drag = false;
        const p = svgPoint(view.root, ev.clientX, ev.clientY);
        mapData.tiles[selected].pos = [Math.round(p.x), Math.round(p.y)];
        renderPanel();
        rerender();
      };
      view.root.addEventListener("pointerup", finish);
      view.root.addEventListener("pointercancel", finish);
    } catch (err) {
      boardWrap.appendChild(el("div", { style: "padding:40px;color:#b23a2e;font-family:serif" }, [`地图校验失败:${(err as Error).message}`]));
    }
    // 校验状态控制试玩按钮(task 3.4):无效则禁用,避免试玩进入坏图
    let ok = false;
    try { loadMap(mapData); ok = true; } catch { ok = false; }
    playBtn.disabled = !ok;
    playBtn.textContent = ok ? "▶ 试玩这局" : "地图无效,无法试玩";
    commit();
  }

  function renderPanel() {
    const t = mapData.tiles[selected];
    panel.innerHTML = "";
    if (!t) {
      panel.appendChild(el("div", {}, ["(未选中城池)"]));
      return;
    }
    panel.appendChild(el("h4", { style: "margin:0 0 10px;font-family:var(--font-deco)" }, [`#${selected} ${t.name}`]));
    const strFields: (keyof typeof t)[] = ["name", "group", "region", "id"];
    const numFields: (keyof typeof t)[] = ["price", "upgrade", "buildCost"];
    for (const k of strFields) {
      panel.appendChild(fieldRow(k as string, String(t[k]), (v) => { (t as unknown as Record<string, unknown>)[k] = v; rerender(); }));
    }
    for (const k of numFields) {
      panel.appendChild(numRow(k as string, Number(t[k]), (v) => { (t as unknown as Record<string, unknown>)[k] = v; rerender(); }));
    }
    panel.appendChild(el("div", { style: "margin-top:10px;font-size:12px;color:var(--ink-dim)" }, [`坐标:[${t.pos[0]}, ${t.pos[1]}](拖拽城池改)`]));

    // 辅路提示(只读:辅路数据由地图作者在 JSON 中手配,编辑器暂不提供可视化编辑)
    if (mapData.branch) {
      const b = mapData.branch;
      const fromT = mapData.tiles.find((tt) => tt.id === b.start);
      const toT = mapData.tiles.find((tt) => tt.id === b.end);
      const counts = b.cells.reduce<Record<string, number>>((m, c) => { m[c.kind] = (m[c.kind] ?? 0) + 1; return m; }, {});
      const summary = Object.entries(counts).map(([k, v]) => `${k === "treasure" ? "珍宝" : k === "event" ? "锦囊" : "中伏"}×${v}`).join(" · ");
      panel.appendChild(el("h4", { style: "margin:14px 0 6px;font-family:var(--font-deco);border-top:1px solid rgba(140,110,60,0.3);padding-top:10px" }, ["辅路(只读)"]));
      panel.appendChild(el("div", { style: "font-size:12px;color:var(--ink-dim)" }, [`${fromT?.name ?? b.start} → ${toT?.name ?? b.end} · ${b.cells.length} 格 · ${summary}`]));
    }

    // 平衡提示(task 4.5)
    const total = mapData.tiles.reduce((s, t) => s + (t.price || 0), 0);
    const prices = mapData.tiles.map((t) => t.price ?? 0).sort((a, b) => a - b);
    panel.appendChild(el("div", { style: "margin-top:14px;font-size:12px;color:var(--ink-dim);border-top:1px solid rgba(140,110,60,0.3);padding-top:10px" }, [`城 ${mapData.tiles.length} · 辅路 ${mapData.branch ? mapData.branch.cells.length + " 格" : "无"} · 总价 ${formatMoney(total)} · 单城 ${formatMoney(prices[0])}~${formatMoney(prices[prices.length - 1])}`]));
  }

  function fieldRow(label: string, val: string, on: (v: string) => void): HTMLElement {
    const inp = el("input", { value: val, style: "width:62%;font-size:13px" }) as HTMLInputElement;
    inp.addEventListener("change", () => on(inp.value));
    return el("label", { style: "display:block;margin:5px 0;font-size:13px" }, [`${label}: `, inp]);
  }
  function numRow(label: string, val: number, on: (v: number) => void): HTMLElement {
    const inp = el("input", { type: "number", value: String(val), style: "width:62%;font-size:13px" }) as HTMLInputElement;
    inp.addEventListener("change", () => on(Number(inp.value) || 0));
    return el("label", { style: "display:block;margin:5px 0;font-size:13px" }, [`${label}: `, inp]);
  }

  rerender();
  renderPanel();
}
