// 地图展示名解析 hook:首页与单机配置页共用同一份「id → name」逻辑,
// 避免两处各自维护兜底规则导致显示口径漂移(清单加载失败时保留 id 兜底显示)。
import { useEffect, useState } from "react";
import type { MapSource } from "@core/map-source";

/** 解析地图展示名;清单未返回/无此 id 时回退为 id 本身(对照旧实现兜底行为)。 */
export function useMapName(mapSource: MapSource, mapId: string): string {
  const [name, setName] = useState(mapId);
  useEffect(() => {
    let alive = true;
    setName(mapId); // 切换期间先兜底显示 id,清单到达后刷新为真实名
    mapSource
      .listMaps()
      .then((entries) => {
        const found = entries.find((e) => e.id === mapId);
        if (alive && found) setName(found.name);
      })
      .catch(() => {
        /* 忽略:清单加载失败时保留 id 兜底显示 */
      });
    return () => {
      alive = false;
    };
  }, [mapSource, mapId]);
  return name;
}
