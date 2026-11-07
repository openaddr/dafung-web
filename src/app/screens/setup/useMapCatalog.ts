// 地图清单拉取单源 hook(C6 样板收口):entries/error/reload 三件套——
// MapStrip(首页条带)与 MapSelectPanel(选图弹层)的拉取样板曾逐字双抄
// (alive 守卫+失败态+重试钮都成对),收口于此。失败态由消费面显式呈现
// (「加载失败+重试」,零静默兜底)。
import { useEffect, useState } from "react";
import type { MapEntry, MapSource } from "@core/map-source";

export interface MapCatalog {
  /** 清单(null=加载中);空数组是正常业务态(空清单直陈)。 */
  entries: MapEntry[] | null;
  /** 拉取失败消息(消费面显式呈现,配 reload 重试)。 */
  error: string | null;
  /** 重新拉取。 */
  reload: () => void;
}

export function useMapCatalog(mapSource: MapSource): MapCatalog {
  const [entries, setEntries] = useState<MapEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);
    mapSource.listMaps().then(
      (list) => alive && setEntries(list),
      (err: Error) => alive && setError(err.message),
    );
    return () => {
      alive = false;
    };
  }, [mapSource, reloadKey]);
  return { entries, error, reload: () => setReloadKey((k) => k + 1) };
}
