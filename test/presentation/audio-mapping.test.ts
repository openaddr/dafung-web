import { describe, expect, it } from "bun:test";
import { SOUND_CLIPS, soundClipUrl } from "@app/fx/sound-clips";
import { resolve } from "node:path";

describe("对局音效素材表", () => {
  it("每个对局音效的播放资源都在安装包内", async () => {
    for (const [event, clip] of Object.entries(SOUND_CLIPS)) {
      const path = resolve(import.meta.dir, "../../public", `.${soundClipUrl(clip)}`);
      expect(await Bun.file(path).exists(), `${event} 缺少 ${path}`).toBe(true);
    }
  });

  it("同一录音的共享裁剪一致，收尾渐隐短于裁剪长度", () => {
    const trimByFile = new Map();
    for (const clip of Object.values(SOUND_CLIPS)) {
      if (clip.kind !== "recording" || !clip.trim) continue;
      expect(clip.trim.releaseMs).toBeLessThan(clip.trim.stopAt * 1000);
      if (trimByFile.has(clip.file)) expect(clip.trim).toEqual(trimByFile.get(clip.file));
      else trimByFile.set(clip.file, clip.trim);
    }
  });
});
