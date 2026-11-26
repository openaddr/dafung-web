import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getAudio } from "@app/fx/audio";
import { TargetActionBar, TargetActionButton } from "./TargetActionBar";
import { TESTIDS } from "./testids";
import "./reaction-banner.css";

interface ReactionBannerProps {
  text: string;
  range: string;
  step: string | null;
  durationMs: number;
  deadlineAt: number;
  confirmEnabled: boolean;
  locked: boolean;
  onLockChange?: (locked: boolean) => void;
  onConfirm: () => void;
  onDecline: () => void;
  onMute: () => void;
}

const ARC_R = 15;
const REACTION_REMINDER_LEAD_MS = 3000;

/** 跟本座的实际问询计时。作用域保留到权威换窗，重连和暂锁时撤掉在途提醒。 */
export function useReactionReminder(scope: string | null, answerDeadlineAt: number | null): void {
  const current = useRef<{
    scope: string;
    opened: boolean;
    armed: boolean;
    warned: boolean;
  } | null>(null);

  useEffect(() => {
    const audio = getAudio();
    if (scope !== (current.current?.scope ?? null)) {
      audio.stop("reaction", "fade");
      current.current =
        scope === null ? null : { scope, opened: false, armed: false, warned: false };
    }
    const reminder = current.current;
    if (reminder === null) return;
    let timeout: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timeout);
      const hidden = document.visibilityState === "hidden";
      if (hidden) reminder.opened = true;
      if (hidden || answerDeadlineAt === null) {
        reminder.armed = false;
        audio.stop("reaction", hidden ? "immediate" : "fade");
        return;
      }
      const remaining = answerDeadlineAt - performance.now();
      if (remaining <= 0) {
        reminder.armed = false;
        audio.stop("reaction", "fade");
        return;
      }
      if (!reminder.opened) {
        reminder.opened = true;
        audio.play("reactionOpen");
      }
      if (remaining > REACTION_REMINDER_LEAD_MS && !reminder.warned) {
        reminder.armed = true;
        timeout = setTimeout(update, Math.max(1, remaining - REACTION_REMINDER_LEAD_MS));
        return;
      }
      if (reminder.armed) {
        reminder.armed = false;
        reminder.warned = true;
        audio.play("reactionTick");
      }
      timeout = setTimeout(update, Math.max(1, remaining));
    };
    const onVisibilityChange = () => {
      reminder.armed = false;
      update();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    update();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimeout(timeout);
    };
  }, [scope, answerDeadlineAt]);
}

/** 倒计时从当前窗已过的时刻开始。 */
export function ReactionBanner({
  text,
  range,
  step,
  durationMs,
  deadlineAt,
  confirmEnabled,
  locked,
  onLockChange,
  onConfirm,
  onDecline,
  onMute,
}: ReactionBannerProps) {
  const elapsedMs = useMemo(
    () => Math.min(durationMs, Math.max(0, durationMs - (deadlineAt - performance.now()))),
    [deadlineAt, durationMs],
  );
  const [seconds, setSeconds] = useState(() => Math.ceil((durationMs - elapsedMs) / 1000));
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const beat = () => {
      const remain = Math.max(0, deadlineAt - performance.now());
      const secs = Math.ceil(remain / 1000);
      setSeconds(secs);
      if (secs > 0) timeout = setTimeout(beat, Math.max(1, remain - (secs - 1) * 1000));
    };
    beat();
    return () => clearTimeout(timeout);
  }, [deadlineAt]);
  const disabled = locked || seconds === 0;
  useLayoutEffect(() => {
    onLockChange?.(disabled);
  }, [disabled, onLockChange]);

  return (
    <TargetActionBar
      className="reaction-action-bar"
      testId={TESTIDS.reactionBanner}
      leading={
        <span
          className={"reaction-timerbox" + (seconds <= 5 ? " danger" : "")}
          data-testid={TESTIDS.reactionTimer}
          style={{
            ["--reaction-dur" as string]: `${durationMs}ms`,
            ["--reaction-delay" as string]: `${-elapsedMs}ms`,
          }}
        >
          <svg className="reaction-timer" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
            <circle className="track" cx="18" cy="18" r={ARC_R} />
            <circle className="arc" cx="18" cy="18" r={ARC_R} />
          </svg>
          <span className="reaction-timer-num">{seconds}</span>
        </span>
      }
      title={<span data-testid={TESTIDS.reactionText}>{text}</span>}
      detail={
        <>
          <div className="reaction-range">{range}</div>
          {step != null && <div data-testid={TESTIDS.reactionStep}>{step}</div>}
        </>
      }
      actions={
        <>
          <div className="reaction-mute-group">
            <TargetActionButton
              className="reaction-mute"
              data-testid={TESTIDS.reactionMute}
              disabled={disabled}
              onClick={onMute}
            >
              本回合不再询问
            </TargetActionButton>
          </div>
          <TargetActionButton
            data-testid={TESTIDS.reactionDecline}
            disabled={disabled}
            onClick={onDecline}
          >
            不出
          </TargetActionButton>
          <TargetActionButton
            data-testid={TESTIDS.reactionConfirm}
            variant="commit"
            disabled={disabled || !confirmEnabled}
            onClick={onConfirm}
          >
            出牌
          </TargetActionButton>
        </>
      }
    />
  );
}
