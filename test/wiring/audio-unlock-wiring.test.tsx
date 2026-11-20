import { afterAll, beforeAll, expect, it, spyOn } from "bun:test";
import { AudioProvider } from "@app/fx/AudioProvider";
import { getAudio } from "@app/fx/audio";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

beforeAll(ensureHappyDom);
afterAll(releaseHappyDom);

it("首个触摸未解锁时，后续点按能让异步对局音效播放", () => {
  let activated = false;
  let played = 0;
  class GestureAudioContext {
    state: AudioContextState = "suspended";
    destination = {};
    currentTime = 0;

    async resume() {
      if (activated) this.state = "running";
    }

    async close() {
      this.state = "closed";
    }

    createGain() {
      const gain = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} };
      return { gain, connect() {} };
    }

    createOscillator() {
      return {
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect(node: ReturnType<GestureAudioContext["createGain"]>) {
          return node;
        },
        start: () => {
          if (this.state === "running") played++;
        },
        stop() {},
      };
    }
  }

  using _fetchAudio = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 404 }),
  );
  const original = Object.getOwnPropertyDescriptor(window, "AudioContext");
  Object.defineProperty(window, "AudioContext", { configurable: true, value: GestureAudioContext });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <AudioProvider>
          <button type="button">掷骰</button>
        </AudioProvider>,
      ),
    );
    const button = host.querySelector("button")!;
    function tap(allowsPlayback: boolean) {
      const touch = { bubbles: true, pointerType: "touch" };
      button.dispatchEvent(new PointerEvent("pointerdown", touch));
      activated = allowsPlayback;
      button.dispatchEvent(new PointerEvent("pointerup", touch));
      button.click();
      activated = false;
    }

    tap(false);
    getAudio().play("reactionTick");
    expect(played).toBe(0);

    tap(true);
    getAudio().play("reactionTick");
    expect(played).toBe(1);
  } finally {
    act(() => root.unmount());
    host.remove();
    if (original) Object.defineProperty(window, "AudioContext", original);
    else Reflect.deleteProperty(window, "AudioContext");
  }
});
