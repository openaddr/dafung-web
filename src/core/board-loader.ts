// 地图加载器:把 MapData(JSON)校验并构建为运行时对象(Board + catalog + 属性)。
// 主路 = tiles 数组顺序闭合环。校验失败抛可读错误。
// 地图 schema 类型随域走(#326 types.ts 解散,ADR-0019):地图 JSON 契约由本文件拥有
// (loadMap 是它唯一的解释者,编辑器/导入导出消费同一形状)。
import { createBoard, isCityType } from "./board";
import type { Board, BoardPos, TileDef, TileType } from "./board";
import type { PropertyDef } from "./economy";
import { MIN_TILE_DIST } from "./constants";
import { findTooClosePairs } from "./geometry";

// ── 地图 JSON schema(自定义地图 / 编辑器 / 导入导出)──
export interface MapData {
  version: number;
  targetNetWorth: number;
  startingCash: number;
  /** 等级上限(逐图必配,loadMap 校验 ≥1 整数;城池持有等级 0..maxLevel)。 */
  maxLevel: number;
  /** 都城补给(两/次)的地图级固定值(必配,loadMap 校验);不随城池等级变化。 */
  resupply: number;
  tiles: MapTile[];
}

export interface MapTile {
  id: string;
  name: string;
  pos: number[]; // [x, y]
  type?: TileType; // 默认 Property;Chance/Fate 等非地产格用
  group?: string; // 区域分组字母(Theme.groupNames a–h):城池格必配,loadMap 校验
  region?: string;
  price?: number; // 购价(两):城池格必配,免费城显式写 0
  buildCost?: number; // 建城费(两):城池格必配
  /** 各等级变卖价(#671 正名,旧称「城池价值」),长度 = maxLevel+1,下标 = 等级。 */
  valueByLevel?: number[];
  /** 坐地起价加价值(per-level,两):与 PropertyDef 同义。城池格必配,长度 = maxLevel+1。 */
  tradeAdd: number[];
  /** 坐地起价乘数(per-level):与 PropertyDef 同义。城池格必配,长度 = maxLevel+1。 */
  tradeMult: number[];
}

const SUPPORTED_VERSION = 1;

export interface MapCatalog {
  get(id: string | null): PropertyDef | null;
  groupMembers(group: string): string[];
}

export interface LoadedMap {
  board: Board;
  properties: PropertyDef[];
  tiles: TileDef[];
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

  if (!Number.isInteger(d.maxLevel) || d.maxLevel < 1) {
    fail(`maxLevel 必配且须为 ≥1 的整数(当前:${String(d.maxLevel)})`);
  }
  const maxLevel = d.maxLevel;
  if (typeof d.resupply !== "number") {
    fail("缺顶层 resupply(都城补给,两/次,固定值)");
  }
  const resupply = d.resupply;

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
    // 宝物城与普通城池同权(ADR-0024):propertyId / 都城候选同口径,
    // catalog 入册与校验同一路径(见下方 properties 段)。
    const isCity = isCityType(type);
    return {
      index: i,
      type,
      name: t.name,
      position: pos,
      propertyId: isCity ? t.id : null,
      isCapitalEligible: isCity,
      region: t.region ?? null,
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

  // properties(城池格进 catalog:Property 与 TreasureCity 同口径,ADR-0024;特殊格跳过)
  const properties: PropertyDef[] = [];
  d.tiles.forEach((t, i) => {
    const type = t.type ?? "Property";
    if (!isCityType(type)) return;
    const values = t.valueByLevel;
    if (!Array.isArray(values) || values.length !== maxLevel + 1) {
      fail(`第 ${i + 1} 城 valueByLevel 长度必须等于等级数 ${maxLevel + 1}(Lv0..Lv${maxLevel})`);
    }
    if (!Array.isArray(t.tradeAdd) || t.tradeAdd.length !== maxLevel + 1) {
      fail(`第 ${i + 1} 城 tradeAdd 必配且长度必须等于等级数 ${maxLevel + 1}(Lv0..Lv${maxLevel})`);
    }
    if (!Array.isArray(t.tradeMult) || t.tradeMult.length !== maxLevel + 1) {
      fail(`第 ${i + 1} 城 tradeMult 必配且长度必须等于等级数 ${maxLevel + 1}(Lv0..Lv${maxLevel})`);
    }
    if (t.price == null || t.buildCost == null) {
      fail(`第 ${i + 1} 城 price/buildCost 必配(免费城显式写 0)`);
    }
    if (t.price < 0 || t.buildCost < 0) {
      fail(`第 ${i + 1} 城价格/buildCost 不能为负`);
    }
    if (!t.group) {
      fail(`第 ${i + 1} 城 group 必配(区域分组字母,Theme.groupNames a–h)`);
    }
    properties.push({
      id: t.id,
      group: t.group,
      purchasePrice: t.price,
      maxLevel,
      valueByLevel: values,
      buildCost: t.buildCost,
      resupply, // 地图顶层固定值注入,城侧不逐城配置
      tradeAdd: t.tradeAdd,
      tradeMult: t.tradeMult,
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
      return id ? (byId.get(id) ?? null) : null;
    },
    groupMembers(group) {
      return byGroup.get(group) ?? [];
    },
  };

  const board = createBoard(tiles);
  return {
    board,
    properties,
    tiles,
    catalog,
    targetNetWorth: d.targetNetWorth,
    startingCash: d.startingCash,
  };
}
