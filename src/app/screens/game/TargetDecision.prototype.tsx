import type { ReactNode } from "react";
import "./target-decision.prototype.css";

export const targetDemo =
  import.meta.env.MODE === "target-prototype"
    ? new URLSearchParams(window.location.search).get("target-demo")
    : null;

export function TargetDecisionPrototype({
  title,
  affected,
  prompt,
  timer,
  mute,
  actions,
  testId,
}: {
  title: string;
  affected?: string;
  prompt: string;
  timer?: ReactNode;
  mute?: ReactNode;
  actions: ReactNode;
  testId: string;
}) {
  return (
    <div className="target-decision-prototype" data-testid={testId}>
      {timer}
      <div className="target-decision-prototype-copy">
        <div>{title}</div>
        {affected && <p>{affected}</p>}
        <p className="target-decision-prototype-prompt" aria-live="polite">
          {prompt}
        </p>
      </div>
      {mute}
      <div className="target-decision-prototype-actions">{actions}</div>
    </div>
  );
}
