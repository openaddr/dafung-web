// 地图加载器:把 MapData(JSON)校验并构建为运行时对象(Board + catalog + 属性)。
// 主路 = tiles 数组顺序闭合环;捷径 from/to 用 tile id 引用,sideWaypoints 默认用避城算法,
// 若 JSON 提供 waypoints 则手配覆盖。校验失败抛可读错误。
import { createBoard, sideArc } from "./board";
import type { Board } from "./board";
import type {
  BoardPos,
  MapData,
  PropertyDef,
  ShortcutDef,
  TileDef,
} from "./types";

const SUPPORTED_VERSION = 1;

export interface MapCatalog {
  get(id: string | null): PropertyDef | null;
  groupMembers(group: string): string[];
}

export interface LoadedMap {
  board: Board;
  properties: PropertyDef[];
  tiles: TileDef[];
  shortcuts: ShortcutDef[];
  catalog: MapCatalog;
  targetNetWorth: number;
  startingCash: number;
}

function fail(msg: string): never {
  throw new Error(`地图校验失败:${msg}`);
}

/**
 * 把已解析的地图 JSON 校验并构建为运行时对象。
 * 入参用 unknown:JSON import 推断的字面量类型(如 consequence.kind: string)
 * 与判别联合不兼容,内部统一 cast 成 MapData 再校验。
 */
export function loadMap(data: unknown): LoadedMap {
  const d = data as MapData;
  if (d.version !== SUPPORTED_VERSION) {
    fail(`不支持的地图版本 ${d.version}(当前支持 v${SUPPORTED_VERSION})`);
  }
  if (!Array.isArray(d.tiles) || d.tiles.length === 0) fail("tiles 为空");

  const maxLevel = d.maxLevel ?? 5;
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
    // 城池规模(Lv0 租金推断):≥20 大重镇 / ≥10 中 / <10 小;非地产格无 size
    const rent = t.rentByLevel;
    const size: TileDef["size"] = type === "Property" && rent
      ? rent[0] >= 20 ? "large" : rent[0] >= 10 ? "medium" : "small"
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

  // 坐标不重叠:最小间距 MIN_DIST(含完全重合),防止城池 UI 互相压盖
  const MIN_DIST = 80;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = positions[i].x - positions[j].x;
      const dy = positions[i].y - positions[j].y;
      if (dx * dx + dy * dy < MIN_DIST * MIN_DIST) {
        fail(`第 ${i + 1} 格与第 ${j + 1} 格距离过近,UI 会重叠(需 ≥ ${MIN_DIST})`);
      }
    }
  }

  // properties(仅 Property 格进 catalog;Chance/Fate 等跳过)
  const properties: PropertyDef[] = [];
  d.tiles.forEach((t, i) => {
    if ((t.type ?? "Property") !== "Property") return;
    const rent = t.rentByLevel;
    if (!Array.isArray(rent) || rent.length < maxLevel + 1) {
      fail(`第 ${i + 1} 城 rentByLevel 长度不足(需 ≥ ${maxLevel + 1})`);
    }
    if ((t.price ?? 0) < 0 || (t.upgrade ?? 0) < 0 || (t.buildCost ?? 0) < 0) {
      fail(`第 ${i + 1} 城价格/升级/buildCost 不能为负`);
    }
    properties.push({
      id: t.id,
      group: t.group ?? "z",
      purchasePrice: t.price ?? 0,
      upgradeCost: t.upgrade ?? 0,
      maxLevel,
      rentByLevel: rent,
      buildCost: t.buildCost ?? 0,
      resupplyPerLevel: resupply,
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

  // shortcuts(from/to 为 tile id,解析为 index;sideWaypoints 默认避城,可手配覆盖)
  const shortcuts: ShortcutDef[] = (d.shortcuts ?? []).map((s, i) => {
    const fromIdx = idToIdx.get(s.from);
    const toIdx = idToIdx.get(s.to);
    if (fromIdx == null) fail(`第 ${i + 1} 条捷径 from 引用无效:${s.from}`);
    if (toIdx == null) fail(`第 ${i + 1} 条捷径 to 引用无效:${s.to}`);
    if (fromIdx === toIdx) fail(`第 ${i + 1} 条捷径 from 与 to 相同`);
    const sideWaypoints = Array.isArray(s.waypoints) && s.waypoints.length
      ? s.waypoints.map((wp) => ({ x: wp[0], y: wp[1] }))
      : sideArc(positions[fromIdx], positions[toIdx], positions);
    return {
      id: s.id,
      branchNode: fromIdx,
      rejoinNode: toIdx,
      sideWaypoints,
      consequence: s.consequence,
    };
  });

  const board = createBoard(tiles, shortcuts);
  return {
    board,
    properties,
    tiles,
    shortcuts,
    catalog,
    targetNetWorth: d.targetNetWorth,
    startingCash: d.startingCash,
  };
}
