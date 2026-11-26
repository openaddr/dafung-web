import { afterAll, beforeAll, expect, it, spyOn } from "bun:test";
import { AudioProvider } from "@app/fx/AudioProvider";
import { getAudio, MediaAudioPlayer } from "@app/fx/audio";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installControlledClock } from "./controlled-clock";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

beforeAll(ensureHappyDom);
afterAll(releaseHappyDom);

it("AudioContext 时钟停零时仍用网页媒体播放，反应提醒平滑压低和恢复结算尾音", async () => {
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
  const clock = installControlledClock({ monotonic: true });
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
    expect(tails.map((element) => element.volume)).toEqual(originalVolumes);
    await clock.advance(20);
    const lowering = tails.map((element) => element.volume);
    expect(lowering.every((volume, i) => volume < originalVolumes[i])).toBe(true);
    await clock.advance(60);
    const lowered = tails.map((element) => element.volume);
    expect(lowered.every((volume, i) => volume < lowering[i])).toBe(true);
    played[2].dispatchEvent(new Event("ended"));
    expect(tails.map((element) => element.volume)).toEqual(lowered);
    getAudio().play("diceLand");
    expect(played[3].volume).toBe(originalVolumes[0]);
    await clock.advance(48);
    expect(tails.every(({ volume }, i) => volume > lowered[i] && volume < originalVolumes[i])).toBe(
      true,
    );
    await clock.advance(150);
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
    expect(played).toHaveLength(4);
    act(() => root.render(null));
    expect(played.every((element) => paused.has(element) && !element.hasAttribute("src"))).toBe(
      true,
    );
  } finally {
    act(() => root.unmount());
    clock.restore();
    host.remove();
    if (original) Object.defineProperty(window, "AudioContext", original);
    else Reflect.deleteProperty(window, "AudioContext");
  }
});

it("演出尾音渐出途中卡住，恢复后继续降低音量再停声", async () => {
  const played: HTMLMediaElement[] = [];
  using _play = spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    played.push(this);
    return Promise.resolve();
  });
  const clock = installControlledClock({ monotonic: true });
  const player = new MediaAudioPlayer({ preload: false });
  try {
    player.play("cityConquest");
    const [tail] = played;
    player.stop("presentation", "fade");
    await clock.advance(16);
    const beforeStall = tail.volume;
    expect(beforeStall).toBeLessThan(1);

    await clock.advance(235, { stalled: true });
    expect(tail.hasAttribute("src")).toBe(true);
    expect(tail.volume).toBeGreaterThan(0);
    expect(tail.volume).toBeLessThan(beforeStall);
    await clock.advance(112);
    expect(tail.hasAttribute("src")).toBe(false);
  } finally {
    player.dispose();
    clock.restore();
  }
});

it("反应窗压低结算声的第一拍延迟时，恢复后仍分步变化", async () => {
  const played: HTMLMediaElement[] = [];
  using _play = spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    played.push(this);
    return Promise.resolve();
  });
  const clock = installControlledClock({ monotonic: true });
  const player = new MediaAudioPlayer({ preload: false });
  try {
    player.play("cityConquest");
    player.play("reactionOpen");
    const [tail] = played;
    await clock.advance(74, { stalled: true });
    const firstGain = tail.volume;
    expect(firstGain).toBeGreaterThan(0.35);
    expect(firstGain).toBeLessThan(1);
    await clock.advance(16);
    expect(tail.volume).toBeCloseTo(0.35);
  } finally {
    player.dispose();
    clock.restore();
  }
});
