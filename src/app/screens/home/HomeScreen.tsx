// 首屏(信息架构重构):只放四个模式入口——单机 / 联机 / 选图 / 编辑。
// 国号、诸侯数等对局配置移到「单机模式」次级页(SoloSetupScreen),让首页回归
// 纯导航(用户要求:菜单只显示四个按钮入口)。选图仍是二级面板(MapSelectPanel
// 复用不重写),确认后回显当前地图名并照旧记忆到 localStorage。
import { useState } from "react";
import type { MapSource } from "@core/map-source";
import { getMapSource } from "@app/map-sources";
import { MapSelectPanel } from "@app/screens/setup/MapSelectPanel";
import { TID } from "@app/screens/setup/testids";
import { useMapName } from "@app/screens/setup/useMapName";
import { HOME_TID } from "./testids";

export interface HomeScreenProps {
  /** 「单机模式」→ 次级配置页。 */
  onSolo: () => void;
  /** 「联机模式」→ 大厅(现有 handleOnline,流程零变化)。 */
  onOnline: () => void;
  /** 「编辑地图」入口;从当前选中图起编(undefined = 默认内置图)。 */
  onEdit: (mapId?: string) => void;
  /** 初始选中的地图 id(来自 localStorage 记忆,旧默认 sanguo)。 */
  initialMapId?: string;
  /** 选中地图变更回调(接线方持久化到 localStorage;对照旧 onMapChange)。 */
  onMapChange?: (mapId: string) => void;
  /** 地图源(默认进程级复合源;测试可注入内存实现)。 */
  mapSource?: MapSource;
}

export function HomeScreen({
  onSolo,
  onOnline,
  onEdit,
  initialMapId = "sanguo",
  onMapChange,
  mapSource = getMapSource(),
}: HomeScreenProps) {
  const [selectedMapId, setSelectedMapId] = useState(initialMapId);
  const [showMapSelect, setShowMapSelect] = useState(false);
  // 与单机配置页共用同一份地图名解析逻辑(清单失败回退 id 显示)
  const mapName = useMapName(mapSource, selectedMapId);

  const btnBase =
    "rounded-lg border px-8 py-5 font-brush text-2xl tracking-[0.3em] cursor-pointer transition-colors";

  return (
    <div
      data-testid={HOME_TID.screen}
      className="min-h-full flex flex-col items-center justify-center bg-bg p-6"
    >
      <h1 className="font-brush text-6xl text-ink tracking-widest">群雄逐鹿</h1>
      <div className="font-deco text-ink-dim mt-2 mb-10 tracking-[0.5em]">— 三国大富翁 —</div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-[min(560px,92vw)]">
        <button
          data-testid={HOME_TID.solo}
          onClick={onSolo}
          className={btnBase + " border-gold bg-gold/80 hover:bg-gold text-ink font-bold"}
        >
          单机模式
        </button>
        <button
          data-testid={HOME_TID.online}
          onClick={onOnline}
          className={btnBase + " border-ink/40 bg-panel hover:bg-panel-hi text-ink"}
        >
          联机模式
        </button>
        <button
          data-testid={HOME_TID.selectMap}
          onClick={() => setShowMapSelect(true)}
          className={btnBase + " border-ink/40 bg-panel hover:bg-panel-hi text-ink"}
        >
          选择地图
        </button>
        <button
          data-testid={HOME_TID.editMap}
          onClick={() => onEdit(selectedMapId !== "sanguo" ? selectedMapId : undefined)}
          className={btnBase + " border-ink/40 bg-panel hover:bg-panel-hi text-ink"}
        >
          编辑地图
        </button>
      </div>

      {/* 当前选中地图回显(选择在二级面板完成后刷新;localStorage 记忆不变) */}
      <div className="font-deco text-[13px] text-ink-dim mt-6 flex items-center gap-2">
        <span>当前地图:</span>
        <span data-testid={TID.currentMapName} className="text-ink">{mapName}</span>
      </div>

      {/* 地图选择二级屏:复用原面板,确认后回写选中 id(取消保留原选择) */}
      {showMapSelect && (
        <MapSelectPanel
          mapSource={mapSource}
          currentMapId={selectedMapId}
          onConfirm={(mapId) => {
            setSelectedMapId(mapId);
            setShowMapSelect(false);
            onMapChange?.(mapId);
          }}
          onCancel={() => setShowMapSelect(false)}
        />
      )}
    </div>
  );
}
