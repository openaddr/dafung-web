# 音效素材(public/assets/audio)

音效事件、素材、音量和收尾都在 [sound-clips.ts](../../../src/app/fx/sound-clips.ts) 登记。根目录 ogg 是录音素材，`playback/` 中是录音的裁剪成品和程序合成的短音。游戏通过 HTML 媒体元素播放。

修改裁剪或合成配方后，安装 ffmpeg 并从仓库根运行 `bun scripts/build-sound-clips.ts`，提交修改过的成品。日常构建使用仓内成品。

## 授权与登记

- 人工账本:`public/assets/CREDITS.md`;机器账本:`public/assets/manifest.json`(`id → {path, source, license, author, fetched_at}`)。
- 来源:Wikimedia Commons(CC0 / Public Domain / CC-BY)与 Freesound(CC0)为主,逐条经接口核实直链、授权、作者、字节数;标 `review_required` 的条目在 APK 公开发布前必须人工复核(授权纪律见 CREDITS.md)。
- 入库走 `scripts/fetch-asset.ts` 管线(与图片/字体/画像同一条),不手放裸文件。

## 目录现状

11 个 ogg,两代命名并存:2026-10 批起新素材带 `audio-` 前缀(coins-box / rain;同批 tile-clack 已随 #638 拼点双印退役),更早的以事件语义命名(如 `coin-drop.ogg`、`gong-long.ogg`),不做批量改名。素材退役后删文件,CREDITS/manifest 条目标「已退役」留档。
