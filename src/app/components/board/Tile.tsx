// 单座城池(程序化城门建筑)。移植自 src/render/board.ts 的 buildGate / drawBuilding / updateTiles。
// 静态结构(建筑/文字)按 tile 数据声明;状态(归属/都城/等级/焦点)由 props 驱动,
// React.memo 保证仅状态变化的城池重渲。
import { memo } from "react";
import type { TileDef } from "@core/types";
import { Theme, groupColor, playerColor, rgba } from "@core/theme";

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
function Building({ size, tint }: { size: "large" | "medium" | "small"; tint?: string | null }) {
  const wallFill = "rgba(232,220,192,0.95)";
  const wallStroke = "rgba(90,70,40,0.5)";
  const roofFill = "rgba(120,60,40,0.85)";
  const roofStroke = "rgba(60,30,15,0.6)";
  const crenFill = "rgba(90,70,40,0.55)";
  const archFill = "rgba(90,65,32,0.5)";
  const crenXs =
    size === "large"
      ? [-40, -23, -6, 11, 28]
      : size === "medium"
        ? [-34, -20, -6, 8]
        : [];
  const arch = (
    <path d="M -8,12 L -8,2 Q -8,-1 0,-1 Q 8,-1 8,2 L 8,12 Z" fill={archFill} />
  );
  // 各档屋面轮廓(供染瓦叠加用):染层直接复用底稿 path,保证形状逐点对齐
  const roofShapes: string[] =
    size === "large"
      ? ["-54,-22 -43.5,-32 -33,-22", "33,-22 43.5,-32 54,-22", "-20,-24 0,-38 20,-24"]
      : size === "medium"
        ? ["-16,-22 0,-34 16,-22"]
        : ["-24,-4 0,-22 24,-4"];
  const roofTint = tint ? (
    <g className="bv-roof-tint">
      {roofShapes.map((pts, i) => (
        <polygon key={i} points={pts} fill={tint} />
      ))}
    </g>
  ) : null;
  if (size === "small") {
    // 坡顶小屋 + 门(村落/关隘)
    return (
      <>
        <rect x={-20} y={-4} width={40} height={16} rx={2} fill={wallFill} stroke={wallStroke} strokeWidth={1.5} />
        <polygon points="-24,-4 0,-22 24,-4" fill={roofFill} stroke={roofStroke} strokeWidth={1} />
        {roofTint}
        <rect x={-5} y={2} width={10} height={10} fill={archFill} />
      </>
    );
  }
  if (size === "medium") {
    return (
      <>
        <rect x={-40} y={-6} width={80} height={18} rx={3} fill={wallFill} stroke={wallStroke} strokeWidth={1.5} />
        <rect x={-13} y={-22} width={26} height={28} rx={2} fill={wallFill} stroke={wallStroke} strokeWidth={1.5} />
        <polygon points="-16,-22 0,-34 16,-22" fill={roofFill} stroke={roofStroke} strokeWidth={1} />
        {roofTint}
        {crenXs.map((x) => (
          <rect key={x} x={x} y={-11} width={9} height={6} fill={crenFill} />
        ))}
        {arch}
      </>
    );
  }
  // large:宽城墙 + 左右角楼 + 中央高城楼 + 歇山顶(重镇/州治)
  return (
    <>
      <rect x={-48} y={-6} width={96} height={18} rx={3} fill={wallFill} stroke={wallStroke} strokeWidth={1.5} />
      <rect x={-52} y={-22} width={17} height={34} rx={2} fill={wallFill} stroke={wallStroke} strokeWidth={1.5} />
      <rect x={35} y={-22} width={17} height={34} rx={2} fill={wallFill} stroke={wallStroke} strokeWidth={1.5} />
      <polygon points="-54,-22 -43.5,-32 -33,-22" fill={roofFill} stroke={roofStroke} strokeWidth={1} />
      <polygon points="33,-22 43.5,-32 54,-22" fill={roofFill} stroke={roofStroke} strokeWidth={1} />
      <rect x={-16} y={-24} width={32} height={30} rx={2} fill={wallFill} stroke={wallStroke} strokeWidth={1.5} />
      <polygon points="-20,-24 0,-38 20,-24" fill={roofFill} stroke={roofStroke} strokeWidth={1} />
      {roofTint}
      {crenXs.map((x) => (
        <rect key={x} x={x} y={-11} width={9} height={6} fill={crenFill} />
      ))}
      {arch}
    </>
  );
}

// ── 竖排木匾城名 ──
// 局部常量:深木底 + 暖金边/铆钉,集中在此便于整体调色。
const PLANK_FILL = "#3a2a1a";
const PLANK_EDGE = "rgba(212,175,105,0.9)";

/**
 * 竖排木匾(挂建筑右侧):深木底 + 1px 金边 + 顶部两枚铆钉;都城匾加宽 + 金底墨字 + 底部两缕流苏。
 * 方案取舍:选"逐字纵排"而非 SVG writing-mode(后者 Firefox/Safari 对 tb 支持参差,逐字定位最稳)。
 * 可读性:字号 17,最小城(整城 scale 0.8)缩放后仍 ≈13.6px,满足 ≥13px 等效可读红线,故不必退回横排。
 */
function NamePlaque({ name, capital }: { name: string; capital: boolean }) {
  const chars = [...name].slice(0, 3); // 城名 2-3 字
  const w = capital ? 34 : 26;
  const step = 18;
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
          fontSize={17}
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

/** 等级旌旗插位:沿城墙横向排布(避开中央城楼/右侧木匾),按建筑档位给 3 个槽。 */
const LEVEL_FLAG_XS: Record<"large" | "medium" | "small", number[]> = {
  large: [-36, -24, -12],
  medium: [-34, -22, -10],
  small: [-14, -3, 8],
};

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
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <g
      className={cls}
      id={`tile-${tile.index}`}
      data-tile={tile.index}
      data-name={tile.name}
      transform={`translate(${tile.position.x} ${tile.position.y}) scale(${sizeScale})`}
      onClick={onClick ? () => onClick(tile.index) : undefined}
    >
      {/* 命中高亮底 + 都城/焦点光晕 */}
      <circle className="bv-tile-hilite" r={62} fill={rgba(Theme.gold)} />
      <circle className="bv-capital-glow" r={70} fill={rgba(Theme.goldBright)} style={{ filter: "blur(9px)" }} />

      {/* 持有者铭牌边框(玩家色 + 加粗 + 淡底;焦点城金环由 .bv-active 样式覆盖 stroke) */}
      <rect
        className="bv-tile-border"
        x={-52}
        y={-44}
        width={104}
        height={88}
        rx={10}
        fill={ownerRgb ? rgba(ownerRgb) : "rgba(247,236,208,0.92)"}
        fillOpacity={ownerRgb ? 0.12 : 1}
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
          <rect className="bv-tile-band" x={-46} y={-44} width={92} height={8} rx={2} fill={bandFill} />
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
          {/* 有主城染瓦:玩家色 70% 叠在屋面上,与铭牌描边/色带同源(沿用 playerColor props,无新通道) */}
          <Building size={tile.size ?? "medium"} tint={ownerRgb ? rgba(ownerRgb, 0.7) : null} />
          {/* 军事重镇(large 档):左角楼顶烽火台剪影(小梯形)+ 一缕淡墨烟 */}
          {tile.size === "large" ? (
            <g>
              <polygon points="-47,-31 -40,-31 -41.5,-39 -45.5,-39" fill="rgba(70,52,30,0.85)" />
              <path d="M -43.5 -40 q 3 -4 1 -8 q -2 -3 1 -6" fill="none" stroke="rgba(90,80,70,0.5)" strokeWidth={1.2} />
            </g>
          ) : null}
          {/* 分组色带(顶部):有持有者→玩家色;无主→区域色 */}
          <rect className="bv-tile-band" x={-46} y={-44} width={92} height={8} rx={2} fill={bandFill} />
          {/* 城名竖排木匾(挂建筑右侧):都城金底墨字 + 流苏,普通城深木底金字 */}
          <NamePlaque name={tile.name} capital={isCapital} />
          <text
            x={0}
            y={42}
            textAnchor="middle"
            fontFamily="var(--font-deco)"
            fontSize={14}
            fill={rgba(Theme.inkDim)}
          >
            {price}
          </text>
          {/* 等级=城上旌旗(1-3 面沿城墙):持有者玩家色;满级(3)旗面描金。
              旧 pips 小圆点在 zoom-out 后信息量趋零,旗形轮廓仍是清晰色块,故整体替换不留旧实现。 */}
          <g className="bv-tile-pips">
            {LEVEL_FLAG_XS[tile.size ?? "medium"]
              .slice(0, Math.min(state.level, 3))
              .map((fx, i) => (
                <g key={i}>
                  <line x1={fx} y1={-12} x2={fx} y2={-24} stroke="rgba(50,35,15,0.8)" strokeWidth={1.5} />
                  <polygon
                    points={`${fx},-24 ${fx + 12},-20 ${fx},-16`}
                    fill={rgba(ownerRgb ?? Theme.ink)}
                    stroke={state.level >= 3 ? rgba(Theme.goldBright) : "rgba(40,28,10,0.6)"}
                    strokeWidth={state.level >= 3 ? 1.2 : 0.8}
                  />
                </g>
              ))}
          </g>
          {/* 王旗(都城):旗杆 + 旗顶缨 + 玩家色三角(描金边)+ 国号 */}
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
              <polygon
                points="0,-88 32,-79 0,-70"
                fill={rgba(playerColor(state.capitalColorIndex))}
                stroke={rgba(Theme.goldBright)}
                strokeWidth={1.5}
              />
              <text
                x={11}
                y={-77}
                textAnchor="middle"
                fontFamily="var(--font-brush)"
                fontSize={16}
                fill="#fff"
              >
                {state.capitalGuohao}
              </text>
            </g>
          ) : null}
          {/* 持有者小旌旗(非都城持有城):右上小三角 + 国号 */}
          {!isCapital && ownerRgb ? (
            <g className="bv-tile-owner-flag">
              <line x1={40} y1={-28} x2={40} y2={-50} stroke="rgba(50,35,15,0.8)" strokeWidth={1.5} />
              <polygon points="40,-50 58,-45 40,-40" fill={rgba(ownerRgb)} />
              <text
                x={49}
                y={-42}
                textAnchor="middle"
                fontFamily="var(--font-brush)"
                fontSize={11}
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
