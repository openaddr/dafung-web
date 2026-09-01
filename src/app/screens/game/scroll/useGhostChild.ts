// 幽灵帧协议(#107 批次 6 C6 下沉):#90(R3-C3)在 DecisionScrollLayer 里手搓的
// 「子节点身份变化 → 保留上一帧 210ms 作退场帧」机制,整个收拢进本文件——
// prev 快照、sig 判定(纯函数 shouldGhost)、ghost state、定时出列、让位标记,
// 协议一处可查。调用方(DecisionScrollLayer)只剩三件事:
//   1. 给出本帧 child;
//   2. 按子节点类型算 opts.skip(胜利屏这类全屏覆盖不配退场帧);
//   3. 事件侧就地收场的卷轴(详情卷轴走 ScrollShell closing 出口)调 yield() 让位。
// 跨层通道仍是唯一的 ScrollGhostContext(ScrollShell 侧 disabled/inert/rollback 防御不动);
// 本文件不 import 任何 css/音频,保持可在 bun test 直接测纯规则。
import { isValidElement, useEffect, useRef, useState, type ReactNode } from "react";

/** 幽灵帧驻留时长,与 ScrollShell closing 出口同一条 210 口径:收起动画
 *  scroll-anim-rollback 走 var(--dur-fast) = 150ms(core/theme Motion.dur.fast,
 *  经 gen:theme 序列化进 tokens.css),210 = 150 + 60ms 余量,保证动画播完有余再卸载。
 *  刻意用字面量而不读运行时 CSS——getComputedStyle 首帧未就绪且触发强制布局;
 *  同源关系以此注释钉死,改 --dur-fast 时这里要跟着核一遍。 */
const GHOST_FRAME_MS = 210;

/** 子节点身份 sig:只有 ReactElement 带组件类型,字符串/数字等载荷不视作可退场帧。 */
function sigOf(child: ReactNode): unknown {
  return isValidElement(child) ? child.type : null;
}

/** 「身份变化是否生成幽灵帧」纯规则(唯一判定,单测只测这里):
 *  仅「非空 → 清空」生成——A→B 直接换页不生成(同型是重渲染无退场;异型只清空退场,
 *  快节奏相位回环下幽灵与新卷轴并存,死按钮会抢在真按钮前被 .first() 类选择器命中,
 *  #90 e2e 速战档事故);null→X 不生成(没有可退场的上一帧);skip=true 不生成
 *  (全屏覆盖类的退场帧会让陈旧覆盖层多压 210ms)。
 *  sig 为子节点身份(组件函数引用,比引用相等),null/undefined 视作空位。 */
export function shouldGhost(
  prevSig: unknown,
  nextSig: unknown,
  opts: { skip?: boolean } = {},
): boolean {
  if (opts.skip) return false;
  return prevSig != null && nextSig === null;
}

export interface UseGhostChildOpts {
  /** 本帧 child 被清空退出时不留幽灵帧。判定条件由调用方按 child 类型算(协议只认
   *  「这一帧的 child 不配退场帧」),hook 把标记随本帧快照存进 prev,等这份 child
   *  真正被清空的那次身份变化时生效。现用例:胜利屏(全屏覆盖,退场帧多压 210ms)。 */
  skip?: boolean;
}

export interface GhostChildSlot {
  /** 退场帧(上一帧子节点的原样快照),无则 null。调用方渲染在当前子节点之后,
   *  并包进 ScrollGhostContext.Provider 值 true(Shell 据此挂 rollback、禁音、inert)。 */
  ghost: ReactNode | null;
  /** 让位标记(事件侧协议,原 shellClosedRef):上一帧子节点已在别处就地演过收场——
   *  详情卷轴走 ScrollShell 的 closing 出口(210ms rollback 后才卸载)——其退场不再补
   *  幽灵帧,防卸载后又重挂一具重复播放收起动画的替身(二连播)。标记在下一次身份
   *  变化时消费一次后自动复位;身份未变则一直待命。 */
  yield: () => void;
}

/** 幽灵帧 hook:追踪 child 的组件身份,身份变化时按 shouldGhost 决定是否把上一帧
 *  元素快照原样再渲染 210ms(GHOST_FRAME_MS)。机制照 #90 原版,一处不落地搬:
 *  render 期比对 + state/ref 突变是 React 认可的「props 变化调整 state」模式,
 *  提前到 commit 前保证幽灵与新卷轴不共存一帧(e2e 口径),故不改为 effect 写法。 */
export function useGhostChild(child: ReactNode, opts: UseGhostChildOpts = {}): GhostChildSlot {
  const [ghost, setGhost] = useState<ReactNode | null>(null);
  // 上一帧快照:身份 sig + 元素 el + 该帧的 skip 标记(skip 随帧走,退出时才被问询)
  const prevRef = useRef<{ sig: unknown; el: ReactNode; skip: boolean }>({
    sig: null, el: null, skip: false,
  });
  // yield() 的事件侧标记:事件与渲染异步,挂 ref 等下次身份变化消费
  const yieldRef = useRef(false);

  // 定时出列(照 useDeltaFloat 的定时移除写法):ghost 身份变化即重设 210ms 定时
  useEffect(() => {
    if (ghost === null) return;
    const t = setTimeout(() => setGhost(null), GHOST_FRAME_MS);
    return () => clearTimeout(t);
  }, [ghost]);

  // ── 渲染期身份迁移 ──
  const sig = sigOf(child);
  const prev = prevRef.current;
  if (prev.sig !== sig) {
    if (shouldGhost(prev.sig, sig, { skip: prev.skip || yieldRef.current })) {
      setGhost(prev.el);
    }
    // 让位标记消费一次即复位;身份变了但没走到清空路径,同样不复播(照旧)
    yieldRef.current = false;
  }
  prevRef.current = { sig, el: child, skip: opts.skip === true };

  // 新卷轴挂出即让旧幽灵立即让位(testid 相同会撞重复节点;渲染期清,两帧不并存)
  if (ghost !== null && sig !== null) setGhost(null);

  return {
    ghost,
    yield: () => { yieldRef.current = true; },
  };
}
