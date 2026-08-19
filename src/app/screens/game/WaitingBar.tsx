// G-3/16/21 统一等待状态条:本地玩家非交互时,按「谁在拖节奏」给出过程反馈。
//   - bot 行动 →「智将运筹中…」(替代原 GameScreen 里一闪而过的"运筹中"角标)
//   - 联机轮到远端人类掷骰 →「静候『魏』落子…」
//   - 决策类相位(Awaiting* 系)轮到非本地玩家 →「『魏』正在抉择…」;
//     破产清算相位 →「『魏』正在变卖家产…」(G-21 债权人可见对方变卖抵债)
// 本组件只读 props 不读 store(GameScreen 接线时传),样式为细条,绝对定位在
// HintBar(top-3)下方(top-12),互不叠位。
import type { GameSnapshot } from "@app/store/gameStore";
import type { TurnPhase } from "@core/types";
import { TESTIDS } from "./testids";

export interface WaitingBarProps {
  /** 当前对局快照(读 phase/turnPhase/activeIndex/players)。 */
  snapshot: GameSnapshot;
  /** 此刻本地玩家能否操作(false = 本地在等别人)。 */
  interactive: boolean;
  /** 本地视角座位(联机=自己分到的座位;单机=当前活跃人类座位)。 */
  viewSeat: number;
  /** 是否联机对局(单机时除本地外只有 bot,不出现「静候远端人类」分支)。 */
  online: boolean;
}

/** 决策类相位:轮到该玩家做选择(掷骰 Roll 不在其中——那是「落子」不是「抉择」)。 */
const DECISION_PHASES: ReadonlySet<TurnPhase> = new Set<TurnPhase>([
  "AwaitingBranch",
  "AwaitingDecision",
  "AwaitingHeroPick",
  "AwaitingTreasureOwner",
  "AwaitingBankruptcySettle",
]);

/** 推导等待文案(null = 本地可交互/无人在前,不渲染)。 */
function waitingText(
  snapshot: GameSnapshot,
  interactive: boolean,
  viewSeat: number,
  online: boolean,
): string | null {
  if (interactive || snapshot.phase !== "Playing") return null;
  const active = snapshot.players[snapshot.activeIndex];
  if (!active) return null;
  const name = `「${active.guohao}」`;
  if (active.isBot) return "智将运筹中…";
  if (online && snapshot.activeIndex !== viewSeat) {
    // 联机远端人类:掷骰阶段=静候落子;决策相位=正在抉择(破产清算单独措辞)。
    if (snapshot.turnPhase === "AwaitingBankruptcySettle") return `${name}正在变卖家产…`;
    if (DECISION_PHASES.has(snapshot.turnPhase)) return `${name}正在抉择…`;
    return `静候${name}落子…`;
  }
  return null;
}

export function WaitingBar({ snapshot, interactive, viewSeat, online }: WaitingBarProps) {
  const text = waitingText(snapshot, interactive, viewSeat, online);
  if (!text) return null;
  return (
    <div
      data-testid={TESTIDS.waitingBar}
      className="waiting-bar pointer-events-none absolute top-[calc(var(--safe-top)+48px)] left-1/2 -translate-x-1/2 rounded-full border border-gold/50 bg-ink/80 px-3 py-0.5 font-brush text-sm text-panel shadow"
    >
      {text}
      <span className="waiting-dots" aria-hidden />
    </div>
  );
}
