// 地图源实现(render 层):core 定义接口,这里做实际的 fetch / localStorage。
// 内置图 = FetchMapSource(fetch 清单 + JSON);自建图 = LocalStorageMapSource(localStorage 图库)。
// 组合用 CompositeMapSource(按 id 前缀分流)。本文件是 01 的内置图部分,自建图在 ticket 03 补。
import {
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

/** 默认内置图 id(无历史选择时的回退)。 */
export const DEFAULT_MAP_ID = "sanguo";

/**
 * 组合源:内置 + 自建(自建在 ticket 03 加入)。当前仅代理内置源。
 * listMaps 合并两个源的条目;loadMapData 按 id 前缀分流(custom- → 自建,其余 → 内置)。
 */
export class CompositeMapSource implements MapSource {
  private builtin: FetchMapSource;
  private custom: MapSource | null = null; // ticket 03 注入 LocalStorageMapSource

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

/** 进程级单例(整个 app 共用一个复合源)。 */
let _composite: CompositeMapSource | null = null;

export function getMapSource(): CompositeMapSource {
  if (!_composite) _composite = new CompositeMapSource();
  return _composite;
}
