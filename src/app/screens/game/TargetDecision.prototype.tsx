import type { ReactNode } from "react";
import "./target-decision.prototype.css";

export const targetDemo =
  import.meta.env.MODE === "target-prototype"
    ? new URLSearchParams(window.location.search).get("target-demo")
    : null;

export function TargetDecisionPrototype({
  title,
  prompt,
  timer,
  actions,
  testId,
}: {
  title: string;
  prompt: string;
  timer?: ReactNode;
  actions: ReactNode;
  testId: string;
}) {
  return (
    <div className="target-decision-prototype" data-testid={testId}>
      {timer}
      <div className="target-decision-prototype-copy">
        <div>{title}</div>
        <p aria-live="polite">{prompt}</p>
      </div>
      <div className="target-decision-prototype-actions">{actions}</div>
    </div>
  );
}
