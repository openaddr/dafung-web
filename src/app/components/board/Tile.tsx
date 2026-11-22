// 组件收口:器物豁免(永久)——棋盘器物件,交互收口规则不适用(细则 docs/design/组件收口.md)
// 单座城池。静态结构(建筑/文字)按 tile 数据声明;状态(归属/都城/等级/焦点)由 props 驱动,
// React.memo 保证仅状态变化的城池重渲。建筑为程序化精绘(Building:飞檐城台/朱柱,
// 按城池档位分形制,ADR-0042)。
// 玄墨鎏金深底化(#512,#500 决议方案一「重调色保留」):铭牌=深卡浅字(漆金细边深卡
// lacquer 系+纸色字);都城金匾是深卡唯一例外(金底墨字)。事件格大字/外轮廓三族随
// 功能格五型退役整体删除(#826 全城池制:一切格子都走城池渲染分支)。
// #842 归属色墨化:格底=color-mix(ownerRgb 22%, bgDeep) 墨渍染,饱和归属色收敛到
// 铭牌底染 shade(owner,0.5)+全饱和描边两通道(糖果色整格平涂退役,一格一语言);
// 归属国号角标收回格内左上压角;铭牌字随名长自适应不截断。
// 本文件不再散落色值字面量:语义色吃 Theme token,棋盘专属装饰色收敛到文件头常量块。
// 宣告动效(ADR-0015):扩军(新珠落位)与易主(流光)的「何时播」归表现事件流——
// 播放器经 sink 在 fxStore 下发宣告 nonce,本组件订阅重播;组件内不做 props diff 自触发
// (R3 的 key={level} 重挂 / useOwnerChangeFlash 上一值钩子已删)。动画 keyframes 本体
// 仍在 board.css/fx.css,CSS 只承担「怎么播」。
import { memo, useId } from "react";
import type { TileEvent } from "@core/board";
import { fullDefenseOf } from "@core/defense";
import { CITY_BURN_TURNS } from "@core/constants";
import { CityBurningBadge } from "./CityBurningBadge";
import { Theme, playerColor, rgba } from "@core/theme";
import { useFxStore } from "@app/fx/fxStore";
import { Building } from "./tile-building";
import {
  CITY_FRAME,
  CITY_HIT_RADIUS,
  cityOpacity,
  cityTransform,
  type CityScene,
} from "./city-scene";

/** 玩家色加深(f<1):领地铭牌要"深卡浅字"的深底,直接用原玩家色做底则与描边/旗同明度
 *  缺乏层次,统一乘暗系数得到同色相的深卡(zoom-out 后"色块=地盘"仍按色相可辨)。 */
function shade(c: { r: number; g: number; b: number }, f: number) {
  return { r: Math.round(c.r * f), g: Math.round(c.g * f), b: Math.round(c.b * f) };
}

/** 双色 srgb 加权混色:`color-mix(in srgb, c f%, base)` 的等价算式(逐通道线性插值,
 *  双方 alpha 恒 1,#842)。归属只在格底留墨渍级痕迹(玩家色 22% 混进玄墨底),
 *  饱和色收敛到铭牌底染+描边两通道,不再整格平涂(DESIGN §5.2 一格一语言)。 */
function mix(
  base: { r: number; g: number; b: number },
  c: { r: number; g: number; b: number },
  f: number,
) {
  return {
    r: Math.round(base.r + (c.r - base.r) * f),
    g: Math.round(base.g + (c.g - base.g) * f),
    b: Math.round(base.b + (c.b - base.b) * f),
  };
}

interface TileProps extends CityScene {
  /** 缩略图自带静态都城光晕，盘面光晕由 AmbientLayer 提供。 */
  rasterSource?: boolean;
}

// ── 竖排木匾城名 ──
// 局部常量(#512 深卡浅字):匾身=漆木深卡(有主=深玩家色底染,#842)、边/铆钉/流苏=
// 漆金细边、字=纸色;都城金匾是深卡唯一例外(金底墨字)。集中在此便于整体调色。
const PLAQUE_FILL = rgba(Theme.paperLo, 0.98); // 匾身深卡(比铭牌 lacquer 卡再沉一档)
const PLAQUE_EDGE = rgba(Theme.lacquerGold, 0.9); // 漆金细边/铆钉/流苏
const PLAQUE_TEXT = rgba(Theme.paper, 0.96); // 纸色匾字
const CAPITAL_PLAQUE_TEXT = rgba(Theme.bgDeep); // 金匾墨字(深卡唯一例外)

/** 无主城低石台（#1537）。四档共用轮廓，台面与砖缝用现有墨木和淡纸色调出明暗。 */
function StonePlinth() {
  return (
    <g className="bv-tile-plinth" aria-hidden="true" pointerEvents="none">
      <ellipse cy={5} rx={54} ry={32} fill={rgba(Theme.bgDeep, 0.7)} />
      <path
        d="M-55 17 L-44 8 H43 L56 18 V27 L45 35 H-45 L-55 27Z"
        fill={rgba(mix(Theme.lacquer, Theme.paperDim, 0.18))}
        stroke={rgba(Theme.bgDeep, 0.9)}
        strokeWidth={1.7}
      />
      <path
        d="M-55 17 L-44 8 H43 L56 18 L44 27 H-43Z"
        fill={rgba(mix(Theme.panelHi, Theme.paperDim, 0.38))}
        stroke={rgba(mix(Theme.panelHi, Theme.paperDim, 0.64))}
        strokeWidth={1.1}
      />
      <path
        d="M-43 28H44L54 20 M-45 31H44 M-24 27v6 M20 28v6"
        fill="none"
        stroke={rgba(Theme.bgDeep, 0.45)}
        strokeWidth={1.4}
      />
      <path
        d="M-44 20l8-5h61l13 5 M-35 25l7-3m20 2 11-1m19-4 9 2"
        fill="none"
        stroke={rgba(Theme.paperDim, 0.35)}
        strokeWidth={1.4}
      />
    </g>
  );
}

/**
 * 竖排木匾(挂建筑右侧):漆木深卡 + 1px 漆金细边 + 顶部两枚铆钉;都城匾加宽 + 金底墨字
 * (深卡唯一例外)+ 底部两缕流苏。有主(非都城)匾身换深玩家色底染 shade(owner,0.5)
 * (#842):饱和归属色从整格平涂收敛到铭牌(一格一语言,DESIGN §5.2 定稿口径),
 * zoom-out 后「铭牌色块/旗形=归属」的形状层辨认不变。
 * 方案取舍:选"逐字纵排"而非 SVG writing-mode(后者 Firefox/Safari 对 tb 支持参差,逐字定位最稳)。
 *
 * 长名不截断(#842):全字入匾、匾高随字数自适应;≥3 字字号降档 0.85×(17≈20×0.85,
 * 字距同步收紧),自定义图 4 字以上城名完整可读,匾身在建筑右侧向下延展(悬挂匾,
 * 本就允许探出格底)。内置两张图城名最长 3 字,截断史实为自定义图专属路径。
 *
 * 总览定格(恒 computeFitView 按图推导,3400 宽级 → ~1000px 容器,缩放系数 ≈0.3-0.45;
 * #946 平移缩放退役,取景无第二形态)下任何城名字都只有 ~6-8px——读字不指望,靠
 * 「铭牌色块/旗形=归属」的形状层辨认(旧「放大后读字」层级随平移缩放一并退役,
 * 真 LOD 切换亦无取景通路可依);fs=20(城池统一 2.6x 放大,#58 后 ≈+15%,
 * #938 再提 2.2→2.6——定格总览下把字读出来就靠这一档;建筑规模/档位通道现归
 * Building 的 tier 形制,ADR-0042)。
 *
 * 匾字字体(2026-11-01 拷问):font-title(站酷酷黑)退役改 font-deco(站酷小薇,魏碑)——
 * 酷黑镜像仅 18 子集,临淄/下邳/吴郡/襄阳/邺城/颍川各缺一字逐字回退毛笔体(同匾混两族);
 * 且酷黑无 700 字重,原 fontWeight=700 是浏览器伪加粗,小字号笔画糊死(可读性红线)。
 * 小薇 92 子集全城名覆盖;印文(EventSeal/CandidateSeal)留在 font-title 但同样去伪加粗。
 */
function NamePlaque({
  name,
  capital,
  ownerRgb,
}: {
  name: string;
  capital: boolean;
  ownerRgb: { r: number; g: number; b: number } | null;
}) {
  const chars = [...name]; // 长名不截断(#842):全字入匾
  const w = capital ? 34 : 26;
  const fs = chars.length >= 3 ? 17 : 20; // ≥3 字降档 0.85×(#842)
  const step = fs + 5; // B5:字距留缝,随字号同步缩放(2026-11-01 拷问 +3→+5:竖排留白 15%→25%,小字号粘连主犯之一)
  const h = chars.length * step + 12;
  const x = 40 - w / 2; // 匾中心 x=40(建筑右侧、铭牌内),不与王旗/小旌旗重叠
  const y0 = -22;
  const rivet = capital ? rgba(Theme.bgDeep, 0.6) : PLAQUE_EDGE; // 金匾钉帽换深色,金钉钉金匾不可见
  const body = capital
    ? rgba(Theme.goldBright, 0.95)
    : ownerRgb
      ? rgba(shade(ownerRgb, 0.5), 0.98) // 归属底染(#842):饱和色收敛到铭牌
      : PLAQUE_FILL;
  return (
    <g className="bv-tile-plaque">
      <rect
        x={x}
        y={y0}
        width={w}
        height={h}
        rx={3}
        fill={body}
        stroke={PLAQUE_EDGE}
        strokeWidth={1}
      />
      {/* 顶部两枚铆钉圆点(固定匾额的钉帽,细节让 zoom-out 后仍是"色块有细节") */}
      <circle cx={x + 5} cy={y0 + 5} r={1.6} fill={rivet} />
      <circle cx={x + w - 5} cy={y0 + 5} r={1.6} fill={rivet} />
      {chars.map((c, i) => (
        <text
          key={i}
          x={40}
          y={y0 + 15 + i * step}
          textAnchor="middle"
          fontFamily="var(--font-deco)"
          fontSize={fs}
          fill={capital ? CAPITAL_PLAQUE_TEXT : PLAQUE_TEXT}
        >
          {c}
        </text>
      ))}
      {/* 都城匾底部两缕流苏(曲线收尖),与王旗描金同调 */}
      {capital ? (
        <>
          <path d={`M ${x + 11} ${y0 + h} q -3 5 -2 9 l 2.5 3 z`} fill={PLAQUE_EDGE} />
          <path d={`M ${x + w - 11} ${y0 + h} q 3 5 2 9 l -2.5 3 z`} fill={PLAQUE_EDGE} />
        </>
      ) : null}
    </g>
  );
}

/** 等级徽记与选都序号使用同一锚点，扩军宣告重播徽记落位。 */
export function CityLevelBadge({ tileIndex, level }: { tileIndex: number; level: number }) {
  const growNonce = useFxStore((s) => s.announces.get(tileIndex)?.level ?? 0);
  return (
    <g transform="translate(-41 31)" data-level={level} pointerEvents="none">
      <g key={growNonce} className={growNonce > 0 ? "bv-level-badge-grow" : undefined}>
        <rect
          x={-9}
          y={-9}
          width={18}
          height={18}
          rx={2}
          fill={rgba(Theme.goldBright)}
          stroke={rgba(Theme.bgDeep)}
          strokeWidth={0.8}
        />
        <text
          y={1}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="var(--font-wenkai)"
          fontSize={16}
          fill={rgba(Theme.bgDeep)}
        >
          {level}
        </text>
      </g>
    </g>
  );
}

/** 沿用小盾牌的直顶平肩和弧腹尖底。 */
const SHIELD_PATH = "M -3.4 -4 H 3.4 V -0.5 C 3.4 2.2 2 3.9 0 4.6 C -2 3.9 -3.4 2.2 -3.4 -0.5 Z";
const SHIELD_X = 1;
const SHIELD_Y = 29;

function CityDefenseShield({ defense, level }: { defense: number; level: number }) {
  const fillId = useId();
  const fillBoundary = 1 - defense / fullDefenseOf(level);
  const blue = rgba(Theme.defenseShield);
  return (
    <g data-shield data-defense={defense} pointerEvents="none">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset={fillBoundary} stopColor={rgba(Theme.bgDeep)} />
          <stop offset={fillBoundary} stopColor={blue} />
        </linearGradient>
      </defs>
      <path
        d={SHIELD_PATH}
        transform={`translate(${SHIELD_X} ${SHIELD_Y}) scale(3.1)`}
        fill={`url(#${fillId})`}
        stroke={blue}
        strokeWidth={0.5}
      />
      <text
        x={SHIELD_X}
        y={SHIELD_Y + 3}
        textAnchor="middle"
        fontFamily="var(--font-wenkai)"
        fontSize={18}
        fill={rgba(Theme.paper)}
        stroke={rgba(Theme.bgDeep)}
        strokeWidth={1.5}
        paintOrder="stroke"
      >
        {defense}
      </text>
    </g>
  );
}

// ── X4(#23) 选都候选序号印:壹/贰/叁(引擎滚出顺序=第几候选)──
// 16×16 圆角方 + 笔书大字,描金变体:玄墨底金框金字——与「宝」印同读作
// 「印=特殊标记」;候选期无主无等级,与等级徽记同锚点(-41 31)而时段互斥(Setup 期
// Lv 恒 0),不叠印;总览下是一粒金边方点,与脉冲金圈构成「三城仪式组」,放大后读序号
// (「我选叁号城」)。
const CANDIDATE_SEAL_CHARS = ["", "壹", "贰", "叁"] as const;
function CandidateSeal({ order }: { order: number }) {
  return (
    <g className="bv-candidate-seal" transform="translate(-41 31)">
      <rect
        x={-8}
        y={-8}
        width={16}
        height={16}
        rx={2}
        fill={rgba(Theme.bgDeep, 0.9)}
        stroke={rgba(Theme.goldBright)}
        strokeWidth={1.2}
      />
      <text
        y={4.2}
        textAnchor="middle"
        fontFamily="var(--font-title)"
        fontSize={12}
        fill={rgba(Theme.goldBright)}
      >
        {CANDIDATE_SEAL_CHARS[order]}
      </text>
    </g>
  );
}

// ── #823/#828 特殊城池两字徽标:右上角方印按 event 字段渲染奖励域 ──
// 奖励域词表:珍宝(拼点探宝)/名将(招贤)/商市(行情赌局)。印底金族统一
// (goldBright 底+玄墨字,#842 饱和色收敛两通道,靠印文区分);
// 保留 -6° 手钤角与「印=特殊标记」的读法(与选都候选印同族,配色对偶:
// 候选印玄墨底金字、事件印金底玄墨字)。
// 尺寸:两字印 32×20/单字 11 号(逻辑单位,TILE_SCALE 2.6 屏上单字 ~29px,
// 844×390 实测可读)。锚点 (49,-34):-6° 旋转后底左角 (34,-22.4) 让开右侧木匾
// 顶缘(-22),顶右角 (64,-45.6) 出格顶一线=悬挂印旧观感;旗组 #842 已收回左上,
// 右上角唯此一印不撞木匾(右侧)/王旗(上方)/等级徽记(左下)。
// #665/#828 收编导出:印文词表与徽标组件供 test/tile-badge.test.tsx 同源断言
// (词表漂移/普通城无徽标在组件级钉住,不靠 e2e)。
export const TILE_EVENT_BADGES: Record<TileEvent, string> = {
  treasure: "珍宝",
  hero: "名将",
  market: "商市",
};

export function EventSeal({ event }: { event: TileEvent }) {
  return (
    <g className="bv-event-seal" transform="translate(49 -34) rotate(-6)">
      <rect
        x={-16}
        y={-10}
        width={32}
        height={20}
        rx={2}
        fill={rgba(Theme.goldBright)}
        stroke={rgba(Theme.bgDeep, 0.7)}
        strokeWidth={1.4}
      />
      {[...TILE_EVENT_BADGES[event]].map((c, i) => (
        <text
          key={i}
          x={i === 0 ? -6.5 : 6.5}
          y={4}
          textAnchor="middle"
          fontFamily="var(--font-title)"
          fontSize={11}
          fill={rgba(Theme.bgDeep)}
        >
          {c}
        </text>
      ))}
    </g>
  );
}

// ── #96 易主检测已收编(ADR-0015)──
// 旧 useOwnerChangeFlash(props diff 上一值快照)删除:易主宣告由引擎结算留痕 →
// 表现事件流 → sink → fxStore.announces 下发 nonce,Tile 在组件内订阅本城记录重播,
// 触发源是播放器/sink 而非组件自 diff(易主在破产清算/变卖等结算点发生,props diff
// 无法区分「易主」与「终态加载」)。

export const Tile = memo(function Tile({ tile, tier, state, rasterSource = false }: TileProps) {
  const isCapital = state.capitalColorIndex != null;
  const ownerRgb = state.ownerColorIndex != null ? playerColor(state.ownerColorIndex) : null;
  const showsPlinth = ownerRgb === null && !isCapital;
  const showsFrame = !showsPlinth || state.isActive;

  const cls = [
    "bv-tile",
    isCapital ? "bv-capital" : "",
    state.isTaken ? "opacity-40 grayscale" : "",
    // X4(#23) 候选集全座位可见:静态低透明金圈;本地可点(bv-selectable)脉冲升级
    state.capitalCandidateOrder != null ? "bv-candidate" : "",
    !rasterSource && state.isSelectable ? "bv-selectable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <g
      className={cls}
      data-city-art={rasterSource ? tile.index : undefined}
      data-tile={rasterSource ? undefined : tile.index}
      data-name={tile.name}
      /* 目标段选城选择器契约:e2e 候选=cityTarget(tileIndex)、
          选中=cityTargetPicked(tileIndex)(testids 单源),勿散落属性串。 */
      data-city-target={(!rasterSource && state.isCityTarget) || undefined}
      data-city-target-selected={(!rasterSource && state.isCityPicked) || undefined}
      transform={cityTransform(tile.position)}
      opacity={rasterSource ? undefined : cityOpacity({ tile, tier, state }, false)}
    >
      {/* 命中高亮底 + 都城/焦点光晕 */}
      <circle
        className="bv-tile-hilite"
        r={CITY_HIT_RADIUS}
        fill={rgba(Theme.gold)}
        opacity={state.capitalCandidateOrder === null ? 0 : 0.15}
      />
      {/* F2:光晕 radialGradient 圆(CityDefs 定义,中心亮→边缘 0)。棋盘侧的常驻
          脉动已迁氛围层(ADR-0039,showGlow=false 由 BoardView 关闭);本件只剩
          TileThumb 缩略图用的静态光晕(board.css 钉呼吸中程,无动画)。 */}
      {!rasterSource && isCapital ? (
        <circle className="bv-capital-glow" r={70} fill="url(#bv-capital-glow-grad)" />
      ) : null}
      {/* 「轮到谁」活跃虚线环已退役(2026-11-01 #966:原 Tile 内 bv-active-ring 曾迁
          氛围层 .bv-amb-tile-ring,随环一线裁撤);轮到谁的金描边仍由下方
          bv-tile-border 的 isActive 态承担。 */}

      {/* 104×88 矩形同时承担格面与触达。无主常态的填色和描边透明，保留整块命中；
          当前城描金。有主格底留 22% 玩家色墨染，边框、铭牌和城旗共同表达归属。 */}
      <rect
        className="bv-tile-border"
        {...CITY_FRAME}
        fill={
          ownerRgb
            ? rgba(mix(Theme.bgDeep, ownerRgb, 0.22))
            : showsFrame
              ? rgba(Theme.lacquer, 0.92)
              : "transparent"
        }
        fillOpacity={ownerRgb ? 0.94 : 1}
        stroke={
          state.isActive
            ? rgba(Theme.goldBright)
            : ownerRgb
              ? rgba(ownerRgb)
              : showsFrame
                ? rgba(Theme.lacquerGold, 0.5)
                : "transparent"
        }
        strokeOpacity={ownerRgb ? 0.95 : 0.9}
        strokeWidth={ownerRgb ? 3 : state.isActive ? 3 : 1.5}
      />
      {showsPlinth ? <StonePlinth /> : null}

      {/* 需求2·都城① 金色城台底座:建筑脚下两层 rect(暗金座身+亮金座面,模拟上下渐变)。
            不用 linearGradient:defs 在 StaticLayers(独占勿动),每城内联 defs 会产生重复 id 冲突。
            #512 深底适配:座身压暗(goldDeep)、描边换玄墨勾线,金面读作「金台」不炫目。 */}
      {isCapital ? (
        <g className="bv-capital-pedestal">
          <rect
            x={-62}
            y={9}
            width={124}
            height={12}
            rx={2}
            fill={rgba(Theme.goldDeep, 0.55)}
            stroke={rgba(Theme.bgDeep, 0.8)}
            strokeWidth={1.5}
          />
          <rect x={-62} y={9} width={124} height={5.5} rx={2} fill={rgba(Theme.gold, 0.85)} />
        </g>
      ) : null}
      {/* 建筑整体 scale 1.08(都城):以城脚(y=12)为锚,只向上长高="微抬升",
            不踩进底座;无主/领地保持原尺度。 */}
      <g transform={isCapital ? "translate(0 12) scale(1.08) translate(0 -12)" : undefined}>
        {/* 程序化建筑(档位形制,ADR-0042):等级与归属都不上楼——等级归等级徽记、
              归属归铭牌底染(2026-10-17 拷问:重复表达裁单一,楼回归纯规格)。 */}
        <Building tier={tier} />
      </g>
      {/* #96/ADR-0015 易主流光已迁 fx 宿主(架构体检 B 批):SVG 内逐帧流光在底板
            栅格空间重绘城区,现经 FxSink→fxStore.ownFlashes→FxLayer mini-svg 出底板,
            几何(铭牌顶缘 ±46/-39 线)与流光语义原样平移;Tile 只余等级徽记 nonce。 */}
      {/* 城名竖排木匾(挂建筑右侧):都城金底墨字 + 流苏,普通城深木底金字 */}
      <NamePlaque name={tile.name} capital={isCapital} ownerRgb={ownerRgb} />
      {!rasterSource && state.level !== null ? (
        <CityLevelBadge tileIndex={tile.index} level={state.level} />
      ) : null}
      {state.level !== null && state.defense !== null ? (
        <CityDefenseShield defense={state.defense} level={state.level} />
      ) : null}
      {!rasterSource && state.fireMarks > 0 ? (
        <CityBurningBadge marks={state.fireMarks} fill={state.fireProgress / CITY_BURN_TURNS} />
      ) : null}
      {/* 选都候选序号印与有主城等级徽记共用锚点。 */}
      {state.capitalCandidateOrder != null ? (
        <CandidateSeal order={state.capitalCandidateOrder} />
      ) : null}
      {/* 王旗(都城):旗杆 + 旗顶缨 + 玩家色三角(描金边)+ 国号。
            需求2·都城② 旗面加宽至 1.4 倍 + 双层(后层深色衬底)——大旗是 zoom-out 后
            仍可辨的形状级王权信号,不依赖文字/描边细节。
            旗杆基点固定 -40:恰接大档城楼屋脊(城头立旗)。#938 TILE_SCALE 2.6 后旗组
            整体下移 14(杆顶 -88→-74):2.6 下行距 320 折局部 123.1、扣卡半高 44,
            上邻卡底缘在局部 -79.1,原杆顶 -88 必戳邻卡;-74 留 3 局部避让余量,旗面观感不变。 */}
      {isCapital && state.capitalColorIndex != null ? (
        <g className="bv-tile-flag">
          <line
            x1={0}
            y1={-40}
            x2={0}
            y2={-74}
            stroke={rgba(Theme.goldWash, 0.85)}
            strokeWidth={2}
          />
          {/* 旗杆顶缨:金珠 + 三笔红缨,静态点缀 */}
          <circle cx={0} cy={-75} r={2.2} fill={rgba(Theme.goldBright)} />
          <g stroke={rgba(Theme.danger, 0.8)} strokeWidth={1}>
            <line x1={0} y1={-73} x2={-3} y2={-70} />
            <line x1={0} y1={-73} x2={0} y2={-69} />
            <line x1={0} y1={-73} x2={3} y2={-70} />
          </g>
          {/* 后层深色衬:略大略低一笔,让前层旗面在任何底色上都"浮"出来(玄墨底取 bgDeep) */}
          <polygon points="0,-76 47,-63.5 0,-51" fill={rgba(Theme.bgDeep, 0.65)} />
          <polygon
            points="0,-74 45,-62.5 0,-51"
            fill={rgba(playerColor(state.capitalColorIndex))}
            stroke={rgba(Theme.goldBright)}
            strokeWidth={1.5}
          />
          {/* B3:三角尖端窄,文字锚点从 x=15 右移到形心偏内 x=19,避免国号挤向尖端溢出。
                #512 深底适配:纸色字 + 玄墨描边衬底(paint-order),任意玩家色旗面上都可读 */}
          <text
            x={19}
            y={-60}
            textAnchor="middle"
            fontFamily="var(--font-brush)"
            fontSize={17}
            fill={rgba(Theme.paper)}
            stroke={rgba(Theme.bgDeep, 0.85)}
            strokeWidth={2.5}
            paintOrder="stroke"
          >
            {state.capitalGuohao}
          </text>
        </g>
      ) : null}
      {/* 特殊城池两字徽标(#823/#828,EventSeal):右上角方印按 event 字段渲染奖励域
            珍宝/名将/商市统一用金底——旧「宝」单字印
            (ADR-0024 时代,#825 改读 event)升级两字印,普通城(无 event)无徽标。
            旧「都城化让位」条件(都印优先)已随都印退役删除——都城身份现由光晕+王旗
            承担,与本印不同锚不撞,都城化的特殊城仍可辨「此城有固定事件」。
            「起」印(#73 所植,同锚旧邻)已随 2026-10-19 拷问退役:游戏无共同
            起点——选都后各人行军自都城始(各不相同),tileIndex 0 仅选都期全员
            落位;「起点有标识」前提不成立,环路方向语义由首段双羽独挑。
            #512:金底印字用玄墨底色(ink=纸色,金底上须配深字才可读)。 */}
      {tile.event ? <EventSeal event={tile.event} /> : null}
      {/* B2 三旗语法分化:持有者城旗改「燕尾旗」(矩形 + 飞端 V 形缺口)——
            与棋子的三角旗(人)、王旗的双层大三角(都)三形互斥,远看旗形即分类;
            深描边压住轮廓,保证浅色玩家色旗面在漆木深卡上也可辨。
            #842:旗组从格框外路面(原 x 40..62 越框压箭羽)收回格内左上角压角——
            框缘内缩 6px(旗顶 -38=上缘内缩 6、旗杆 -46=左缘内缩 6),杆脚落在檐角
            线上(下檐尖 ±40,-21),不压箭羽/等级徽记(左下)/宝印(右上)/木匾(右侧)。 */}
      {!isCapital && ownerRgb ? (
        <g className="bv-tile-owner-flag">
          <line
            x1={-46}
            y1={-24}
            x2={-46}
            y2={-38}
            stroke={rgba(Theme.goldWash, 0.8)}
            strokeWidth={1.5}
          />
          <polygon
            points="-46,-38 -24,-38 -31,-33 -24,-28 -46,-28"
            fill={rgba(ownerRgb)}
            stroke={rgba(Theme.bgDeep, 0.7)}
            strokeWidth={1}
          />
          <text
            x={-36}
            y={-29.5}
            textAnchor="middle"
            fontFamily="var(--font-brush)"
            fontSize={10.5}
            fill={rgba(Theme.paper)}
            stroke={rgba(Theme.bgDeep, 0.8)}
            strokeWidth={2}
            paintOrder="stroke"
          >
            {state.ownerGuohao}
          </text>
        </g>
      ) : null}
      {/* X4+:选都可点指示已迁氛围层(架构体检 B 批:金盘+描边金环呼吸出底板,
          AmbientLayer 按 selectableTiles 挂 bv-amb-select-crown,形体参数原样平移);
          本件只剩候选(他席)静态细环。 */}
      {state.capitalCandidateOrder != null ? (
        <rect
          opacity={0.5}
          x={-51}
          y={-43}
          width={102}
          height={86}
          rx={9}
          fill="none"
          stroke={rgba(Theme.gold)}
          strokeWidth={2}
        />
      ) : null}
      {/* 目标段选城·选中定靶(#1388 T2,#417 选中态同语):实金双环停持——外实金环+
          内发丝线(#510 漆金环口径,seat-target.css .picked 同族),呼吸 crown 已随
          选中出列(候选呼吸停),恒定不闪;状态表达 §4.6 纯环制不加文字标牌。 */}
      {state.isCityPicked ? (
        <g className="bv-city-picked-ring">
          <rect
            x={-57}
            y={-49}
            width={114}
            height={98}
            rx={12}
            fill="none"
            stroke={rgba(Theme.goldBright)}
            strokeWidth={3}
          />
          <rect
            x={-49.5}
            y={-41.5}
            width={99}
            height={83}
            rx={8}
            fill="none"
            stroke={rgba(Theme.gold)}
            strokeWidth={1.2}
          />
        </g>
      ) : null}
    </g>
  );
});
