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
function Building({ size }: { size: "large" | "medium" | "small" }) {
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
  if (size === "small") {
    // 坡顶小屋 + 门(村落/关隘)
    return (
      <>
        <rect x={-20} y={-4} width={40} height={16} rx={2} fill={wallFill} stroke={wallStroke} strokeWidth={1.5} />
        <polygon points="-24,-4 0,-22 24,-4" fill={roofFill} stroke={roofStroke} strokeWidth={1} />
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
      {crenXs.map((x) => (
        <rect key={x} x={x} y={-11} width={9} height={6} fill={crenFill} />
      ))}
      {arch}
    </>
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
          <Building size={tile.size ?? "medium"} />
          {/* 分组色带(顶部):有持有者→玩家色;无主→区域色 */}
          <rect className="bv-tile-band" x={-46} y={-44} width={92} height={8} rx={2} fill={bandFill} />
          <text
            className="bv-tile-name"
            x={0}
            y={28}
            textAnchor="middle"
            fontFamily="var(--font-deco)"
            fontSize={22}
            fontWeight={700}
            fill={rgba(isCapital ? Theme.goldBright : Theme.ink)}
          >
            {tile.name}
          </text>
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
          {/* 等级 pips:持有者用玩家色,无主金 */}
          <g className="bv-tile-pips">
            {Array.from({ length: state.level }, (_, i) => (
              <circle key={i} cx={-36 + i * 14} cy={16} r={4.5} fill={rgba(ownerRgb ?? Theme.goldBright)} />
            ))}
          </g>
          {/* 王旗(都城):旗杆 + 玩家色三角 + 国号 */}
          {isCapital && state.capitalColorIndex != null ? (
            <g className="bv-tile-flag">
              <line x1={0} y1={-40} x2={0} y2={-88} stroke="rgba(50,35,15,0.8)" strokeWidth={2} />
              <polygon
                points="0,-88 32,-79 0,-70"
                fill={rgba(playerColor(state.capitalColorIndex))}
                stroke="rgba(40,28,10,0.7)"
                strokeWidth={1}
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
