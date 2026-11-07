// 地图展示名解析 hook(C6 收口):首页与单机配置页共用同一份「id → name」逻辑。
// 清单经 useMapCatalog 单源拉取;名字未解析前显示 id——待数据语义,非兜底。
// 拉取失败不在此处吞:同屏清单消费面(MapStrip/MapSelectPanel)的「加载失败+重试」
// 显式呈现,本钩子保持纯解析。
import type { MapSource } from "@core/map-source";
import { useMapCatalog } from "./useMapCatalog";

/** 解析地图展示名;清单到达前显示 id,到达后为真实名。 */
export function useMapName(mapSource: MapSource, mapId: string): string {
  const { entries } = useMapCatalog(mapSource);
  const found = entries?.find((e) => e.id === mapId);
  return found ? found.name : mapId;
}
