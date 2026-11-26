import { afterAll, beforeAll, expect, it, spyOn } from "bun:test";
import { AudioProvider } from "@app/fx/AudioProvider";
import {
  getAudio,
  MediaAudioPlayer,
  subscribeAudioPlayback,
  type AudioPlaybackEvent,
} from "@app/fx/audio";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installControlledClock } from "./controlled-clock";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

beforeAll(ensureHappyDom);
afterAll(releaseHappyDom);

it("重叠开播和自然结束按实例配对，试听和界面提示不入诊断", async () => {
  const played: HTMLMediaElement[] = [];
  const ready = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  using _play = spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    played.push(this);
    const pending = ready[played.length - 1];
    return pending === undefined ? Promise.resolve() : pending.promise;
  });
  const clock = installControlledClock({ monotonic: true });
  const player = new MediaAudioPlayer({ preload: false });
  const events: AudioPlaybackEvent[] = [];
  const unsubscribe = subscribeAudioPlayback((event) => events.push(event));
  try {
    player.play("diceLand");
    player.play("diceLand");
    await clock.advance(23);
    expect(events).toEqual([]);

    ready[1].resolve();
    await clock.settle();
    await clock.advance(11);
    ready[0].resolve();
    await clock.settle();
    expect(events).toEqual([
      { kind: "start", sound: "diceLand", atMs: 23, instanceId: expect.any(Number) },
      { kind: "start", sound: "diceLand", atMs: 34, instanceId: expect.any(Number) },
    ]);
    const [second, first] = events;
    expect(second.instanceId).not.toBe(first.instanceId);

    await clock.advance(17);
    played[0].dispatchEvent(new Event("ended"));
    await clock.advance(21);
    played[1].dispatchEvent(new Event("ended"));
    expect(events.slice(2)).toEqual([
      { ...first, kind: "end", atMs: 51, reason: "natural" },
      { ...second, kind: "end", atMs: 72, reason: "natural" },
    ]);

    player.play("jinnangSelect");
    player.play("lobbyJoined");
    await clock.settle();
    played[2].dispatchEvent(new Event("ended"));
    played[3].dispatchEvent(new Event("ended"));
    player.audition("diceLand", () => {});
    await clock.settle();
    played[4].dispatchEvent(new Event("ended"));
    expect(events).toHaveLength(4);
  } finally {
    unsubscribe();
    player.dispose();
    clock.restore();
  }
});

it("开播失败和快速取消各记一次收声，迟到的媒体回调不补报", async () => {
  const played: HTMLMediaElement[] = [];
  const ready = Array.from({ length: 3 }, () => Promise.withResolvers<void>());
  using _play = spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    played.push(this);
    return ready[played.length - 1].promise;
  });
  using _warn = spyOn(console, "warn").mockImplementation(() => {});
  const clock = installControlledClock({ monotonic: true });
  const player = new MediaAudioPlayer({ preload: false });
  const events: AudioPlaybackEvent[] = [];
  const unsubscribe = subscribeAudioPlayback((event) => events.push(event));
  try {
    player.play("cityConquest");
    await clock.advance(14);
    ready[0].reject(new Error("媒体拒绝开播"));
    await clock.settle();

    player.play("reactionOpen");
    await clock.advance(7);
    played[1].dispatchEvent(new Event("error"));
    ready[1].reject(new Error("媒体同时拒绝开播"));
    await clock.settle();

    player.play("victory");
    await clock.advance(14);
    player.stop("all");
    ready[2].resolve();
    played[2].dispatchEvent(new Event("ended"));
    await clock.settle();

    expect(events).toEqual([
      {
        kind: "end",
        sound: "cityConquest",
        atMs: 14,
        instanceId: expect.any(Number),
        reason: "failed",
      },
      {
        kind: "end",
        sound: "reactionOpen",
        atMs: 21,
        instanceId: expect.any(Number),
        reason: "failed",
      },
      {
        kind: "end",
        sound: "victory",
        atMs: 35,
        instanceId: expect.any(Number),
        reason: "cancelled",
      },
    ]);
  } finally {
    unsubscribe();
    player.dispose();
    clock.restore();
  }
});

it("节拍、替换、静音和切后台在实际收声时各记原因", async () => {
  using _play = spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  const clock = installControlledClock({ monotonic: true });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
  const events: AudioPlaybackEvent[] = [];
  const ends = () => events.filter((event) => event.kind === "end");
  const unsubscribe = subscribeAudioPlayback((event) => events.push(event));
  const discardPresentation = () => getAudio().stop("all");
  document.addEventListener("visibilitychange", discardPresentation);
  try {
    act(() => root.render(<AudioProvider>{null}</AudioProvider>));
    const audio = getAudio();
    audio.play("cityConquest", 96);
    audio.play("reactionOpen");
    await clock.advance(16);
    audio.play("reactionTick");
    await clock.advance(79);
    expect(ends()).toEqual([]);
    await clock.advance(1);
    expect(ends()).toEqual([
      {
        kind: "end",
        sound: "cityConquest",
        atMs: 96,
        instanceId: expect.any(Number),
        reason: "beatFade",
      },
    ]);

    await clock.advance(150);
    audio.setMuted(true);
    audio.setMuted(false);
    audio.play("victory");
    await clock.settle();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(ends().map(({ sound, reason }) => [sound, reason])).toEqual([
      ["cityConquest", "beatFade"],
      ["reactionOpen", "replaced"],
      ["reactionTick", "muted"],
      ["victory", "background"],
    ]);
  } finally {
    unsubscribe();
    document.removeEventListener("visibilitychange", discardPresentation);
    if (visibility === undefined) Reflect.deleteProperty(document, "visibilityState");
    else Object.defineProperty(document, "visibilityState", visibility);
    act(() => root.unmount());
    clock.restore();
    host.remove();
  }
});

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
