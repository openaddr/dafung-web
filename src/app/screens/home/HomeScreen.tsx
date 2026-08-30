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

  // S1 仪式感三件套:入场 stagger(标题 0.3s 先行,按钮 300ms 起 80ms/个,包裹层播动画)/
  // 笔触下划线 hover / 按压 scale .97,均在 home.css;testid 与布局(grid 结构)不变。
  // H-3 tracking 尾部溢出:大字距末字后拖 0.3em 空白致文本视觉偏左,
  // 左内边距补偿同量(pl 用唯一 utility,避免与 px 的 padding-left 冲突)。
  const btnBase =
    "home-btn-brush rounded-lg border pr-8 pl-[calc(2rem+0.3em)] font-brush tracking-[0.3em] cursor-pointer transition-colors";
  const entries: Array<{
    tid: string;
    label: string;
    onClick: () => void;
    // R3-B14 尺寸档:玩法入口(单机/联机)大档 py-5 text-2xl≈72px,工具入口(选图/编辑)
    // 小档 py-4 text-xl≈64px,8px 高差+两排 20px 行距形成「玩法在上、工具在下」的层级;
    // 尺寸类只出现在这一档字段里,与 btnBase 无同属性冲突。
    size: string;
    extra: string;
  }> = [
    // H-1:金底变体额外挂 home-btn-gold,笔触下划线取反为墨线(见 home.css)
    { tid: HOME_TID.solo, label: "单机模式", onClick: onSolo, size: " py-5 text-2xl", extra: " home-btn-gold border-gold bg-gold/80 hover:bg-gold text-ink font-bold" },
    { tid: HOME_TID.online, label: "联机模式", onClick: onOnline, size: " py-5 text-2xl", extra: " border-ink/40 bg-panel hover:bg-panel-hi text-ink" },
    { tid: HOME_TID.selectMap, label: "选择地图", onClick: () => setShowMapSelect(true), size: " py-4 text-xl", extra: " border-ink/40 bg-panel hover:bg-panel-hi text-ink" },
    {
      tid: HOME_TID.editMap,
      label: "编辑地图",
      onClick: () => onEdit(selectedMapId),
      size: " py-4 text-xl",
      extra: " border-ink/40 bg-panel hover:bg-panel-hi text-ink",
    },
  ];

  return (
    // E1(#13):根节点只做滚动容器(flex-col overflow-y-auto),内层 m-auto 居中——
    // flexbox「居中+可滚」标准解:内容不溢出时视觉与 justify-center 一致,
    // 666×360 横屏等小视口下四入口+地图行全量可滚达,不再被 #app overflow:hidden 截断。
    <div data-testid={HOME_TID.screen} className="flex h-full flex-col overflow-y-auto bg-bg p-6">
      <div className="m-auto flex w-full flex-col items-center">
      {/* H-2 标题/副标题先行淡入(home.css 0.3s),按钮 stagger 从 300ms 起跟进 */}
      <h1 className="home-title-in font-brush text-6xl text-ink tracking-widest">群雄逐鹿</h1>
      {/* H-3 副标题 0.5em 字距,pl 同量补偿尾部空白使视觉居中 */}
      <div className="home-title-in-sub font-deco text-ink-dim mt-2 mb-10 tracking-[0.5em] pl-[0.5em]">— 三国大富翁 —</div>

      {/* R3-B14:gap-y-5 拉开两排 20px,配合尺寸档形成上下分组;横向 560px 栅格与 gap-x-4 不变 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5 w-[min(560px,92vw)]">
        {entries.map((e, i) => (
          // 包裹层承载入场动画(见 home.css 注释:动画 fill 锁 transform,与按压态分层)
          <div key={e.tid} className="home-btn-in" style={{ animationDelay: `${300 + i * 80}ms` }}>
            <button
              data-testid={e.tid}
              onClick={e.onClick}
              className={btnBase + e.size + e.extra}
            >
              {e.label}
            </button>
          </div>
        ))}
      </div>

      {/* 当前选中地图回显;H-5:整行可点唤起选图二级屏,提对比(text-ink) */}
      <button
        type="button"
        onClick={() => setShowMapSelect(true)}
        className="font-deco text-[13px] text-ink mt-6 flex items-center gap-2 cursor-pointer rounded px-2 py-1 hover:bg-panel-hi transition-colors"
      >
        <span className="text-ink-dim">当前地图:</span>
        <span data-testid={TID.currentMapName} className="text-ink">{mapName}</span>
        <span className="text-ink-dim text-xs">▾</span>
      </button>

      {/* 地图选择二级屏:复用原面板,确认后回写选中 id(取消保留原选择;fixed 弹层,滚动容器内无关) */}
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
    </div>
  );
}
