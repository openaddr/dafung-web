// 棋子层(旌旗):props 驱动声明式定位 + CSS transform 过渡。
// 移植自 src/render/board.ts 的 buildToken / updateTokens / setTokenPosition。
//
// ── 阶段 6 动画挂点 ──
// 1) 每个棋子 <g data-token-player={playerId}>:动画层可用
//      svgRef.current.querySelector('[data-token-player="p1"]')
//    拿到原生节点,直接改 style.transform(transition 已由 .bv-token 提供)做逐段行军。
// 2) props.skipTokenIds:行军动画接管中的玩家从此层的声明式定位中剔除
//    (等价旧 updateTokens(engine, skipPlayerId)),避免 React 重渲把棋子拽回终点;
//    动画结束后从集合移除该 id,React 会以终态坐标接管。
// 3) props.layerRef:暴露棋子层 <g> 本体,便于批量查(如遍历所有棋子 z 序重排)。
import { memo } from "react";
import type { Board } from "@core/board";
import type { BoardPos, Player } from "@core/types";
import { playerColor, rgba } from "@core/theme";
import { TOKEN_SLOT_OFFSETS } from "@core/constants";
import { marchPos } from "@app/fx/useMarch";

/** 玩家所在的「格子槽位键」:与 src/render/board.ts 的 playerSlotKey 逻辑一致
 *  (辅路按 step 分组,主路按 position)。两端必须共用同一规则,否则落格偏移先错后纠、可见抖动。 */
export function playerSlotKey(p: Pick<Player, "position" | "onBranch">, board: Board): string {
  return p.onBranch != null && board.branch ? `b${p.onBranch.step}` : String(p.position);
}

/** 玩家当前渲染坐标(辅路上则取辅路格坐标)。 */
export function tokenRenderPos(p: Player, board: Board): BoardPos {
  if (p.onBranch != null && board.branch) {
    return board.branch.cells[p.onBranch.step]?.position ?? board.positionOf(p.position);
  }
  return board.positionOf(p.position);
}

export interface TokenSlot {
  player: Player;
  x: number;
  y: number;
  /** 0=正常,0.15=破产淡出,0=隐藏(未选都)。 */
  opacity: number;
}

interface TokenLayerProps {
  board: Board;
  players: Player[];
  /** setup 阶段未选都城不显示棋子。 */
  setupUnselected: boolean;
  /** 行军动画接管中的玩家 id(跳过声明式定位)。 */
  skipTokenIds?: ReadonlySet<string>;
  /** 暴露棋子层 <g>(阶段 6 动画挂点 3)。 */
  layerRef?: React.Ref<SVGGElement>;
}

function TokenFlag({ p }: { p: Player }) {
  const c = playerColor(p.colorIndex);
  return (
    <g className="bv-token-flag">
      {/* 旗杆 */}
      <line x1={0} y1={0} x2={0} y2={-34} stroke="rgba(40,28,10,0.85)" strokeWidth={2.5} />
      {/* 三角旌旗(玩家色) */}
      <polygon
        points="0,-34 26,-26 0,-16"
        fill={rgba(c)}
        stroke="rgba(40,28,10,0.6)"
        strokeWidth={1}
      />
      {/* 国号字 */}
      <text
        x={9}
        y={-23}
        textAnchor="middle"
        fontFamily="var(--font-brush)"
        fontSize={13}
        fontWeight={700}
        fill="#fff"
      >
        {p.guohao || "?"}
      </text>
      {/* 底座印玺 */}
      <circle cx={0} cy={2} r={6} fill={rgba(c)} stroke="rgba(40,28,10,0.7)" strokeWidth={1.5} />
    </g>
  );
}

const Token = memo(function Token({ slot }: { slot: TokenSlot }) {
  const { player: p, x, y, opacity } = slot;
  return (
    <g
      className="bv-token"
      data-token-player={p.id}
      style={{ transform: `translate(${x}px, ${y}px)`, opacity }}
    >
      <TokenFlag p={p} />
    </g>
  );
});

export const TokenLayer = memo(function TokenLayer({
  board,
  players,
  setupUnselected,
  skipTokenIds,
  layerRef,
}: TokenLayerProps) {
  // 同格错位:按槽位键分组,组内按 TOKEN_SLOT_OFFSETS 错位摆放
  const bySlot = new Map<string, string[]>();
  for (const p of players) {
    if (p.isBankrupt) continue;
    const key = playerSlotKey(p, board);
    const arr = bySlot.get(key);
    if (arr) arr.push(p.id);
    else bySlot.set(key, [p.id]);
  }

  const slots: TokenSlot[] = [];
  for (const p of players) {
    if (setupUnselected && p.capitalIndex < 0) {
      slots.push({ player: p, x: 0, y: 0, opacity: 0 });
      continue;
    }
    if (skipTokenIds?.has(p.id)) {
      // 行军接管中:不按声明式(引擎终态)定位,改用 useMarch 维护的「当前段坐标」——
      // 保证行军中任何重渲(如 bot 步进 sync)把 transform 写成当前段目标而非终点,
      // 命令式逐段动画不被 React 拽回。接管刚建立(尚无坐标)则暂不渲染(等一帧起点锚定)。
      const mp = marchPos.get(p.id);
      if (!mp) continue;
      slots.push({ player: p, x: mp.x, y: mp.y, opacity: 1 });
      continue;
    }
    const pos = tokenRenderPos(p, board);
    const mates = bySlot.get(playerSlotKey(p, board)) ?? [p.id];
    const off = TOKEN_SLOT_OFFSETS[Math.max(0, mates.indexOf(p.id)) % TOKEN_SLOT_OFFSETS.length];
    slots.push({ player: p, x: pos.x + off.x, y: pos.y + off.y, opacity: p.isBankrupt ? 0.15 : 1 });
  }

  return (
    <g id="bv-tokens" ref={layerRef}>
      {slots.map((s) => (
        <Token key={s.player.id} slot={s} />
      ))}
    </g>
  );
});
