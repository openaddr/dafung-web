// 弹层按视觉层级登记，供遮罩、顶层交互和安卓系统返回共用。
import { onBackButtonPress } from "@tauri-apps/api/app";
import { isTauri, type PluginListener } from "@tauri-apps/api/core";
import { useGameStore } from "@app/store/gameStore";
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/** 活跃弹层栈(模块级,数组即计数器;槽位=Symbol 实例身份,挂载/卸载严格配对)。 */
const stack: { slot: symbol; order: number; portal: boolean; back?: () => void }[] = [];
const listeners = new Set<() => void>();
let nextOrder = 0;
let releaseBackListener: (() => void) | null = null;

function syncAndroidBackListener() {
  if (!stack.some((entry) => entry.back !== undefined)) {
    releaseBackListener?.();
    releaseBackListener = null;
    return;
  }
  if (releaseBackListener !== null || !isTauri() || !navigator.userAgent.includes("Android"))
    return;

  let listening = true;
  let listener: PluginListener | undefined;
  const reportError = (error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    useGameStore.getState().pushHint(`弹层返回键监听失败：${detail}`, "error");
  };
  releaseBackListener = () => {
    listening = false;
    if (listener !== undefined) void listener.unregister().catch(reportError);
  };
  void onBackButtonPress(() => {
    if (listening) stack.at(-1)?.back?.();
  })
    .then(async (registered) => {
      if (listening) listener = registered;
      else await registered.unregister();
    })
    .catch(reportError);
}

/** 本实例是否为叠层中的上层:栈深>1 且本实例下标>0。底层实例恒 false(全档遮罩)。
 *  active=false 时不入栈、恒 false。layout effect:入栈/出栈都发生在绘制前,
 *  上层遮罩首帧即减淡档,不闪全档(遮罩无入场动画,整帧跳变可见)。 */
export function useDialogStackSlot(active: boolean, portal = true, onBack?: () => void) {
  const back = useRef(onBack);
  useLayoutEffect(() => {
    back.current = onBack;
  }, [onBack]);
  const handlesBack = onBack !== undefined;
  const slotRef = useRef<symbol | null>(null);
  if (slotRef.current === null) slotRef.current = Symbol("dialog-slot");
  const slot = slotRef.current;
  const order = useRef<number | null>(null);
  const [position, setPosition] = useState({ stacked: false, frontmost: true });
  useLayoutEffect(() => {
    if (!active) return;
    order.current ??= nextOrder++;
    const index = stack.findIndex((entry) =>
      entry.portal === portal ? entry.order > order.current! : entry.portal,
    );
    stack.splice(index < 0 ? stack.length : index, 0, {
      slot,
      order: order.current,
      portal,
      back: handlesBack ? () => back.current?.() : undefined,
    });
    syncAndroidBackListener();
    const sync = () => {
      const index = stack.findIndex((entry) => entry.slot === slot);
      const stacked = index > 0;
      const frontmost = index === stack.length - 1;
      setPosition((prev) =>
        prev.stacked === stacked && prev.frontmost === frontmost ? prev : { stacked, frontmost },
      );
    };
    listeners.add(sync);
    for (const notify of listeners) notify();
    return () => {
      const i = stack.findIndex((entry) => entry.slot === slot);
      if (i < 0) throw new Error("弹层开栈:卸载时槽位不在栈内(挂载/卸载配对破坏)");
      stack.splice(i, 1);
      syncAndroidBackListener();
      listeners.delete(sync);
      // 上层收走后,新的上层(或独层)遮罩回全档——存活实例同步复位
      for (const notify of listeners) notify();
    };
  }, [active, portal, slot, handlesBack]);
  return position;
}

export interface DialogPeekSurface {
  id: string;
  decision: string | null;
  element: RefObject<HTMLElement | null>;
}

export const DialogPeekContext = createContext<{
  enabled: boolean;
  hidden: ReadonlyMap<string, DialogPeekSurface> | null;
  register: (surface: DialogPeekSurface) => () => void;
  minimize: (id: string) => void;
} | null>(null);

export const DialogPeekDecision = createContext<string | null>(null);
export const DialogPeekInspection = createContext<(() => void) | null>(null);

export function useDialogPeekSurface(active: boolean) {
  const context = useContext(DialogPeekContext);
  const decision = useContext(DialogPeekDecision);
  const dismissInspection = useContext(DialogPeekInspection);
  const id = useId();
  const element = useRef<HTMLElement | null>(null);
  const register = context?.register;
  const enabled = active && context?.enabled === true;
  useLayoutEffect(() => {
    if (!enabled || dismissInspection !== null || register == null) return;
    return register({ id, decision, element });
  }, [enabled, dismissInspection, register, id, decision]);

  return {
    element,
    hidden: context?.hidden?.has(id) === true,
    minimize: enabled ? (dismissInspection ?? (() => context.minimize(id))) : undefined,
  };
}
