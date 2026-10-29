// 首屏(信息架构重构):只放四个模式入口——单机 / 联机 / 选图 / 编辑。
// 国号、诸侯数等对局配置移到「单机模式」次级页(SoloSetupScreen),让首页回归
// 纯导航(用户要求:菜单只显示四个按钮入口)。选图仍是二级面板(MapSelectPanel
// 复用不重写),确认后回显当前地图名并照旧记忆到 localStorage。
// #707 矮横屏档(landscape + max-height:500px,与对局屏 layout.css A 档同口径):
// 二级选图弹层在 844×390 一类视口被裁切、换图开局不可达——选图改内联横排条带
// (MapStrip,左右滑动全部可达,点选即选中),「选择地图」入口与地图回显行由
// 条带承担,选择+开局一屏完成零滚动;桌面档信息架构零变化。
import { useState } from "react";
import type { MapSource } from "@core/map-source";
import { getMapSource } from "@app/map-sources";
import { useMediaQuery } from "@app/hooks/use-media-query";
import { MapSelectPanel } from "@app/screens/setup/MapSelectPanel";
import { TID } from "@app/screens/setup/testids";
import { useMapName } from "@app/screens/setup/useMapName";
import { Sym } from "@app/screens/shared/Sym";
import { HOME_TID } from "./testids";
import { MapStrip } from "./MapStrip";
import "./home.css";

/** 矮横屏档媒体查询(形态分档断点单源=对局屏 game/layout.css A 档同一查询串,
 *  home.css 短横屏档媒体查询同串;JS 分支与 CSS 档必须同步,改一处改两处)。 */
const SHORT_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 500px)";

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
  // #707:矮横屏档开关(JS 结构分支:条带 ↔ 地图行+弹层入口;间距收紧仍走 home.css
  // 同串媒体查询,JS 与 CSS 各管各的不重复)。桌面档恒 false,信息架构零变化。
  const isShortLandscape = useMediaQuery(SHORT_LANDSCAPE_QUERY);
  // 与单机配置页共用同一份地图名解析逻辑(清单失败回退 id 显示)
  const mapName = useMapName(mapSource, selectedMapId);

  // 条带点选 = 弹层确认路径的等价短路:回写选中 + 交接线方持久化(localStorage)。
  const pickMap = (mapId: string) => {
    setSelectedMapId(mapId);
    onMapChange?.(mapId);
  };

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
    // #497 ④:home-btn-gold(金底变体遗物)退役 —— 主入口现为墨钮,与次级笺钮
    // 共用同一条金色笔触 hover 线(home-btn-brush),hover 语言全屏统一
    cls: `${btnBase} home-pad-tight w-full py-5 text-2xl ink-btn font-bold`,
  };
  // #707:矮横屏档「选择地图」入口退役——选图由内联横排条带承担(点选即选,
  // 弹层路径在该档裁切不可达),次级行剩两口改双列;桌面档三口零变化。
  const secondary: Array<{ tid: string; label: string; onClick: () => void }> = [
    { tid: HOME_TID.online, label: "联机模式", onClick: onOnline },
    ...(!isShortLandscape
      ? [{ tid: HOME_TID.selectMap, label: "选择地图", onClick: () => setShowMapSelect(true) }]
      : []),
    { tid: HOME_TID.editMap, label: "编辑地图", onClick: () => onEdit(selectedMapId) },
  ];

  return (
    // E1(#13):根节点只做滚动容器(flex-col overflow-y-auto),内层 m-auto 居中——
    // flexbox「居中+可滚」标准解:内容不溢出时视觉与 justify-center 一致,
    // 666×360 横屏等小视口下四入口+地图行全量可滚达,不再被 #app overflow:hidden 截断。
    // #707 矮横屏档:条带收纳后内容须零滚动,e2e 断言根容器 scrollHeight==clientHeight。
    <div
      data-testid={HOME_TID.screen}
      // G1(#751/#742):home-safe = 左右 padding 与 safe-area inset 取 max(刘海/圆角横屏
      // 不贴边裸奔;桌面 env()=0 无感),同 GameTopBar 现役 --safe-* 用法
      className={`home-safe flex h-full flex-col overflow-y-auto bg-bg ${isShortLandscape ? "px-6 py-4" : "p-6"}`}
    >
      <div className="m-auto flex w-full flex-col items-center">
        {/* H-2 标题/副标题先行淡入(home.css 0.3s),按钮 stagger 从 300ms 起跟进;
          #497 ④:h1 补 pl 与 tracking-widest 尾部空白同量(副标题/按钮都补了,唯独 h1 漏);
          #707 矮横屏档标题降档给条带让位(收纳档,桌面 6xl 不动);
          #761 ⑥:本档再降一档 36→30px(844×360 零滚动三主刀之一) */}
        <h1
          className={`home-title-in font-title ${isShortLandscape ? "text-3xl" : "text-6xl"} text-ink tracking-widest pl-[0.1em]`}
        >
          群雄逐鹿
        </h1>
        {/* H-3 副标题 0.5em 字距,pl 同量补偿尾部空白使视觉居中;home-sub-tight=短横屏档收间距 */}
        <div className="home-title-in-sub home-sub-tight font-deco text-ink-dim mt-2 mb-8 tracking-[0.5em] pl-[0.5em]">
          — 三国大富翁 —
        </div>

        {/* 视觉重做 v2 签名件:玄墨鎏金装裱横带(#514/S8 立框;#558 画心接位):
          texture-lanting 横批 + 压深渐变(home.css .home-band-heart),右端周瑜立绘
          低透明亮相(mask 渐隐入深底,纯装饰),右下钤「逐鹿」漆金印落款,
          上下金线 = 裱边「矩」。横带是氛围位不是演出位(§4.6/方向 D),静态无动效;
          #751/H1(#742 判词):矮横屏窄带档只撤立绘、画心纹理照常 cover 裁带
          (裁切语言对纹理成立,只对人物不成立,home.css 同名媒体查询;
          带高 56px 随 #761 ⑥ 收口)。 */}
        {/* H2(#751/#742):矮横屏档横带与内容列同宽(600px 单源,消 776 vs 600 双栏不齐
          ——该档横带只有 56px 高,宽出的部分只贡献空带观感);桌面档「装裱横批宽于
          签列」的层次 intentional,维持 880px 不动。 */}
        <div
          className={`home-band-in home-gap-tight relative mb-10 ${
            isShortLandscape ? "w-[min(600px,92vw)]" : "w-[min(880px,92vw)]"
          }`}
        >
          <div className="home-scroll-band relative overflow-hidden rounded-[3px]">
            {/* 画心:lanting 纹理+压深渐变(home.css 持材质),高度沿用 home-band-h 短横屏档 */}
            <div className="home-band-h home-band-heart w-full select-none" aria-hidden="true" />
            {/* 周瑜立绘:右端低透明亮相——aria-hidden + 空 alt 不进可访问名,
                pointer-events-none 纯装饰;先于印章入 DOM,「逐鹿」印保持最高亮层 */}
            <img
              src="/assets/heroes/hero-zhouyu-sgs.png"
              alt=""
              aria-hidden="true"
              className="home-band-hero pointer-events-none absolute top-0 right-0 h-full w-auto select-none"
            />
            {/* 落款漆金印:右端钤「逐鹿」竖读小印(#506 印章漆金化) */}
            <span
              aria-hidden="true"
              className="seal-gold absolute bottom-3 right-5 inline-flex rotate-[-6deg] flex-col items-center justify-center rounded-[2px] px-1.5 py-1.5 font-title text-[15px] leading-[1.15]"
              style={{ writingMode: "vertical-rl" }}
            >
              逐鹿
            </span>
          </div>
        </div>

        {/* 主入口通栏(墨钮),次级三口同行同档;stagger 延时延续 300ms 起 80ms/个。
            home-pad-tight=短横屏档收按钮纵向 padding(430px 高首屏四入口免滚动)。 */}
        <div className="flex w-[min(600px,92vw)] flex-col gap-y-4">
          <div className="home-btn-in" style={{ animationDelay: "300ms" }}>
            <button data-testid={primary.tid} onClick={primary.onClick} className={primary.cls}>
              {primary.label}
            </button>
          </div>
          <div className={`grid gap-x-3 ${isShortLandscape ? "grid-cols-2" : "grid-cols-3"}`}>
            {secondary.map((e, i) => (
              // 包裹层承载入场动画(见 home.css 注释:动画 fill 锁 transform,与按压态分层)
              <div
                key={e.tid}
                className="home-btn-in"
                style={{ animationDelay: `${380 + i * 80}ms` }}
              >
                <button
                  data-testid={e.tid}
                  onClick={e.onClick}
                  className={`${btnBase} home-pad-tight w-full py-4 text-xl note-btn`}
                >
                  {e.label}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* #707 矮横屏档:内联横排条带 = 本档的地图选择器(替代「当前地图」回显行 +
            二级弹层;当前选中由条带选中态表达,§4.6 不另设文字回显行)。
            桌面档维持地图行 + 弹层入口,信息架构零变化。 */}
        {isShortLandscape ? (
          <div className="mt-2 w-[min(600px,92vw)]">
            <MapStrip mapSource={mapSource} selectedMapId={selectedMapId} onSelect={pickMap} />
          </div>
        ) : (
          /* 当前选中地图回显;H-5:整行可点唤起选图二级屏。#558:13px→14px(选图入口
            第二载体不该是全屏最小字),「当前地图:」与图名同用 text-ink,仅箭头 ink-dim。
            W2 包E(审计 A3):升级为小签材质(note-btn 小控件档 3px),文案落 wenkai
            (动态地图名禁落小薇);裸排 ▾ 换 Sym expand(SVG,无 tofu 风险)。 */
          <button
            type="button"
            onClick={() => setShowMapSelect(true)}
            className="note-btn rounded-[3px] font-wenkai text-[14px] text-ink mt-6 flex items-center gap-2 cursor-pointer px-2.5 py-1 transition-colors"
          >
            <span className="text-ink">当前地图:</span>
            <span data-testid={TID.currentMapName} className="text-ink">
              {mapName}
            </span>
            <Sym name="expand" size={11} className="text-ink-dim" />
          </button>
        )}

        {/* 地图选择二级屏:复用原面板,确认后回写选中 id(取消保留原选择;fixed 弹层,滚动容器内无关)。
            #707:矮横屏档不挂弹层(该档选择器=条带;桌面开着的弹层旋到矮横屏时随档卸载,
            旋回恢复——showMapSelect 意图保留)。 */}
        {!isShortLandscape && showMapSelect && (
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
