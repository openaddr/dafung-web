// 组件收口:保留现实现——决策/详情卷轴壳,#729 钉底收口:题行钉顶+正文井内滚+拍板钮 footer 钉底,固定抉择钮组恒在场不随内容滚走(细则 docs/design/组件收口.md)
// 全屏宣告横幅壳(S9 #515:卷轴壳退役后的决策弹层制式,#492 决议②「漆金横幅+朱印题」)。
// ADR-0013 机制零改动:选项集≥2⇔弹层、choices 快照消费、命令路由全在原层,本件只换壳——
// 深墨横幅带(漆木 #332a1e 系)+漆金描边+金印题(印章漆金化,#492 决议①)+正文井(纸色正文)。
// 拖拽(ADR-0031 翻案):横幅决策弹窗支持题名行拖动——「边看边掂量」需要把弹层拖到
// 一旁看盘面,旧判词「横幅是宣告件,无常驻需求」废止。拖拽逻辑单源在
// hooks/use-dialog-drag(与 ui/dialog 底件系同一份),本壳只接三处:题行挂把手、
// 壳体 transform 消费 --drag-x/--drag-y、遮罩随拖离中心减淡(色值单源在 hook)。
import { useEffect, useRef, type ReactNode } from "react";
// #174:焦点陷阱收编为 shared/DialogFocusScope(2026-09-12 起为自研实现,无第三方依赖)
import { DialogFocusScope } from "@app/screens/shared/DialogFocusScope";
// #846 正文井内滚换 ui/scroll-area 底件(#708 现成件):keepMounted 漆金轨道 +
// 溢出门控常显,与 PileShell 同语言;渐隐带在 banner.css 沿底件下发的
// data-overflow-y-* 门控(壳只管结构,滚动提示观感单源在 css)。
import { ScrollArea } from "@app/components/ui/scroll-area";
import { Button } from "@base-ui/react/button";
import "./banner.css";
import { getAudio } from "@app/fx/audio";
// 题名拖动(#674,ADR-0031):原语单源与遮罩色值单源都在 hook 文件
import {
  OVERLAY_TINT,
  OVERLAY_TINT_DIMMED,
  OVERLAY_TINT_STACKED,
  useDialogDrag,
} from "@app/hooks/use-dialog-drag";
// 叠层开栈(#767):同帧多弹层时上层遮罩减淡,计数器单源在 hook 文件
import { useDialogPeekSurface, useDialogStackSlot } from "@app/hooks/dialog-stack";
import { DialogControlIcon, DialogMinimize } from "@app/components/ui/dialog-controls";
import { SCROLL_TESTIDS as T } from "./testids";
import { TESTIDS } from "../testids";

interface BannerShellProps {
  title: string;
  children: ReactNode;
  /** #729 footer 槽:三段式的钉底段(题行钉顶 + 正文井内滚 + 拍板钮钉底)。
   *  摆固定抉择钮组(购地/扩军/选都)或破产结算行——正文内滚合法(浏览内容),
   *  拍板钮恒在场、永不滚出视口。传了才渲染:不可决断的弹层(详情等
   *  钮即内容或无可拍板)不传,槽不占位、零余白。 */
  footer?: ReactNode;
  /** 决策所需的读数，固定在滚动井上方。 */
  summary?: ReactNode;
  /** 可放弃的弹层提供关闭钮。 */
  onClose?: () => void;
  /** 外层容器上的 data-testid(各决策弹层用自己的 id;e2e 契约:scroll-* 前缀保留)。 */
  testid?: string;
  /** 破产清算的资产网格使用较宽的横幅。 */
  wide?: boolean;
  /** 定高分页内容不使用滚动井;由业务网格控制页内密度。 */
  fixedBody?: boolean;
  className?: string;
}

/** 决策弹层共用按钮(旧 .btn .btn-primary → ink-btn/note-btn 种,app.css 材质单源)。
 *  为什么放这:所有决策弹层共用一套按钮观感。 */
export function BannerButton({
  children,
  onClick,
  primary,
  testid,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  testid?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? "ink-btn relative rounded-[5px] px-5 py-2.5 font-brush text-[17px] transition-colors disabled:opacity-40"
          : "note-btn relative rounded-[5px] px-4 py-2 font-brush text-[15px] transition-colors disabled:opacity-40"
      }
    >
      {children}
    </Button>
  );
}

export function BannerShell({
  title,
  children,
  footer,
  summary,
  onClose,
  testid,
  wide,
  fixedBody,
  className,
}: BannerShellProps) {
  useEffect(() => {
    getAudio().play("scrollOpen");
  }, []);

  // 题名拖动(#674):壳体即变量宿主;题名更替 = 内容换新(#90 内容身份由题名承载),
  // 位置随 resetKey 回中心。
  const shellRef = useRef<HTMLDivElement | null>(null);
  const drag = useDialogDrag({ popupRef: shellRef, resetKey: title });
  // 叠层开栈(#767):栈深>1 且本层为上层时
  // 遮罩消费减淡档 --mask-dim-stacked(alpha 单源 app.css,rgb 三元组与两档同族)。
  const peek = useDialogPeekSurface(true);
  const { stacked, frontmost } = useDialogStackSlot(!peek.hidden, false, onClose);

  const shellBody = (
    <div
      ref={(node) => {
        shellRef.current = node;
        peek.element.current = node;
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testid ?? T.scrollShell}
      className={`banner-card banner-shell relative flex max-h-[86dvh] ${
        wide ? "w-[clamp(540px,80vw,700px)]" : "w-[clamp(480px,72vw,640px)]"
      } translate-x-[var(--drag-x,0px)] translate-y-[var(--drag-y,0px)] flex-col px-6 py-4 ${className ?? ""}`}
    >
      {/* 题行:金印 + 笔书题名,兼拖动把手(#674):把手事件与触屏隔离由
          handleProps 承担;行内 X 钮自带豁免(起点命中按钮不启动拖)。题印漆金化:
          漆底金字,朱砂保留给危险/破产语义与按钮;题名金字(漆金题)对漆底 ≥8:1。 */}
      <div
        {...drag.handleProps}
        data-testid={TESTIDS.modalDragHandle}
        data-banner-heading={peek.minimize !== undefined || onClose !== undefined || undefined}
        data-peek-close={peek.minimize !== undefined && onClose !== undefined ? true : undefined}
        className="relative mb-1 flex shrink-0 items-center justify-center gap-2.5 border-b border-[rgba(217,185,92,0.35)] px-1 pb-2 pt-0.5"
      >
        {/* 题印投影 rgba(43,35,23,·) 为裸色:墨影族阴影豁免,登记本体见同域 banner.css 头注 */}
        <span
          aria-hidden="true"
          className="flex h-[24px] w-[24px] flex-none rotate-[-4deg] items-center justify-center rounded-[3px] bg-gradient-to-b from-gold-bright to-gold-deep font-title text-[15px] leading-none text-lacquer shadow-[0_1px_3px_rgba(43,35,23,0.5)]"
        >
          {/* 题印取题名首个汉字:详情题名带「」引号,直取首字会把括号钤进印里 */}
          {title.match(/\p{Script=Han}/u)?.[0] ?? title.slice(0, 1)}
        </span>
        <h2
          data-testid={T.scrollTitle}
          className="m-0 font-title text-[26px] tracking-[4px] text-gold-bright"
        >
          {title}
        </h2>
        {onClose && (
          <Button
            type="button"
            data-testid={T.scrollClose}
            aria-label="关闭"
            onClick={onClose}
            className="dialog-control"
          >
            <DialogControlIcon name="close" />
          </Button>
        )}
        {peek.minimize !== undefined && <DialogMinimize onClick={peek.minimize} />}
      </div>
      {/* 正文井:深墨实底(bg-deep)收口深底可读性——纸色正文 ≈16:1、淡纸 ≈9:1、
          朱砂警示 ≈5.5:1,全部 ≥4.5(漆金带上直接排小字对 danger 仅 ≈4.1,井底加深
          是对比度核查的收口手段,#509 残留 2 在此了结)。#846:井本体 = ui/scroll-area
          根(PileShell 同款底件,keepMounted 轨道首帧可见滚动提示),min-h-0 保住
          限高内滚链(壳体 max-h 86dvh → 井 min-h-0 → viewport flex-1 内滚),
          长内容(破产清单等)横屏也不溢出;内衬 px-3/py-3 随内容走(挂井内包裹层,
          视口缘的渐隐带才贴得住内容断头处,观感口径同 pile-body 内容 margin)。 */}
      {summary != null && <div className="banner-summary">{summary}</div>}
      {fixedBody ? (
        <div className="banner-body banner-body-fixed min-h-0">{children}</div>
      ) : (
        <ScrollArea className="banner-body min-h-0">
          <div className="px-3 py-3">{children}</div>
        </ScrollArea>
      )}
      {/* #729 footer 槽:正文井之后的钉底段。shrink-0 + 壳体 flex-col 限高链
          (max-h-86dvh → 井 min-h-0 → viewport 内滚)让 footer 在场时正文井自然被
          压缩内滚,钮组不随内容滚走;发丝分隔线与题行 border-b 同色对称(#729 拍板),
          水平内衬 px-3 与正文井对齐。 */}
      {footer != null && (
        <div className="mt-1 shrink-0 border-t border-[rgba(217,185,92,0.35)] px-3 pt-1">
          {footer}
        </div>
      )}
    </div>
  );

  // 原地保留正文树。最小化时遮罩退出命中，横幅退出焦点栈。
  return (
    <div
      className={`banner-overlay absolute inset-0 z-30 flex items-center justify-center`}
      data-testid={peek.minimize !== undefined ? TESTIDS.modalBackdrop : undefined}
      hidden={peek.hidden}
      aria-hidden={peek.hidden || undefined}
      inert={peek.hidden || undefined}
      // 遮罩两档减淡(#674 拖离 + #767 叠层):拖离减淡(0.15)强于叠层减淡(0.28),
      // 两者同时命中取更强;色值单源在 hook 文件
      style={{
        backgroundColor: drag.dimmed
          ? OVERLAY_TINT_DIMMED
          : stacked
            ? OVERLAY_TINT_STACKED
            : OVERLAY_TINT,
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget || peek.hidden || !frontmost) return;
        if (peek.minimize !== undefined) peek.minimize();
        else onClose?.();
      }}
    >
      <DialogFocusScope
        asChild
        active={!peek.hidden && frontmost}
        restoreOnClose={!peek.hidden && frontmost}
      >
        {shellBody}
      </DialogFocusScope>
    </div>
  );
}
