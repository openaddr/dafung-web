import { useState } from "react";
import { TargetActionBar, TargetActionButton } from "./TargetActionBar";
import { TESTIDS } from "./testids";

export interface PrimaryAction {
  label: string;
  variant: "commit" | "primary";
}

interface ActionBarProps {
  title: string;
  collapsed: boolean;
  detail?: string;
  primaryAction: PrimaryAction;
  cancelLabel?: string;
  canConfirm: boolean;
  locked: boolean;
  onPlay: () => void;
  onPass: () => void;
  onBack?: () => void;
  onBlockedAttempt: () => void;
}

export function ActionBar({
  title,
  collapsed,
  detail,
  primaryAction,
  cancelLabel,
  canConfirm,
  locked,
  onPlay,
  onPass,
  onBack,
  onBlockedAttempt,
}: ActionBarProps) {
  const targeting = cancelLabel != null;
  const [bump, setBump] = useState(false);
  if (collapsed) {
    return (
      <div
        data-testid={TESTIDS.actionbar}
        className="target-action-bar target-action-phase"
        aria-live="polite"
      >
        出牌阶段
      </div>
    );
  }
  return (
    <TargetActionBar
      testId={TESTIDS.actionbar}
      title={title}
      detail={detail}
      actions={
        <>
          {onBack != null && (
            <TargetActionButton
              data-testid={TESTIDS.actionbarPrevious}
              disabled={locked}
              onClick={onBack}
            >
              上一步
            </TargetActionButton>
          )}
          <TargetActionButton
            data-testid={targeting ? TESTIDS.actionbarCancel : TESTIDS.actionbarPass}
            disabled={locked}
            onClick={onPass}
          >
            {cancelLabel ?? "不出"}
          </TargetActionButton>
          <TargetActionButton
            variant={primaryAction.variant}
            data-testid={targeting ? TESTIDS.actionbarTarget : TESTIDS.actionbarPlay}
            className={bump ? "bump" : undefined}
            disabled={locked || (targeting && !canConfirm)}
            aria-disabled={!canConfirm || undefined}
            onAnimationEnd={() => setBump(false)}
            onClick={() => {
              if (canConfirm) {
                onPlay();
              } else {
                setBump(true);
                onBlockedAttempt();
              }
            }}
          >
            {primaryAction.label}
          </TargetActionButton>
        </>
      }
    />
  );
}
