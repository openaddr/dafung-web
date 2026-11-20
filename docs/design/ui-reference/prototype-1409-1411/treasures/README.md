# #1409 珍宝与技能书画心比选

[打开可点原型](index.html) · [打开 PNG 对照](compare.png)

原型默认在 844×390 首页 B 构图模型上打开手册的「珍宝」签。关闭手册可看到首页入口，再点首页「手册」打开。下方切换现状、A 和 B，切换时保留所看的条目和档位。用下方的草帽、胡饼、算筹、青梅和传国玉玺按钮定位图文行册，点一行看大图。点「返回棋盘」后，从右下「珍宝」圆钮打开收藏册，点「技能书·疾行」或「技能书·英姿」查看书册。原型可从本地直接打开，读取同工作区的离线字体、样式和原图。

## 两个方案

| 方案           | 已有适用的器物实拍                                   | 错物、来源待核、缺画心                                                 | 运行时技能书               |
| -------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------- |
| 现状           | 整张原照片                                           | 草帽、胡饼用原照片，算筹和青梅在手册显示「暂无画心」，局内显示远山肌理 | 装裱卡上的远山肌理         |
| A 同底同光     | 裁出实物轮廓，置于暖暗绢底，统一光感                 | 补样共用暖暗底、左上柔光                                               | 靛布装订册，题签写实际技名 |
| B 保留实拍背景 | 保留原底和原投影，统一检查取景，适度降低饱和度与亮度 | 与 A 共用补样                                                          | 与 A 共用书册              |

建议 **B**。同一实物缩到小档，A 布底更整齐，B 的背景亮度变化更明显，但还能认出轮廓，也保住器物的真实光影和背景。A 需要逐件校验抠边与明暗过渡。B 沿用 #1408 已确认的照片策略，光向在补画里固定为左上柔光，实拍以主体和背景分得开为门槛。两案共用同一张兽钮印照片。[#1408 决议](https://github.com/openaddr/dafung-web/issues/1408#issuecomment-7032993454)

## 看哪些细节

- 手册行册画心槽 68×68，详情模型按该视高用 218×218。局内装裱卡为短横屏的 96×128 档，画心还要更小。先看轮廓能不能分别认成帽、饼、印、筹、梅、装订册，再到详情看材质、留边和正文。样张主体长边约占画面 70%–85%，可随物体比例微调。四边留空间，题签、品级角标与图片边缘不能压住物件。
- 草帽用帽冠和帽檐，胡饼用圆扁的饼形，算筹用横竖两列竹签，青梅用成簇的青果。保留深金框、左图中正文右品级/指导价的行册，以及局内纸底跋文和品级角标。传国玉玺对照沿用仓内的清代田黄型冻石兽钮印类比图。
- 技能书共用一张静物底图，装订线、纸页和靛布封面提供书册身份。封面题签只放技名，牌面仍从 `makeSkillBook` 读「技能书·技名」、描述及珍宝品级。样本「疾行」「英姿」各品级 2、指导价 200 两，详情另从技表显示真实技能说明。小档先凭装订册轮廓辨出种别，再用装裱题签或详情认技名。真实实现可由 `kind === "book"` 选择书册母版，用 `skillId` 取技名排字，并覆盖所有可印技能。
- 现行静态目录 16 件，14 件有 `image`，算筹与青梅为合法空态。实施清点从当时的 `TREASURES` 逐项取样，依次记录品种匹配、原图来源和授权、轮廓、裁切、继续使用或补画的结论。技能书另以 `makeSkillBook` 生成实例盘点，检查短、长名称在同一装订册上可辨。

## 素材与验证边界

| 取样                           | 来源与处理                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 现状草帽                       | Elekes Andor 的印尼竹帽照片，CC BY-SA 4.0。现状保持原图，两案补画汉末背景用的草编帽形。[原图及授权](<https://commons.wikimedia.org/wiki/File:Bamboo_hat_(blue)_-_Indonesia,_2012_(2).JPG>)                                                                                                                                                  |
| 现状胡饼                       | 仓内 `public/assets/treasures/treasure-hubing.webp`，在本次基线的素材 manifest 和 CREDITS 未找到相应条目。仅保留在现状栏，两案用原创样画预览。                                                                                                                                                                                              |
| 玉玺照片                       | The Metropolitan Museum of Art 藏品 2015.500.6.17，CC0 1.0。原图为 375×500。两案共用 `art/seal-photo.webp`，原图坐标裁到 `(0,86)–(375,461)`，饱和度缩至 84%，亮度缩至 94%。A 以 CSS 取实物轮廓衬暖暗底，B 保留照片原背景与原投影。正式复用前仍需确认此历史类比是否合适。[藏品与授权](https://www.metmuseum.org/art/collection/search/39853) |
| 草帽、胡饼、算筹、青梅和技能书 | 内置 ImageGen 生成同一张六格静物样张，工作区使用五枚裁片。每格由 512×512 缩到 384×384，玉玺格仅用于早期比画材，交付中使用实际照片。书题签为原型运行时文字。画心样张供本票决策。                                                                                                                                                             |
| 首页与棋盘                     | 手册叠在已选首页 B 的 844×390 构图模型上。局内收藏册沿用 #1408 原型的 `art/board.webp`，来源为 #1403 的关中截图和 #1404 关中原型。两处均作情境模型。                                                                                                                                                                                        |

数据起基 `662bb00d2f45cc116dfe2284f7d6692b39dd354c`，从 `TREASURES`、`makeSkillBook`、`guidePriceOf` 与 `formatMoney` 取样。静态手册只收目录项。局内样本固定持有七件，样张详情是用于观察画心的临时交互。实际收藏册中的普通珍宝静态陈列；技能书在己方出牌阶段且存在可学习名将时，点书直接用书或打开选人。原型固定展示「出牌阶段可研读」的陈列状态。PNG 为按 844×390 场景几何作的静态合成，采用系统中文字库。最终 APK 的实际渲染、触屏开合和研读通路需要真机核对。

### ImageGen 提示词

> One raster asset atlas only, exact 3 columns by 2 rows, 6 equal rectangular cells across a landscape sheet, no gutters, no borders. Every cell uses equal scale and the object is isolated with generous quiet margin on all sides including the grid edges, nothing touches or straddles cell boundaries. Realistic antiquarian museum object photography rendered with subtly hand-painted, restrained photorealism for a Three Kingdoms Chinese game. Shared same matte dark brown-gray ink-silk background throughout, soft broad light from upper left, gentle contact shadows, warm low saturation, moderate contrast with strongly legible silhouettes, almost front 3/4 view from slightly above. TOP LEFT: Ancient Han Chinese broad low conical yellow straw peasant hat, entirely braided natural golden straw with a wide flared circular edge and shallow pointed crown, no ribbon, no head, no holder. TOP CENTER: One round flat golden sesame-topped Hu Bing flatbread, profile clearly thin like a baked flatbread, lightly charred small sesame specks, on the silk without dish, no other food. TOP RIGHT: A single squat square dark ivory-green translucent ancient Chinese jade imperial seal with a small curled animal shaped knob, carved relief, a subdued red hint under it. BOTTOM LEFT: A fan-shaped arrangement of nine thin straight pale bamboo counting rods, grouped in two perpendicular sets of solid rods like ancient Chinese mathematics, no cord, clean silhouettes. BOTTOM CENTER: A small asymmetric cluster of three recognizably plum-sized green fruits with matte green skins and a dark green leaf, whole green plums, no bowls. BOTTOM RIGHT: A clearly bound ancient Chinese manuscript folio made of stacked creamy paper, indigo cloth cover, visible paper edges and two thread fastenings at the spine, front-facing cover well lit and blank so a real dynamic name can be placed over it later. Keep all six objects complete with 20% to 25% left/right breathing room and 18% top/bottom, same centered visual scale, dark muted clean negative space, rich realistic material textures. No people, modern objects, large props, text, glyphs, letters, seals outside the illustrated imperial seal, captions, labels, poster layout, or UI.
