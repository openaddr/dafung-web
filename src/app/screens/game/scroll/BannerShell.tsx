// 全屏宣告横幅壳(S9 #515:卷轴壳退役后的决策弹层制式,#492 决议②「漆金横幅+朱印题」)。
// ADR-0013 机制零改动:选项集≥2⇔弹层、choices 快照消费、命令路由全在原层,本件只换壳——
// 深墨横幅带(漆木 #332a1e 系)+漆金描边+金印题(印章漆金化,#492 决议①)+正文井(纸色正文)。
// 入场 = 横幅自上缘压下+淡入(banner.css banner-drop,--dur-slow 单拍);收起 = 上浮淡出
// (banner-lift,--dur-fast),「播完再移除」的 210ms 出口沿用旧卷轴口径(--dur-fast 150ms
// + 60 余量,与幽灵帧 GHOST.frameMs/timings.ts 同一条 210,fx 层单源不在此复制)。
// 行为基座沿用旧壳:shared/DialogFocusScope 自研焦点陷阱(#174 收编)——活横幅获得焦点
// 陷阱/关闭还焦 + role=dialog/aria-modal;收起中与幽灵退场帧不走 FocusScope(纯视觉重放,
// 自带 aria-hidden/inert)。刻意不用 Dialog.Content:它强制 Portal 会破坏 #scroll-layer
// 定位栈与幽灵帧协议。
// 拖拽(ADR-0031 翻案):横幅决策弹窗支持题名行拖动——「边看边掂量」需要把弹层拖到
// 一旁看盘面,旧判词「横幅是宣告件,无常驻需求」废止。拖拽逻辑单源在
// hooks/use-dialog-drag(与 ui/dialog 底件系同一份),本壳只接三处:题行挂把手、
// 壳体 transform 消费 --drag-x/--drag-y、遮罩随拖离中心减淡(色值单源在 hook)。
// 退场帧(幽灵帧/banner-anim-out)不绑拖动:exit 重放是纯视觉,把手事件随活实例
// 卸载失效,退场帧整体 inert+pointer-events:none 不可达。入场动画 banner-drop 写
// transform、与 translate 属性叠加合成,动画进行中拖动照录变量、动画结束后位移生效。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
// #174:焦点陷阱收编为 shared/DialogFocusScope(2026-09-12 起为自研实现,无第三方依赖)
import { DialogFocusScope } from "@app/screens/shared/DialogFocusScope";
import "./banner.css";
import { getAudio } from "@app/fx/audio";
import { Sym } from "@app/screens/shared/Sym";
// 题名拖动(#674,ADR-0031):原语单源与遮罩色值单源都在 hook 文件
import { OVERLAY_TINT, OVERLAY_TINT_DIMMED, useDialogDrag } from "@app/hooks/use-dialog-drag";
import { SCROLL_TESTIDS as T } from "./testids";
import { TESTIDS } from "../testids";

/** #90(R3-C3)退场幽灵帧开关:DecisionScrollLayer 相位切换时把上一个子节点快照
 *  再渲染 210ms 作退场帧,用本上下文标记该实例是幽灵——Shell 直接以退场类登场,
 *  不重放入场动画、不重播横幅音(它不是新开的弹层,是旧弹层退场的重放帧)。 */
export const BannerGhostContext = createContext(false);

export interface BannerShellProps {
  title: string;
  children: ReactNode;
  /** 只有可放弃的弹层(详情/确认/等待视角)才传;抉择类必须选,不误关(旧卷轴同策略)。
   *  传了 onClose 即支持:点遮罩空白关闭 + Esc 关闭(与 ConfirmDialog 的 Esc 惯例一致)。 */
  onClose?: () => void;
  /** 外层容器上的 data-testid(各决策弹层用自己的 id;e2e 契约:scroll-* 前缀保留)。 */
  testid?: string;
}

/** 决策弹层共用按钮(旧 .btn .btn-primary → ink-btn/note-btn 种,app.css 材质单源)。
 *  为什么放这:所有决策弹层共用一套按钮观感。 */
export function BannerButton({
  children,
  onClick,
  primary,
  testid,
  // UI F1:决策类按钮可能不可选(银两/委任不足、满级)——disabled + title 原因,
  // 口径与引擎选项集注册表一致,由壳统一观感
  disabled,
  title,
  // G-19:决策快捷键角标(1/2/3);仅展示用,按键监听在 DecisionScrolls
  shortcut,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  testid?: string;
  disabled?: boolean;
  title?: string;
  shortcut?: number;
}) {
  // #90:幽灵退场帧里的按钮一律 disabled——e2e/用户的选择器(如
  // `button[data-testid^="action-"]:not([disabled])`)在 210ms 退场窗口内
  // 不会再命中死钮吞掉真实点击。
  // #93(R3-C6)决策按钮主次权重:primary 升档为墨钮(漆底金字)+加大字号
  // 与内边距;secondary 降半档只缩字号。并排时主次一眼可辨。disabled 两类口径不变
  // (disabled:opacity-40);次级笺钮在横幅上的描边/衬底收口见 banner.css(.banner-shell .note-btn)。
  const isGhost = useContext(BannerGhostContext);
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      disabled={disabled || isGhost}
      title={title}
      className={
        (primary
          ? "ink-btn relative cursor-pointer rounded-[5px] px-5 py-2.5 font-brush text-[17px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          : "note-btn relative cursor-pointer rounded-[5px] px-4 py-2 font-brush text-[15px] transition-colors hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40") +
        (shortcut != null ? " pr-5" : "")
      }
    >
      {children}
      {shortcut != null && (
        <span
          aria-hidden="true"
          className="absolute top-0.5 right-1 font-deco text-[10px] leading-none text-ink-dim"
        >
          {shortcut}
        </span>
      )}
    </button>
  );
}

export function BannerShell({ title, children, onClose, testid }: BannerShellProps) {
  // #90(R3-C3)收起:×/遮罩/Esc 统一走 requestClose——先置 closing(壳体挂退场类、
  // 遮罩淡出并放行点击、aria-hidden),210ms 后(退场动画 var(--dur-fast) =150ms 已走完)
  // 再调真 onClose 卸载。「播完再移除」模式照抄 useDeltaFloat 的定时出列;
  // 零兜底:只有一个明确的 setTimeout,不设超时兜底分支。
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 相位切换的幽灵帧(BannerGhostContext)与本地 closing 同样按收起处理
  const isGhost = useContext(BannerGhostContext);
  const exiting = closing || isGhost;

  const requestClose = useCallback(() => {
    // 计时器在途 = 已在收起,忽略重复出口(Esc 连按/遮罩二次点击)
    if (!onClose || closeTimerRef.current !== null) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 210); // 收起出口 = 退场 150ms(--dur-fast)+ 60 余量。刻意字面量不进倍率:
    // 地板 100ms 会砍断退场动画并与幽灵帧同刻竞态(#117 评审实测并行两连挂)。
  }, [onClose]);

  // 收起途中组件被外部直接卸载(如整屏切换)时清理计时器
  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    },
    [],
  );
  // 卷声挂点迁到横幅出现(S9 #515):复用既有 scroll-unroll 音效文件(新音归 S7 演出包),
  // 挂载即播,与 banner-drop 动画 0ms 同帧起步;播放惯例与 DiceOverlay 的 useEffect 内
  // getAudio().play 一致,静音由播放器内部处理。幽灵帧(退场重放)跳过——旧弹层收走时不能再喊一声。
  useEffect(() => {
    if (isGhost) return;
    getAudio().play("scrollOpen");
  }, [isGhost]);
  // #34:可关弹层补 Esc 快捷键(与 ConfirmDialog 的 Esc 惯例统一)
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, requestClose]);
  // #90:收起途中同实例换了内容主体(如详情弹层 A 未收完就点了城 B)则撤销收起——
  // 否则退场动画的 fill forwards 会把新内容也钉在 opacity 0 上,弹层永久隐身。
  // 内容身份由题名承载(详情题名带城名,A→B 题名必变),不再另设内容键。
  useEffect(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
      setClosing(false);
    }
  }, [title]);

  // 题名拖动(#674):壳体即变量宿主;题名更替 = 内容换新(#90 内容身份由题名承载),
  // 位置随 resetKey 回中心。
  const shellRef = useRef<HTMLDivElement | null>(null);
  const drag = useDialogDrag({ popupRef: shellRef, resetKey: title });

  // 壳体本体(横幅带 + 金印题行 + 正文井):活横幅与退场帧两条渲染路径共用同一份 JSX。
  // role=dialog/aria-modal 挂壳体(可达名称用 aria-label=题名);退场帧的父层已
  // aria-hidden+inert,壳上的 role 对辅助技术不可见,无需按路径分支。
  // translate 消费 --drag-x/--drag-y(缺省 0px = 原居中;banner-drop/lift 写 transform,
  // 与 translate 属性叠加合成——入场动画进行中拖动照录变量,动画结束位移生效)。
  const shellBody = (
    <div
      ref={shellRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testid ?? T.scrollShell}
      className={`banner-card banner-shell relative flex max-h-[86dvh] w-[min(92vw,640px)] translate-x-[var(--drag-x,0px)] translate-y-[var(--drag-y,0px)] flex-col px-6 py-4 ${
        exiting ? "banner-anim-out" : ""
      }`}
    >
      {/* 题行:金印 + 笔书题名,兼拖动把手(#674):把手事件/触屏隔离/抓取光标由
          handleProps 承担;行内 X 钮自带豁免(起点命中按钮不启动拖)且自身
          cursor-pointer 类在钮上恒胜继承的 grab。题印漆金化(#492 决议①「印章漆金化」):
          漆底金字,朱砂保留给危险/破产语义与按钮;题名金字(漆金题)对漆底 ≥8:1。 */}
      <div
        {...drag.handleProps}
        data-testid={TESTIDS.modalDragHandle}
        className="relative mb-3 flex shrink-0 items-center justify-center gap-2.5 border-b border-[rgba(217,185,92,0.35)] px-1 pb-2 pt-0.5"
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
          // #64:44px 热区不变,视觉为漆金发丝描边圆钮;hover 用 group 让整个热区点亮。
          <button
            type="button"
            data-testid={T.scrollClose}
            aria-label="关闭"
            onClick={(e) => {
              e.stopPropagation();
              requestClose();
            }}
            disabled={isGhost}
            className="group absolute top-1/2 right-[-8px] flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center disabled:cursor-default"
          >
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(217,185,92,0.35)] text-ink-dim transition-colors group-hover:bg-[rgba(217,185,92,0.12)] group-hover:text-gold-bright"
            >
              <Sym name="close" size={13} />
            </span>
          </button>
        )}
      </div>
      {/* 正文井:深墨实底(bg-deep)收口深底可读性——纸色正文 ≈16:1、淡纸 ≈9:1、
          朱砂警示 ≈5.5:1,全部 ≥4.5(漆金带上直接排小字对 danger 仅 ≈4.1,井底加深
          是对比度核查的收口手段,#509 残留 2 在此了结)。min-h-0 保住限高内滚链
          (壳体 max-h 86dvh → 内容区 min-h-0 overflow-y-auto),长内容(破产清单等)
          横屏也不溢出。 */}
      <div className="banner-body min-h-0 overflow-y-auto px-3 py-3">{children}</div>
    </div>
  );

  // 收起中/幽灵帧:纯视觉退场帧——FocusScope 树已卸载(焦点陷阱只属于活横幅),本帧自带
  // aria-hidden/inert 语义,沿用旧遮罩点击出口(仅可关弹层;收起中重复出口由
  // requestClose 的计时器在途守卫挡掉)。
  if (exiting) {
    return (
      <div
        className="banner-overlay banner-overlay-out absolute inset-0 z-30 flex items-center justify-center"
        // 退场帧恒常色(减淡只属活横幅的拖离态);色值单源在 hook 文件
        style={{ backgroundColor: OVERLAY_TINT }}
        aria-hidden={exiting || undefined}
        // 幽灵帧整体 inert:退场重放帧里的按钮是旧闭包死钮,浏览器层面禁掉
        // 命中/聚焦,任何 `.first()` 类选择器都不会再点到它(#90 e2e 回归教训)
        inert={isGhost || undefined}
        // 点遮罩空白处关闭(仅可关弹层);收起中放行点击,重复出口由 requestClose 挡掉
        onClick={(e) => {
          if (e.target === e.currentTarget) requestClose();
        }}
      >
        {shellBody}
      </div>
    );
  }

  // 活横幅:DialogFocusScope(自研焦点陷阱,#174 收编/#175 移除 radix)提供焦点陷阱
  // 与关闭还焦;role/aria-modal 由壳体自带。刻意不用 Dialog.Content——它内部强制
  // Portal 到 body,会破坏 #scroll-layer 定位栈与幽灵帧协议。挂载不夺焦(封装内置
  // onMountAutoFocus preventDefault:× 关闭钮在 DOM 首位,默认首焦会落在它上,Enter
  // 误关)。Esc/点外关闭沿用窗级 Esc 监听 + 遮罩点击,与 ui/dialog.tsx 行为口径一致。
  return (
    <div
      className="banner-overlay absolute inset-0 z-30 flex items-center justify-center"
      // 遮罩随拖离中心减淡(#674):非零位移且超出吸附半径时转淡档,色值单源在 hook 文件
      style={{ backgroundColor: drag.dimmed ? OVERLAY_TINT_DIMMED : OVERLAY_TINT }}
      // 点遮罩空白处关闭(仅可关弹层);收起中放行点击,重复出口由 requestClose 挡掉
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <DialogFocusScope asChild>{shellBody}</DialogFocusScope>
    </div>
  );
}
