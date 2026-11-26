# 音效录音与成品

首页「音效试听」与对局共用 42 条成品。每条都使用网络录音，经裁剪、均衡、移调或叠加制成。根目录的 Ogg 是录音素材，`playback/` 存放可直接播放的成品。事件、文件和播放音量见 [sound-clips.ts](../../../src/app/fx/sound-clips.ts)。

## 试听条目与录音来源

| 试听条目 | 使用的录音 |
| --- | --- |
| 选择纸扣、卷轴展开、锦囊入手、出牌拂纸、窥探翻页 | [展开卷纸][paper] |
| 入房软木扣、驻跸门闩、扩军 | [木门把手扣合][latch] |
| 重连提示、开窗轻叩、末段提醒 | [轻叩陶杯][ceramic] |
| 石印 | [钤印][seal] |
| 起兵主题、称帝落印与角句 | [圆号实录][horn]。称帝时加[钤印][seal] |
| 骰签落定 | [木块敲击][woodblock] |
| 行军起步 | [木柜滑动][slide]、[木门把手扣合][latch] |
| 拼点合击 | [硬木块敲击][clash] |
| 判词磬·中性、判词磬·己胜、判词磬·己败 | [敲击颂钵][bowl] |
| 购地成交 | [钤印][seal]、[掌中摇硬币][coinshake] |
| 城池受击 | [石击][stone] |
| 破防 | [碎石][crash]、[大鼓][drum] |
| 攻陷 | [断木][splinter]、[旗帛拍动][cloth]、[木门把手扣合][latch]、[大鼓][drum] |
| 银两归账 | [硬币落到木地板][coin] |
| 独立失银 | [布料拍动][cloth]、[掌中摇硬币][coinshake] |
| 铜钱交接 | [硬币落到木地板][coin]、[掌中摇硬币][coinshake] |
| 账册合拢 | [展开卷纸][paper]、[钤印][seal]、[木门把手扣合][latch] |
| 识破铜扣、反识破回音 | [金属搭扣][clasp]、[敲击颂钵][bowl] |
| 探得珍宝、窃得珍宝 | [古琴《醉渔唱晚》][qin] |
| 书册入案 | [展开卷纸][paper]、[钤印][seal] |
| 招将成功 | [金属皮带扣][buckle]、[古琴《醉渔唱晚》][qin] |
| 习得技能 | [展开卷纸][paper]、[古琴《醉渔唱晚》][qin] |
| 体力损耗、体力耗竭、终局单鼓 | [大鼓][drum] |
| 恢复体力 | [敲击颂钵][bowl] |
| 倒旗起锣 | [锣声][gong] |
| 雨声铺底 | [雨声实录][rain] |
| 撒币短响 | [硬币入盒][coinsbox] |

## 维护

改配方后，从仓库根运行 `bun scripts/build-sound-clips.ts [音效事件 ...]` 生成并提交对应成品。脚本用 ffmpeg 读已登记的录音，常规构建直接使用仓内成品。

新增外部录音用 [fetch-asset.ts](../../../../../scripts/fetch-asset.ts) 入库。作者与授权见 [CREDITS.md](../CREDITS.md)，机器账本见 [manifest.json](../manifest.json)。退役后删录音文件，保留来源记录。

[paper]: https://freesound.org/s/710764/
[latch]: https://freesound.org/s/104019/
[ceramic]: https://freesound.org/s/706536/
[seal]: https://freesound.org/s/759526/
[horn]: https://freesound.org/s/373255/
[woodblock]: https://commons.wikimedia.org/wiki/File:Blok_music.ogg
[slide]: https://freesound.org/s/364103/
[clash]: https://freesound.org/s/692818/
[bowl]: https://freesound.org/s/271370/
[coinshake]: https://commons.wikimedia.org/wiki/File:Shaking_coins_in_palm.ogg
[stone]: https://freesound.org/s/431019/
[crash]: https://freesound.org/s/711657/
[drum]: https://freesound.org/s/375259/
[splinter]: https://freesound.org/s/774268/
[cloth]: https://freesound.org/s/844390/
[coin]: https://commons.wikimedia.org/wiki/File:Coin_dropped_on_wooden_floor.ogg
[clasp]: https://freesound.org/s/822397/
[qin]: https://commons.wikimedia.org/wiki/File:Guqin-Zuiyu_Changwan.ogg
[buckle]: https://freesound.org/s/331719/
[gong]: https://commons.wikimedia.org/wiki/File:Gong55.ogg
[rain]: https://freesound.org/s/320520/
[coinsbox]: https://freesound.org/s/190945/
