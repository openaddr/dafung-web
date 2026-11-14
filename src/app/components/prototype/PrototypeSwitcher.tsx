// 临时原型工具，留在原型分支：URL 切换样张，不进入正式产品。
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@base-ui/react/button";
import { Sym } from "@app/screens/shared/Sym";

export function PrototypeSwitcher<T extends string>({
  variants,
  current,
  onChange,
  state,
  hostTestId,
}: {
  variants: ReadonlyArray<{ key: T; label: string }>;
  current: T;
  onChange: (key: T) => void;
  state: string;
  hostTestId: string;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${hostTestId}"]`);
    if (!el) throw new Error("原型切换条缺少手册宿主");
    setHost(el);
  }, [hostTestId]);
  const step = (delta: number) => {
    const index = variants.findIndex((v) => v.key === current);
    if (index < 0) throw new Error("原型编号不在切换目录中");
    onChange(variants[(index + delta + variants.length) % variants.length]!.key);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input,textarea,[contenteditable]:not([contenteditable='false'])")
      )
        return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      step(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  if (!import.meta.env.DEV || host === null) return null;
  const selected = variants.find((v) => v.key === current);
  if (!selected) throw new Error("原型编号不在切换目录中");
  return createPortal(
    <div className="treasure-prototype-switcher" aria-label="原型比较工具">
      <Button aria-label="上一个原型" onClick={() => step(-1)}>
        <Sym name="back" size={15} />
      </Button>
      <div role="status" aria-live="polite">
        <span>
          原型 {current} · {selected.label}
        </span>
        <small>{state}</small>
      </div>
      <Button aria-label="下一个原型" onClick={() => step(1)}>
        <Sym name="back" size={15} className="rotate-180" />
      </Button>
    </div>,
    host,
  );
}
