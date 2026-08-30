// S4(#37):弹层焦点陷阱共享 hook——把 ConfirmDialog 已有的「Tab 圈定」口径抽成通用件,
// 供 MapSelectPanel / 编辑器 InputScroll 等未内建陷阱的弹层接入,消除与 ConfirmDialog 的双标。
// 行为三件事:
// 1. 打开聚焦首项:挂载时聚焦容器内首个可聚焦元素;焦点已在容器内则不打扰
//    (InputScroll 的输入框 autoFocus 保持直接可输入的手感)。focusKey 变化时重试——
//    清单异步加载完成后首项才出现的场景(MapSelectPanel)。
// 2. Tab 不出面板:Tab / Shift+Tab 恒在容器内循环(与 ConfirmDialog 同口径);
//    焦点漂到容器外(点遮罩等)时下一次 Tab 拉回。
// 3. 关闭还焦:卸载时把焦点还给打开前的触发元素。
import { useEffect, useRef, type RefObject } from "react";

/** 可聚焦元素选择器(比 ConfirmDialog 的 button 口径放宽到常规可聚焦控件;disabled 不入列)。 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function useDialogFocus(container: RefObject<HTMLElement | null>, focusKey?: unknown) {
  // 还焦目标只在首挂载捕获:focusKey 重试不得把它覆盖成弹层内元素
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restoreRef.current ??= document.activeElement as HTMLElement | null;
    return () => {
      restoreRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const inside = () => {
      const cur = document.activeElement;
      return cur instanceof Node && el.contains(cur);
    };
    if (!inside()) {
      el.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = el.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!inside()) {
        // 焦点在容器外:拉回循环(方向按 shift)
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [container, focusKey]);
}
