// 地图加载器:把 MapData(JSON)校验并构建为运行时对象(Board + catalog + 属性)。
// 主路 = tiles 数组顺序闭合环;分岔辅路 branch 的 start/end 用 tile id 引用,
// cells 的坐标由 JSON 手配。校验失败抛可读错误。
import { createBoard } from "./board";
import type { Board, BoardBranch, BranchCell } from "./board";
import type {
  BoardPos,
  MapData,
  PropertyDef,
  TileDef,
} from "./types";
import { MIN_TILE_DIST } from "./constants";
import { findTooClosePairs } from "./geometry";

const SUPPORTED_VERSION = 1;

export interface MapCatalog {
  get(id: string | null): PropertyDef | null;
  groupMembers(group: string): string[];
}

export interface LoadedMap {
  board: Board;
  properties: PropertyDef[];
  tiles: TileDef[];
  branch: BoardBranch | null;
  catalog: MapCatalog;
  targetNetWorth: number;
  startingCash: number;
}

function fail(msg: string): never {
  throw new Error(`地图校验失败:${msg}`);
}

/** 版本迁移:旧存档字段补全/转换。当前 v1→v1 无操作;升版本时在此递增转换,
 *  避免老存档被版本检查直接拒绝(配合 main.ts 的降级兜底,保住自定义地图)。 */
function migrate(data: MapData): MapData {
  return data;
}

/**
 * 把已解析的地图 JSON 校验并构建为运行时对象。
 * 入参用 unknown:JSON import 推断的字面量类型(如 consequence.kind: string)
 * 与判别联合不兼容,内部统一 cast 成 MapData 再校验。
 */
export function loadMap(data: unknown, opts?: { lenient?: boolean }): LoadedMap {
  const d = migrate(data as MapData);
  if (d.version !== SUPPORTED_VERSION) {
    fail(`不支持的地图版本 ${d.version}(当前支持 v${SUPPORTED_VERSION})`);
  }
  if (!Array.isArray(d.tiles) || d.tiles.length === 0) fail("tiles 为空");

  const maxLevel = d.maxLevel ?? 3;
  const resupply = d.resupplyPerLevel ?? 0;

  // tiles + 坐标
  const idToIdx = new Map<string, number>();
  const positions: BoardPos[] = [];
  const tiles: TileDef[] = d.tiles.map((t, i) => {
    if (!t.id) fail(`第 ${i + 1} 格缺少 id`);
    if (idToIdx.has(t.id)) fail(`重复的 tile id:${t.id}`);
    idToIdx.set(t.id, i);
    if (!Array.isArray(t.pos) || t.pos.length !== 2) fail(`第 ${i + 1} 格 pos 格式错误`);
    const pos: BoardPos = { x: t.pos[0], y: t.pos[1] };
    positions.push(pos);
    const type = (t.type ?? "Property") as TileDef["type"];
    // 城池规模(Lv0 价值推断):≥20 大重镇 / ≥10 中 / <10 小;非地产格无 size
    const value = t.valueByLevel;
    const size: TileDef["size"] = type === "Property" && value
      ? value[0] >= 20 ? "large" : value[0] >= 10 ? "medium" : "small"
      : undefined;
    return {
      index: i,
      type,
      name: t.name,
      position: pos,
      propertyId: type === "Property" ? t.id : null,
      isCapitalEligible: type === "Property",
      region: t.region ?? null,
      size,
    };
  });

  // 坐标不重叠:最小间距(含完全重合),防止城池 UI 互相压盖。阈值与编辑器共用 MIN_TILE_DIST。
  // lenient(编辑器实时预览用)跳过此项——拖拽中途允许暂时靠近,由编辑器红圈高亮提示。
  if (!opts?.lenient) {
    const tooClose = findTooClosePairs(positions, MIN_TILE_DIST);
    if (tooClose.length) {
      const [i, j] = tooClose[0];
      fail(`第 ${i + 1} 格与第 ${j + 1} 格距离过近,UI 会重叠(需 ≥ ${MIN_TILE_DIST})`);
    }
  }

  // properties(仅 Property 格进 catalog;Chance/Fate 等跳过)
  const properties: PropertyDef[] = [];
  d.tiles.forEach((t, i) => {
    if ((t.type ?? "Property") !== "Property") return;
    const values = t.valueByLevel;
    if (!Array.isArray(values) || values.length !== maxLevel + 1) {
      fail(`第 ${i + 1} 城 valueByLevel 长度必须等于等级数 ${maxLevel + 1}(Lv0..Lv${maxLevel})`);
    }
    if ((t.price ?? 0) < 0 || (t.buildCost ?? 0) < 0) {
      fail(`第 ${i + 1} 城价格/buildCost 不能为负`);
    }
    properties.push({
      id: t.id,
      group: t.group ?? "z",
      purchasePrice: t.price ?? 0,
      maxLevel,
      valueByLevel: values,
      buildCost: t.buildCost ?? 0,
      resupplyPerLevel: resupply,
      tradeAdd: t.tradeAdd,
      tradeMult: t.tradeMult,
      trade: t.trade,
    });
  });

  // catalog(按 id / 按 group 查询)
  const byId = new Map(properties.map((p) => [p.id, p]));
  const byGroup = properties.reduce<Map<string, string[]>>((m, p) => {
    const arr = m.get(p.group) ?? [];
    arr.push(p.id);
    m.set(p.group, arr);
    return m;
  }, new Map());
  const catalog: MapCatalog = {
    get(id) {
      return id ? byId.get(id) ?? null : null;
    },
    groupMembers(group) {
      return byGroup.get(group) ?? [];
    },
  };

  // 分岔辅路(start/end 为 tile id,解析为 index;cells 坐标由 JSON 手配)
  let branch: BoardBranch | null = null;
  if (d.branch) {
    const b = d.branch;
    const startIdx = idToIdx.get(b.start);
    const endIdx = idToIdx.get(b.end);
    if (startIdx == null) fail(`辅路 start 引用无效:${b.start}`);
    if (endIdx == null) fail(`辅路 end 引用无效:${b.end}`);
    if (startIdx === endIdx) fail("辅路 start 与 end 相同");
    if (!Array.isArray(b.cells) || b.cells.length === 0) fail("辅路 cells 为空");
    const cells: BranchCell[] = b.cells.map((c, i) => {
      if (c.kind !== "treasure" && c.kind !== "event" && c.kind !== "penalty")
        fail(`辅路第 ${i + 1} 格 kind 非法:${String(c.kind)}`);
      if (!Array.isArray(c.pos) || c.pos.length !== 2) fail(`辅路第 ${i + 1} 格 pos 格式错误`);
      return { kind: c.kind, position: { x: c.pos[0], y: c.pos[1] } };
    });
    branch = { id: b.id, startNode: startIdx, endNode: endIdx, cells };
  }

  const board = createBoard(tiles, branch);
  return {
    board,
    properties,
    tiles,
    branch,
    catalog,
    targetNetWorth: d.targetNetWorth,
    startingCash: d.startingCash,
  };
}
