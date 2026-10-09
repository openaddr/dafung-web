// 音效映射一致性守卫(2026-10 复盘 P1):AUDIO_FILES 指向的素材文件缺失时,
// HybridAudioPlayer 会静默回退合成——播放不报错,只有人耳能发现。本测试把这类
// 降级变成当场炸出的回归(改目录名/删文件/打错 URL 都在此落网);
// 顺带守 FILE_TRIM 不挂死键(裁剪只作用于文件通路,合成音不受裁)。
import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AUDIO_FILES, FILE_TRIM } from "@app/fx/audio";

const audioDir = fileURLToPath(new URL("../public/assets/audio", import.meta.url));

describe("音效映射一致性", () => {
  it("AUDIO_FILES 每个映射都指向 public/assets/audio/ 下真实存在的文件", () => {
    const onDisk = new Set(readdirSync(audioDir));
    const entries = Object.entries(AUDIO_FILES);
    expect(entries.length).toBeGreaterThan(0); // 表非空:空表=映射能力被整体误删
    for (const [event, url] of entries) {
      expect(url, `${event} 缺 URL`).toBeDefined();
      const file = url!.replace(/^\/assets\/audio\//, "");
      expect(onDisk.has(file), `${event} → ${url} 素材文件不存在(将静默降级合成)`).toBe(true);
    }
  });

  it("FILE_TRIM 只挂已映射文件的事件(裁剪作用于文件通路)", () => {
    for (const event of Object.keys(FILE_TRIM)) {
      expect(
        AUDIO_FILES[event as keyof typeof AUDIO_FILES],
        `${event} 在 FILE_TRIM 有裁剪但无文件映射(死配置)`,
      ).toBeDefined();
    }
  });
});
