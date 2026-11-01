// 地图源:统一加载入口。core 层只定义接口与编排(loadMapById),
// 实际 fetch 实现在 core 之外(架构红线 1:core 零 DOM/浏览器 API)。
import { loadMap, type LoadedMap, type MapData } from "./board-loader";

/** 清单条目:描述一张可选地图的展示信息。 */
export interface MapEntry {
  id: string;
  name: string;
  desc: string;
  tileCount: number;
  targetNetWorth: number;
}

/** 地图源:抽象"从哪里拿地图数据"。可注入,单测用内存实现;
 *  生产实现唯一:FetchMapSource(render 层,fetch 清单 + JSON)。
 *  地图扩展通路 = 内置图 PR 一个 JSON + index.json 清单登记。 */
export interface MapSource {
  /** 列出所有可选地图。需 async fetch 清单。 */
  listMaps(): Promise<MapEntry[]>;
  /** 按 id 加载地图原始数据。找不到抛错。 */
  loadMapData(id: string): Promise<MapData>;
}

/** 按 id 从源加载并校验构建为 LoadedMap。统一入口,取代各处硬编码 fetch 内置地图 JSON。 */
export async function loadMapById(mapSource: MapSource, id: string): Promise<LoadedMap> {
  const data = await mapSource.loadMapData(id);
  return loadMap(data);
}

/** 清单文件(JSON 数组)的条目 schema,供 FetchMapSource 解析用。 */
export interface CatalogFileEntry {
  id: string;
  name: string;
  file: string;
  desc: string;
  tileCount: number;
  targetNetWorth: number;
}

/** 解析清单文件(unknown → CatalogFileEntry[]),校验格式。格式错抛可读错误。 */
export function parseCatalog(data: unknown): CatalogFileEntry[] {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("地图清单为空或非数组");
  }
  return data.map((e, i) => {
    if (!e || typeof e !== "object") throw new Error(`清单第 ${i + 1} 项非对象`);
    const { id, name, file, desc, tileCount, targetNetWorth } = e as Record<string, unknown>;
    if (typeof id !== "string" || !id) throw new Error(`清单第 ${i + 1} 项缺 id`);
    if (typeof name !== "string" || !name) throw new Error(`清单第 ${i + 1} 项缺 name`);
    if (typeof file !== "string" || !file) throw new Error(`清单第 ${i + 1} 项缺 file`);
    if (typeof desc !== "string") throw new Error(`清单第 ${i + 1} 项 desc 非字符串`);
    if (typeof tileCount !== "number" || tileCount <= 0)
      throw new Error(`清单第 ${i + 1} 项 tileCount 非法`);
    if (typeof targetNetWorth !== "number" || targetNetWorth <= 0)
      throw new Error(`清单第 ${i + 1} 项 targetNetWorth 非法`);
    return { id, name, file, desc, tileCount, targetNetWorth };
  });
}

/** CatalogFileEntry → MapEntry(去 file 字段)。 */
export function entryFromFile(e: CatalogFileEntry): MapEntry {
  return {
    id: e.id,
    name: e.name,
    desc: e.desc,
    tileCount: e.tileCount,
    targetNetWorth: e.targetNetWorth,
  };
}
