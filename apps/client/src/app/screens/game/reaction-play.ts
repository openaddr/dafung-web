import type { Board } from "@dafung/core/engine/board";
import type { ReactionView } from "@dafung/core/engine/reaction-window";
import type { GameSnapshot } from "@app/store/gameStore";
import type {
  SeatIntent,
  SeatIntentResult,
  SeatInteractionView,
} from "@dafung/core/protocol/seat-interaction";
import type { GameDiagnosticDecisions } from "@app/game-diagnostic-record";
import { getAudio } from "@app/fx/audio";

function reactionAnnouncement(
  view: ReactionView,
  seatLabel: (seat: number) => string,
  cityName: (tileIndex: number) => string,
) {
  const user = seatLabel(view.userSeat);
  if (view.kind === "march") {
    return {
      text: `${user} 行军途经`,
      range: `${seatLabel(view.ownerSeat)} 的「${cityName(view.tileIndex)}」`,
    };
  }
  const text = `${user} 用「${view.cardId}」`;
  const { kind, ids, requiresSelection } = view.targets;
  const label = kind === "city" ? cityName : seatLabel;
  if (view.counter != null) {
    const { rootCardId, rootUserSeat, protects } = view.counter;
    const objects = ids.map(label).join("、");
    const root = `${seatLabel(rootUserSeat)} 的「${rootCardId}」`;
    return {
      text,
      range: `${protects ? "拆解" : "恢复"} ${root}${objects ? ` · ${objects}` : ""}`,
    };
  }
  if (kind === "city") return { text, range: `受击城 ${ids.map(label).join("、")}` };
  if (requiresSelection) return { text, range: `影响 ${ids.length} 位诸侯` };
  return {
    text,
    range:
      ids.length === 1 && ids[0] === view.userSeat
        ? "影响自身"
        : `影响 ${ids.map(label).join("、")}`,
  };
}

export function turnScope(snapshot: GameSnapshot): string {
  return JSON.stringify([snapshot.gameId, snapshot.turnNumber, snapshot.activeIndex]);
}

export function reactionDiagnostics(
  choices: SeatInteractionView<GameSnapshot>["reaction"],
  canAct: boolean,
): GameDiagnosticDecisions["reaction"] {
  if (choices === null) return null;
  const { kind, asked, answered, muted, playable } = choices;
  const canDecline = asked && !answered && !muted && canAct;
  return {
    kind,
    asked,
    answered,
    muted,
    canDecline,
    playable: canDecline ? playable.map(({ cardId }) => cardId) : [],
  };
}

export function reactionPlay(
  { snapshot, seat, autopilotOn, reaction: choices }: SeatInteractionView<GameSnapshot>,
  board: Board,
  act: (intent: SeatIntent) => SeatIntentResult,
) {
  const seq = choices?.asked ? choices.seq : null;
  // 已答仍是同一权威窗。提醒的身份跟窗号走，可操作范围另看是否已答。
  const identity = seq !== null ? JSON.stringify([snapshot.gameId, seat, seq]) : null;
  const scope = choices != null && !choices.answered && !autopilotOn ? identity : null;
  if (seq === null || scope === null || choices === null || choices.muted)
    return { identity, scope, window: null };
  const reaction = snapshot.reaction;
  if (reaction === null) throw new Error(`反应窗 ${seq} 缺少公告`);
  const { deadlineAt, selectedCard, targets, canRespond, canConfirm } = choices;
  if (deadlineAt === null) throw new Error(`反应窗 ${seq} 缺少截止时刻`);

  const seatLabel = (seat: number) => snapshot.players[seat].guohao;
  const cityName = (tileIndex: number) => board.at(tileIndex).name;
  const notice = reactionAnnouncement(reaction, seatLabel, cityName);
  const submit = (type: "confirm" | "pass" | "muteReactions") => {
    if (!canRespond) return;
    getAudio().stop("reaction", "fade");
    act({ type });
  };

  return {
    identity,
    scope,
    window: {
      deadlineAt,
      hand: {
        playable: choices.playable,
        seq,
        selection: selectedCard,
        onSelect(handIndex: number) {
          if (!canRespond) return;
          const result = act({ type: "selectCard", handIndex });
          if (result.status === "draft" && handIndex !== selectedCard?.handIndex)
            getAudio().play("jinnangSelect");
        },
      },
      targetStep: targets,
      action: {
        ...notice,
        selection:
          selectedCard === null
            ? null
            : {
                cardId: selectedCard.cardId,
                target:
                  targets === null
                    ? null
                    : {
                        domain: targets.domain,
                        selectedLabel: targets.selectedLabels[0] ?? null,
                      },
              },
        unavailableReason: targets?.unavailableReason,
        durationMs: reaction.windowMs,
        deadlineAt,
        confirmEnabled: canConfirm,
        onConfirm: () => submit("confirm"),
        onDecline: () => submit("pass"),
        onMute: () => submit("muteReactions"),
      },
    },
  };
}
