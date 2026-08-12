# 古风音效素材清单(public/assets/audio)

本目录存放三国大富翁替换/增强 `src/render/audio.ts` 合成音效所用的真实录音。
所有素材来自 **Wikimedia Commons** 的 **CC0 / Public Domain / CC-BY** 音频(优先零署名),
逐条经 Commons `imageinfo` 接口核实直链、授权、作者、字节数、时长。

## ⚠️ 重要:二进制尚未下载(需运行脚本)

本目录的 `.ogg`/`.wav` 文件由 **`scripts/fetch-audio.ts`** 下载生成(见文末内嵌脚本)。
运行前目录为空(仅本说明)。下载后 `manifest.json` 会逐条登记来源/授权/大小。

### 一键下载

```bash
# 抓全部 CC0/Public Domain 音效(推荐,零署名)
npx tsx scripts/fetch-audio.ts

# 只抓单个
npx tsx scripts/fetch-audio.ts --id audio:coin

# 额外抓 CC-BY(-SA) 需署名音效(woodblock / gong-long)
npx tsx scripts/fetch-audio.ts --with-attribution
```

脚本会在 `public/assets/audio/` 生成 `.ogg` 文件,写 `manifest.json`(音频清单),
并把 `- **audio:xxx**` 行追加到 `public/assets/CREDITS.md`(与图片条目共存)。

---

## 已核实素材清单(优先级 = 任务要求)

下表每一行的**直链/授权/作者/大小**均来自 Commons `imageinfo` 实测(2026 核实),
下载脚本据此硬编码,运行时仍会再次校验授权与 mime。

| id | 用途(SoundEvent) | Commons 文件 | 授权 | 作者 | 大小 | 时长 | 满足50KB |
|---|---|---|---|---|---|---|---|
| **audio:coin** | coin 铜钱 | [Coin dropped on wooden floor.ogg](https://commons.wikimedia.org/wiki/File:Coin_dropped_on_wooden_floor.ogg) | Public domain | ezwa(pdsounds.org) | 42KB | 2.3s | ✅ |
| **audio:coins-shake** | coin 摇钱 | [Shaking coins in palm.ogg](https://commons.wikimedia.org/wiki/File:Shaking_coins_in_palm.ogg) | Public domain | ezwa(pdsounds.org) | 94KB | 3.6s | ⚠️裁剪 |
| **audio:gong** | stamp 印章/盖宝 | [Gong or bell vibrant (short).ogg](https://commons.wikimedia.org/wiki/File:Gong_or_bell_vibrant_(short).ogg) | **CC0** | stephan(pdsounds.org) | 57KB | 5.6s | ⚠️裁剪 |
| **audio:march** | banner 行军/横幅 | [Drum Roll Intro.ogg](https://commons.wikimedia.org/wiki/File:Drum_Roll_Intro.ogg) | **CC0** | Iwan Sounds and DIY | 74KB | 4.0s | ⚠️裁剪 |
| **audio:victory** | victory 胜利庆典 | [Fanfares of the President of Azerbaijan.ogg](https://commons.wikimedia.org/wiki/File:Fanfares_of_the_President_of_Azerbaijan.ogg) | Public domain | Central Band, Armed Forces of Azerbaijan | 153KB | 14.3s | ⚠️裁剪 |

次选(需 `--with-attribution`,CC-BY(-SA) **需署名**):

| id | 用途 | Commons 文件 | 授权 | 作者 | 大小 |
|---|---|---|---|---|---|
| **audio:woodblock** | stamp 木击 | [Blok music.ogg](https://commons.wikimedia.org/wiki/File:Blok_music.ogg) | CC BY-SA 4.0 | Krol111 | 23KB ✅ |
| **audio:gong-long** | victory 得宝长尾 | [Gong55.ogg](https://commons.wikimedia.org/wiki/File:Gong55.ogg) | **CC0** | stephan | 149KB |

### 直链(Commons upload.wikimedia.org,脚本运行时取最新)

```
https://upload.wikimedia.org/wikipedia/commons/c/c5/Coin_dropped_on_wooden_floor.ogg
https://upload.wikimedia.org/wikipedia/commons/4/46/Shaking_coins_in_palm.ogg
https://upload.wikimedia.org/wikipedia/commons/4/42/Gong_or_bell_vibrant_%28short%29.ogg
https://upload.wikimedia.org/wikipedia/commons/c/c4/Drum_Roll_Intro.ogg
https://upload.wikimedia.org/wikipedia/commons/4/48/Fanfares_of_the_President_of_Azerbaijan.ogg
https://upload.wikimedia.org/wikipedia/commons/0/07/Blok_music.ogg
https://upload.wikimedia.org/wikipedia/commons/2/2c/Gong55.ogg
```

---

## 任务覆盖情况(按优先级)

| 任务要求音效 | 优先级 | Commons 可用 | 说明 |
|---|---|---|---|
| 骰子/签筒掷骰 | 🔴最高 | ❌ 无真正音效 | Commons 仅爵士乐《Toss the Dice》与语言发音;签筒/竹筒无。**见下 Freesound 手动补充** |
| 铜钱/金币 | 🟠高 | ✅ `audio:coin` / `audio:coins-shake` | PD,落币 + 摇钱 |
| 印章盖章 | 🟡中 | ✅ `audio:gong`(锣替代)/ `audio:woodblock` | 无直接盖章声,用金属锣/木块替代 |
| 胜利庆典 | 🟢低 | ✅ `audio:victory` | PD 铜管号角 |
| 古风提示音(古琴/笛单音) | 中 | ⚠️ 仅整曲 | 古琴录音为 CC-BY-SA 整曲(4-5MB),无单音。建议继续用 `audio.ts` 合成单音 |
| 古代行军/马蹄 | 中 | ✅ `audio:march` | CC0 鼓滚奏;马蹄无,用鼓点替代 |
| 卷轴展开 | 低 | ❌ 无 | Commons 无纸张/卷轴音效 |

### Freesound 手动补充(骰子/签筒/卷轴 —— Commons 缺失品类)

项目 `.env` 无 Freesound API token,无法脚本化下载(需 OAuth2 注册)。
**手动操作**:到 <https://freesound.org> 搜索(d筛选 License = **Creative Commons 0**),
下载后放本目录,并在 `manifest.json`/`CREDITS.md` 补登记。推荐检索词:

- 骰子:`dice`, `rolling dice`, `dice cup`(签筒:`bamboo shaker`, `sticks`)
- 卷轴:`paper`, `scroll`, `parchment`, `page turn`

> 注:部分 Freesound CC0 内容已被转载到 Commons 并标 CC0(如锣、ratchet),
> 但**骰子/签筒/卷轴**尚未被转载,故只能从 Freesound 原站取。

---

## 50KB 预算与裁剪

任务要求单文件 ≤ 50KB,但游戏音效的真实录音普遍 40~150KB(ogg)。
仅 `audio:coin`(42KB)天然满足。其余**略超**,APK 打包前建议裁剪:

```bash
# 示例:截前 3 秒 + 降到 mono 48kbps(需 ffmpeg)
ffmpeg -i sound-gong.ogg -t 3 -ac 1 -b:a 48k sound-gong.ogg
```

裁剪后体积通常可压到 50KB 以内且听感无损(短音效)。`manifest.json` 会标 `over_size_budget: true` 提示。
浏览器/WebView(Tauri2)原生支持 ogg 解码,无需转 mp3。

---

## 接入游戏代码

`src/render/audio.ts` 已预留可拔插 `AudioPlayer` 接口。接入方式(不在本任务范围,仅备忘):
新增 `FileAudioPlayer` 实现,预加载 `assets/audio/sound-*.ogg` 到 `Map<SoundEvent, AudioBuffer>`,
`play(event)` 查表回放;`SynthAudioPlayer` 作为兜底(文件未就绪/加载失败时降级)。
调用处 `this.audio.play(event)` 永不改。
