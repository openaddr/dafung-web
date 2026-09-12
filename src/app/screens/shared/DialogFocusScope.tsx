// #174:弹层焦点口径统一封装——@radix-ui/react-focus-scope 的「惯用法」薄壳。
// 吞并原 useDialogFocus 的手写 Tab 陷阱(S4 #37 的 window keydown 圈定),与 ScrollShell
// 的内联用法归一为同一实现;Base UI 无独立 FocusScope(#158),本原语是 CLAUDE.md 红线 #6
// 豁免条款钦定的单点。口径三条(新弹层一律沿用):
// 1. 挂载不夺焦:onMountAutoFocus 恒 preventDefault——首焦点若落在 × 关闭钮会促成 Enter
//    误关;焦点已在容器内(输入框 autoFocus)或在外(触发钮持有)都不打扰。
// 2. Tab 不出容器:trapped 后由 FocusScope 的 focusin/focusout 双通道圈定,焦点漂出
//    (点遮罩等)即被拉回,Tab 到边缘 preventDefault 钉住。
// 3. 关闭还焦:FocusScope 默认行为——卸载时把焦点还给挂载前的元素,无需自写 restoreRef。
// (原 useDialogFocus 的 focusKey 异步重试随其最后一个消费方 MapSelectPanel 迁往
//  ui/dialog(#173)一并退场,不再保留无主能力。)
import type { ReactNode } from "react";
import * as FocusScopePrimitive from "@radix-ui/react-focus-scope";

export interface DialogFocusScopeProps {
  /** 把陷阱行为合并到子元素上(ScrollShell/VictoryScreen 均以此挂壳,不引入额外 DOM 节点)。 */
  asChild?: boolean;
  children: ReactNode;
}

export function DialogFocusScope({ asChild, children }: DialogFocusScopeProps) {
  return (
    <FocusScopePrimitive.Root trapped asChild={asChild} onMountAutoFocus={(e) => e.preventDefault()}>
      {children}
    </FocusScopePrimitive.Root>
  );
}
