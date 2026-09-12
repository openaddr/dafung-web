// 弹层焦点口径统一封装——自研 FocusScope 等价原语(#158:Base UI 无独立 FocusScope,
// 原 @radix-ui/react-focus-scope 于 2026-09-12 移除,全仓 Radix 依赖归零)。
// 吞并原 useDialogFocus 的手写 Tab 陷阱(S4 #37 的 window keydown 圈定),与 ScrollShell
// 的内联用法归一为同一实现;本原语是 CLAUDE.md 红线 #6 豁免条款钦定的全仓唯一自写
// 交互语义集中点。口径三条(新弹层一律沿用):
// 1. 挂载不夺焦:恒不自动聚焦容器内首件——首焦点若落在 × 关闭钮会促成 Enter 误关;
//    焦点已在容器内(输入框 autoFocus)或在外(触发钮持有)都不打扰。
// 2. Tab 不出容器:document 级 keydown 圈定——容器内 Tab/Shift+Tab 到边缘 preventDefault
//    回绕;焦点在外(含点遮罩掉焦到 body)时 Tab 重新进容器。focusin 漂出即拉回最近容器内
//    焦点位。
// 3. 关闭还焦:卸载时把焦点还给挂载前的元素(元素已离 DOM 则放弃,不猜转移目标)。
// (原 useDialogFocus 的 focusKey 异步重试随其最后一个消费方 MapSelectPanel 迁往
//  ui/dialog(#173)一并退场,不再保留无主能力。)
import { cloneElement, isValidElement, useEffect, useRef, type ReactNode, type Ref } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** 可聚焦且实际渲染(inert/display:none 排除;含离屏但非隐藏的元素,遮罩拖拽场景需要)。 */
function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.closest("[inert]") && el.getClientRects().length > 0,
  );
}

export interface DialogFocusScopeProps {
  /** 把陷阱行为合并到子元素上(ScrollShell/VictoryScreen 均以此挂壳,不引入额外 DOM 节点;
   *  子元素自带 ref 时与其组合,不覆盖——Shell 的拖拽 bodyRef 依赖这一点)。 */
  asChild?: boolean;
  children: ReactNode;
}

export function DialogFocusScope({ asChild, children }: DialogFocusScopeProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  // 挂载前持有焦点的元素(卸载还焦目标);lastInner = 最近一次容器内焦点位(拉回锚点)。
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const lastInnerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    lastInnerRef.current = container.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;

    // Tab 圈定:容器内到边缘回绕;焦点在外时重新进容器(方向跟随 Shift)。
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const scope = containerRef.current;
      if (!scope) return;
      const focusables = focusableIn(scope);
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && scope.contains(active);
      if (!inside) {
        // 挂载不夺焦口径下的首次 Tab:从边缘进入,方向与按键一致。
        if (focusables.length) {
          e.preventDefault();
          (e.shiftKey ? focusables[focusables.length - 1] : focusables[0]).focus();
        }
        return;
      }
      if (!focusables.length) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // 焦点漂出即拉回:点遮罩 mousedown 掉焦到 body、程序性 focus 到外部等。
    const onFocusIn = (e: FocusEvent) => {
      const scope = containerRef.current;
      if (!scope) return;
      const target = e.target as Node;
      if (scope.contains(target)) {
        lastInnerRef.current = target as HTMLElement;
        return;
      }
      const anchor =
        lastInnerRef.current && scope.contains(lastInnerRef.current)
          ? lastInnerRef.current
          : focusableIn(scope)[0];
      anchor?.focus();
    };

    // 掉焦补拍:blur()/非焦点元素点击在 Chromium 不派发 body 的 focusin,容器 focusout
    // (relatedTarget 出容器或为 null)延迟一帧复查,焦点仍在外才拉回。
    const onFocusOut = (e: FocusEvent) => {
      const scope = containerRef.current;
      if (!scope) return;
      const next = e.relatedTarget as Node | null;
      if (next && scope.contains(next)) return;
      const anchor =
        lastInnerRef.current && scope.contains(lastInnerRef.current)
          ? lastInnerRef.current
          : focusableIn(scope)[0];
      setTimeout(() => {
        const live = containerRef.current;
        if (!live) return;
        const active = document.activeElement;
        if (!active || (active !== document.body && !live.contains(active))) return;
        anchor?.focus();
      }, 0);
    };

    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("focusin", onFocusIn, true);
    container.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("keydown", onKeydown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      container.removeEventListener("focusout", onFocusOut);
      // 关闭还焦:还给挂载前持有者;已被卸载/离 DOM 则放弃(不猜转移目标)。
      const prev = prevFocusRef.current;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, []);

  if (!asChild || !isValidElement(children)) {
    return (
      <div ref={containerRef as Ref<HTMLDivElement>} style={{ display: "contents" }}>
        {children}
      </div>
    );
  }
  const child = children as React.ReactElement<{ ref?: Ref<HTMLElement> }>;
  return cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      containerRef.current = node;
      const childRef = child.props.ref;
      if (typeof childRef === "function") childRef(node);
      else if (childRef && typeof childRef === "object") childRef.current = node;
    },
  });
}
