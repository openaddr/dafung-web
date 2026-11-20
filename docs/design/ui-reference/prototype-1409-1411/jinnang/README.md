# 锦囊画心比选

[打开离线原型](index.html) · [查看静态对照](compare.png) · [#1410](https://github.com/openaddr/dafung-web/issues/1410)

打开后用下排切换现状、A、B。手牌架可看谋系、攻系和即时三组，每组的前两张是共用画心的对照，第三张是已有专属图的参照。试一次「只看画心」和「换顺序」，说出哪张在拼点、拖住、取宝、烧城、拆招、拦路，再打开题名核对。点牌看原位 1.6 倍放大，手册中点任何一张看正文和画心。

| 锦囊     | 现状 | A · 完整小场景   | B · 主体特写       |
| -------- | ---- | ---------------- | ------------------ |
| 连环计   | 云   | 两将隔案掷骰     | 两枚相撞的骨骰     |
| 缓兵之计 | 云   | 渡泥道时车马滞留 | 陷住的车轮         |
| 窃玉偷香 | 火   | 夜里从漆匣取玉   | 手指提起玉璧       |
| 火烧连营 | 火   | 营寨火势沿坡蔓延 | 火舌压过城楼       |
| 识破诡计 | 电   | 谋士揭开密札     | 断封后抽出一枚竹简 |
| 半路杀出 | 电   | 城外关卡拦下行人 | 横木截断道路       |

## 建议

**以 B 的主体可辨为小档标准。** A 在放大时有更清楚的人物关系和前后景。缩回手牌，连环计的骰子和窃玉偷香的玉璧容易被人物、桌面与漆匣分去注意力。B 让撞骰、泥轮、玉璧、大火、抽简、横木占据各自最大轮廓。B 的玉璧还可以加强「正从手边取走」的动作，半路画心定稿时可把红白横杠改作古代拒马，保留横向截路轮廓。图只承担故事辨识，份额、触发窗口和结算依正文判读。

- **六张用专属构图**。连环／缓兵的区别是拼点与跳回合，窃玉／火烧是夺宝与烧城，识破／半路是取消一份锦囊效果与途经拦检。图里即使借用同一种道具或材质，也要能从动作与轮廓分开。
- **三张已有专属保留**。军情密探的眼、横征暴敛的方孔钱、求贤令的榜文先沿用。抽简与榜文、玉璧与方孔钱也用小档盲看确认，避免相近物件新撞图。
- **复用看题材和辨识**。同一张牌可在手牌、放大和手册沿用同一画心。异名牌共用同一成图，需题材和动作确实相通，且标准横屏遮字后同场可区分。云、火、电可在类别相同的牌间复用为背景笔触或图元。以清单逐牌记录采用或复用理由，登记来源、作者或生成记录、授权和各消费位裁切，墨线、矢量与位图都可参选。画框管边界，纸底管阅读，标签章管类别。人机、单机和联机消费同一画心。

最终由用户比较 A 与 B；正式样张验收看 844×390 Android APK 中的 96×128 手牌、原位放大、120×160 手册墙和详情。遮笺头、笺脚与标签后，应能说出三对各自的画面区别，且小档跨组仍可区分。还原文字后核对长题名、双章、长正文、实际叠牌、关闭与触屏。原型的「点牌放大」是统一比选动作，三组都可点。现行手册详情为纯文字，A/B 额外示意画心与全文并列。触发时机与对局操作沿现行规则。

## 样张来源

- 源码基线 `662bb00d2f45cc116dfe2284f7d6692b39dd354c`。目录、标签、牌库张数和正文取自 `src/core/jinnang.ts`，现状九个画心从 `src/app/components/card/ink-art/jinnang-huaxin.tsx` 渲染。纸面、主题、离线字体规格取自同提交的牌面组件与设计规范。交互页在工作区直接打开，字体读取仓库镜像。
- `art/guanzhong.webp` 是前一原型留存的 #1403 真实关中截图。手牌架按现行 96×128 几何重排对照样本。`art/home.webp` 转存上一轮认可的首页 B 原型截图，作为手册示意背景。静态 PNG 用 WeasyPrint 排版、系统文泉驿与固定画布导出；几何和视觉待在 Android APK 验证。
- `art/a-fire.webp` 原样复用 #1408 样张 `art/paint-1.webp`。另两张 3×2 母图由内置 ImageGen 按下方提示词生成。(a) 生成记录 `exec-3df1aee8-f9d2-4144-bbb5-65f9239b95a3.png`，(b) 为 `exec-22f3190f-445b-4354-8be1-2885c3aa4e9d.png`。按格裁掉接缝，裁为 420×300 WebP，版面居中取图。样张供本次比选，正式资产另走逐项登记和确认。 [#1408 决议](https://github.com/openaddr/dafung-web/issues/1408#issuecomment-7032993454)

<details>
<summary>两张母图的生成提示词</summary>

**A**

> Generate ONE contact sheet exactly as follows. Original late-Han Three Kingdoms tabletop game artwork. Restrained Chinese ink and mineral pigment on aged silk, near-black charcoal, umber, muted cinnabar and worn gold, small use of dark jade, matte textured brush contour. NO text, NO Chinese characters, NO paper card borders, NO graphic design, NO letters, NO numerals, NO ornament. The 3x2 contact sheet is a perfectly aligned grid of THREE equal columns by TWO equal rows, exactly six equal rectangular paintings, straight sharp boundaries, NO margins and NO gutters. Wide landscape 2.1:1 overall if possible, about 1.4:1 for each cell. Every subject stays wholly inside its cell with a margin. Each tile is an independent game-card picture window intended to also be recognizable at 88x70 pixels.
> Treatment A: make each a clear complete story in middle distance with context, depth and human gesture, composed so focal actions group near the center and the setting is subordinate. TOP LEFT: two rival military warlords face each other across a low war table throwing bone dice, two dark helmeted profiles facing inward, dusk tactical tent. TOP MIDDLE: a mounted courier's departure delayed at a muddy crossroads as attendants work to free his deeply bogged chariot wheel; rider waiting, wet empty road leading away, warm tan palette. TOP RIGHT: nocturnal thief with hand lifting a bright pale jade ring out of an open low lacquer casket, torso half in shadow, treasure and stealth clear, muted jade night. BOTTOM LEFT: an ancient city gate and its nearby timber encampments catch fire in emphatic orange vermilion at night, firegoing left along the roofs, waterless dusty ground. BOTTOM MIDDLE: strategist exposes the enemy plot in a tent by opening the sealed bamboo dispatch, deliberate angular hand and watchful face, dark purple brown ink and a small pool of candle light. BOTTOM RIGHT: soldiers spring from a roadside city checkpoint to intercept a lone passing rider; an emphatic barred road, one standing spear guard, hills and gate blurred in the background, slate gray. No violence or injuries. Preserve all six as separate pictures with no overlap.

**B**

> Generate ONE concept-art contact sheet exactly as follows. Original late-Han Three Kingdoms tabletop game artwork. Restrained Chinese ink and mineral pigment on aged silk, near-black charcoal, umber, muted cinnabar and worn gold, small use of dark jade, matte textured brush contour. NO text, NO Chinese characters, NO paper card borders, NO graphic design, NO letters, NO numerals, NO ornament. The 3x2 contact sheet is a perfectly aligned grid of THREE equal columns by TWO equal rows, exactly six equal rectangular paintings, straight sharp boundaries, NO margins and NO gutters. Wide landscape 2.1:1 overall if possible, about 1.4:1 for each cell. Every subject stays wholly inside its cell with a margin. Each tile is an independent game-card picture window intended to also be recognizable at 88x70 pixels.
> Treatment B: emblematic close-up, deliberately simpler than narrative illustration, a single dominant physical motif and a single implied action in each tile, gestural structure readable in black and white. Overscale each motif centered, leave quiet contrasting charcoal paper visible around it. Never paint human faces, crowds or full figures, very little setting. TOP LEFT: two large square pale bone dice visibly colliding corner to corner in the middle, dark round pips and minimal dust strokes; paired dice act as one connected silhouette. TOP MIDDLE: the vertical dark-spoked bronze chariot wheel sinking into a thick diagonal band of ochre mud; wheel and mud clearly isolated against warm parchment, no person. TOP RIGHT: one dark-clothed hand lifting a large pale green jade disc with central hole out of shadow, disc's bright circular void clearly visible; only fingertips against the disc as one shape. BOTTOM LEFT: one sweeping vermilion flame licking beyond the edge of one black ancient Chinese gatehouse roof geometry, exaggerated flame with very clear dark/light boundary on brown-black paper. BOTTOM MIDDLE: an isolated pale opened Chinese bamboo dispatch ribbon and one dark broken cinnabar wax seal, hand pulling one slip away from the parallel strips; the tips of the fingers stay near the document, dominant open fan silhouette and deep purple ink background. BOTTOM RIGHT: an angular horizontal closed pole of a wooden checkpoint barrier traverses the vanishing line of a pale empty road, predominantly dark blue-gray ink and one slender upright pole; extremely clear transverse shape. Use original historical painterly style, avoiding flat modern icon vector arrows.

</details>
