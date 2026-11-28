import type { GameEngine, TurnPhase } from "../engine/authority";

/** 对局状态摘要，供 HTTP 开局回包和 CLI 状态查询使用。 */
export function statusOf(e: GameEngine) {
  const s = e.snapshot();
  const activePlayer = s.players[s.activeIndex];
  return {
    phase: s.phase,
    setupPhase: s.setupPhase,
    turnPhase: s.turnPhase,
    activeIndex: s.activeIndex,
    active: activePlayer?.guohao ?? null,
    isOver: s.isOver,
    winner: s.winner ? (s.players.find((p) => p.id === s.winner)?.guohao ?? null) : null,
    winReason: s.winReason,
    turnNumber: s.turnNumber,
    round: s.round,
    lastRoll: s.lastRoll?.die ?? null,
    rngState: s.rngState,
    offeredCapitals: s.offeredCapitals,
    // 可用选项集(ADR-0013;快照 choices = engine.choicesFor() 全集,过滤 available;
    // 非选项集相位 choicesFor 返回 [] → 此处亦 [])。
    choices: s.choices.filter((o) => o.available),
    // 反应窗公告(ReactionView | null,快照字段透传,零派生):
    // 锦囊窗携带 targets 与询问集，行军窗携带城主及途经城格。
    reaction: s.reaction,
    players: s.players.map((p) => ({
      guohao: p.guohao,
      isBot: p.isBot,
      cash: p.cash,
      netWorth: p.netWorth,
      position: p.position,
      capitalIndex: p.capitalIndex,
      isBankrupt: p.isBankrupt,
      skipTurns: p.skipTurns,
      treasures: p.treasures.length,
      properties: p.properties.length,
      heroes: p.heroes.length,
    })),
    prompt: promptFor(
      s.phase,
      s.setupPhase,
      s.turnPhase,
      activePlayer?.guohao,
      activePlayer?.isBot,
      // 城主视角(AwaitingTreasureOwner):提示该谁抉择
      s.turnPhase === "AwaitingTreasureOwner" ? decisionOwnerGuohao(e) : undefined,
      // 出牌阶段(AwaitingJinnang):技能目标段残留时一并提示 useHeroSkill(实例定位对,#817)
      e.pendingSkill,
    ),
  };
}

/** AwaitingTreasureOwner 阶段,真正做抉择的是城主(可能 ≠ active 玩家)。
 *  归属座位统一走 engine.decisionOwner;treasureVisitor 缺失 → 无城主提示(原语义)。 */
function decisionOwnerGuohao(e: GameEngine): string | undefined {
  if (e.turnPhase !== "AwaitingTreasureOwner" || e.treasureVisitor == null) return undefined;
  return e.players[e.decisionOwner]?.guohao;
}

function promptFor(
  phase: string,
  setupPhase: string,
  tp: TurnPhase,
  guohao: string | undefined,
  isBot: boolean | undefined,
  decisionOwner?: string,
  pendingSkill?: { heroId: string; skillId: string } | null,
): string {
  if (!guohao) return "";
  const who = `${guohao}${isBot ? "(bot)" : ""}`;
  if (phase === "GameOver") return "游戏结束";
  if (phase === "Setup") {
    if (setupPhase === "Guohao") return `${who} 选国号(cmd 不支持,用 new 时 seats 带入)`;
    if (setupPhase === "PickCapital") {
      return `${guohao} 选都(候选见 status.offeredCapitals):pick-capital <tileIndex>(auto-setup 自动跑完)`;
    }
    return `${who} 开局中…`;
  }
  switch (tp) {
    case "Roll":
      return `${who} 的回合:行军(roll)`;
    case "AwaitingDecision":
      return `${who} 落城:购地(buy)/扩军(upgrade)/跳过(skip)`;
    case "AwaitingHeroPick":
      return `${who} 招贤纳士:resolveHeroPick 可选名将(index)、求书(action=seekBook)或跳过(action=skip)`;
    case "AwaitingJinnang": {
      const skill = pendingSkill
        ? `;待发动技:cmd {"type":"useHeroSkill","heroId":"${pendingSkill.heroId}","skillId":"${pendingSkill.skillId}"}(或其目标段/cancel 作罢)`
        : "";
      return `${who} 出牌阶段:用锦囊(cmd {"type":"useJinnang","cardId":"<id>"};今不用 {"type":"useJinnang","cardId":null},牌 id 见 status.choices)${skill}`;
    }
    case "AwaitingReaction":
      return `反应窗(cmd {"type":"respondReaction","seat":<n>,"use":false} 不出；用牌传 use:true、cardId 与 handIndex)。待应答座位和对象见 status.reaction。targets.requiresSelection 为 true 时，出牌须从公告选份并附 "target":{"kind":"city"|"seat","id":<n>}。`;
    case "AwaitingTreasureOwner":
      return `${decisionOwner ?? who} 城主抉择:公道买卖(fair <id>)/坐地起价(premium <id>)/跳过(tskip)`;
    case "AwaitingBankruptcySettle":
      return `${who} 破产清算:批量出售并清偿(cmd {"type":"confirmBankruptcySettle","assets":[{"kind":"treasure","id":"<id>"}]})或认破产(cmd {"type":"declareBankruptcy"})`;
    case "Land":
    case "EndTurn":
      return `${who} 结算中…(状态过渡,无需操作)`;
    default:
      return `${who} 状态:${tp}`;
  }
}
