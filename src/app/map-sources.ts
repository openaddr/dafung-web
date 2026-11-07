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

/** 内置图源:fetch 清单文件 + 按 id 对应 file 名 fetch 地图 JSON。
 *  #1273 单源缓存:清单与地图数据都按「在途/已就绪 Promise」memo——同图在一次
 *  进程内只 fetch+parse 一次(App.handleStart/seedSolo/handleOnline 三处原「同图
 *  双取双析」全走这里收敛);启动竞态也一并消除(桥先于 React 挂载可用,seedSolo
 *  与 MapStrip 的清单拉取曾并发双飞)。失败不缓存:reject 即逐出,重试照常重拉,
 *  错误照常响亮抛出(零兜底:缓存只记成功,不吞错)。 */
export class FetchMapSource implements MapSource {
  /** 在途/已就绪的清单 Promise(null=尚未拉取)。 */
  private catalogPromise: Promise<CatalogFileEntry[]> | null = null;
  /** 按 id 的在途/已就绪地图数据 Promise。 */
  private readonly dataPromises = new Map<string, Promise<MapData>>();

  /** 懒加载清单(首次调用 fetch,之后并发安全复用同一 Promise)。 */
  private ensureCatalog(): Promise<CatalogFileEntry[]> {
    if (this.catalogPromise) return this.catalogPromise;
    const t0 = performance.now();
    const p = (async () => {
      const res = await fetch(CATALOG_URL);
      if (!res.ok) throw new Error(`加载地图清单失败:HTTP ${res.status}`);
      const cat = parseCatalog(await res.json());
      performance.measure("df.map.catalog", { start: t0, end: performance.now() });
      return cat;
    })();
    this.catalogPromise = p;
    p.catch(() => {
      this.catalogPromise = null;
    });
    return p;
  }

  listMaps(): Promise<MapEntry[]> {
    return this.ensureCatalog().then((cat) => cat.map(entryFromFile));
  }

  loadMapData(id: string): Promise<MapData> {
    const inflight = this.dataPromises.get(id);
    if (inflight) return inflight;
    const t0 = performance.now();
    const p = (async () => {
      const cat = await this.ensureCatalog();
      const entry = cat.find((e) => e.id === id);
      if (!entry) throw new Error(`内置图清单中无此 id:${id}`);
      const res = await fetch(`${MAPS_BASE}${entry.file}`);
      if (!res.ok) throw new Error(`加载内置图 ${id} 失败:HTTP ${res.status}`);
      const data = (await res.json()) as MapData;
      // 亚段打点(#1273):只记真实 fetch+parse;memo 命中≈0 不打(资源表 count 已示双取与否)
      performance.measure("df.map.loadMapData", { start: t0, end: performance.now() });
      return data;
    })();
    this.dataPromises.set(id, p);
    // 失败不缓存:reject 即逐出,下一次调用如实重拉(错误本身照常抛给调用方)
    p.catch(() => {
      this.dataPromises.delete(id);
    });
    return p;
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
