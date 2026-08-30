// G-3/16/21 统一等待状态条:本地玩家非交互时,按「谁在拖节奏」给出过程反馈。
//   - bot 行动 →「智将运筹中…」(X7 #26:GameScreen 底部「运筹中…」角标已删,本条是唯一等待反馈)
//   - 联机轮到远端人类掷骰 →「静候『魏』落子…」
//   - 决策类相位(Awaiting* 系)轮到非本地玩家 →「『魏』正在抉择…」;
//     破产清算相位 →「『魏』正在变卖家产…」(G-21 债权人可见对方变卖抵债)
// X7 #26:同一等待超过 8 秒追加「(已候 N 秒)」——静态省略号在联机长等待下等于没反馈。
// X8 #27 交接:文案主体按 decisionOwner 口径取(珍宝交涉=城主,其余=activeIndex,快照侧
// 派生同 engine.decisionOwner)——访客关闭交涉卷轴后等待条接管「等待城主抉择」的反馈。
// 本组件只读 props 不读 store(GameScreen 接线时传),样式为细条,绝对定位在
// HintBar(top-3)下方(top-12),互不叠位。
import { useEffect, useState } from "react";
import type { GameSnapshot } from "@app/store/gameStore";
import type { TurnPhase } from "@core/types";
import { TESTIDS } from "./testids";

export interface WaitingBarProps {
  /** 当前对局快照(读 phase/turnPhase/activeIndex/treasureVisitor/players)。 */
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

/** 超时安抚阈值(秒):同一句等待文案持续超过该秒数才追加已候计时。 */
const WAIT_ANNOUNCE_S = 8;

/** 推导等待文案(null = 本地可交互/无人在前,不渲染)。 */
function waitingText(
  snapshot: GameSnapshot,
  interactive: boolean,
  viewSeat: number,
  online: boolean,
): string | null {
  if (interactive || snapshot.phase !== "Playing") return null;
  // 决策归属座位(与 engine.decisionOwner 同口径):珍宝交涉=城主(可能 ≠ 访客),
  // 其余相位 = activeIndex。快照未直排该字段,按同源数据派生。
  const ownerIndex =
    snapshot.turnPhase === "AwaitingTreasureOwner"
      ? snapshot.treasureVisitor?.ownerIdx ?? snapshot.activeIndex
      : snapshot.activeIndex;
  const owner = snapshot.players[ownerIndex];
  if (!owner) return null;
  const name = `「${owner.guohao}」`;
  if (owner.isBot) return "智将运筹中…";
  if (online && ownerIndex !== viewSeat) {
    // 联机远端人类:掷骰阶段=静候落子;决策相位=正在抉择(破产清算单独措辞)。
    if (snapshot.turnPhase === "AwaitingBankruptcySettle") return `${name}正在变卖家产…`;
    if (DECISION_PHASES.has(snapshot.turnPhase)) return `${name}正在抉择…`;
    return `静候${name}落子…`;
  }
  return null;
}

export function WaitingBar({ snapshot, interactive, viewSeat, online }: WaitingBarProps) {
  const text = waitingText(snapshot, interactive, viewSeat, online);
  // 已候秒数:按连续等待会话计时,text 变化(等待对象换了)即归零重计;条卸载即清表。
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!text) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [text]);
  if (!text) return null;
  return (
    <div
      data-testid={TESTIDS.waitingBar}
      className="waiting-bar pointer-events-none absolute top-[calc(var(--safe-top)+48px)] left-1/2 -translate-x-1/2 rounded-full border border-gold/50 bg-ink/80 px-3 py-0.5 font-brush text-sm text-panel shadow"
    >
      {/* X7 #26:thinking testid 迁到文案 span(原 GameScreen 底部角标,单机 bot 用例仍走此断言) */}
      <span data-testid={TESTIDS.thinking}>
        {text}
        {elapsed > WAIT_ANNOUNCE_S ? `(已候 ${elapsed} 秒)` : ""}
      </span>
      <span className="waiting-dots" aria-hidden />
    </div>
  );
}
