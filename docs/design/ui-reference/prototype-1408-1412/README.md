# 群雄逐鹿 · 卡牌画心与首页原型

[打开原型](index.html)。下方左右箭头切换现状、A、B。画心可切换局内手牌、手册珍宝、手册机遇和局内机遇。首页可切换 844×390、800×360 多图长名、800×360 双侧各留 36px。需要时从地址栏复制带 `topic`、`variant` 和 `scene` 的链接。

[画心对照](cards-compare.webp) · [局内机遇](encounter-compare.webp) · [首页对照](home-compare.webp) · [首页窄屏](home-short.webp)

## #1408 卡牌画心

| 方案 | 珍宝 | 锦囊 | 机遇 |
| --- | --- | --- | --- |
| 现状 | 室内器物照片 | 族类墨线 | 档位气象墨线，局内卷轴直接读文字 |
| A 统一设色 | 玉玺单物设色 | 营寨起火 | 人群乘船，手册与卷轴联用 |
| B 保留实物照片 | 玉玺沿用照片 | 营寨起火 | 人群乘船，手册与卷轴联用 |

两案共用金框、纸底和文本布局。珍宝以单件器物为主体，锦囊以动作结果为主体，机遇以事件场景为主体。用明暗和主体轮廓保证缩小后还能看清。品级、锦囊标签和机遇档位继续由各自的角标表达。奇遇身份沿用宽卷和题行金穗，携民渡江在现行目录中是普通中性事件。

建议 B。已有照片里轮廓清楚、来源可查、适合裁切的器物可以继续用。故事不清或器物照片无法代表物件时再补画。A 的画材观感更整齐，需要处理更多现有资产。定案后，三类画心的实际题材和逐项复用仍由 #1409、#1410、#1411 决定。正式资产逐项记录来源、作者或生成记录、授权状态与裁切处理，实体清单与画心索引由各实施票核对。

观察位包括手牌上约 96×128 的牌面、手册机遇笺约 120×160 和详情画心。画面上缩到小尺寸后仍能指出玉玺、火和渡船。正文和动作按钮始终保留。最终真机验收在 844×390 Android APK 进行。

## #1412 首页主视觉

- A 沙盘横幅。标题在画内，城楼、棋子和路线露在右侧。画下同一行放三入口，单机靠左且突出。地图条通宽。
- B 左画右操作。左半展示完整沙盘和谋士，右半放单机、联机、手册、地图条和诊断。地图区宽度较小，多图时需要更多横滑。
- 现状用平复帖短横带和上下排列的入口作对照。原型依源码重构，保留重点布局和素材。

建议 A。用户可以在 844×390 一眼扫到三个入口和当前地图，沙盘题材也能读出来。B 更适合把谋士和整个沙盘一起展示。两案在 800×360 样张仍保留对局诊断。用实际的地图清单填充默认状态，多图长名称选项增加四个压力样本。点地图立刻显示金框，点单机和联机核对所选图，点手册进入本原型的珍宝目录。

## 样张来源

- 起基 `da59243ca4c8d7d2f0bb27e2c665c8499f0c3f95`。地图、牌名、机遇选项、珍宝名称与指导价来自此提交的数据。锦囊和机遇现状墨线取自本提交组件。
- 对局底图取自 #1403 的关中截图与 #1404 的关中原型。相同题材在各案保持同一大小和背景。原型数据选取了代表条目，界面接线、按钮跳转和结算是演示状态。
- `art/paint-0.webp` 至 `art/paint-2.webp` 是同一张三联样画的裁片，`art/sand-table.webp` 是独立沙盘样画。两者用内置 ImageGen 生成。素材仅供这次比选。
- 网页原型沿用仓库离线字体。对照图用静态排版器导出，采用系统中文字库和固定画布。图中数据和尺寸用于比较，Android 真实排版和触屏需真机观察。

## ImageGen 提示词

画心三联样张

> Generate ONE production-quality concept-art contact sheet, exactly 3 equal vertical panels side by side with straight clean boundaries and no gutters, bleed edge-to-edge. This is a single shared-paint-medium comparison swatch for THREE DIFFERENT card picture windows for an original Three Kingdoms board game. Wide landscape image, 3:1 if possible. Each panel will independently crop to a landscape 1.43:1 art window, so keep its subject large, centered in the middle 60% of that third, and near the vertical center. Every panel in same matte tinted ink and mineral-pigment painted illustration style, warm dusty charcoal ink, faded tea-brown textured silk, subdued muted cinnabar/green/ochre, dark ink edges, clear light/dark separation, careful brush contour. LEFT THIRD: only a single pale celadon/jade royal Chinese seal, square body and a sculpted crouching dragon knob, in three-quarter view against dark restrained parchment, bold silhouette with ample space. MIDDLE THIRD: Three Kingdoms era military encampments in a line along a slope catching fire at dusk, bold glowing vermilion flames across two near black timber tents with one prominent silhouette, brushstroke smoke, medium close view. RIGHT THIRD: Three Kingdoms era group of commoners and families boarding a wooden ferry crossing a wide river, ferry as the clear focal silhouette, fog, a muted blue gray river, cream light rim on the boat. Simple readable forms when reduced to 64px. No text, no calligraphy, no border, no graphics, no card frames, no people in the left panel, no typography.

首页沙盘

> Create original exceptionally composed landscape key art for an Android landscape Three Kingdoms board game homepage. ONLY raster illustration, no text, no calligraphy, no UI, no borders or graphic design. Wide landscape approximately 3:2. An intimate tangible Han dynasty tabletop campaign sand table, a dark grained lacquer table with low carved ink-green mountains, a thin winding patinated brass trail connecting miniature ancient Chinese gatehouses, 3 very legible upright lacquer game pawns in deep cinnabar, dark muted teal, and worn gold, one near center-right and two at distant depths. A single late Han strategist in understated black and smoky burgundy robes appears beyond the board on the far right, softly shaded, subordinate to the gatehouse and board. View from low three-quarter tabletop angle, cinematic ambient warm dusk light, thin smoke, rich ink-shadow texture. Left 40% is very dark low contrast with some terrain texture and enough negative space for overlaid ivory title. Critical silhouette of main gatehouse, bronze winding route, yellow teal and red board pawns centered within the middle horizontal third of the image height, so the art still reads as a short 4.5:1 banner crop. Painterly realism and restrained golden accents, same classic ink-lacquer feel of worn historical material. Entirely original, avoid resemblance to any existing video game art or interface.
