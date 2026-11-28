// 组件收口:旗面属棋盘器物，点选沿用 Base UI Button。
// 棋子层(旌旗,ADR-0042 第三波 HTML 版):props 驱动声明式定位 + CSS transform 过渡。
// 前身是顶板 SVG 里的 <g> 层(移植自 src/render/board.ts 的 buildToken/updateTokens)
// ——SVG 子元素拿不到合成器层,行军 transform 过渡与环动画令整张顶板 SVG 每帧失效
// 重绘,是低端 WebView 掉帧主源;现迁 HTML:每棋子一个合成器提升的包装 div
// (transform 锚)+ 内嵌 mini-svg(旗面/双环原绘原类,美术与 CSS 动画零改动),
// 逐帧失效收敛到棋子自身小盒。宿主矩阵同步见 boardHost.tsx;氛围层(ADR-0039)
// 行军换装消费同一槽位公式。
//
// ── 动画挂点(useMarch,选择器契约保号)──
// 1) 每个棋子 <div data-token-player={playerId}>:useMarch 以
//      document.querySelector('#bv-tokens [data-token-player="p1"]')
//    拿到包装节点,直接改 style.transform(transition 已由 .bv-token 提供)做逐段行军
//    ——HTML transform 过渡由合成器插值,主线程只在段边界参与。
// 2) props.skipTokenIds:行军动画接管中的玩家从声明式定位中剔除(等价旧
//    updateTokens(engine, skipPlayerId)),避免 React 重渲把棋子拽回终点。
// 3) marchPos(模块 Map):接管中棋子的声明式 transform 取「当前段坐标」——任何
//    store 同步触发的重渲与命令式写入值一致,棋子不会被拽回起点/终点(单写者,
//    ADR-0029 不变量②)。
//
// ── 氛围层拆分(ADR-0039,行军换装)──
// 静止期的旗面/自机微光/回合方金环常驻装饰归氛围层(AmbientLayer,合成器动画);
// 本层只留阶段性环(行军金环/候选呼吸)与行军接管期的静态旗(摇曳归氛围层,拖影照挂),
// 落定换装回氛围层动效旗。旗面缓倒仪式(desk.ts fallTokenFlag)随常驻旗迁层,改查
// [data-amb-flag];旗面形制单源 flagArt.tsx 两侧共用。槽位公式抽为 computeTokenSlots
// 导出,氛围层与本层各取所需(单源不复制,#608)。
import { Button } from "@base-ui/react/button";
import { memo, type MouseEvent } from "react";
import type { Board } from "@dafung/core/engine/board";
import { Theme, rgba } from "@dafung/core/engine/theme";
import { TESTIDS } from "@app/screens/game/testids";
import { FlagShapes } from "./flagArt";
import { BoardHost } from "./boardHost";
import { computeTokenSlots, TOKEN_CROWD_SCALE, TOKEN_SCALE, type TokenSlot } from "./tokenSlots";
import type { BoardPlayer } from "./BoardView";

export interface PawnTargets {
  available: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  locked: boolean;
  onPick: (playerId: string) => void;
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
  /** 候选棋子共用画面高亮和点选入口。 */
  targets?: PawnTargets;
  /** #762 当前回合方玩家 id(棋子金呼吸环;GameScreen 按快照 activeIndex 传)。 */
  activeId?: string;
  /** 棋盘 svg 根(宿主矩阵同步真源)。 */
  svgRef: React.RefObject<SVGSVGElement | null>;
}

/** 棋子美术盒(局部坐标):双环(r17+描边)与旗面(杆顶 -34.8/旗尖 26.8/印底 8.75)
 *  经 TOKEN_SCALE 缩放后的并集外扩 2 单位安全边。viewBox 与包装 div 尺寸/负 margin
 *  同源单值(board.css .bv-token 同数);氛围层对位 spec 量的就是包装盒,本盒即其语义
 *  (盒⊃旗锚落点,扩盒 ×1.3 判定语义不变)。 */
const TOKEN_ART_BOX = { x: -49, y: -93, w: 121, h: 142 } as const;

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

function targetRingDistance(pawn: HTMLElement, x: number, y: number): number {
  const ring = pawn.querySelector(".bv-token-target-ring");
  if (ring === null) throw new Error("目标棋子缺少候选光圈");
  const { left, top, width, height } = ring.getBoundingClientRect();
  return (x - left - width / 2) ** 2 + (y - top - height / 2) ** 2;
}

/** 同格棋子的触区可重叠。点按取最近的候选光圈，辅助技术激活沿用焦点按钮。 */
function pawnTargetOfClick(event: MouseEvent<HTMLButtonElement>, playerId: string): string {
  if (event.detail === 0) return playerId;
  const { currentTarget: button, clientX: x, clientY: y } = event;
  const pawn = button.parentElement!;
  const layer = pawn.parentElement!;
  let selected = pawn;
  let nearest = targetRingDistance(pawn, x, y);
  for (const other of layer.querySelectorAll<HTMLButtonElement>(".bv-token-target")) {
    if (other === button || other.disabled) continue;
    const { left, top, right, bottom } = other.getBoundingClientRect();
    if (x < left || x > right || y < top || y > bottom) continue;
    const candidate = other.parentElement!;
    const distance = targetRingDistance(candidate, x, y);
    if (distance < nearest) {
      selected = candidate;
      nearest = distance;
    }
  }
  const target = selected.dataset.tokenPlayer;
  if (target === undefined) throw new Error("目标棋子缺少玩家标识");
  return target;
}

const Token = memo(function Token({ slot, targets }: { slot: TokenSlot; targets?: PawnTargets }) {
  const { player: p, x, y, opacity, marching, targeted, crowded } = slot;
  return (
    <div
      className={marching ? "bv-token bv-token-marching" : "bv-token"}
      data-token-player={p.id}
      style={{ transform: `translate(${x}px, ${y}px)`, opacity }}
    >
      {/* 旗面/双环原绘(类名与 SVG 版逐字一致):候选呼吸环仍在 mini-svg 内(阶段性
          动画,出牌段才在);行军金环已迁下方 HTML 转子(架构体检 B 批,合成器化)。 */}
      <svg
        aria-hidden="true"
        className="bv-token-art"
        width={TOKEN_ART_BOX.w}
        height={TOKEN_ART_BOX.h}
        viewBox={`${TOKEN_ART_BOX.x} ${TOKEN_ART_BOX.y} ${TOKEN_ART_BOX.w} ${TOKEN_ART_BOX.h}`}
      >
        <g transform={`scale(${TOKEN_SCALE * (crowded ? TOKEN_CROWD_SCALE : 1)})`}>
          {/* #256 目标段候选呼吸:金虚线环 pulse(样式 layout.css;席位格金圈同步呼吸
              ——席位是身份,棋盘是地理,双锚点)。非候选(无效目标)不挂。
              阶段性动画(出牌段才在),不在氛围层迁出范围(ADR-0039)。 */}
          {targeted && (
            <circle
              className="bv-token-target-ring"
              data-testid={TESTIDS.pawnTargetRing(p.id)}
              r={17}
              fill="none"
              stroke={rgba(Theme.goldBright, 0.95)}
              strokeWidth={2.5}
              strokeDasharray="5 4"
            />
          )}
          {marching && <TokenFlag p={p} />}
        </g>
      </svg>
      {targeted && opacity > 0 && targets !== undefined && (
        <Button
          type="button"
          className="bv-token-target"
          data-testid={TESTIDS.pawnTarget(p.id)}
          disabled={targets.locked}
          aria-label={`指定 ${p.guohao} 为目标`}
          aria-pressed={targets.selected.has(p.id)}
          onClick={(event) => targets.onPick(pawnTargetOfClick(event, p.id))}
        />
      )}
      {/* #30 落脚指示环(架构体检 B 批合成器化):原为 mini-svg 内圆的 CSS 旋转——SVG
          子元素进不了合成器,行军全程逐帧重绘环盒(最大持续主线程Paint源);现转子
          div 持同款环绘(viewBox -21..21×TOKEN_SCALE=109.2px,虚线/描边逐像素复刻),
          rotate+opacity 双动画全走合成器(HTML transform/opacity 自动提升),主线程
          行军期零逐帧参与。锚点=包装盒内 (49,93)(TOKEN_ART_BOX 取反),几何由
          TOKEN_SCALE 单源推导,不落死值。 */}
      {marching && (
        <div
          className="bv-token-ring-rotor"
          aria-hidden="true"
          style={{
            width: 42 * TOKEN_SCALE,
            height: 42 * TOKEN_SCALE,
            left: -TOKEN_ART_BOX.x - 21 * TOKEN_SCALE,
            top: -TOKEN_ART_BOX.y - 21 * TOKEN_SCALE,
          }}
        >
          <svg className="bv-token-ring-art" viewBox="-21 -21 42 42">
            <circle
              r={17}
              fill="none"
              stroke={rgba(Theme.goldBright, 0.9)}
              strokeWidth={2}
              strokeDasharray="6 5"
            />
          </svg>
        </div>
      )}
    </div>
  );
});

export const TokenLayer = memo(function TokenLayer({
  board,
  players,
  setupUnselected,
  skipTokenIds,
  mineId,
  targets,
  activeId,
  svgRef,
}: TokenLayerProps) {
  const slots = computeTokenSlots(board, players, {
    setupUnselected,
    skipTokenIds,
    mineId,
    targetedIds: targets?.available,
    activeId,
  });

  return (
    <BoardHost id="bv-tokens" svgRef={svgRef} decorative={targets === undefined}>
      {slots.map((s) => (
        <Token key={s.player.id} slot={s} targets={targets} />
      ))}
    </BoardHost>
  );
});
