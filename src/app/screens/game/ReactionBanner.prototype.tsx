// #1403 的可丢弃对照。沿用棋盘、手牌架、选份和倒计时，只试横幅的构图。
// ?variant=a 单行横笺，?variant=b 双层分区，?variants=1 显示开发环境切换栏。
import { Popover } from "@base-ui/react/popover";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Sym } from "@app/screens/shared/Sym";
import { TESTIDS } from "./testids";
import "./reaction-banner.prototype.css";

export type ReactionVariant = "current" | "a" | "b";

export interface ReactionPrototypeContext {
  title: string;
  affected: string;
  domain: "seat" | "city";
}

export function readReactionVariant(): ReactionVariant {
  if (!import.meta.env.DEV && import.meta.env.MODE !== "reaction-prototype") return "current";
  const variant = new URLSearchParams(window.location.search).get("variant");
  return variant === "a" || variant === "b" ? variant : "current";
}

interface ReactionPrototypeLayoutProps {
  variant: Exclude<ReactionVariant, "current">;
  context: ReactionPrototypeContext;
  timer: ReactNode;
  miniature: ReactNode;
  shares: ReactNode;
  confirm: ReactNode;
  decline: ReactNode;
  mute: ReactNode;
}

export function ReactionPrototypeLayout({
  variant,
  context,
  timer,
  miniature,
  shares,
  confirm,
  decline,
  mute,
}: ReactionPrototypeLayoutProps) {
  const protection = context.domain === "city" ? "保护一座城" : "保护一位诸侯";
  const event = (detail: string) => (
    <div className="reaction-prototype-event">
      {timer}
      {variant === "b" && miniature}
      <div className="reaction-prototype-reading" data-testid={TESTIDS.reactionText}>
        <div className="reaction-prototype-title">{context.title}</div>
        {detail && <div className="reaction-prototype-note">{detail}</div>}
      </div>
    </div>
  );

  if (variant === "a") {
    return (
      <div
        className="reaction-banner reaction-prototype reaction-prototype-inline"
        data-testid={TESTIDS.reactionBanner}
        data-domain={context.domain}
      >
        {event(shares ? protection : context.affected)}
        {shares}
        <div className="reaction-prototype-actions">
          {decline}
          {confirm}
          <Popover.Root>
            <Popover.Trigger
              type="button"
              className="reaction-prototype-more"
              aria-label="反应窗更多选项"
              data-testid={TESTIDS.reactionPrototypeMore}
            >
              更多 <Sym name="expand" size={10} />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner side="top" align="end" sideOffset={8}>
                <Popover.Popup className="reaction-prototype-menu" initialFocus={false}>
                  <Popover.Title className="reaction-prototype-menu-note">
                    本回合内的询问都按「不用」处理。
                  </Popover.Title>
                  {mute}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </div>
    );
  }

  return (
    <div
      className="reaction-banner reaction-prototype reaction-prototype-stacked"
      data-testid={TESTIDS.reactionBanner}
      data-domain={context.domain}
    >
      {event(shares ? "" : context.affected)}
      {mute}
      <div className="reaction-prototype-pick">
        <span className="reaction-prototype-note">{shares ? protection : "先选反应锦囊"}</span>
        {shares}
      </div>
      <div className="reaction-prototype-actions">
        {decline}
        {confirm}
      </div>
    </div>
  );
}

const variants: ReactionVariant[] = ["current", "a", "b"];
const names = {
  current: "现版",
  a: "A 单行横笺",
  b: "B 双层分区",
};

export function ReactionPrototypeSwitcher({
  variant,
  onChange,
}: {
  variant: ReactionVariant;
  onChange: (variant: ReactionVariant) => void;
}) {
  const enabled =
    import.meta.env.DEV && new URLSearchParams(window.location.search).has("variants");

  useEffect(() => {
    if (!enabled) return;
    function keydown(e: KeyboardEvent) {
      if (!(e.target instanceof Element) || e.target.closest("input, textarea, [contenteditable]"))
        return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const step = e.key === "ArrowRight" ? 1 : -1;
      const next = variants[(variants.indexOf(variant) + step + variants.length) % variants.length];
      const url = new URL(window.location.href);
      url.searchParams.set("variant", next);
      history.replaceState(null, "", url);
      onChange(next);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [enabled, onChange, variant]);

  if (!enabled) return null;
  return createPortal(
    <div className="reaction-prototype-switcher" aria-label="反应窗原型对照">
      {variants.map((v) => (
        <button
          type="button"
          key={v}
          aria-pressed={v === variant}
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.set("variant", v);
            history.replaceState(null, "", url);
            onChange(v);
          }}
        >
          {names[v]}
        </button>
      ))}
    </div>,
    document.body,
  );
}
