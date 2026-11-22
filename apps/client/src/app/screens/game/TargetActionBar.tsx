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
      <div className="target-action-info">
        {leading}
        <div className="target-action-copy" aria-live="polite">
          <div className="target-action-title">{title}</div>
          {detail != null && <div className="target-action-detail">{detail}</div>}
        </div>
      </div>
      <div className="target-action-buttons">{actions}</div>
    </div>
  );
}

export function TargetActionButton({
  variant,
  className = "",
  ...props
}: Omit<ComponentProps<typeof Button>, "className"> & {
  variant?: "primary" | "commit";
  className?: string;
}) {
  return (
    <Button
      {...props}
      type="button"
      data-variant={variant}
      className={`target-action-button ${className}`}
    />
  );
}
