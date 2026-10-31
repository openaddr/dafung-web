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
//
// ── 氛围层拆分(ADR-0039,行军换装)──
// 静止期的旗面/自机微光/回合方金环常驻装饰迁 HTML 氛围层(AmbientLayer,合成器
// 动画,主线程零逐帧参与);本层只留阶段性环(行军金环/候选呼吸)。旗面组即棋子
// 本体,行军接管期由本层 TokenFlag 渲染静态旗(摇曳归氛围层,拖影照挂),落定换装
// 回氛围层动效旗。旗面缓倒仪式(desk.ts fallTokenFlag)随常驻旗迁层,改查
// [data-amb-flag];旗面形制单源 flagArt.tsx 两侧共用。槽位公式抽为 computeTokenSlots
// 导出,氛围层与本层各取所需(单源不复制,#608)。
import { memo } from "react";
import type { Board } from "@core/board";
import type { BoardPos } from "@core/board";
import { Theme, rgba } from "@core/theme";
import { TOKEN_SLOT_OFFSETS } from "@core/constants";
import { marchPos } from "@app/fx/useMarch";
import { FlagShapes } from "./flagArt";
import { playerSlotKey, tokenSlotGroups, tokenSlotOffset } from "./tokenSlots";
import type { BoardPlayer } from "./BoardView";

/** 玩家当前渲染坐标。 */
export function tokenRenderPos(p: BoardPlayer, board: Board): BoardPos {
  return board.positionOf(p.position);
}

export interface TokenSlot {
  player: BoardPlayer;
  x: number;
  y: number;
  /** 0=正常,0.15=破产淡出,0=隐藏(未选都)。 */
  opacity: number;
  /** #30 行军接管中(强调态:金边拖影 + 落脚指示环)。 */
  marching: boolean;
  /** L47:本地视角自己的棋子(玩家色微光圈,氛围层渲染)。 */
  mine: boolean;
  /** #256 目标段:出牌阶段候选棋子(金虚线环呼吸,与席位格金圈同步,双锚点)。 */
  targeted: boolean;
  /** #762 当前回合方棋子(金呼吸环,氛围层渲染;同时至多一枚有环)。 */
  active: boolean;
  /** #557 同格拥挤档:同格 >4 子(旗面 scale 0.85,给 8 槽圆周让位)。 */
  crowded: boolean;
}

interface TokenLayerProps {
  board: Board;
  players: BoardPlayer[];
  /** setup 阶段未选都城不显示棋子。 */
  setupUnselected: boolean;
  /** 行军动画接管中的玩家 id(跳过声明式定位)。 */
  skipTokenIds?: ReadonlySet<string>;
  /** L47:本地视角玩家 id(自己棋子加玩家色微光圈)。 */
  mineId?: string;
  /** #256 目标段:候选呼吸的棋子 id 集(available 候选席位;样式 layout.css)。 */
  targetedIds?: ReadonlySet<string>;
  /** #762 当前回合方玩家 id(棋子金呼吸环;GameScreen 按快照 activeIndex 传)。 */
  activeId?: string;
  /** 暴露棋子层 <g>(阶段 6 动画挂点 3)。 */
  layerRef?: React.Ref<SVGGElement>;
}

/** #30/#39/#58 棋子放大比例:旗/字/印玺等比 scale。屏幕净大小 = TOKEN_SCALE /
 *  TILE_SCALE(城池 2.2):2.6/2.2≈净 1.18x(#557 总览可辨性:较原 2.24 净放大
 *  ≈16%,旗面/国号字在总览缩放下更大更可辨)。scale 落在独立 <g transform> 属性上,
 *  与 .bv-token 的 CSS style.transform(行军命令式写入 translate)互不覆盖。
 *  氛围层旗/光环同用此比例(AmbientLayer,ADR-0039)。 */
export const TOKEN_SCALE = 2.6;
/** #557 同格拥挤档:同格 >4 子时旗面整体再乘 0.85,给 8 槽圆周留出彼此轮廓。 */
export const TOKEN_CROWD_SCALE = 0.85;

/** 槽位推导单源(ADR-0039 抽取):TokenLayer 声明式定位与氛围层装饰落点共用的
 *  同一公式体——分组/偏移走 tokenSlots 单源,行军接管读 marchPos 当前段坐标。 */
export function computeTokenSlots(
  board: Board,
  players: BoardPlayer[],
  o: {
    setupUnselected: boolean;
    skipTokenIds?: ReadonlySet<string>;
    mineId?: string;
    targetedIds?: ReadonlySet<string>;
    activeId?: string;
  },
): TokenSlot[] {
  const bySlot = tokenSlotGroups(players);

  const slots: TokenSlot[] = [];
  for (const p of players) {
    const mine = p.id === o.mineId;
    const targeted = o.targetedIds?.has(p.id) ?? false;
    const active = p.id === o.activeId;
    if (o.setupUnselected && p.capitalIndex < 0) {
      slots.push({
        player: p,
        x: 0,
        y: 0,
        opacity: 0,
        marching: false,
        mine,
        targeted,
        active,
        crowded: false,
      });
      continue;
    }
    if (o.skipTokenIds?.has(p.id)) {
      // 行军接管中:不按声明式(引擎终态)定位,改用 useMarch 维护的「当前段坐标」——
      // 保证行军中任何重渲(如 bot 步进 sync)把 transform 写成当前段目标而非终点,
      // 命令式逐段动画不被 React 拽回。接管刚建立(尚无坐标)则暂不渲染(等一帧起点锚定)。
      // #30:接管中即标 marching → 金边拖影 + 落脚指示环(强调效果挂在动画路径上,
      // 动画结束 removeMarching 后 React 终态接管,强调态随之自然消退)。
      const mp = marchPos.get(p.id);
      if (!mp) continue;
      slots.push({
        player: p,
        x: mp.x,
        y: mp.y,
        opacity: 1,
        marching: true,
        mine,
        targeted,
        active,
        crowded: false, // 行军中在路径上、不占同格槽位语义
      });
      continue;
    }
    const pos = tokenRenderPos(p, board);
    const mates = bySlot.get(playerSlotKey(p)) ?? [p.id];
    const off = tokenSlotOffset(players, p);
    slots.push({
      player: p,
      x: pos.x + off.x,
      y: pos.y + off.y,
      opacity: p.isBankrupt ? 0.15 : 1,
      marching: false,
      mine,
      targeted,
      active,
      crowded: mates.length > TOKEN_SLOT_OFFSETS.length / 2,
    });
  }
  return slots;
}

/** 行军换装期的静态旗面(ADR-0039):旗面组即棋子本体(杆/旗/字/印),行军接管期
 *  氛围层旗暂隐,本体由本件承担——静止旗面零动画(摇曳归氛围层),金边拖影由
 *  board.css .bv-token-marching 挂 drop-shadow,#30 强调完整保留。 */
function TokenFlag({ p }: { p: BoardPlayer }) {
  return (
    <g className="bv-token-flag">
      <FlagShapes p={p} />
    </g>
  );
}

const Token = memo(function Token({ slot }: { slot: TokenSlot }) {
  const { player: p, x, y, opacity, marching, targeted, crowded } = slot;
  return (
    <g
      className={marching ? "bv-token bv-token-marching" : "bv-token"}
      data-token-player={p.id}
      style={{ transform: `translate(${x}px, ${y}px)`, opacity }}
    >
      <g transform={`scale(${TOKEN_SCALE * (crowded ? TOKEN_CROWD_SCALE : 1)})`}>
        {/* #30 落脚指示环:行军接管中由 board.css 显示(默认 opacity 0);
            金色虚线环 + 旋转/呼吸,读作「这枚棋子正在动、在这里」。 */}
        <circle
          className="bv-token-march-ring"
          r={17}
          fill="none"
          stroke={rgba(Theme.goldBright, 0.9)}
          strokeWidth={2}
          strokeDasharray="6 5"
        />
        {/* #256 目标段候选呼吸:金虚线环 pulse(样式 layout.css;席位格金圈同步呼吸
            ——席位是身份,棋盘是地理,双锚点)。非候选(无效目标)不挂。
            阶段性动画(出牌段才在),不在氛围层迁出范围(ADR-0039)。 */}
        {targeted && (
          <circle
            className="bv-token-target-ring"
            r={17}
            fill="none"
            stroke={rgba(Theme.goldBright, 0.95)}
            strokeWidth={2.5}
            strokeDasharray="5 4"
          />
        )}
        {marching && <TokenFlag p={p} />}
      </g>
    </g>
  );
});

export const TokenLayer = memo(function TokenLayer({
  board,
  players,
  setupUnselected,
  skipTokenIds,
  mineId,
  targetedIds,
  activeId,
  layerRef,
}: TokenLayerProps) {
  const slots = computeTokenSlots(board, players, {
    setupUnselected,
    skipTokenIds,
    mineId,
    targetedIds,
    activeId,
  });

  return (
    <g id="bv-tokens" ref={layerRef}>
      {slots.map((s) => (
        <Token key={s.player.id} slot={s} />
      ))}
    </g>
  );
});
