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
import "./home.css";

export interface HomeScreenProps {
  /** 「单机模式」→ 次级配置页。 */
  onSolo: () => void;
  /** 「联机模式」→ 大厅(现有 handleOnline,流程零变化)。 */
  onOnline: () => void;
  /** 「编辑地图」入口;从当前选中图起编(undefined = 默认内置图)。 */
  onEdit: (mapId: string) => void;
  /** 初始选中的地图 id(localStorage 记忆,或 App 解析的清单首项;必传,无兜底)。 */
  initialMapId: string;
  /** 选中地图变更回调(接线方持久化到 localStorage;对照旧 onMapChange)。 */
  onMapChange?: (mapId: string) => void;
  /** 地图源(默认进程级复合源;测试可注入内存实现)。 */
  mapSource?: MapSource;
}

export function HomeScreen({
  onSolo,
  onOnline,
  onEdit,
  initialMapId,
  onMapChange,
  mapSource = getMapSource(),
}: HomeScreenProps) {
  const [selectedMapId, setSelectedMapId] = useState(initialMapId);
  const [showMapSelect, setShowMapSelect] = useState(false);
  // 与单机配置页共用同一份地图名解析逻辑(清单失败回退 id 显示)
  const mapName = useMapName(mapSource, selectedMapId);

  // S1 仪式感三件套:入场 stagger(80ms/个,包裹层播动画)/ 笔触下划线 hover /
  // 按压 scale .97,均在 home.css;testid 与布局(grid 结构)不变。
  const btnBase =
    "home-btn-brush rounded-lg border px-8 py-5 font-brush text-2xl tracking-[0.3em] cursor-pointer transition-colors";
  const entries: Array<{
    tid: string;
    label: string;
    onClick: () => void;
    extra: string;
  }> = [
    { tid: HOME_TID.solo, label: "单机模式", onClick: onSolo, extra: " border-gold bg-gold/80 hover:bg-gold text-ink font-bold" },
    { tid: HOME_TID.online, label: "联机模式", onClick: onOnline, extra: " border-ink/40 bg-panel hover:bg-panel-hi text-ink" },
    { tid: HOME_TID.selectMap, label: "选择地图", onClick: () => setShowMapSelect(true), extra: " border-ink/40 bg-panel hover:bg-panel-hi text-ink" },
    {
      tid: HOME_TID.editMap,
      label: "编辑地图",
      onClick: () => onEdit(selectedMapId),
      extra: " border-ink/40 bg-panel hover:bg-panel-hi text-ink",
    },
  ];

  return (
    <div
      data-testid={HOME_TID.screen}
      className="min-h-full flex flex-col items-center justify-center bg-bg p-6"
    >
      <h1 className="font-brush text-6xl text-ink tracking-widest">群雄逐鹿</h1>
      <div className="font-deco text-ink-dim mt-2 mb-10 tracking-[0.5em]">— 三国大富翁 —</div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-[min(560px,92vw)]">
        {entries.map((e, i) => (
          // 包裹层承载入场动画(见 home.css 注释:动画 fill 锁 transform,与按压态分层)
          <div key={e.tid} className="home-btn-in" style={{ animationDelay: `${i * 80}ms` }}>
            <button
              data-testid={e.tid}
              onClick={e.onClick}
              className={btnBase + e.extra}
            >
              {e.label}
            </button>
          </div>
        ))}
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
