import { afterAll, beforeAll, expect, it, spyOn } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { MapSource } from "@dafung/core/engine/map-source";
import { MediaAudioPlayer, getAudio, setAudio } from "@app/fx/audio";
import { SOUND_CLIPS, soundClipUrl, type SoundEvent } from "@app/fx/sound-clips";
import { HOME_TID } from "@app/screens/home/testids";
import { SOUND_TID } from "@app/screens/sound/testids";
import maps from "../../packages/core/maps/index.json";
import pkg from "../../package.json";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

const mapSource: MapSource = {
  listMaps: async () => maps,
  loadMapData: async () => {
    throw new Error("试听不进入对局");
  },
};

beforeAll(ensureHappyDom);
afterAll(releaseHappyDom);

function button(testId: string): HTMLButtonElement {
  const element = document.querySelector(`[data-testid="${testId}"]`);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`缺少按钮 ${testId}`);
  return element;
}

const click = (testId: string) => act(async () => button(testId).click());

it("首页列出每条游戏音效的触发说明，换声和关闭会停止试听", async () => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;
  Object.defineProperty(navigator, "webdriver", { value: true, configurable: true });
  const { HomeScreen } = await import("@app/screens/home/HomeScreen");
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const played: { player: HTMLMediaElement; src: string | null; rate: number }[] = [];
  const paused: HTMLMediaElement[] = [];
  const play = spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    played.push({ player: this, src: this.getAttribute("src"), rate: this.playbackRate });
    return Promise.resolve();
  });
  const pause = spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    paused.push(this);
  });
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const gameAudio = new MediaAudioPlayer({ preload: false });
  gameAudio.setMuted(true);
  setAudio(gameAudio);

  try {
    await act(async () =>
      root.render(
        <HomeScreen
          initialMapId="guanzhong"
          mapSource={mapSource}
          onSolo={() => {}}
          onOnline={() => {}}
        />,
      ),
    );
    await click(HOME_TID.soundAudition);

    expect(played).toHaveLength(0);
    for (const event of Object.keys(SOUND_CLIPS) as SoundEvent[]) {
      const row = button(SOUND_TID.play(event));
      const description = row.getAttribute("aria-describedby");
      if (description === null) throw new Error(`缺少 ${event} 的触发说明`);
      expect(document.getElementById(description)?.textContent).toBeTruthy();
    }

    const dice = SOUND_TID.play("diceLand");
    const victory = SOUND_TID.play("victory");
    await click(dice);
    expect(played[0].src).toBe(soundClipUrl(SOUND_CLIPS.diceLand));
    expect(played[0].rate).toBe(1);
    expect(button(dice).getAttribute("aria-pressed")).toBe("true");

    await click(victory);
    expect(played[1].src).toBe(soundClipUrl(SOUND_CLIPS.victory));
    expect(paused).toContain(played[0].player);
    await act(async () => played[0].player.dispatchEvent(new Event("ended")));
    expect(button(victory).getAttribute("aria-pressed")).toBe("true");
    await act(async () => played[1].player.dispatchEvent(new Event("ended")));
    expect(button(victory).getAttribute("aria-pressed")).toBe("false");

    play.mockRejectedValueOnce(new Error("试播失败"));
    await click(dice);
    expect(document.querySelector(`[data-testid="${SOUND_TID.error}"]`)?.textContent).toContain(
      "骰签落定",
    );
    await click(dice);
    expect(document.querySelector(`[data-testid="${SOUND_TID.error}"]`)).toBeNull();
    expect(played).toHaveLength(3);
    await click(SOUND_TID.close);
    expect(document.querySelector(`[data-testid="${SOUND_TID.dialog}"]`)).toBeNull();
    expect(paused).toContain(played[2].player);
    expect(getAudio()).toBe(gameAudio);
    gameAudio.play("coin");
    expect(played).toHaveLength(3);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    setAudio(null);
    warn.mockRestore();
    pause.mockRestore();
    play.mockRestore();
    Reflect.deleteProperty(navigator, "webdriver");
  }
});
