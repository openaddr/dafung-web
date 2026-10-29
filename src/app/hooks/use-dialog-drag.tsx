// 弹窗题名拖动共享原语(#674):全部居中弹窗的题名行拖拽,两条壳(ui/dialog 底件系
// 与 BannerShell 横幅系)共用同一份逻辑,单源在此。口径(规格逐条落死):
//   - 模态语义零改动:遮罩仍拦指针、焦点陷阱/Esc/点遮罩关闭照旧,本原语只动位移。
//   - 手势 = 仅题名行:pointerdown 命中题名行才启动,起点在 button 上(X/决策钮)豁免;
//     位移 <10px 松手不算拖,原点击语义保留。桌面鼠标与触屏同款 pointer events,
//     题名行 touch-action:none 防触屏滚动劫持(内容区滚动不受影响——手势只属题名行)。
//   - 位移 = --drag-x/--drag-y CSS 变量,setProperty 命令式更新,不进 React state/
//     渲染路径;消费方在本体 transform/translate 上组合变量(各壳自定,见 dialog.tsx /
//     BannerShell / ConfirmDialog)。React 重渲染安全:变量键不在任何 React 管理的
//     style 里,重渲染只 diff 它自己的键,命令式写入不会被抹。
//   - 位置零记忆:每次打开回中心。底件系弹层关闭即整树卸载,变量随元素离场;同实例
//     内容更替(BannerShell 题名 A→B,#90 同身份协议)走 resetKey 复位。
//   - clamp:窗体允许大面积出屏,题名行任一部分不得完全出视口(拖动起点测一次题名
//     包围盒,与视口求交非空;全程用这份测量,不逐帧读 DOM)。
//   - 吸附与遮罩联动:落点在默认中心 ±SNAP_RADIUS_PX 内松手 → 吸附回正(变量归零)+
//     遮罩复原;非零位移且超出吸附半径 → dimmed=true,遮罩减淡至 OVERLAY_TINT_DIMMED。
//     两档色值单源 = 下面两个常量,ui/dialog 遮罩与 banner-overlay 都从这里取色。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

/** 遮罩墨纱两档(色值单源):常态 0.42 / 拖离中心减淡 0.15。 */
export const OVERLAY_TINT = "rgba(30,23,12,0.42)";
export const OVERLAY_TINT_DIMMED = "rgba(30,23,12,0.15)";
/** 叠层减淡档(#767 弹窗详情族④):同帧两弹层以上(开栈栈深>1)时**上层**遮罩色。
 *  alpha 单源 = app.css 的 --mask-dim-stacked(0.28,消费条件见该 token 注释),
 *  rgb 三元组与两档同族;拖离减淡(0.15)强于叠层减淡,壳侧取强不叠加。 */
export const OVERLAY_TINT_STACKED = "rgba(30, 23, 12, var(--mask-dim-stacked))";

/** 拖动生效的最小位移(px):不足即松手不算拖。 */
const DRAG_THRESHOLD_PX = 10;
/** 吸附半径(px):松手落点在默认中心 ±R 内吸附回正;非零位移且超出即减淡遮罩。 */
const SNAP_RADIUS_PX = 24;

interface DragPoint {
  x: number;
  y: number;
}

/** 一次拖拽会话(pointerdown 建、up/cancel 销毁;ref 持有,不进渲染路径)。 */
interface DragSession {
  pointerId: number;
  start: DragPoint;
  /** 拖动起点时的既有偏移:已在拖离位上的再次拖动从原位续算,不归零重算。 */
  base: DragPoint;
  /** 题名行包围盒(拖动起点测量,viewport 坐标;clamp 全程用这份)。 */
  titleRect: DOMRect;
  viewport: { w: number; h: number };
  /** 位移已过阈值(过了才算拖,变量才开始动)。 */
  moved: boolean;
}

export interface DialogDragOptions {
  /** 弹窗本体元素:CSS 变量的宿主(本体 transform/translate 消费变量,写与读同件)。 */
  popupRef: RefObject<HTMLElement | null>;
  /** 复位键:变化即归零(BannerShell 题名更替 = 内容换新,位置回中心;底件系关闭即
   *  卸载,不需要)。 */
  resetKey?: string;
}

/** 一次拖拽原语会话暴露给壳的完整状态(handleProps 摊题名行、dimmed 联动遮罩)。
 *  命名避开局内同名把手组件 DialogDragHandle:类型=State,组件=Handle。 */
export interface DialogDragState {
  /** 摊在题名行元素上的 props:ref + 四个 pointer 事件 + 抓取光标/触屏滚动隔离。
   *  题名行内的 button 自带豁免(起点命中按钮不启动拖),无需另行摘除。 */
  handleProps: {
    ref: (node: HTMLElement | null) => void;
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    style: CSSProperties;
  };
  /** 拖离中心减淡态:遮罩背景应取 OVERLAY_TINT_DIMMED,否则 OVERLAY_TINT。 */
  dimmed: boolean;
}

export function useDialogDrag({ popupRef, resetKey }: DialogDragOptions): DialogDragState {
  const handleRef = useRef<HTMLElement | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  /** 当前偏移(会话之间存续;写变量与吸附判定都从这里出发)。 */
  const offsetRef = useRef<DragPoint>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dimmed, setDimmed] = useState(false);

  const writeVars = useCallback(
    (p: DragPoint) => {
      const el = popupRef.current;
      if (el == null) throw new Error("useDialogDrag:弹窗本体 ref 为空(接线 bug)");
      el.style.setProperty("--drag-x", `${p.x}px`);
      el.style.setProperty("--drag-y", `${p.y}px`);
    },
    [popupRef],
  );

  // 内容更替即新开:复位键变化 → 变量归零 + 减淡清零。挂载首跑不复位(新挂元素本无
  // 变量,键也未变);复位时弹窗元素必在树内(键变化只发生在存活实例上),ref 空即
  // 接线 bug,writeVars 里炸出来(零兜底)。
  const prevResetKey = useRef(resetKey);
  useEffect(() => {
    if (prevResetKey.current === resetKey) return;
    prevResetKey.current = resetKey;
    offsetRef.current = { x: 0, y: 0 };
    writeVars(offsetRef.current);
    setDimmed(false);
  }, [resetKey, writeVars]);

  const apply = useCallback(
    (s: DragSession, client: DragPoint) => {
      // clamp 加在原始位移上:titleRect 已含 base 偏移,新题名位 = titleRect + raw,
      // 「任一部分不出视口」= 求交非空(right+raw > 0 且 left+raw < 视口宽,纵同)。
      const rawX = client.x - s.start.x;
      const rawY = client.y - s.start.y;
      const x =
        s.base.x + Math.max(-s.titleRect.right, Math.min(s.viewport.w - s.titleRect.left, rawX));
      const y =
        s.base.y + Math.max(-s.titleRect.bottom, Math.min(s.viewport.h - s.titleRect.top, rawY));
      offsetRef.current = { x, y };
      writeVars(offsetRef.current);
      // 减淡沿:非零位移且落点超出吸附半径(同一把 ±SNAP_RADIUS_PX 方域,吸附判定同源)
      setDimmed(
        (x !== 0 || y !== 0) && (Math.abs(x) > SNAP_RADIUS_PX || Math.abs(y) > SNAP_RADIUS_PX),
      );
    },
    [writeVars],
  );

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    // 起点在按钮上(X 钮/决策钮)不启动拖动;已有指针在拖,第二指不接管
    if ((e.target as Element).closest("button") != null || sessionRef.current != null) return;
    const title = handleRef.current;
    if (title == null) throw new Error("useDialogDrag:题名行 ref 为空(接线 bug)");
    sessionRef.current = {
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      base: offsetRef.current,
      titleRect: title.getBoundingClientRect(),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = sessionRef.current;
      if (s == null || e.pointerId !== s.pointerId) return;
      if (!s.moved) {
        if (Math.hypot(e.clientX - s.start.x, e.clientY - s.start.y) < DRAG_THRESHOLD_PX) return;
        s.moved = true;
      }
      apply(s, { x: e.clientX, y: e.clientY });
    },
    [apply],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = sessionRef.current;
      if (s == null || e.pointerId !== s.pointerId) return;
      sessionRef.current = null;
      setDragging(false);
      // 位移不足阈值:不算拖,位置不动(setPointerCapture 下 click 仍落在题名行,
      // 遮罩关闭判定 e.target===currentTarget 天然不中,无目标转发问题)
      if (!s.moved) return;
      const { x, y } = offsetRef.current;
      if (Math.abs(x) <= SNAP_RADIUS_PX && Math.abs(y) <= SNAP_RADIUS_PX) {
        // 吸附回正:变量归零 + 遮罩复原
        offsetRef.current = { x: 0, y: 0 };
        writeVars(offsetRef.current);
        setDimmed(false);
      }
    },
    [writeVars],
  );

  return {
    handleProps: {
      ref: (node: HTMLElement | null) => {
        handleRef.current = node;
      },
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      // 触屏滚动隔离(手势只属题名行,内容区滚动不受影响)+ 抓取光标 + 拖拽途经
      // 不选中文本(题名行是拖拽示意件,非选区目标)
      style: { cursor: dragging ? "grabbing" : "grab", touchAction: "none", userSelect: "none" },
    },
    dimmed,
  };
}

const DialogDragContext = createContext<DialogDragState | null>(null);

/** 取所在弹窗的拖拽原语;不在 DialogContent 子树内使用 = 接线 bug,当场炸(零兜底)。
 *  注意 context 只向下游流:壳组件本体(PileShell 等,它们渲染 DialogContent)在
 *  provider 上游,不能直接消费——把手一律经 <DialogDragHandle> 消费。 */
function useDialogDragContext(): DialogDragState {
  const handle = useContext(DialogDragContext);
  if (handle == null) throw new Error("DialogDragHandle:不在 DialogContent 子树内(接线 bug)");
  return handle;
}

/** 题名行把手节点(ui/dialog 底件系):消费所在 DialogContent 的拖拽原语,自身渲染
 *  为题名行元素并挂上 handleProps(ref + pointer 事件 + 抓取光标/触屏隔离)。必须
 *  渲染在 DialogContent 子树内(provider 下游);元素类型随壳自选(题名行 = div/
 *  span/h3)。BannerShell 不走 Portal、不进本 context,直接调 useDialogDrag。 */
export function DialogDragHandle({
  as = "div",
  className,
  testid,
  children,
  ...rest
}: {
  /** 把手元素类型(题名行所在标签,各壳自选)。 */
  as?: "div" | "span" | "h3";
  className?: string;
  /** data-testid(调用方传 testids 单源的 modalDragHandle,本件不写死)。 */
  testid?: string;
  children?: ReactNode;
} & Omit<
  HTMLAttributes<HTMLElement>,
  "style" | "ref" | "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
>) {
  const { handleProps } = useDialogDragContext();
  // handleProps 在前(事件/光标/触屏隔离归原语),调用方附加 props 与 testid 在后
  const Tag = as;
  return (
    <Tag {...handleProps} {...rest} data-testid={testid} className={className}>
      {children}
    </Tag>
  );
}

/** ui/dialog 底件系专用:DialogContent 把本壳的拖拽原语下发给 children,题名行经
 *  <DialogDragHandle> 消费(见上)。 */
export function DialogDragProvider({
  value,
  children,
}: {
  value: DialogDragState;
  children: ReactNode;
}) {
  return <DialogDragContext.Provider value={value}>{children}</DialogDragContext.Provider>;
}
