// 单座城池。静态结构(建筑/文字)按 tile 数据声明;状态(归属/都城/等级/焦点)由 props 驱动,
// React.memo 保证仅状态变化的城池重渲。建筑为程序化精绘(Building:飞檐青瓦/城台/朱柱,
// 按区域分形制变体)。
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
import { memo } from "react";
import type { TileDef, TileEvent } from "@core/board";
import { Theme, playerColor, rgba } from "@core/theme";
import { useFxStore } from "@app/fx/fxStore";
import { Building } from "./tile-building";

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

export interface TileVisualState {
  /** 持有者 colorIndex(null=无主)。 */
  ownerColorIndex: number | null;
  /** 持有者国号(小旌旗文字)。 */
  ownerGuohao: string | null;
  /** 该城等级(0=未持有)。 */
  level: number;
  /** 是否某玩家都城 + 都城主 colorIndex(王旗)。 */
  capitalColorIndex: number | null;
  capitalGuohao: string | null;
  /** 当前回合玩家所在城(脉动金环)。 */
  isActive: boolean;
  /** 选都阶段已被选(标灰禁用)。 */
  isTaken: boolean;
  /** 可交互高亮(轮到本地选都的候选集,呼吸脉冲金圈)。 */
  isSelectable: boolean;
  /** X4(#23) 选都候选序号(1 基,引擎滚出顺序;null=非候选)。候选集全座位可见:
   *  静态低透明金圈(bv-candidate)是非决策席档,本地可点脉冲由 isSelectable 升档。 */
  capitalCandidateOrder: number | null;
}

interface TileProps {
  tile: TileDef;
  group: string; // 地产分组(catalog.get(propertyId).group),建筑地域形制变体用
  /** 满级档(catalog.get(propertyId).maxLevel),满贯金框判据;非地产格无珠不读。 */
  maxLevel: number;
  state: TileVisualState;
  onClick?: (index: number) => void;
}

// ── #25/#39/#58 城池全局放大比例 ──
// 旗/匾/印/价格签等所有元素随 <g> 整体 scale(等比,视觉口径统一;点击热区与
// hover 重排随 SVG transform 同步放大,无需另调)。
// 屏幕上的净大小 = TILE_SCALE / 画布放大倍数(1.4x):#58 蛇形重排后网格步距
// 列 400/行 310,城池再放大:1.96→2.2(净 2.2/1.4≈1.57x)。
// 压盖校验:铭牌外缘 ~104×2.2≈229 < 行距(旧 310/ADR-0027 起 320)< 列距(旧 400/现 380)。
// #665 收编导出:TileThumb 的缩略图包围盒换算引用本单源,字面量复制已退役。
export const TILE_SCALE = 2.2;

// ── 竖排木匾城名 ──
// 局部常量(#512 深卡浅字):匾身=漆木深卡(有主=深玩家色底染,#842)、边/铆钉/流苏=
// 漆金细边、字=纸色;都城金匾是深卡唯一例外(金底墨字)。集中在此便于整体调色。
const PLAQUE_FILL = rgba(Theme.paperLo, 0.98); // 匾身深卡(比铭牌 lacquer 卡再沉一档)
const PLAQUE_EDGE = rgba(Theme.lacquerGold, 0.9); // 漆金细边/铆钉/流苏
const PLAQUE_TEXT = rgba(Theme.paper, 0.96); // 纸色匾字
const CAPITAL_PLAQUE_TEXT = rgba(Theme.bgDeep); // 金匾墨字(深卡唯一例外)

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
 * 两级可读设计(B1):总览(computeFitView 按图推导,3400 宽级 → ~1000px 容器,缩放系数 ≈0.3-0.45)下
 * 任何城名字都只有 ~6-8px——总览不指望读字,靠「铭牌色块/旗形=归属」的形状层辨认
 * (viewBox 是命令式更新、不触发 React 渲染,Tile 感知不到 zoom,做不了真 LOD 切换);
 * 放大后才进入「读字」层级,此时满字号应 ≥13px 等效红线:
 * fs=20(城池统一 2.2x 放大,#58 后 ≈+15%;规模三档视觉通道已随经济 v2 退役)。
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
  const step = fs + 3; // B5:字距留缝,随字号同步缩放
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
          fontFamily="var(--font-title)"
          fontSize={fs}
          fontWeight={700}
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

// ── 档位珠(铭牌左下小金珠):城池等级的唯一视觉通道(2026-10-17 拷问定案)──
// 珠数=等级,Lv0 无珠,满级珠外加金框加冕——变卖价/都城补给/坐地起价全挂在等级上,
// 珠数是离散计数、总览可数不依赖识字。旧双通道(城楼加层+壹贰叁小印)总览双双不可辨
// (加层每级高差 5px 竖向预算顶死、16px 暗印只是一粒点),随本批退役(GLOSSARY「档位珠」)。
// #96/ADR-0015 出场落位:bv-pip-grow(board.css,scale 0.6→1)只挂最末一颗新珠——扩军
// 宣告 nonce(replay=growNonce>0)经 key 重挂时末珠生长、其余珠静置;快照恢复(nonce=0)
// 全组静置不播。
/** 相邻珠心距;满贯金框宽随它推导(level × PIP_STEP + 6),改距不双改。 */
const PIP_STEP = 10;

function LevelPips({
  level,
  maxLevel,
  replay,
}: {
  level: number;
  maxLevel: number;
  replay: boolean;
}) {
  const full = level >= maxLevel;
  return (
    <g className="bv-level-pips" transform="translate(-41 31)" data-level={level}>
      {/* 满贯金框:满级加冕记(补给 ×(Lv+1) 到顶/变卖顶价),与珠同锚只包珠行 */}
      {full ? (
        <rect
          className="bv-pips-crown"
          x={-8}
          y={-8}
          width={level * PIP_STEP + 6}
          height={16}
          rx={3}
          fill="none"
          stroke={rgba(Theme.goldBright)}
          strokeWidth={1.3}
        />
      ) : null}
      {Array.from({ length: level }, (_, i) => (
        <circle
          key={i}
          className={i === level - 1 && replay ? "bv-pip bv-pip-grow" : "bv-pip"}
          cx={i * PIP_STEP}
          cy={0}
          r={4.5}
          fill={rgba(Theme.gold)}
          stroke={rgba(Theme.bgDeep, 0.8)}
          strokeWidth={0.8}
        />
      ))}
    </g>
  );
}

// ── X4(#23) 选都候选序号印:壹/贰/叁(引擎滚出顺序=第几候选)──
// 16×16 圆角方 + 笔书大字,描金变体:玄墨底金框金字——与「宝」印同读作
// 「印=特殊标记」;候选期无主无等级,与档位珠同锚点(-41 31)而时段互斥(Setup 期
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
        fontWeight={700}
        fill={rgba(Theme.goldBright)}
      >
        {CANDIDATE_SEAL_CHARS[order]}
      </text>
    </g>
  );
}

// ── #823/#828 特殊城池两字徽标:右上角方印按 event 字段渲染奖励域 ──
// 五类词表(奖励域,非城名):珍宝(拼点探宝)/名将(招贤三选一)/锦囊(落格抽签)/
// 声望(天命 +20)/商市(行情赌局)。旧「宝」单字印升级两字印;印底金族统一
// (goldBright 底+玄墨字,#842 饱和色收敛两通道——区分靠两字文本,不上五色);
// 保留 -6° 手钤角与「印=特殊标记」的读法(与选都候选印同族,配色对偶:
// 候选印玄墨底金字、事件印金底玄墨字)。
// 尺寸:两字印 32×20/单字 11 号(逻辑单位,TILE_SCALE 2.2 屏上单字 ~24px,
// 844×390 实测可读)。锚点 (49,-34):-6° 旋转后底左角 (34,-22.4) 让开右侧木匾
// 顶缘(-22),顶右角 (64,-45.6) 出格顶一线=悬挂印旧观感;旗组 #842 已收回左上,
// 右上角唯此一印不撞木匾(右侧)/王旗(上方)/档位珠(左下)。
// #665/#828 收编导出:印文词表与徽标组件供 test/tile-badge.test.tsx 同源断言
// (词表漂移/普通城无徽标在组件级钉住,不靠 e2e)。
export const TILE_EVENT_BADGES: Record<TileEvent, string> = {
  treasure: "珍宝",
  hero: "名将",
  jinnang: "锦囊",
  fate: "声望",
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
          fontWeight={700}
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

export const Tile = memo(function Tile({ tile, group, maxLevel, state, onClick }: TileProps) {
  // ADR-0015 城池宣告信号:selector 按本城 tileIndex 取记录,他城宣告不触发本城重渲。
  // nonce 单调递增、播完自然过期(无清理定时器);0 = 该维从未宣告,静置。
  const announce = useFxStore((s) => s.announces.get(tile.index));
  const growNonce = announce?.level ?? 0;
  // 易主流光仅在有过易主宣告后渲染(开局铺盘不闪);key=nonce 每次易主重挂重播。
  const ownFlash = announce != null && announce.owner > 0 ? announce : null;
  const isCapital = state.capitalColorIndex != null;
  const ownerRgb = state.ownerColorIndex != null ? playerColor(state.ownerColorIndex) : null;

  const cls = [
    "bv-tile",
    isCapital ? "bv-capital" : "",
    state.isActive ? "bv-active" : "",
    state.isTaken ? "opacity-40 grayscale" : "",
    // X4(#23) 候选集全座位可见:静态低透明金圈;本地可点(bv-selectable)脉冲升级
    state.capitalCandidateOrder != null ? "bv-candidate" : "",
    state.isSelectable ? "bv-selectable" : "",
    // 需求2·无主档:整城 0.92 安静感(城池格专属;isTaken 的 40% 灰阶更强,让位不叠加)
    !ownerRgb && !state.isTaken ? "bv-unowned" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <g
      className={cls}
      id={`tile-${tile.index}`}
      data-tile={tile.index}
      data-name={tile.name}
      transform={`translate(${tile.position.x} ${tile.position.y}) scale(${TILE_SCALE})`}
      onClick={onClick ? () => onClick(tile.index) : undefined}
    >
      {/* 命中高亮底 + 都城/焦点光晕 */}
      <circle className="bv-tile-hilite" r={62} fill={rgba(Theme.gold)} />
      {/* F2:光晕改 radialGradient 圆(BoardDefs 定义,中心亮→边缘 0),去掉常驻 blur(9px)
          滤镜——滤镜在 zoom 时每帧重算,渐变只是普通填充;脉动仍由 board.css 的 opacity
          keyframe 驱动(bv-pulse-glow),视觉节奏不变。 */}
      <circle className="bv-capital-glow" r={70} fill="url(#bv-capital-glow-grad)" />
      {/* #75 活跃格虚线环:独立于都城金晕——虚线环=「轮到谁」(回合所属),
          金晕=「哪是都城」,两语义一眼可分。r=80×2.2≈176 逻辑半径 < 310 行距,
          不碰邻格;虚线沿圆周行进(board.css 用 dashoffset 而非 rotate,
          旋转会改变 AABB 令点选稳定性检查超时)。 */}
      {state.isActive ? (
        <circle
          className="bv-active-ring"
          r={80}
          fill="none"
          stroke={rgba(Theme.goldBright, 0.85)}
          strokeWidth={3}
          strokeDasharray="12 9"
        />
      ) : null}

      {/* 格底(#842 归属色墨化):无主=漆木深卡+漆金细边(低显著);有主(含都城)=
          color-mix(ownerRgb 22%, bgDeep) 墨渍级深染——糖果色整格平涂退役,饱和归属色
          收敛到铭牌底染(NamePlaque)+全饱和描边 3px 两通道,色弱通道仍靠城旗国号
          (DESIGN §5.2 一格一语言;城旗/档位珠/都城光晕全不动)。#826:天命/锦囊/税关
          三族族形分支随功能格五型退役整体删除,一切格子走通用圆角方牌。 */}
      <rect
        className="bv-tile-border"
        x={-52}
        y={-44}
        width={104}
        height={88}
        rx={10}
        fill={ownerRgb ? rgba(mix(Theme.bgDeep, ownerRgb, 0.22)) : rgba(Theme.lacquer, 0.92)}
        fillOpacity={ownerRgb ? 0.94 : 1}
        stroke={
          state.isActive
            ? rgba(Theme.goldBright)
            : ownerRgb
              ? rgba(ownerRgb)
              : rgba(Theme.lacquerGold, 0.5)
        }
        strokeOpacity={ownerRgb ? 0.95 : 0.9}
        strokeWidth={ownerRgb ? 3 : state.isActive ? 3 : 1.5}
      />

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
        {/* 程序化建筑(规格/地域形制变体):等级与归属都不上楼——等级归档位珠、
              归属归铭牌底染(2026-10-17 拷问:重复表达裁单一,楼回归纯规格×地域风味)。 */}
        <Building group={group} />
      </g>
      {/* #96/ADR-0015 易主流光:归属变更(A 破产清算回无主 / 转玩家 B / 变卖给银行)
            时铭牌带闪一道玩家色流光一次(回无主一档无玩家色,用金色——金=既有事件强调
            语言)。宣告 nonce 经事件流下发;key=nonce 每次易主重挂重播,动画播完停在
            基态 opacity 0,平时(开局铺盘/快照恢复,nonce=0)不渲染。 */}
      {ownFlash ? (
        <line
          key={ownFlash.owner}
          className="bv-own-flash"
          x1={-46}
          y1={-39}
          x2={46}
          y2={-39}
          stroke={
            ownFlash.ownerColorIndex != null
              ? rgba(playerColor(ownFlash.ownerColorIndex))
              : rgba(Theme.gold)
          }
          strokeWidth={8}
        />
      ) : null}
      {/* 城名竖排木匾(挂建筑右侧):都城金底墨字 + 流苏,普通城深木底金字 */}
      <NamePlaque name={tile.name} capital={isCapital} ownerRgb={ownerRgb} />
      {/* 档位珠(等级唯一通道,Lv0 无珠)+ 选都候选序号印:同锚不同期——候选期
            无主无等级(Setup 期 Lv 恒 0),两标记互斥不叠印;扩军宣告 nonce 为 key,
            重挂时末珠生长(ADR-0015),平时/快照恢复静置。 */}
      {state.level > 0 ? (
        <LevelPips key={growNonce} level={state.level} maxLevel={maxLevel} replay={growNonce > 0} />
      ) : null}
      {/* X4(#23) 选都候选序号印(铭牌左下,壹/贰/叁):16×16 方章描金变体,
            Setup 期与档位珠时段互斥(候选期无主恒 Lv0 无珠);非决策席位同见
            (仪式感是全座的,可点只在本地)。 */}
      {state.capitalCandidateOrder != null ? (
        <CandidateSeal order={state.capitalCandidateOrder} />
      ) : null}
      {/* 王旗(都城):旗杆 + 旗顶缨 + 玩家色三角(描金边)+ 国号。
            需求2·都城② 旗面加宽至 1.4 倍 + 双层(后层深色衬底)——大旗是 zoom-out 后
            仍可辨的形状级王权信号,不依赖文字/描边细节。
            旗杆基点固定 -40:恰接大档城楼屋脊(城头立旗),旗面高度不变,
            不加重与邻城铭牌的既有避让余量(环游图存在同列 196 的近距上下邻城)。 */}
      {isCapital && state.capitalColorIndex != null ? (
        <g className="bv-tile-flag">
          <line
            x1={0}
            y1={-40}
            x2={0}
            y2={-88}
            stroke={rgba(Theme.goldWash, 0.85)}
            strokeWidth={2}
          />
          {/* 旗杆顶缨:金珠 + 三笔红缨,静态点缀 */}
          <circle cx={0} cy={-89} r={2.2} fill={rgba(Theme.goldBright)} />
          <g stroke={rgba(Theme.danger, 0.8)} strokeWidth={1}>
            <line x1={0} y1={-87} x2={-3} y2={-84} />
            <line x1={0} y1={-87} x2={0} y2={-83} />
            <line x1={0} y1={-87} x2={3} y2={-84} />
          </g>
          {/* 后层深色衬:略大略低一笔,让前层旗面在任何底色上都"浮"出来(玄墨底取 bgDeep) */}
          <polygon points="0,-90 47,-77.5 0,-65" fill={rgba(Theme.bgDeep, 0.65)} />
          <polygon
            points="0,-88 45,-76.5 0,-65"
            fill={rgba(playerColor(state.capitalColorIndex))}
            stroke={rgba(Theme.goldBright)}
            strokeWidth={1.5}
          />
          {/* B3:三角尖端窄,文字锚点从 x=15 右移到形心偏内 x=19,避免国号挤向尖端溢出。
                #512 深底适配:纸色字 + 玄墨描边衬底(paint-order),任意玩家色旗面上都可读 */}
          <text
            x={19}
            y={-74}
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
            五类词表(珍宝/名将/锦囊/声望/商市,印底金族统一)——旧「宝」单字印
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
            线上(下檐尖 ±40,-21),不压箭羽/档位珠(左下)/宝印(右上)/木匾(右侧)。 */}
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
      {/* X4+:选都可点指示——描边金环叠于卡面之上。原仅垫底金盘(hilite r=62),
          被卡片遮挡只露边缘光晕,脉冲谷底 0.18 近乎不可见(用户实测「看不出来
          哪些能选」)。selectable=呼吸描边(与底盘同拍);候选(他席)=静态细环。 */}
      {state.isSelectable ? (
        <rect
          className="bv-pick-ring"
          x={-52}
          y={-44}
          width={104}
          height={88}
          rx={10}
          fill="none"
          stroke={rgba(Theme.goldBright)}
          strokeWidth={3.5}
        />
      ) : state.capitalCandidateOrder != null ? (
        <rect
          className="bv-pick-ring-static"
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
    </g>
  );
});
