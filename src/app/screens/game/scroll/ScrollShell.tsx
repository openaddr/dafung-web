// 卷轴容器:对照旧 render/ui.ts createScroll 的视觉骨架(宣纸底/双金边/标题栏/× 关闭/标题栏拖拽)。
// 用 Tailwind token 重写;入场动画用 scroll.css 的两层摊开(#91 R3-C4):
// 壳体 scroll-unroll(淡入+下落+横向舒展) + 标题栏以下纸身 scroll-paper-unroll(scaleY 展开)。
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import "./scroll.css";
import { getAudio } from "@app/fx/audio";
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
          ? "relative cursor-pointer rounded border-2 border-gold bg-gradient-to-b from-gold/45 to-gold/25 px-5 py-2.5 font-brush text-[17px] text-ink shadow-[inset_0_1px_0_rgba(255,244,214,0.5),0_2px_8px_rgba(60,40,10,0.22)] transition-colors hover:from-gold/60 hover:to-gold/35 disabled:cursor-not-allowed disabled:opacity-40"
          : "relative cursor-pointer rounded border border-gold/60 bg-panel-hi px-4 py-2 font-brush text-[15px] text-ink transition-colors hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40") +
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
    }, 210);
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
  };
  const endDrag = () => { drag.current.active = false; };

  // G-18:内容身份变化(标题或显式 scrollKey)时复位拖拽 transform——旧实现换内容沿用
  // 上一次偏移,常表现为"卷轴飞出屏幕找不回"。#14(E2):不能依赖 children——每次渲染
  // 都是新引用,快照/hint 一变就把拖开的卷轴弹回中心;拖拽进行中也跳过,等这把拖完。
  useEffect(() => {
    if (drag.current.active) return;
    drag.current = { active: false, sx: 0, sy: 0, x: 0, y: 0 };
    if (bodyRef.current) bodyRef.current.style.transform = "";
    // #90:收起途中同实例换了内容主体(如详情卷轴 A 未收完就点了城 B)则撤销收起——
    // 否则 rollback 的 fill forwards 会把新内容也钉在 opacity 0 上,卷轴永久隐身。
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
      setClosing(false);
    }
  }, [title, scrollKey]);

  return (
    <div
      className={`scroll-anim-overlay absolute inset-0 z-30 flex items-center justify-center bg-[rgba(40,30,15,0.35)]${
        exiting ? " scroll-anim-overlay-out" : ""
      }`}
      aria-hidden={exiting || undefined}
      // 幽灵帧整体 inert:退场重放帧里的按钮是旧闭包死钮,浏览器层面禁掉
      // 命中/聚焦,任何 `.first()` 类选择器都不会再点到它(#90 e2e 回归教训)
      inert={isGhost || undefined}
      // 点遮罩空白处关闭(仅可关卷轴);收起中放行点击,重复出口由 requestClose 挡掉
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div
        ref={bodyRef}
        data-testid={testid ?? T.scrollShell}
        className={`relative flex max-h-[86dvh] flex-col rounded-md border-[3px] border-double border-gold bg-gradient-to-b from-paper-hi to-paper-lo px-7 py-5 shadow-[0_10px_40px_rgba(60,40,10,0.4)] ${
          exiting ? "scroll-anim-rollback" : "scroll-anim-unroll"
        } ${width === "lg" ? "max-w-[560px]" : "max-w-[460px]"}`}
      >
        {/* 标题栏:整条可拖(大目标),含 × 关闭。#31(X12):shrink-0 保高度不被长内容
            压缩,touch-none 断触屏手势——真机拖标题不带动页面/棋盘滚动。 */}
        <div
          className="relative -mx-7 -mt-5 mb-3.5 flex shrink-0 cursor-move touch-none items-center justify-center rounded-t-sm border-b-2 border-[rgba(140,110,60,0.35)] bg-gradient-to-b from-gold/15 to-gold/[0.03] px-7 pb-2.5 pt-3"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
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
                className="flex h-7 w-7 items-center justify-center rounded-full border border-gold/40 text-[26px] leading-none text-ink-dim transition-colors group-hover:bg-gold/15 group-hover:text-ink"
              >
                ×
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
          {/* #91 下轴:纸身底缘的深金细条,随纸身 scaleY 展开自然露出,纯装饰。 */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-[rgba(140,110,60,0.5)]"
          />
        </div>
      </div>
    </div>
  );
}
