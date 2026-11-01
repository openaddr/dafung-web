// 地图源实现(render 层):core 定义接口,这里做实际的 fetch。
// 生产实现唯一 = FetchMapSource(内置图,fetch 清单 + JSON);地图扩展走 PR+JSON
// (public/maps/*.json + index.json 清单登记,#947 自建图库通路随编辑器一并退役)。
import {
  type MapSource,
  type MapEntry,
  type CatalogFileEntry,
  parseCatalog,
  entryFromFile,
} from "@core/map-source";
import type { MapData } from "@core/board-loader";

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

/** 默认地图 id:清单第一项(与服务器侧一致;无历史选择时的回退)。
 *  async 因清单需 fetch。 */
export async function getDefaultMapId(): Promise<string> {
  const maps = await getMapSource().listMaps();
  // 零兜底原则:清单为空 = maps/index.json 加载失败/损坏,直接抛错暴露问题,
  // 不退回任何硬编码 id(默认地图的唯一事实源 = 清单首项)。
  if (maps.length === 0) throw new Error("地图清单为空:内置地图加载失败(index.json 缺失或损坏)");
  return maps[0].id;
}

/** 进程级单例(整个 app 共用一个图源)。 */
let _source: FetchMapSource | null = null;

export function getMapSource(): FetchMapSource {
  if (!_source) _source = new FetchMapSource();
  return _source;
}
