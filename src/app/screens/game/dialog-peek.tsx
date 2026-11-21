import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import type { DialogPeekSurface } from "@app/hooks/dialog-stack";
import { Sym } from "@app/screens/shared/Sym";
import { TESTIDS } from "./testids";
import "./dialog-peek.css";

function rememberScroll(surface: HTMLElement) {
  const offsets = Array.from(
    surface.querySelectorAll<HTMLElement>('[data-slot="scroll-area-viewport"], [data-peek-scroll]'),
    (element) => ({ element, top: element.scrollTop, left: element.scrollLeft }),
  );
  return () => {
    for (const { element, top, left } of offsets) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  };
}

interface HiddenDialog extends DialogPeekSurface {
  restoreScroll: () => void;
}

export function useGameDialogPeek(enabled: boolean) {
  const surfaces = useRef(new Map<string, DialogPeekSurface>());
  const [session, setSession] = useState<ReadonlyMap<string, HiddenDialog> | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const afterRestore = useRef<(() => void) | null>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const register = useCallback((surface: DialogPeekSurface) => {
    surfaces.current.set(surface.id, surface);
    return () => {
      surfaces.current.delete(surface.id);
      setSession((current) => {
        if (current === null || !current.has(surface.id)) return current;
        const remaining = new Map(current);
        remaining.delete(surface.id);
        return remaining.size > 0 ? remaining : null;
      });
    };
  }, []);
  const minimize = useCallback(
    (id: string) => {
      const surface = surfaces.current.get(id);
      if (surface === undefined) return;
      const panel = surface.element.current;
      const activeElement = document.activeElement;
      const focusTarget =
        activeElement instanceof HTMLElement && panel?.contains(activeElement)
          ? activeElement
          : panel?.querySelector<HTMLElement>(`[data-testid="${TESTIDS.modalMinimize}"]`);
      const hidden = new Map(session);
      for (const entry of surfaces.current.values()) {
        if (!hidden.has(entry.id) && entry.element.current !== null) {
          hidden.set(entry.id, {
            ...entry,
            restoreScroll: rememberScroll(entry.element.current),
          });
        }
      }
      returnFocus.current = focusTarget ?? null;
      setSession(hidden);
    },
    [session],
  );
  const peeking = enabled && session !== null;
  const decision = peeking
    ? (Array.from(session.values()).find((entry) => entry.decision !== null)?.decision ?? null)
    : null;
  useEffect(() => {
    if (peeking) {
      restoreButton.current?.focus({ preventScroll: true });
    } else {
      afterRestore.current?.();
      afterRestore.current = null;
      returnFocus.current = null;
    }
  }, [peeking]);

  return {
    context: useMemo(
      () => ({ enabled, hidden: session, register, minimize }),
      [enabled, session, register, minimize],
    ),
    peeking,
    decision,
    restoreButton,
    restore: () => {
      if (session === null) return;
      const focusTarget = returnFocus.current;
      afterRestore.current = () => {
        for (const entry of session.values()) entry.restoreScroll();
        if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
      };
      setSession(null);
    },
  };
}

export function RestoreGameDialog({
  decision,
  locked,
  buttonRef,
  onRestore,
}: {
  decision: boolean;
  locked: boolean;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  onRestore: () => void;
}) {
  return (
    <Button
      ref={buttonRef}
      className="game-dialog-restore"
      data-testid={TESTIDS.modalRestore}
      disabled={locked}
      focusableWhenDisabled
      onClick={onRestore}
    >
      <Sym name="back" size={17} />
      {decision ? "返回抉择" : "返回弹窗"}
    </Button>
  );
}
