import { useCallback, useEffect, useRef, useState } from "react";
import type { GameCommand } from "@dafung/core/engine/authority";
import type { Board } from "@dafung/core/engine/board";
import { SINGLE_TARGET } from "@dafung/core/engine/jinnang";
import type { ReactionView } from "@dafung/core/engine/reaction-window";
import type { GameSnapshot } from "@dafung/core/engine/snapshot";
import { reactionChoicesForSeat } from "@app/controllers/reaction";
import { getAudio } from "@app/fx/audio";
import type { CardSelection } from "./jinnang-play";
import { reactionMuteEngage, reactionMuted, type ReactionMuteState } from "./reaction-mute";
import type { TargetSelection, TargetSelectionStep } from "./target-selection";

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

export function useReactionPlay({
  snapshot,
  seat,
  board,
  autopilotOn,
  interactive,
  deadlineAt,
  dispatchCommand,
}: {
  snapshot: GameSnapshot;
  seat: number;
  board: Board;
  autopilotOn: boolean;
  interactive: boolean;
  deadlineAt: number | null;
  dispatchCommand: (command: GameCommand) => void;
}) {
  const choices = reactionChoicesForSeat(snapshot, seat);
  const seq = choices?.asked ? snapshot.pendingReaction!.seq : null;
  // 已答仍是同一权威窗。提醒的身份跟窗号走，可操作范围另看是否已答。
  const identity = seq !== null ? JSON.stringify([snapshot.gameId, seat, seq]) : null;
  const scope = choices != null && !choices.answered && !autopilotOn ? identity : null;
  const turn = turnScope(snapshot);
  const [mute, setMute] = useState<{ scope: string; state: ReactionMuteState } | null>(null);
  const muted = mute?.scope === turn && reactionMuted(mute.state, snapshot.activeIndex);
  const readDiagnosticChoices = useCallback(
    (state: GameSnapshot, seat: number, canAct: boolean) => {
      const choices = reactionChoicesForSeat(state, seat);
      if (choices === null) return null;
      const muted =
        mute?.scope === turnScope(state) && reactionMuted(mute.state, state.activeIndex);
      const canDecline = choices.asked && !choices.answered && !muted && canAct;
      return { ...choices, muted, canDecline, playable: canDecline ? choices.playable : [] };
    },
    [mute],
  );

  const lastMutedAnswer = useRef<string | null>(null);
  useEffect(() => {
    if (!interactive || !muted || scope == null || lastMutedAnswer.current === scope) return;
    lastMutedAnswer.current = scope;
    dispatchCommand({ type: "respondReaction", seat, use: false });
  }, [dispatchCommand, interactive, muted, scope, seat]);

  const [draft, setDraft] = useState<(CardSelection & { scope: string }) | null>(null);
  useEffect(() => {
    setDraft((selected) => (selected?.scope === scope ? selected : null));
  }, [scope]);

  const reaction = scope != null && !muted ? snapshot.reaction : null;
  if (reaction == null) return { identity, scope, window: null, readDiagnosticChoices };
  if (deadlineAt == null) throw new Error(`反应窗 ${seq} 缺少截止时刻`);

  const playable = choices!.playable;
  const selected = draft?.scope === scope && playable.includes(draft.optionId) ? draft : null;
  const seatLabel = (seat: number) => snapshot.players[seat].guohao;
  const cityName = (tileIndex: number) => board.at(tileIndex).name;
  const shares = reaction.kind === "jinnang" ? reaction.targets : null;
  const targetStep: TargetSelectionStep | null =
    selected != null && shares?.requiresSelection
      ? {
          scope: JSON.stringify(["reaction", scope, selected.key]),
          domain: shares.kind,
          ...SINGLE_TARGET,
          candidates: shares.ids.map((id) => ({
            id,
            label: shares.kind === "city" ? cityName(id) : seatLabel(id),
            available: true,
          })),
        }
      : null;
  const notice = reactionAnnouncement(reaction, seatLabel, cityName);

  return {
    identity,
    scope,
    readDiagnosticChoices,
    window: {
      deadlineAt,
      hand: {
        reactiveIds: playable,
        seq: seq!,
        selection: selected,
        onSelect(selection: CardSelection) {
          if (!interactive) return;
          if (selected?.key === selection.key) {
            setDraft(null);
            return;
          }
          getAudio().play("jinnangSelect");
          setDraft({ ...selection, scope: scope! });
        },
      },
      targetStep,
      actionFor(targets: TargetSelection) {
        const confirmEnabled = selected != null && (targetStep == null || targets.canConfirm);
        const share = targets.selected[0];
        const target =
          targetStep != null && share != null ? { kind: targetStep.domain, id: share } : undefined;
        const respond = (use: boolean) => {
          if (!interactive) return;
          getAudio().stop("reaction", "fade");
          dispatchCommand({
            type: "respondReaction",
            seat,
            use,
            ...(use ? { cardId: selected!.optionId, target } : {}),
          });
        };
        return {
          ...notice,
          selection:
            selected == null
              ? null
              : {
                  cardId: selected.optionId,
                  target:
                    targetStep == null
                      ? null
                      : {
                          domain: targetStep.domain,
                          selectedLabel: target == null ? null : targets.selectedLabels[0],
                        },
                },
          unavailableReason: targets.unavailableReason,
          durationMs: reaction.windowMs,
          deadlineAt,
          confirmEnabled,
          onConfirm() {
            if (confirmEnabled) respond(true);
          },
          onDecline: () => respond(false),
          onMute() {
            if (!interactive) return;
            lastMutedAnswer.current = scope;
            setMute({ scope: turn, state: reactionMuteEngage(snapshot.activeIndex) });
            respond(false);
          },
        };
      },
    },
  };
}
