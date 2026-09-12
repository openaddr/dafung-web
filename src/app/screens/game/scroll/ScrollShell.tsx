// 卷轴容器:对照旧 render/ui.ts createScroll 的视觉骨架(宣纸底/双金边/标题栏/× 关闭/标题栏拖拽)。
// 用 Tailwind token 重写;入场动画用 scroll.css 的两层摊开(#91 R3-C4):
// 壳体 scroll-unroll(淡入+下落+横向舒展) + 标题栏以下纸身 scroll-paper-unroll(scaleY 展开)。
// 行为基座(R3 评审):shared/DialogFocusScope 自研焦点陷阱(2026-09-12 起,radix
// focus-scope 已移除)——活卷轴获得焦点陷阱/关闭还焦 + role=dialog/aria-modal;
// 收起中与幽灵退场帧不走 FocusScope(纯视觉重放,自带 aria-hidden/inert)。刻意不用
// Dialog.Content:它强制 Portal 会破坏 #scroll-layer 定位栈与幽灵帧协议。
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
// #174:焦点陷阱收编为 shared/DialogFocusScope(2026-09-12 起为自研实现,无第三方依赖)
import { DialogFocusScope } from "@app/screens/shared/DialogFocusScope";
import "./scroll.css";
import { getAudio } from "@app/fx/audio";
import { Sym } from "@app/screens/shared/Sym";
import { SCROLL_TESTIDS as T } from "./testids";

/** #15(E3)拖拽 clamp:壳体标题栏恒留视口 ≥60px,任意猛拖拖不丢。 */
const TITLE_GRAB_PX = 60;

/** #90(R3-C3)卷轴收起幽灵帧开关:DecisionScrollLayer 相位切换时把上一个子节点快照
 *  再渲染 210ms 作退场帧,用本上下文标记该实例是幽灵——Shell 直接以 rollback 类登场,
 *  不重放 unroll 展开、不重播 scrollOpen(它不是新开的卷轴,是旧卷轴退场的重放帧)。 */
export const ScrollGhostContext = createContext(false);

export interface ScrollShellProps {
  title: string;
  children: ReactNode;
  /** 只有可放弃的卷轴(详情/确认)才传;抉择类必须选,不误关(与旧 createScroll 同策略)。
   *  传了 onClose 即支持:点遮罩空白关闭 + Esc 关闭(与 ConfirmDialog 的 Esc 惯例一致)。 */
  onClose?: () => void;
  /** #34 详情卷轴去右上 ×:关闭改为 点遮罩/Esc(有明确动作的确认类卷轴仍保留 ×)。 */
  hideClose?: boolean;
  /** 外层容器上的 data-testid(各决策卷轴用自己的 id)。 */
  testid?: string;
  /** 宽度档位:默认决策卷轴宽;详情类可窄一点。 */
  width?: "md" | "lg";
  /** #14 内容身份键:变化时复位拖拽偏移。身份已由标题承载(如「城名」)的调用方可不传;
   *  同标题但内容会换的调用方显式传(如格索引)。复位不能依赖 children——它每次渲染都是新引用。 */
  scrollKey?: string;
}

/** 通用卷轴按钮(旧 .btn .btn-primary 的 Tailwind 版)。为什么放这:所有决策卷轴共用一套按钮观感。 */
export function ScrollButton({
  children,
  onClick,
  primary,
  testid,
  // UI F1:决策类按钮可能不可选(银两/委任不足、满级)——disabled + title 原因,
  // 口径与旧侧栏内嵌按钮一致,只是搬进卷轴后由 ScrollShell 统一观感
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
  // #93(R3-C6)决策按钮主次权重:primary 升档为金渐变+内高光(纸面凸印感)+加大字号
  // 与内边距;secondary 降半档只缩字号。并排时主次一眼可辨。disabled 两类口径不变
  // (disabled:opacity-40);#97 全局按压 button:active scale(0.98) 与本观感无冲突。
  // shortcut 角标仍靠追加 pr-5 让出右上角(primary 的 pr-5 与 px-5 同值、secondary
  // 在 px-4 基础上加宽,角标热区/避让均不破坏)。
  const isGhost = useContext(ScrollGhostContext);
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

export function ScrollShell({ title, children, onClose, hideClose = false, testid, width = "md", scrollKey }: ScrollShellProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // #90(R3-C3)收起:×/遮罩/Esc 统一走 requestClose——先置 closing(壳体挂 rollback
  // 收起类、遮罩淡出并放行点击、aria-hidden),210ms 后(rollback 动画 var(--dur-fast)
  // =150ms 已走完)再调真 onClose 卸载。「播完再移除」模式照抄 useDeltaFloat 的定时出列;
  // 零兜底:只有一个明确的 setTimeout,不设超时兜底分支。
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 相位切换的幽灵帧(ScrollGhostContext)与本地 closing 同样按收起处理
  const isGhost = useContext(ScrollGhostContext);
  const exiting = closing || isGhost;

  const requestClose = useCallback(() => {
    // 计时器在途 = 已在收起,忽略重复出口(Esc 连按/遮罩二次点击)
    if (!onClose || closeTimerRef.current !== null) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 210); // 收起出口 = rollback 150ms(--dur-fast)+ 60 余量。刻意字面量不进倍率:
    // 地板 100ms 会砍断 rollback 动画并与幽灵帧同刻竞态(#117 评审实测并行两连挂)。
  }, [onClose]);

  // 收起途中组件被外部直接卸载(如整屏切换)时清理计时器
  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    },
    [],
  );
  // #65 卷轴展开音:挂载即播,与 scroll-anim-unroll keyframe 的 0ms 同帧起步;
  // 播放惯例与 DiceOverlay 的 useEffect 内 getAudio().play 一致,静音由播放器内部处理。
  // 幽灵帧(退场重放)跳过——旧卷轴收走时不能再喊一声开卷。
  useEffect(() => {
    if (isGhost) return;
    getAudio().play("scrollOpen");
  }, [isGhost]);
  // #34:可关卷轴补 Esc 快捷键(此前只有遮罩点击/×;与 ConfirmDialog 的 Esc 惯例统一)
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
  // 标题栏手写拖拽(对照旧 createScroll 的 pointer 拖动):卷轴可被拖到不挡棋盘的位置。
  const drag = useRef<{ active: boolean; sx: number; sy: number; x: number; y: number }>({
    active: false, sx: 0, sy: 0, x: 0, y: 0,
  });
  // 拖拽偏移的渲染态镜像:收起时渲染树从 Radix 分支切到退场帧分支(DOM 重建),
  // 新节点经 style 从本 ref 取回偏移,避免回卷动画开场瞬间跳回屏幕中心。
  const transformRef = useRef("");

  const onPointerDown = (e: React.PointerEvent) => {
    // 点在按钮(× 关闭)上不触发拖动,与旧行为一致
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { ...drag.current, active: true, sx: e.clientX, sy: e.clientY };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active || !bodyRef.current) return;
    d.x += e.clientX - d.sx;
    d.y += e.clientY - d.sy;
    d.sx = e.clientX;
    d.sy = e.clientY;
    // #15(E3):写回前 clamp——壳体顶缘(标题栏)恒留 ≥60px 在视口内,决策卷轴无 onClose
    // 也拖不丢、松手可拖回。getBoundingClientRect 含当前 transform,先减去已积累偏移
    // 得未变换基准位,再反解出偏移的合法区间。
    const r = bodyRef.current.getBoundingClientRect();
    const baseLeft = r.left - d.x;
    const baseTop = r.top - d.y;
    d.x = Math.min(
      window.innerWidth - TITLE_GRAB_PX - baseLeft,
      Math.max(-(r.width - TITLE_GRAB_PX) - baseLeft, d.x),
    );
    d.y = Math.min(
      window.innerHeight - TITLE_GRAB_PX - baseTop,
      Math.max(-baseTop, d.y),
    );
    bodyRef.current.style.transform = `translate(${d.x}px, ${d.y}px)`;
    transformRef.current = `translate(${d.x}px, ${d.y}px)`;
  };
  const endDrag = () => { drag.current.active = false; };

  // G-18:内容身份变化(标题或显式 scrollKey)时复位拖拽 transform——旧实现换内容沿用
  // 上一次偏移,常表现为"卷轴飞出屏幕找不回"。#14(E2):不能依赖 children——每次渲染
  // 都是新引用,快照/hint 一变就把拖开的卷轴弹回中心;拖拽进行中也跳过,等这把拖完。
  useEffect(() => {
    if (drag.current.active) return;
    drag.current = { active: false, sx: 0, sy: 0, x: 0, y: 0 };
    transformRef.current = "";
    if (bodyRef.current) bodyRef.current.style.transform = "";
    // #90:收起途中同实例换了内容主体(如详情卷轴 A 未收完就点了城 B)则撤销收起——
    // 否则 rollback 的 fill forwards 会把新内容也钉在 opacity 0 上,卷轴永久隐身。
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
      setClosing(false);
    }
  }, [title, scrollKey]);

  // 壳体本体(挂轴双杆 + 题签标题栏 + 纸身):活卷轴与退场帧两条渲染路径共用同一份 JSX。
  // role=dialog/aria-modal 挂壳体(可达名称用 aria-label=题名);退场帧的父层已
  // aria-hidden+inert,壳上的 role 对辅助技术不可见,无需按路径分支。
  const shellBody = (
    <div
      ref={bodyRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testid ?? T.scrollShell}
      style={{ transform: transformRef.current }}
      className={`relative flex max-h-[86dvh] flex-col rounded-[3px] border border-[rgba(43,35,23,0.28)] bg-gradient-to-b from-paper-hi to-paper-lo px-7 py-5 shadow-[var(--ink-shadow-lg)] ${
        exiting ? "scroll-anim-rollback" : "scroll-anim-unroll"
      } ${width === "lg" ? "max-w-[560px]" : "max-w-[460px]"}`}
    >
      {/* 挂轴双杆(视觉重做 v2 签名件):上下漆木卷杆横出炉身两侧,端头露木色轴头——
          「这是卷轴」的器物语言一眼可读。纯装饰层,不参与拖拽/命中。 */}
      <div aria-hidden="true" className="pointer-events-none absolute -inset-x-4 -top-2.5 z-10 flex h-[17px] items-center">
        <span className="h-[17px] w-[17px] flex-none rounded-full bg-gradient-to-b from-[#5c4c34] to-[#241c11] shadow-[0_1px_3px_rgba(43,35,23,0.5)]" />
        <span className="h-[11px] flex-1 bg-gradient-to-b from-[#56462e] via-[#3a2f1e] to-[#241c11] shadow-[inset_0_1px_0_rgba(217,185,92,0.4)]" />
        <span className="h-[17px] w-[17px] flex-none rounded-full bg-gradient-to-b from-[#5c4c34] to-[#241c11] shadow-[0_1px_3px_rgba(43,35,23,0.5)]" />
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute -inset-x-4 -bottom-2.5 z-10 flex h-[17px] items-center">
        <span className="h-[17px] w-[17px] flex-none rounded-full bg-gradient-to-b from-[#5c4c34] to-[#241c11] shadow-[0_2px_4px_rgba(43,35,23,0.5)]" />
        <span className="h-[11px] flex-1 bg-gradient-to-b from-[#56462e] via-[#3a2f1e] to-[#241c11] shadow-[inset_0_1px_0_rgba(217,185,92,0.4)]" />
        <span className="h-[17px] w-[17px] flex-none rounded-full bg-gradient-to-b from-[#5c4c34] to-[#241c11] shadow-[0_2px_4px_rgba(43,35,23,0.5)]" />
      </div>
      {/* 标题栏:整条可拖(大目标),含 × 关闭。#31(X12):shrink-0 保高度不被长内容
          压缩,touch-none 断触屏手势——真机拖标题不带动页面/棋盘滚动。
          题签制式(视觉重做 v2):题首单字钤朱砂方印 + 笔书题名,金饰退为一条发丝线。 */}
      <div
        className="relative -mx-7 -mt-5 mb-3.5 flex shrink-0 cursor-move touch-none items-center justify-center gap-2.5 border-b border-[rgba(140,110,60,0.4)] px-7 pb-2.5 pt-3"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span
          aria-hidden="true"
          className="flex h-[22px] w-[22px] flex-none rotate-[-4deg] items-center justify-center rounded-[2px] bg-danger font-brush text-[14px] leading-none text-[#f6ead6] shadow-[0_1px_2px_rgba(43,35,23,0.35)]"
        >
          {/* 题印取题名首个汉字:详情卷轴题名带「」引号,直取首字会把括号钤进印里 */}
          {title.match(/\p{Script=Han}/u)?.[0] ?? title.slice(0, 1)}
        </span>
        <h2
          data-testid={T.scrollTitle}
          className="m-0 font-brush text-[26px] tracking-[4px] text-ink"
        >
          {title}
        </h2>
        {onClose && !hideClose && (
          // #64:标题栏已 relative,× 锚定在标题栏(原先悬空于整个壳体垂直居中,
          // 44px 热区压在内容上形成幻点击区)。外层 44px 热区不变,视觉升级为
          // 1px 描边圆钮;hover 用 group 让整个热区点亮,与可点范围一致。
          <button
            type="button"
            data-testid={T.scrollClose}
            aria-label="关闭"
            onClick={(e) => { e.stopPropagation(); requestClose(); }}
            disabled={isGhost}
            className="group absolute top-1/2 right-2.5 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center disabled:cursor-default"
          >
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(43,35,23,0.35)] text-ink-dim transition-colors group-hover:bg-[rgba(43,35,23,0.08)] group-hover:text-ink"
            >
              <Sym name="close" size={13} />
            </span>
          </button>
        )}
      </div>
      {/* #91(R3-C4) 两层摊开之内层:标题栏保持在壳体直下(随壳体淡入落位),
          标题栏以下的纸身包进本 wrapper 以顶缘为轴 scaleY 展开——标题先落位、
          纸身在其下摊开,标题字不再随整壳纵向压扁。
          flex-1 + min-h-0 保住原限高内滚链(壳体 max-h 86dvh → wrapper 收缩 →
          内容区 min-h-0 overflow-y-auto),收起 rollback 仍只走壳体、wrapper 不另播。 */}
      <div className="scroll-anim-unroll-paper relative flex min-h-0 flex-1 flex-col">
        {/* #31(X12):壳体限高 86dvh + 内容区 min-h-0 内滚——破产/招贤等长内容横屏
            也不溢出,结算等尾部按钮恒可达。 */}
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );

  // 收起中/幽灵帧:纯视觉退场帧——Radix 树已卸载(焦点陷阱只属于活卷轴),本帧自带
  // aria-hidden/inert 语义,沿用旧遮罩点击出口(仅可关卷轴;收起中重复出口由
  // requestClose 的计时器在途守卫挡掉)。
  if (exiting) {
    return (
      <div
        className="scroll-anim-overlay absolute inset-0 z-30 flex items-center justify-center bg-[rgba(30,23,12,0.42)] scroll-anim-overlay-out"
        aria-hidden={exiting || undefined}
        // 幽灵帧整体 inert:退场重放帧里的按钮是旧闭包死钮,浏览器层面禁掉
        // 命中/聚焦,任何 `.first()` 类选择器都不会再点到它(#90 e2e 回归教训)
        inert={isGhost || undefined}
        // 点遮罩空白处关闭(仅可关卷轴);收起中放行点击,重复出口由 requestClose 挡掉
        onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
      >
        {shellBody}
      </div>
    );
  }

  // 活卷轴:DialogFocusScope(自研焦点陷阱,#174 收编/#175 移除 radix)提供焦点陷阱
  // 与关闭还焦;role/aria-modal 由壳体自带。刻意不用 Dialog.Content——它内部强制
  // Portal 到 body,会破坏 #scroll-layer 定位栈与幽灵帧协议。挂载不夺焦(封装内置
  // onMountAutoFocus preventDefault:× 关闭钮在 DOM 首位,默认首焦会落在它上,Enter
  // 误关)。Esc/点外关闭沿用本文件原有出口(窗级 Esc 监听 + 遮罩点击),与
  // ui/dialog.tsx 行为口径一致。
  return (
    <div
      className="scroll-anim-overlay absolute inset-0 z-30 flex items-center justify-center bg-[rgba(30,23,12,0.42)]"
      // 点遮罩空白处关闭(仅可关卷轴);收起中放行点击,重复出口由 requestClose 挡掉
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <DialogFocusScope asChild>{shellBody}</DialogFocusScope>
    </div>
  );
}
