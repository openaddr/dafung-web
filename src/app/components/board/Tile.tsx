// 单座城池(程序化城门建筑)。移植自 src/render/board.ts 的 buildGate / drawBuilding / updateTiles。
// 静态结构(建筑/文字)按 tile 数据声明;状态(归属/都城/等级/焦点)由 props 驱动,
// React.memo 保证仅状态变化的城池重渲。
import { memo } from "react";
import type { TileDef } from "@core/types";
import { Theme, groupColor, playerColor, rgba } from "@core/theme";

/** 玩家色加深(f<1):领地铭牌要"深底白字",直接用原玩家色做底则与描边/旗同明度
 *  缺乏层次,统一乘暗系数得到同色相的深底(zoom-out 后"色块=地盘"仍按色相可辨)。 */
function shade(c: { r: number; g: number; b: number }, f: number) {
  return { r: Math.round(c.r * f), g: Math.round(c.g * f), b: Math.round(c.b * f) };
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
  /** 可交互高亮(如可选都城集合)。 */
  isSelectable: boolean;
}

interface TileProps {
  tile: TileDef;
  group: string; // 地产分组(catalog.get(propertyId).group),区域色带用
  price: string; // formatMoney 后的购入价
  state: TileVisualState;
  onClick?: (index: number) => void;
}

// ── 城池建筑:按规模三档不同形态(重镇堡垒 / 县城城楼 / 村落小屋) ──
// tint:归属玩家色 rgba(约 70% 不透明度)——有主城屋顶瓦面染玩家色,与铭牌描边同色系呼应;
// 无主城保持墨色瓦(tint=null),一眼区分"有主/无主"。

// ── 城楼加层(等级语言·形状通道):层数 = 城池等级 ──
// 旧表现(0-3 面小旌旗沿城墙)总览下旗面趋近不可辨,数旗读级太慢。改为建筑本体生长:
// 城楼上逐层收分加屋面(塔状楼阁),楼越高、越收尖,等级越高——「高低 + 宽窄」双变化
// 是总览即可读的形状信号;精确对级交给铭牌左下的等级印(LevelSeal),满级金顶收束(下)。
//
// 锚定色带上沿(TOWER_BASE)而非各档屋脊:色带是不透明横条、总盖住 -44..-34,
// 自屋脊起叠的话 medium 档首层会整段落进色带背后不可见;锚 -44 让「露出高度」成为
// 直接设计参数,且三档规模共用同一规格——塔形只读作等级,不与规模档位混淆。
// 竖向预算(不得再加高):chessboard 最近上下邻城同列 196,上邻铭牌底 ≈ -118(board),
// 再往上是上邻价格字区(不可压),折算 building-local(都城另有 1.08 抬升)≈ -61.3;
// Lv3 屋脊(-61)+ 刹珠压线即止。总览可读性靠墨色塔身(宣纸底上高对比)+ 底层加宽
// 出剪影质量,而非突破高度。
const TOWER_BASE = -44;
/** 各层屋面:hw = 半宽(逐层收分出塔姿),apex = 屋脊 y(露出 TOWER_BASE 8 / 13 / 17),roofH = 屋面进深。
 *  步高下大上小(8/5/4):总览下「无塔↔首层」差最大(有无判断最敏感),高等级的区分
 *  转由收分骤变(13/8.6/6.5)+ Lv3 金顶承担,不纯靠高度。 */
const STORY_ROOFS = [
  { hw: 13, apex: -52, roofH: 4.5 },
  { hw: 8.6, apex: -57, roofH: 3.6 },
  { hw: 6.5, apex: -61, roofH: 3.2 },
] as const;

interface TowerGeom {
  /** 塔身核心矩形(墨色,藏于各层屋面之后贯通——总览下整塔读作一枝实心墨色剪影)。 */
  core: { x: number; y: number; w: number; h: number };
  /** 各层屋面三角点串(染瓦层复用同串,保证逐点对齐)。 */
  roofs: string[];
  /** 顶层屋脊 y(金顶收束用)。 */
  topApex: number;
}

/** 生成加层几何(层数 = 等级,Lv0 → null 正常态):窄塔身自色带后贯通至顶层檐口,
 *  屋面自下而上逐层收分叠盖其上——上层墙脚沉入下层屋面,无悬浮接缝,读作同一座楼长高。 */
function cityTower(level: number): TowerGeom | null {
  if (level === 0) return null;
  const specs: (typeof STORY_ROOFS)[number][] = [];
  for (let i = 0; i < level; i++) specs.push(STORY_ROOFS[i]); // level > 3 = 配置越界,当场崩出(零兜底)
  const top = specs[level - 1];
  const coreTop = top.apex + top.roofH;
  return {
    // 核心沉至 -39(而非恰贴色带上缘):都城建筑另有 1.08 抬升,-41 会被抬出色带外露悬空缝
    core: { x: -top.hw * 0.75, y: coreTop, w: top.hw * 1.5, h: TOWER_BASE + 5 - coreTop },
    roofs: specs.map(
      ({ hw, apex, roofH }) => `${-hw},${apex + roofH + 0.5} 0,${apex} ${hw},${apex + roofH + 0.5}`,
    ),
    topApex: top.apex,
  };
}

// ── 建筑表现色(集中常量;归属玩家色不在此,由 tint 运行时叠在屋面上) ──
const WALL_FILL = "rgba(232,220,192,0.95)"; // 夯土墙暖白(墙身)
const WALL_STROKE = "rgba(90,70,40,0.5)";
const ROOF_FILL = "rgba(120,60,40,0.85)"; // 墨瓦(各档屋面 + 加层屋面)
const ROOF_STROKE = "rgba(60,30,15,0.6)";
const CREN_FILL = "rgba(90,70,40,0.55)"; // 雉堞
const ARCH_FILL = "rgba(90,65,32,0.5)"; // 门洞

function Building({ size, level, tint }: { size: "large" | "medium" | "small"; level: number; tint?: string | null }) {
  const crenXs =
    size === "large"
      ? [-40, -23, -6, 11, 28]
      : size === "medium"
        ? [-34, -20, -6, 8]
        : [];
  const arch = (
    <path d="M -8,12 L -8,2 Q -8,-1 0,-1 Q 8,-1 8,2 L 8,12 Z" fill={ARCH_FILL} />
  );
  // 加层(层数=等级)+ 满级金顶收束:顶层屋面金填 + 屋脊刹珠。
  // 金只收在楼顶一处、全静态——脉动金环/金台座是都城的既有语言(环形/座形,位置互斥),
  // 不与之争;乘法城棋盘上无专属造型,金顶不会与之混淆。
  const tower = cityTower(level);
  const storyEls = tower ? (
    <>
      <rect
        className="bv-city-core"
        x={tower.core.x}
        y={tower.core.y}
        width={tower.core.w}
        height={tower.core.h}
        fill={ROOF_FILL}
        stroke={ROOF_STROKE}
        strokeWidth={1}
      />
      {tower.roofs.map((pts, i) => (
        <polygon key={i} className="bv-city-story" points={pts} fill={ROOF_FILL} stroke={ROOF_STROKE} strokeWidth={1} />
      ))}
    </>
  ) : null;
  const finial =
    tower && level >= STORY_ROOFS.length ? (
      <g className="bv-city-finial">
        <polygon points={tower.roofs[level - 1]} fill={rgba(Theme.goldBright, 0.96)} stroke="rgba(60,30,15,0.65)" strokeWidth={1.6} />
        <circle cx={0} cy={tower.topApex + 1.8} r={2.4} fill={rgba(Theme.goldBright)} stroke="rgba(60,30,15,0.7)" strokeWidth={0.7} />
      </g>
    ) : null;
  // 各档屋面轮廓(供染瓦叠加用):染层直接复用底稿 path,保证形状逐点对齐;
  // 加层屋面一并入列——玩家色染瓦须盖住整座楼(含加层),归属色不断层。
  const roofShapes: string[] = [
    ...(size === "large"
      ? ["-54,-22 -43.5,-32 -33,-22", "33,-22 43.5,-32 54,-22", "-20,-24 0,-38 20,-24"]
      : size === "medium"
        ? ["-16,-22 0,-34 16,-22"]
        : ["-24,-4 0,-22 24,-4"]),
    ...(tower ? tower.roofs : []),
  ];
  const roofTint = tint ? (
    <g className="bv-roof-tint">
      {roofShapes.map((pts, i) => (
        <polygon key={i} points={pts} fill={tint} />
      ))}
    </g>
  ) : null;
  if (size === "small") {
    // 坡顶小屋 + 门(村落/关隘);加层自色带上沿起叠(低房 + 高塔,读作塔楼踞墙后)
    return (
      <>
        <rect x={-20} y={-4} width={40} height={16} rx={2} fill={WALL_FILL} stroke={WALL_STROKE} strokeWidth={1.5} />
        <polygon points="-24,-4 0,-22 24,-4" fill={ROOF_FILL} stroke={ROOF_STROKE} strokeWidth={1} />
        {storyEls}
        {roofTint}
        {finial}
        <rect x={-5} y={2} width={10} height={10} fill={ARCH_FILL} />
      </>
    );
  }
  if (size === "medium") {
    return (
      <>
        <rect x={-40} y={-6} width={80} height={18} rx={3} fill={WALL_FILL} stroke={WALL_STROKE} strokeWidth={1.5} />
        <rect x={-13} y={-22} width={26} height={28} rx={2} fill={WALL_FILL} stroke={WALL_STROKE} strokeWidth={1.5} />
        <polygon points="-16,-22 0,-34 16,-22" fill={ROOF_FILL} stroke={ROOF_STROKE} strokeWidth={1} />
        {storyEls}
        {roofTint}
        {finial}
        {crenXs.map((x) => (
          <rect key={x} x={x} y={-11} width={9} height={6} fill={CREN_FILL} />
        ))}
        {arch}
      </>
    );
  }
  // large:宽城墙 + 左右角楼 + 中央高城楼 + 歇山顶(重镇/州治)
  return (
    <>
      <rect x={-48} y={-6} width={96} height={18} rx={3} fill={WALL_FILL} stroke={WALL_STROKE} strokeWidth={1.5} />
      <rect x={-52} y={-22} width={17} height={34} rx={2} fill={WALL_FILL} stroke={WALL_STROKE} strokeWidth={1.5} />
      <rect x={35} y={-22} width={17} height={34} rx={2} fill={WALL_FILL} stroke={WALL_STROKE} strokeWidth={1.5} />
      <polygon points="-54,-22 -43.5,-32 -33,-22" fill={ROOF_FILL} stroke={ROOF_STROKE} strokeWidth={1} />
      <polygon points="33,-22 43.5,-32 54,-22" fill={ROOF_FILL} stroke={ROOF_STROKE} strokeWidth={1} />
      <rect x={-16} y={-24} width={32} height={30} rx={2} fill={WALL_FILL} stroke={WALL_STROKE} strokeWidth={1.5} />
      <polygon points="-20,-24 0,-38 20,-24" fill={ROOF_FILL} stroke={ROOF_STROKE} strokeWidth={1} />
      {storyEls}
      {roofTint}
      {finial}
      {crenXs.map((x) => (
        <rect key={x} x={x} y={-11} width={9} height={6} fill={CREN_FILL} />
      ))}
      {arch}
    </>
  );
}

// ── #25/#39 城池全局放大比例 ──
// 旗/匾/印/价格签等所有元素随 <g> 整体 scale(等比,视觉口径统一;点击热区与
// hover 重排随 SVG transform 同步放大,无需另调)。
// 屏幕上的净大小 = TILE_SCALE / 画布放大倍数(1.4x):要净 +40% 就必须 1.4×1.4≈1.96
// (首版 1.55 的失误正在于此:净效果仅 1.55/1.4≈+11%,肉眼不可辨)。
// 压盖校验:铭牌外缘 ~104×1.96≈204 < 城池最小间距 238(chessboard 网格步距)。
const TILE_SCALE = 1.96;

// ── 竖排木匾城名 ──
// 局部常量:深木底 + 暖金边/铆钉,集中在此便于整体调色。
const PLANK_FILL = "#3a2a1a";
const PLANK_EDGE = "rgba(212,175,105,0.9)";

/**
 * 竖排木匾(挂建筑右侧):深木底 + 1px 金边 + 顶部两枚铆钉;都城匾加宽 + 金底墨字 + 底部两缕流苏。
 * 方案取舍:选"逐字纵排"而非 SVG writing-mode(后者 Firefox/Safari 对 tb 支持参差,逐字定位最稳)。
 *
 * 两级可读设计(B1):总览(FIT_VIEW 2300 宽 → ~1000px 容器,缩放系数 ≈0.43)下
 * 任何城名字都只有 ~6-8px——总览不指望读字,靠「色带=区域色相 / 旗形=归属」的形状层辨认
 * (viewBox 是命令式更新、不触发 React 渲染,Tile 感知不到 zoom,做不了真 LOD 切换);
 * 放大后才进入「读字」层级,此时满字号应 ≥13px 等效红线:
 * large 17(×1)、medium 18(×0.9=16.2)、small 20(×0.8=16)——小城字号下限抬高补回缩放损失。
 */
function NamePlaque({ name, capital, size }: { name: string; capital: boolean; size: "large" | "medium" | "small" }) {
  const chars = [...name].slice(0, 3); // 城名 2-3 字
  const w = capital ? 34 : 26;
  const fs = size === "small" ? 20 : size === "medium" ? 18 : 17;
  const step = fs + 3; // B5:字距留缝(17→20),三字匾整体高度随之 +6
  const h = chars.length * step + 12;
  const x = 40 - w / 2; // 匾中心 x=40(建筑右侧、铭牌内),不与色带/王旗/小旌旗重叠
  const y0 = -22;
  return (
    <g className="bv-tile-plaque">
      <rect
        x={x}
        y={y0}
        width={w}
        height={h}
        rx={3}
        fill={capital ? rgba(Theme.goldBright, 0.95) : PLANK_FILL}
        stroke={PLANK_EDGE}
        strokeWidth={1}
      />
      {/* 顶部两枚铆钉圆点(固定匾额的钉帽,细节让 zoom-out 后仍是"色块有细节") */}
      <circle cx={x + 5} cy={y0 + 5} r={1.6} fill={PLANK_EDGE} />
      <circle cx={x + w - 5} cy={y0 + 5} r={1.6} fill={PLANK_EDGE} />
      {chars.map((c, i) => (
        <text
          key={i}
          x={40}
          y={y0 + 15 + i * step}
          textAnchor="middle"
          fontFamily="var(--font-deco)"
          fontSize={fs}
          fontWeight={700}
          fill={capital ? rgba(Theme.ink) : "rgba(238,210,140,0.96)"}
        >
          {c}
        </text>
      ))}
      {/* 都城匾底部两缕流苏(曲线收尖),与王旗描金同调 */}
      {capital ? (
        <>
          <path d={`M ${x + 11} ${y0 + h} q -3 5 -2 9 l 2.5 3 z`} fill={PLANK_EDGE} />
          <path d={`M ${x + w - 11} ${y0 + h} q 3 5 2 9 l -2.5 3 z`} fill={PLANK_EDGE} />
        </>
      ) : null}
    </g>
  );
}

// ── 等级印(铭牌左下小方章):大写数字壹/贰/叁,Lv0 无印 ──
// 精确读级通道(形状通道 = Building 城楼加层)。有主铭牌是深玩家色底,亮纸方章总览即
// 一粒浅色方点(有/无 = 扩没扩军),放大后读数字对级;与都城「都」印(右上、朱底金字)
// 位置与配色互斥不撞车。纸底墨字取无主宣纸铭牌同色系——等级印只在有主(Lv≥1 必有主)
// 城上出现,不落在宣纸底上。
const LEVEL_SEAL_CHARS = ["", "壹", "贰", "叁"] as const;

function LevelSeal({ level }: { level: number }) {
  return (
    <g className="bv-level-seal" transform="translate(-41 31)">
      <rect
        x={-8}
        y={-8}
        width={16}
        height={16}
        rx={2}
        fill={rgba(Theme.paperHi, 0.96)}
        stroke="rgba(60,45,20,0.5)"
        strokeWidth={1}
      />
      <text
        y={4.2}
        textAnchor="middle"
        fontFamily="var(--font-brush)"
        fontSize={12}
        fontWeight={700}
        fill={rgba(Theme.ink)}
      >
        {LEVEL_SEAL_CHARS[level]}
      </text>
    </g>
  );
}

/** 非城池格(锦囊/天命/税关/商市/卧龙岗)的大字 icon 配色。 */
const ICON_THEME: Partial<Record<TileDef["type"], { color: string; icon: string }>> = {
  Wolong: { color: "goldBright", icon: "龙" },
  Chance: { color: "goldBright", icon: "吉" },
  Fate: { color: "danger", icon: "凶" },
  Tax: { color: "danger", icon: "税" },
  Stock: { color: "money", icon: "市" },
};

export const Tile = memo(function Tile({ tile, group, price, state, onClick }: TileProps) {
  const sizeScale = tile.size === "small" ? 0.8 : tile.size === "medium" ? 0.9 : 1;
  const isCapital = state.capitalColorIndex != null;
  const isIconTile = tile.type in ICON_THEME;
  const ownerRgb = state.ownerColorIndex != null ? playerColor(state.ownerColorIndex) : null;
  const bandFill = ownerRgb
    ? rgba(ownerRgb)
    : tile.propertyId
      ? rgba(groupColor(group))
      : isIconTile
        ? rgba(Theme[ICON_THEME[tile.type]!.color as "goldBright" | "danger" | "money"])
        : "rgba(140,110,60,0.5)";

  const cls = [
    "bv-tile",
    isCapital ? "bv-capital" : "",
    state.isActive ? "bv-active" : "",
    state.isTaken ? "opacity-40 grayscale" : "",
    state.isSelectable ? "bv-selectable" : "",
    // 需求2·无主档:整城 0.92 安静感(城池格专属;isTaken 的 40% 灰阶更强,让位不叠加)
    !ownerRgb && !state.isTaken && !isIconTile ? "bv-unowned" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <g
      className={cls}
      id={`tile-${tile.index}`}
      data-tile={tile.index}
      data-name={tile.name}
      transform={`translate(${tile.position.x} ${tile.position.y}) scale(${sizeScale * TILE_SCALE})`}
      onClick={onClick ? () => onClick(tile.index) : undefined}
    >
      {/* 命中高亮底 + 都城/焦点光晕 */}
      <circle className="bv-tile-hilite" r={62} fill={rgba(Theme.gold)} />
      {/* F2:光晕改 radialGradient 圆(BoardDefs 定义,中心亮→边缘 0),去掉常驻 blur(9px)
          滤镜——滤镜在 zoom 时每帧重算,渐变只是普通填充;脉动仍由 board.css 的 opacity
          keyframe 驱动(bv-pulse-glow),视觉节奏不变。 */}
      <circle className="bv-capital-glow" r={70} fill="url(#bv-capital-glow-grad)" />

      {/* 铭牌底(需求2 三档):无主=宣纸底淡墨边(低显著);有主(含都城)=深玩家色整块
          染底 ≥85% 不透明——zoom-out 扫描时"色块=地盘"按色相即读,不依赖细节。 */}
      <rect
        className="bv-tile-border"
        x={-52}
        y={-44}
        width={104}
        height={88}
        rx={10}
        fill={ownerRgb ? rgba(shade(ownerRgb, 0.58), 0.92) : "rgba(247,236,208,0.92)"}
        fillOpacity={ownerRgb ? 0.92 : 1}
        stroke={
          state.isActive
            ? rgba(Theme.goldBright)
            : ownerRgb
              ? rgba(ownerRgb)
              : "rgba(60,45,20,0.25)"
        }
        strokeOpacity={ownerRgb ? 0.95 : 0.5}
        strokeWidth={ownerRgb ? 4 : 2.5}
      />

      {isIconTile ? (
        <>
          <rect className="bv-tile-band" x={-46} y={-44} width={92} height={10} rx={2} fill={bandFill} stroke="rgba(40,28,12,0.45)" strokeWidth={1} />
          {/* 类型点缀物(静态 path,无动画):每种格一两笔剪影,克制不喧宾。
              珍宝格的宝/囊/伏图标在 StaticLayers 辅路格上,此处不重复画。 */}
          {tile.type === "Stock" ? (
            // 商市:大字两侧挂一对红灯笼(圆 + 穗),暖色点缀商业氛围
            [-34, 34].map((lx) => (
              <g key={lx}>
                <line x1={lx} y1={-36} x2={lx} y2={-4} stroke="rgba(50,35,15,0.7)" strokeWidth={1} />
                <ellipse cx={lx} cy={4} rx={6} ry={8} fill="rgba(178,44,34,0.92)" stroke="rgba(120,20,15,0.7)" strokeWidth={1} />
                <line x1={lx} y1={12} x2={lx} y2={18} stroke="rgba(200,60,40,0.8)" strokeWidth={1} />
                <line x1={lx - 2} y1={12} x2={lx - 3} y2={17} stroke="rgba(200,60,40,0.6)" strokeWidth={0.8} />
                <line x1={lx + 2} y1={12} x2={lx + 3} y2={17} stroke="rgba(200,60,40,0.6)" strokeWidth={0.8} />
              </g>
            ))
          ) : null}
          {tile.type === "Chance" ? (
            // 锦囊:大字下方一具横卷轴(轴身 + 两端轴杆),陪衬"吉"字
            <g>
              <rect x={-13} y={32} width={26} height={7} rx={2} fill="rgba(240,224,180,0.9)" stroke="rgba(120,86,45,0.8)" strokeWidth={0.8} />
              <rect x={-17} y={30.5} width={4} height={10} rx={1.5} fill="rgba(150,110,60,0.9)" />
              <rect x={13} y={30.5} width={4} height={10} rx={1.5} fill="rgba(150,110,60,0.9)" />
            </g>
          ) : null}
          {tile.type === "Fate" ? (
            // 天命:大字下两三笔云纹弧线托底,呼应"天意"意象
            <g fill="none" stroke="rgba(90,70,50,0.55)" strokeWidth={1.2}>
              <path d="M -24 34 q 7 -7 14 0 q 7 7 14 0 q 7 -7 14 0" />
              <path d="M -10 41 q 7 -6 14 0" />
            </g>
          ) : null}
          <text
            x={0}
            y={22}
            textAnchor="middle"
            fontFamily="var(--font-brush)"
            fontSize={48}
            fontWeight={700}
            fill={rgba(Theme[ICON_THEME[tile.type]!.color as "goldBright" | "danger" | "money"])}
          >
            {ICON_THEME[tile.type]!.icon}
          </text>
          <text
            className="bv-tile-name"
            x={0}
            y={-16}
            textAnchor="middle"
            fontFamily="var(--font-deco)"
            fontSize={16}
            fill={rgba(Theme.inkDim)}
          >
            {tile.name}
          </text>
        </>
      ) : (
        <>
          {/* 需求2·都城① 金色城台底座:建筑脚下两层 rect(暗金座身+亮金座面,模拟上下渐变)。
              不用 linearGradient:defs 在 StaticLayers(独占勿动),每城内联 defs 会产生重复 id 冲突。 */}
          {isCapital ? (
            <g className="bv-capital-pedestal">
              <rect x={-62} y={9} width={124} height={12} rx={2} fill="rgba(178,140,50,0.6)" stroke="rgba(50,35,15,0.8)" strokeWidth={1.5} />
              <rect x={-62} y={9} width={124} height={5.5} rx={2} fill="rgba(212,175,55,0.9)" />
            </g>
          ) : null}
          {/* 需求2·都城④ 建筑整体 scale 1.08:以城脚(y=12)为锚,只向上长高="微抬升",
              不踩进底座;无主/领地保持原尺度。 */}
          <g transform={isCapital ? "translate(0 12) scale(1.08) translate(0 -12)" : undefined}>
            {/* 有主城染瓦:玩家色 70% 叠在屋面上(含加层屋面),与铭牌描边/色带同源(沿用 playerColor props,无新通道) */}
            <Building size={tile.size ?? "medium"} level={state.level} tint={ownerRgb ? rgba(ownerRgb, 0.7) : null} />
            {/* 军事重镇(large 档):左角楼顶烽火台剪影(小梯形)+ 一缕淡墨烟 */}
            {tile.size === "large" ? (
              <g>
                <polygon points="-47,-31 -40,-31 -41.5,-39 -45.5,-39" fill="rgba(70,52,30,0.85)" />
                <path d="M -43.5 -40 q 3 -4 1 -8 q -2 -3 1 -6" fill="none" stroke="rgba(90,80,70,0.5)" strokeWidth={1.2} />
              </g>
            ) : null}
          </g>
          {/* 分组色带(顶部):有持有者→玩家色;无主→区域色。
              B1 两级设计:总览读不了字,色带是"形状层"信号——加高一档并描深边,
              让远看时色带在宣纸/铭牌底上仍有清晰的色块轮廓可辨。 */}
          <rect
            className="bv-tile-band"
            x={-46}
            y={-44}
            width={92}
            height={10}
            rx={2}
            fill={bandFill}
            stroke="rgba(40,28,12,0.45)"
            strokeWidth={1}
          />
          {/* 城名竖排木匾(挂建筑右侧):都城金底墨字 + 流苏,普通城深木底金字 */}
          <NamePlaque name={tile.name} capital={isCapital} size={tile.size ?? "medium"} />
          {/* 价格字:有主城铭牌已是深玩家色底,墨字不可读→白字;无主宣纸底保持墨字 */}
          <text
            x={0}
            y={42}
            textAnchor="middle"
            fontFamily="var(--font-deco)"
            fontSize={14}
            fill={ownerRgb ? "rgba(255,252,240,0.95)" : rgba(Theme.inkDim)}
          >
            {price}
          </text>
          {/* 等级=城楼加层(Building 内,层数即等级)+ 等级印(铭牌左下,壹/贰/叁,Lv0 无印)。
              双通道:形状(高低)总览可读,印章放大后精确对级;替换旧的 0-3 面旌旗(总览不可辨,已删)。 */}
          {state.level > 0 ? <LevelSeal level={state.level} /> : null}
          {/* 王旗(都城):旗杆 + 旗顶缨 + 玩家色三角(描金边)+ 国号。
              需求2·都城② 旗面加宽至 1.4 倍 + 双层(后层深色衬底)——大旗是 zoom-out 后
              仍可辨的形状级王权信号,不依赖文字/描边细节。
              旗杆基点固定 -40:城楼加层长高后旗杆「立于楼中」(城头立旗),旗面高度不变,
              不加重与邻城铭牌的既有避让余量(chessboard 存在同列 196 的近距上下邻城)。 */}
          {isCapital && state.capitalColorIndex != null ? (
            <g className="bv-tile-flag">
              <line x1={0} y1={-40} x2={0} y2={-88} stroke="rgba(50,35,15,0.8)" strokeWidth={2} />
              {/* 旗杆顶缨:金珠 + 三笔红缨,静态点缀 */}
              <circle cx={0} cy={-89} r={2.2} fill={rgba(Theme.goldBright)} />
              <g stroke="rgba(178,44,34,0.85)" strokeWidth={1}>
                <line x1={0} y1={-87} x2={-3} y2={-84} />
                <line x1={0} y1={-87} x2={0} y2={-83} />
                <line x1={0} y1={-87} x2={3} y2={-84} />
              </g>
              {/* 后层深色衬:略大略低一笔,让前层旗面在任何底色上都"浮"出来 */}
              <polygon points="0,-90 47,-77.5 0,-65" fill="rgba(35,25,12,0.6)" />
              <polygon
                points="0,-88 45,-76.5 0,-65"
                fill={rgba(playerColor(state.capitalColorIndex))}
                stroke={rgba(Theme.goldBright)}
                strokeWidth={1.5}
              />
              {/* B3:三角尖端窄,文字锚点从 x=15 右移到形心偏内 x=19,避免国号挤向尖端溢出 */}
              <text
                x={19}
                y={-74}
                textAnchor="middle"
                fontFamily="var(--font-brush)"
                fontSize={17}
                fill="#fff"
              >
                {state.capitalGuohao}
              </text>
            </g>
          ) : null}
          {/* 需求2·都城③ 朱底金字方印「都」:右上角、旋转 -6°(手钤印的随意感)、金边框;
              B4:14→20——总览(≈0.43 系数)下 14px 印已趋不可见,放大到 20 让远距仍是一粒
              可辨的朱红方点;与领地区分"这是都城"的第二冗余信号(王旗之外印也认得)。 */}
          {isCapital ? (
            <g className="bv-capital-seal" transform="translate(49 -33) rotate(-6)">
              <rect x={-10} y={-10} width={20} height={20} rx={2} fill={rgba(Theme.danger)} stroke={rgba(Theme.goldBright)} strokeWidth={1.4} />
              <text x={0} y={5} textAnchor="middle" fontFamily="var(--font-brush)" fontSize={14} fontWeight={700} fill={rgba(Theme.goldBright)}>
                都
              </text>
            </g>
          ) : null}
          {/* B2 三旗语法分化:持有者城旗改「燕尾旗」(矩形 + 飞端 V 形缺口)——
              与棋子的三角旗(人)、王旗的双层大三角(都)三形互斥,远看旗形即分类;
              深描边压住轮廓,保证浅色玩家色旗面在宣纸上也可辨。 */}
          {!isCapital && ownerRgb ? (
            <g className="bv-tile-owner-flag">
              <line x1={40} y1={-28} x2={40} y2={-50} stroke="rgba(50,35,15,0.8)" strokeWidth={1.5} />
              <polygon
                points="40,-50 62,-50 55,-45 62,-40 40,-40"
                fill={rgba(ownerRgb)}
                stroke="rgba(40,28,12,0.55)"
                strokeWidth={1}
              />
              <text
                x={50}
                y={-41.5}
                textAnchor="middle"
                fontFamily="var(--font-brush)"
                fontSize={10.5}
                fill="#fff"
              >
                {state.ownerGuohao}
              </text>
            </g>
          ) : null}
        </>
      )}
    </g>
  );
});
