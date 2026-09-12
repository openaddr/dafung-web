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
import { Sym } from "@app/screens/shared/Sym";
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
  // 笔触下划线 hover / 按压 scale .97,均在 home.css;testid 不变。
  // H-3 tracking 尾部溢出:大字距末字后拖 0.3em 空白致文本视觉偏左,
  // 左内边距补偿同量(pl 用唯一 utility,避免与 px 的 padding-left 冲突)。
  // 视觉重做 v2:主入口(单机)走墨钮 ink-btn 种,其余笺纸 note-btn——墨=落子无悔。
  // W2 包E(审计 A3):圆角归主控件档 5px。
  // 层级修订(用户反馈「四钮样式大小不一致」):原 2×2 等宽栅格里「同行异材质+上下两档」
  // 读作不一致而非层级。改为诚实层级——主入口(单机)通栏墨钮,三个次级入口同行同档同材质:
  // 层级由「通栏占位 + 墨/笺材质」表达,不再由同行内的样式差表达。
  const btnBase =
    "home-btn-brush rounded-[5px] border pr-8 pl-[calc(2rem+0.3em)] font-brush tracking-[0.3em] cursor-pointer transition-colors";
  const primary = {
    tid: HOME_TID.solo,
    label: "单机模式",
    onClick: onSolo,
    cls: `${btnBase} w-full py-5 text-2xl home-btn-gold ink-btn font-bold`,
  };
  const secondary: Array<{ tid: string; label: string; onClick: () => void }> = [
    { tid: HOME_TID.online, label: "联机模式", onClick: onOnline },
    { tid: HOME_TID.selectMap, label: "选择地图", onClick: () => setShowMapSelect(true) },
    { tid: HOME_TID.editMap, label: "编辑地图", onClick: () => onEdit(selectedMapId) },
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
      <div className="home-title-in-sub font-deco text-ink-dim mt-2 mb-8 tracking-[0.5em] pl-[0.5em]">— 三国大富翁 —</div>

      {/* 视觉重做 v2 签名件:千里江山装裱横带——《千里江山图》(PD,textures 已入库)
          青绿山水作装裱横幅铺在标题与入口之间,multiply 融纸;右端钤「逐鹿」朱印落款,
          上下深色细线 = 裱边。填补首页中央真空,本屏记忆点。 */}
      <div className="home-band-in relative mb-10 w-[min(880px,92vw)]">
        <div className="home-scroll-band relative overflow-hidden rounded-[3px]">
          <img
            src="/assets/textures/qianli-jiangshan.webp"
            alt=""
            aria-hidden="true"
            className="block h-[clamp(96px,15vw,168px)] w-full select-none object-cover mix-blend-multiply"
            draggable={false}
          />
          {/* 落款朱印:右端钤「逐鹿」竖读小印 */}
          <span
            aria-hidden="true"
            className="absolute bottom-3 right-5 inline-flex rotate-[-6deg] flex-col items-center justify-center rounded-[2px] bg-danger px-1.5 py-1.5 font-brush text-[15px] leading-[1.15] text-[#f6ead6] shadow-[0_1px_3px_rgba(43,35,23,0.4)]"
            style={{ writingMode: "vertical-rl" }}
          >
            逐鹿
          </span>
        </div>
      </div>

      {/* 主入口通栏(墨钮),次级三口同行同档;stagger 延时延续 300ms 起 80ms/个 */}
      <div className="flex w-[min(600px,92vw)] flex-col gap-y-4">
        <div className="home-btn-in" style={{ animationDelay: "300ms" }}>
          <button data-testid={primary.tid} onClick={primary.onClick} className={primary.cls}>
            {primary.label}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-x-3">
          {secondary.map((e, i) => (
            // 包裹层承载入场动画(见 home.css 注释:动画 fill 锁 transform,与按压态分层)
            <div key={e.tid} className="home-btn-in" style={{ animationDelay: `${380 + i * 80}ms` }}>
              <button
                data-testid={e.tid}
                onClick={e.onClick}
                className={`${btnBase} w-full py-4 text-xl note-btn`}
              >
                {e.label}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 当前选中地图回显;H-5:整行可点唤起选图二级屏,提对比(text-ink)。
          W2 包E(审计 A3):升级为小签材质(note-btn 小控件档 3px),文案落 wenkai
          (动态地图名禁落小薇);裸排 ▾ 换 Sym expand(SVG,无 tofu 风险)。 */}
      <button
        type="button"
        onClick={() => setShowMapSelect(true)}
        className="note-btn rounded-[3px] font-wenkai text-[13px] text-ink mt-6 flex items-center gap-2 cursor-pointer px-2.5 py-1 transition-colors"
      >
        <span className="text-ink-dim">当前地图:</span>
        <span data-testid={TID.currentMapName} className="text-ink">{mapName}</span>
        <Sym name="expand" size={11} className="text-ink-dim" />
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
