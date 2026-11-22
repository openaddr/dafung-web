import type { CSSProperties, ReactNode } from "react";
import { effectViewport, type EffectBox } from "./effect-viewport";

/** 真正绘制的mini-svg必须有完整非零局部盒;defs/静态字形测量不走本件。 */
export function FxViewport({
  box,
  children,
  style,
  className = "",
}: {
  box: EffectBox;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  const viewport = effectViewport(box);
  return (
    <svg
      className={`bv-fx-svg ${className}`}
      width={viewport.width}
      height={viewport.height}
      viewBox={viewport.viewBox}
      style={{ ...viewport.style, ...style }}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
