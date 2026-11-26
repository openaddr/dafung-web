import { afterAll, beforeAll, expect, it, spyOn } from "bun:test";
import { AudioProvider } from "@app/fx/AudioProvider";
import { getAudio } from "@app/fx/audio";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

beforeAll(ensureHappyDom);
afterAll(releaseHappyDom);

it("AudioContext 时钟停零时仍用网页媒体播放，反应提醒发声时压低结算尾音", () => {
  class FrozenAudioContext {
    readonly state = "running";
    readonly currentTime = 0;
    readonly destination = {};

    createGain() {
      return {
        gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      };
    }

    createOscillator() {
      return {
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect: (node: ReturnType<FrozenAudioContext["createGain"]>) => node,
        start() {},
        stop() {},
      };
    }

    async close() {}
  }
  const original = Object.getOwnPropertyDescriptor(window, "AudioContext");
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FrozenAudioContext });
  const played: HTMLMediaElement[] = [];
  using _play = spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    played.push(this);
    return Promise.resolve();
  });
  const paused = new Set<HTMLMediaElement>();
  using _pause = spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    paused.add(this);
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    act(() => root.render(<AudioProvider>{null}</AudioProvider>));

    getAudio().play("diceLand");
    getAudio().play("diceLand");
    const tails = [...played];
    const originalVolumes = tails.map((element) => element.volume);
    getAudio().play("reactionTick");
    expect(played.map((element) => element.getAttribute("src"))).toEqual([
      "/assets/audio/playback/woodblock-hit.ogg",
      "/assets/audio/playback/woodblock-hit.ogg",
      "/assets/audio/playback/reaction-tick.ogg",
    ]);
    expect(played[0]).not.toBe(played[1]);
    expect(tails.every((element, i) => element.volume < originalVolumes[i])).toBe(true);
    played[2].dispatchEvent(new Event("ended"));
    expect(tails.map((element) => element.volume)).toEqual(originalVolumes);
    expect(tails.some((element) => paused.has(element))).toBe(false);

    const arrive = getAudio().defer("diceLand");
    getAudio().setMuted(true);
    expect(tails.every((element) => paused.has(element) && !element.hasAttribute("src"))).toBe(
      true,
    );
    getAudio().play("diceLand");
    getAudio().setMuted(false);
    arrive();
    expect(played).toHaveLength(3);
    act(() => root.render(null));
    expect(played.every((element) => paused.has(element) && !element.hasAttribute("src"))).toBe(
      true,
    );
  } finally {
    act(() => root.unmount());
    host.remove();
    if (original) Object.defineProperty(window, "AudioContext", original);
    else Reflect.deleteProperty(window, "AudioContext");
  }
});
