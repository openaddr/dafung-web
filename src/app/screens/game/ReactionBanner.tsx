import { useEffect, useMemo, useState } from "react";
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
  onConfirm: () => void;
  onDecline: () => void;
  onMute: () => void;
}

const ARC_R = 15;

/** 倒计时从当前窗已过的时刻开始。 */
export function ReactionBanner({
  text,
  range,
  step,
  durationMs,
  deadlineAt,
  confirmEnabled,
  locked,
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
    let previous: number | undefined;
    const beat = () => {
      const remain = Math.max(0, deadlineAt - performance.now());
      const secs = Math.ceil(remain / 1000);
      setSeconds(secs);
      if (previous != null && secs > 0 && secs <= 5 && secs < previous) {
        getAudio().play("reactionTick");
      }
      previous = secs;
      if (secs > 0) timeout = setTimeout(beat, Math.max(1, remain - (secs - 1) * 1000));
    };
    beat();
    return () => clearTimeout(timeout);
  }, [deadlineAt]);
  const disabled = locked || seconds === 0;

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
          {step != null && (
            <div className="reaction-step" data-testid={TESTIDS.reactionStep}>
              {step}
            </div>
          )}
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
            primary
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
