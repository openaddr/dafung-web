// 地图源实现(render 层):core 定义接口,这里做实际的 fetch / localStorage。
// 内置图 = FetchMapSource(fetch 清单 + JSON);自建图 = LocalStorageMapSource(localStorage 图库)。
// 组合用 CompositeMapSource(按 id 前缀分流)。
import {
  CUSTOM_ID_PREFIX,
  type MapSource,
  type MapEntry,
  type CatalogFileEntry,
  parseCatalog,
  entryFromFile,
  isCustomId,
} from "@core/map-source";
import type { MapData } from "@core/types";

/** 清单 + 内置图 JSON 的根 URL(相对站点根)。 */
const MAPS_BASE = "/maps/";
const CATALOG_URL = `${MAPS_BASE}index.json`;

/** localStorage 图库 key(数组:每条 {id, name, data, createdAt})。 */
const CUSTOM_MAPS_KEY = "dafung-custom-maps";

/** 内置图源:fetch 清单文件 + 按 id 对应 file 名 fetch 地图 JSON。 */
export class FetchMapSource implements MapSource {
  private catalog: CatalogFileEntry[] | null = null;

  /** 懒加载清单(首次调用 fetch,之后缓存)。 */
  private async ensureCatalog(): Promise<CatalogFileEntry[]> {
    if (this.catalog) return this.catalog;
    const res = await fetch(CATALOG_URL);
    if (!res.ok) throw new Error(`加载地图清单失败:HTTP ${res.status}`);
    const data = await res.json();
    this.catalog = parseCatalog(data);
    return this.catalog;
  }

  async listMaps(): Promise<MapEntry[]> {
    const cat = await this.ensureCatalog();
    return cat.map(entryFromFile);
  }

  async loadMapData(id: string): Promise<MapData> {
    const cat = await this.ensureCatalog();
    const entry = cat.find((e) => e.id === id);
    if (!entry) throw new Error(`内置图清单中无此 id:${id}`);
    const res = await fetch(`${MAPS_BASE}${entry.file}`);
    if (!res.ok) throw new Error(`加载内置图 ${id} 失败:HTTP ${res.status}`);
    return (await res.json()) as MapData;
  }
}

/** localStorage 中单条自建图记录。 */
interface CustomMapRecord {
  id: string;
  name: string;
  data: MapData;
  createdAt: number;
}

/** localStorage 存储抽象:用 Storage 类型,便于单测注入 mock。
 *  浏览器环境下即 window.localStorage;node 单测注入内存实现。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 自建图源:localStorage 图库(数组)。id = `custom-` + Date.now()。
 * - listMaps():读图库 → MapEntry[](desc 固定"自建地图",custom=true)
 * - loadMapData(id):按 id 查图库返回 data
 * - saveCustomMap(name, data):生成新 id 写入(name 允许重名)
 * - deleteCustomMap(id):按 id 删除
 *
 * 不做旧 key 迁移(项目无已发布版本,旧的 dafung-custom-map 单图 key 直接无视)。
 * 架构红线:localStorage 是浏览器 API,本类在 render 层(core 零 DOM/浏览器 API)。
 */
export class LocalStorageMapSource implements MapSource {
  private storage: StorageLike;

  constructor(storage: StorageLike = globalThis.localStorage) {
    this.storage = storage;
  }

  /** 读图库原始记录(解析失败/为空 → 空数组)。 */
  private readAll(): CustomMapRecord[] {
    const raw = this.storage.getItem(CUSTOM_MAPS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as CustomMapRecord[]) : [];
    } catch {
      return [];
    }
  }

  /** 写图库(序列化失败/无 storage 时静默忽略)。 */
  private writeAll(records: CustomMapRecord[]): void {
    try {
      this.storage.setItem(CUSTOM_MAPS_KEY, JSON.stringify(records));
    } catch {
      /* localStorage 不可用(隐私模式/超限)时静默忽略 */
    }
  }

  /** 列出自建图记录(原始数据,供 saveDefaultName 推导编号等)。 */
  listCustomMaps(): CustomMapRecord[] {
    return this.readAll();
  }

  async listMaps(): Promise<MapEntry[]> {
    return this.readAll().map((r) => ({
      id: r.id,
      name: r.name,
      desc: "自建地图",
      tileCount: r.data.tiles.length,
      targetNetWorth: r.data.targetNetWorth,
      custom: true,
    }));
  }

  async loadMapData(id: string): Promise<MapData> {
    const rec = this.readAll().find((r) => r.id === id);
    if (!rec) throw new Error(`自建图库中无此 id:${id}`);
    // 返回深拷贝,避免调用方改动污染图库(JSON 解析即天然深拷贝)
    return JSON.parse(JSON.stringify(rec.data)) as MapData;
  }

  /** 保存自建图:生成新 id 写入图库。返回新 id。
   *  id = `custom-` + 时间戳 + 随机后缀(防同毫秒并存导致 id 撞车)。name 允许重名。 */
  saveCustomMap(name: string, data: MapData): string {
    // 时间戳 + 随机后缀:保证同毫秒多次保存也能生成不同 id(快速连点「保存」场景)
    let id = CUSTOM_ID_PREFIX + Date.now() + "-" + Math.floor(Math.random() * 1e6).toString(36);
    const records = this.readAll();
    // 极小概率仍撞(同毫秒同随机)则再加随机,直至唯一
    while (records.some((r) => r.id === id)) {
      id = CUSTOM_ID_PREFIX + Date.now() + "-" + Math.floor(Math.random() * 1e6).toString(36);
    }
    records.push({ id, name, data: JSON.parse(JSON.stringify(data)) as MapData, createdAt: Date.now() });
    this.writeAll(records);
    return id;
  }

  /** 删除自建图(按 id)。不存在则无操作。 */
  deleteCustomMap(id: string): void {
    const records = this.readAll().filter((r) => r.id !== id);
    this.writeAll(records);
  }
}

/** 默认内置图 id(无历史选择时的回退)。 */
export const DEFAULT_MAP_ID = "sanguo";

/**
 * 组合源:内置 + 自建。listMaps 合并两个源的条目;
 * loadMapData 按 id 前缀分流(custom- → 自建,其余 → 内置)。
 */
export class CompositeMapSource implements MapSource {
  private builtin: FetchMapSource;
  private custom: MapSource | null = null;

  constructor(builtin?: FetchMapSource, custom?: MapSource) {
    this.builtin = builtin ?? new FetchMapSource();
    if (custom) this.custom = custom;
  }

  /** 注入自建源(ticket 03 用)。 */
  setCustomSource(src: MapSource | null): void {
    this.custom = src;
  }

  /** 合并内置 + 自建条目(内置在前)。 */
  async listMaps(): Promise<MapEntry[]> {
    const builtin = await this.builtin.listMaps();
    const custom = this.custom ? await this.custom.listMaps() : [];
    return [...builtin, ...custom];
  }

  async loadMapData(id: string): Promise<MapData> {
    if (isCustomId(id) && this.custom) return this.custom.loadMapData(id);
    return this.builtin.loadMapData(id);
  }
}

/** 进程级单例(整个 app 共用一个复合源)。自建源默认注入 LocalStorageMapSource。 */
let _composite: CompositeMapSource | null = null;

export function getMapSource(): CompositeMapSource {
  if (!_composite) _composite = new CompositeMapSource(new FetchMapSource(), new LocalStorageMapSource());
  return _composite;
}
