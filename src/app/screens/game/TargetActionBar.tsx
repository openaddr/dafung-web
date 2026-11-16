// 组件收口：动作按钮复用 Base UI Button，动作条定位和漆金皮留在本件。
import { Button } from "@base-ui/react/button";
import type { ComponentProps, ReactNode } from "react";
import "./target-action-bar.css";

interface TargetActionBarProps {
  title: ReactNode;
  detail?: ReactNode;
  actions: ReactNode;
  testId: string;
  leading?: ReactNode;
  className?: string;
}

export function TargetActionBar({
  title,
  detail,
  actions,
  testId,
  leading,
  className = "",
}: TargetActionBarProps) {
  return (
    <div data-testid={testId} className={`target-action-bar ${className}`}>
      {leading}
      <div className="target-action-copy" aria-live="polite">
        <div className="target-action-title">{title}</div>
        {detail != null && <div className="target-action-detail">{detail}</div>}
      </div>
      <div className="target-action-buttons">{actions}</div>
    </div>
  );
}

export function TargetActionButton({
  primary,
  className = "",
  ...props
}: Omit<ComponentProps<typeof Button>, "className"> & { primary?: boolean; className?: string }) {
  return (
    <Button
      {...props}
      type="button"
      className={`target-action-button${primary ? " primary" : ""} ${className}`}
    />
  );
}
