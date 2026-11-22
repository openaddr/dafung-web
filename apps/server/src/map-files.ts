import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadMap, type LoadedMap } from "@dafung/core/engine/board-loader";
import { parseCatalog, type CatalogFileEntry } from "@dafung/core/engine/map-source";

/** 以磁盘上的地图清单为准，缺失或损坏直接报错。 */
export function readMapCatalog(mapsDir: string): CatalogFileEntry[] {
  const catalogPath = join(mapsDir, "index.json");
  if (!existsSync(catalogPath)) throw new Error(`地图清单不存在:${catalogPath}`);
  return parseCatalog(JSON.parse(readFileSync(catalogPath, "utf8")));
}

/** 同一地图目录的只读 LoadedMap 可跨房间复用。 */
export function createBuiltinMapLoader(mapsDir: string): (mapId: string) => LoadedMap {
  const cache = new Map<string, LoadedMap>();
  return (mapId) => {
    const cached = cache.get(mapId);
    if (cached) return cached;
    const entry = readMapCatalog(mapsDir).find((map) => map.id === mapId);
    if (!entry) throw new Error(`未知地图 id:${mapId}`);
    const data = JSON.parse(readFileSync(join(mapsDir, entry.file), "utf8"));
    const map = loadMap(data);
    cache.set(mapId, map);
    return map;
  };
}
