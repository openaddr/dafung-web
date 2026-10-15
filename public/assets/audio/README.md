# 音效素材(public/assets/audio)

本目录存放游戏真实录音音效(ogg)。接线与语义的唯一事实源是 `src/app/fx/audio.ts`:`AUDIO_FILES` 把 `SoundEvent` 映射到本目录文件,映射缺失或加载失败的事件走同文件内置合成音回退;音量档与截断收尾在 `FILE_GAIN`/`FILE_TRIM`,个别事件刻意不映射文件(以 `audio.ts` 注释为准)。

## 授权与登记

- 人工账本:`public/assets/CREDITS.md`;机器账本:`public/assets/manifest.json`(`id → {path, source, license, author, fetched_at}`)。
- 来源:Wikimedia Commons(CC0 / Public Domain / CC-BY)与 Freesound(CC0)为主,逐条经接口核实直链、授权、作者、字节数;标 `review_required` 的条目在 APK 公开发布前必须人工复核(授权纪律见 CREDITS.md)。
- 入库走 `scripts/fetch-asset.ts` 管线(与图片/字体/画像同一条),不手放裸文件。

## 目录现状

12 个 ogg,两代命名并存:2026-10 批起新素材带 `audio-` 前缀(tile-clack / coins-box / rain),更早的以事件语义命名(如 `coin-drop.ogg`、`gong-long.ogg`),不做批量改名。素材退役后删文件,CREDITS/manifest 条目标「已退役」留档。
