// 地图展示名解析 hook:首页与单机配置页共用同一份「id → name」逻辑。
// 清单到达前显示 id(待数据,非兜底);清单加载失败不吞错,让异常直接上抛暴露问题。
import { useEffect, useState } from "react";
import type { MapSource } from "@core/map-source";

/** 解析地图展示名;清单到达前显示 id,到达后刷新为真实名(清单加载失败不吞错)。 */
export function useMapName(mapSource: MapSource, mapId: string): string {
  const [name, setName] = useState(mapId);
  useEffect(() => {
    let alive = true;
    setName(mapId); // 切换期间先显示 id(待数据),清单到达后刷新为真实名
    mapSource
      .listMaps()
      .then((entries) => {
        const found = entries.find((e) => e.id === mapId);
        if (alive && found) setName(found.name);
      });
    return () => {
      alive = false;
    };
  }, [mapSource, mapId]);
  return name;
}
