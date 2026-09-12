// 通用确认弹层:对照旧 createConfirm(选都确认等场景)。
// 不走 ScrollShell 的完整卷轴,用旧 confirm-box 的小卡片形态(标题 + 正文 + 两按钮)。
// #153 收口到 ui/dialog(Base UI 水墨底件):role=dialog/aria-labelledby/aria-describedby、
// 焦点陷阱、Esc 关闭、关闭还焦、初始聚焦确认钮全部由底件白拿;水墨小卡视觉、
// scroll-anim 入场动画与全部 data-testid 与旧自绘版一致,调用方 props 签名不变。
// 模态口径(#155/#158 结论):backdropBlocks=true → modal=true(全模态:焦点陷阱 +
// 锁滚 + 内部底衬拦棋盘,编辑器重置/导入失败同旧遮罩拦截体验);backdropBlocks=false
// → modal="trap-focus"(只陷阱焦点,不锁滚、不拦外部指针)——选都确认态下棋盘保持
// 可点,玩家点另一座候选城即可换选择,弹窗内容跟随不关(旧版确认框同体验)。
import { useEffect, useRef, type ReactNode } from "react";
import "./scroll.css";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@app/components/ui/dialog";
import { ScrollButton } from "./ScrollShell";
import { SCROLL_TESTIDS as T } from "./testids";

export interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 遮罩是否拦截棋盘点击(默认拦截)。选都确认传 true 之外的 false:
   *  弹窗不关的前提下直接点其它可选城即可切换目标(弹窗内容跟随),旧版确认框同体验。 */
  backdropBlocks?: boolean;
  /** 容器 testid 覆盖(默认 scroll-confirm;选都确认框传专用 testid 便于 e2e 定位)。 */
  testid?: string;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel = "确认",
  cancelLabel = "取消",
  onConfirm,
  onCancel,
  backdropBlocks = true,
  testid,
}: ConfirmDialogProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  // 关闭还焦(硬卸载路径的兜底):本组件由调用方条件挂载、按钮点击后整树卸载,
  // 不走 Base UI open→false 的收起流程(其 returnFocus 挂在关闭事件上)。若焦点
  // 随弹层消失落到 body,则还焦给打开前聚焦的元素(如编辑器的「重置地图」钮);
  // Base UI 已自行还焦时 activeElement 非 body,本兜底自动让位。
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    return () => {
      if (document.activeElement === document.body && previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  // 全模态焦点补拍(旧 G-4 窗口级陷阱的同口径接替):旧口径点遮罩不关闭,mousedown
  // 会让焦点掉到 body(Chrome 此时不派发 focusin,且 Base UI 对 pointerdown-outside
  // 会抑制自身的 restoreFocus,必须自己接);Base UI 的陷阱守卫只拦「穿过弹层边界」
  // 的 Tab,焦点已在外时首个 Tab 会走入弹层外 DOM。模态下外部被内部底衬拦住、没有
  // 合法的焦点外落目标,故双钩子拉回:
  //   1) 弹层内焦点 focusout 且去处不在弹层内 → 帧末拉回确认钮(覆盖点遮罩掉焦);
  //   2) Tab 按下时焦点不在弹层内 → 拦下并聚焦确认钮(覆盖任意游离态,同旧实现)。
  // 监听挂 document、popup 在事件时经 ref 实时解析——Base UI Portal 两段式挂载,
  // effect 首跑时弹层尚未进 DOM,挂弹层元素上会扑空。非模态(trap-focus)不补拍:
  // 点城换选择时焦点移出弹层是合法流程(#155)。
  useEffect(() => {
    if (!backdropBlocks) return;
    const focusFirst = () =>
      popupRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const onFocusOut = (e: FocusEvent) => {
      const popup = popupRef.current;
      if (!popup || !(e.target instanceof Node) || !popup.contains(e.target)) return;
      const next = e.relatedTarget;
      if (next instanceof Node && popup.contains(next)) return;
      requestAnimationFrame(() => {
        const p = popupRef.current;
        // 弹层已卸载(确认/取消关框)则让位给关闭还焦兜底
        if (p?.isConnected && !p.contains(document.activeElement)) focusFirst();
      });
    };
    const onTab = (e: KeyboardEvent) => {
      const popup = popupRef.current;
      if (e.key !== "Tab" || !popup || popup.contains(document.activeElement)) return;
      e.preventDefault();
      focusFirst();
    };
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("keydown", onTab);
    return () => {
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("keydown", onTab);
    };
  }, [backdropBlocks]);

  return (
    <Dialog
      open
      // #155:非模态用 "trap-focus"——焦点仍陷阱在两按钮间(旧 G-4 口径),但文档
      // 不锁滚、外部指针交互放行(棋盘点城可达),棋盘在选都确认态保持可点。
      modal={backdropBlocks ? true : "trap-focus"}
      // 旧口径:点遮罩空白不关闭(出口只有 Esc 与两按钮);disablePointerDismissal
      // 在非模态下同时关掉「焦点移出即关」——点城换选择时焦点必然移出弹层。
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        ref={popupRef}
        data-testid={testid ?? T.confirmDialog}
        overlayProps={{
          className: "scroll-anim-overlay",
          // 非模态遮罩只保留暗纱视觉、放行点击。必须内联 style:scroll-anim-overlay
          // 自带 pointer-events:auto(未分层 CSS 恒压过 utilities 层的 none 类)。
          style: backdropBlocks ? undefined : { pointerEvents: "none" },
        }}
        // 弹层居中改 auto-margin 口径(inset-0 + m-auto + 尺寸自适应):入场动画
        // scroll-anim-unroll 的关键帧写 transform,会覆盖底件默认 -translate-x/y-1/2
        // 居中位移造成开场跳位;translate-x/y-0 抵消默认位移后动画帧只承担落位动势。
        // 切勿加 relative(会经 twMerge 顶掉底件默认的 fixed,fixed 同样是挂轴
        // absolute 定位的包含块)。pointer-events-auto:遮罩放行时卡片仍要接住点击。
        className={
          "inset-0 m-auto h-max w-max translate-x-0 translate-y-0 max-w-[400px] px-7 scroll-anim-unroll" +
          (backdropBlocks ? "" : " pointer-events-auto")
        }
      >
        {/* 挂轴单杆(视觉重做 v2):小确认卡也带顶杆,与决策卷轴同一器物语言 */}
        <div aria-hidden="true" className="pointer-events-none absolute -inset-x-4 -top-2.5 z-10 flex h-[17px] items-center">
          <span className="h-[17px] w-[17px] flex-none rounded-full bg-gradient-to-b from-[#5c4c34] to-[#241c11] shadow-[0_1px_3px_rgba(43,35,23,0.5)]" />
          <span className="h-[11px] flex-1 bg-gradient-to-b from-[#56462e] via-[#3a2f1e] to-[#241c11] shadow-[inset_0_1px_0_rgba(217,185,92,0.4)]" />
          <span className="h-[17px] w-[17px] flex-none rounded-full bg-gradient-to-b from-[#5c4c34] to-[#241c11] shadow-[0_1px_3px_rgba(43,35,23,0.5)]" />
        </div>
        <DialogTitle data-testid={T.scrollTitle} className="mb-2 text-center text-xl">
          {title}
        </DialogTitle>
        {/* #91(R3-C4) 与 ScrollShell 同步两层摊开:标题随卡片壳体(scroll-anim-unroll)
            淡入落位,标题以下的纸身(正文+按钮)以顶缘为轴 scaleY 展开,标题字不压扁。 */}
        <div className="scroll-anim-unroll-paper">
          {/* W2 包E(审计 A5):正文是动态 children(地图名/城名等),字族迁 wenkai 不落小薇。
              底件 DialogTitle/DialogDescription 白拿 aria-labelledby/aria-describedby 口径。 */}
          <DialogDescription className="mb-3.5 font-wenkai text-[17px] text-ink">{children}</DialogDescription>
          <div className="flex flex-wrap justify-center gap-3">
            {/* 传了专用 testid 时按钮随容器命名(<tid>-ok / <tid>-cancel),
                e2e 无需知道通用/专用两套名字 */}
            <ScrollButton primary testid={testid ? `${testid}-ok` : T.confirmOk} onClick={onConfirm}>
              {confirmLabel}
            </ScrollButton>
            <ScrollButton testid={testid ? `${testid}-cancel` : T.confirmCancel} onClick={onCancel}>
              {cancelLabel}
            </ScrollButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
