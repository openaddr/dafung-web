# 对局屏信息布局重构:参照项目席位框与布局骨架调研(代码级)

> 调研日期:2026-09-25。服务于「对局屏信息布局完全重构」(#243,地图 #242):右栏(状态卡/手牌区/珍宝·名将/诸侯列表)整体退役后,**每件对局信息应去向何处**。
> 与 [research-sanguosha.md](./research-sanguosha.md)(§1-§6)、[research-cardgame.md](./research-cardgame.md)(§2-§3)互补:那两篇聚焦手牌区压缩/交互与图库走查,本篇聚焦**席位框解剖、信息件归属、布局骨架、席位环绕策略**;旧文已摘的手牌压缩公式/选中上浮/Super Drag/prohibitReason 一律不重复。
> 代码引用说明:noname 为本地仓库 `/home/ning/code/noname`(apps/core/ 下);FreeKill 为 gitee 镜像 `NaisuYa/FreeKill` 浅克隆(GitHub 直连超时)。**注意版本差异**:新版皮肤包已从 `LunarLtk/` 更名 `Fk/`,旧文所引 `LunarLtk/Components/HandcardArea.qml` 现为 `Fk/RoomElement/HandcardArea.qml`,间距公式下沉进 C++ `CardArea` 类;引用旧文公式时注明这一点。

## 1. 必答清单速览

| 信息件                                               | 无名杀去向                                                                  | FreeKill 去向                                                                                | 本仓建议锚位(§5 展开)                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ① 自局(现金/身价/委任/声望/体力/城数/珍宝/名将/托管) | 自局=底部中央席位框(data-position 0)+ 全宽 140px #me 条带;装备/标记全挂框内 | 自局也是 Photo(index 0),锚右下、**叠在 dashboard 尾部预留区**;dashboard 只放手牌+技能钮      | 底部仪表条:HandRack 端头固定「自局徽章区」,托管钮归此条          |
| ② 对手×N                                             | 同构 `.player` 框 240×120 环绕桌面(avatar+hp+手牌数+装备+标记)              | 同构 Photo 175×233@0.75(大头像+HpBar+身份+手牌数徽章+装备区+标记区+独立倒计时)               | 席位框:棋盘四周 8 槽位表(或贴出生城),每对手一个                  |
| ③ 对局信息(回合数/活跃方/目标身价)                   | 右上 `touchinfo.right` 文本(`N轮 剩余牌: M`,`ui.updateRoundNumber`)         | 右上 `MiscStatus`:回合数+时长+牌堆余量(小牌背图标叠数字)                                     | 顶部条:回合/身价目标归右上,活跃方=左上回合 chip(已有)+席位框光圈 |
| ④ 签面(骰子结果)                                     | 无对应物;最近似=桌面中央弹出对话框                                          | 无对应物;最近似=`bigAnim` 全屏 Loader(z 999)                                                 | 保留 DiceOverlay 全屏焦点,结果 chip 驻留顶部条                   |
| ⑤ 出牌面(手牌+确认/跳过)                             | 手牌挂 #me 双排;确认/取消/技能钮全在 `#control` 中央浮带                    | dashboard 底条(fillWidth 手牌 + SkillArea)+控制条横跨分界线;`endPhaseButton` 独立右下        | HandRack 唯一交互面(决议已定);确认/跳过贴手牌架右端              |
| ⑥ 事件提示(落格/等待/战报)                           | 全局 `ui.timer`(skillbar,点击可换四角)+ 玩家框内 `.timerbar`;弹泡挂玩家坐标 | per-Photo `progressBar`+`progressTip`(谁被询问谁框下跳条);战报=右抽屉 Log tab;聊天泡挂 Photo | 落格=居中卷轴(已有);等待=席位框倒计时条;战报=折叠条/右抽屉       |

## 2. 无名杀:席位框与布局骨架

### 2.1 席位框 `.player` 解剖(240×120,自局对手同构)

节点构造在 `apps/core/noname/library/element/player.js` 构造器(`player.node = {...}`):每个玩家是**一个自包含 DOM 单元**,全部信息件挂框内——`avatar`(100×100,主将)/`avatar2`(42×42,副将叠右下)/`framebg`(框底,`data-auto` 按 HP 档自动换金/银/铜框)/`identity`(身份章,90,5)/`hp`(8×8 勾玉珠一排,18,14,72px 宽折行)/`name`(竖排 `writing-mode: vertical-rl`)/`count`(对手手牌数,纯文本,right:140/top:86)/`equips`(96×96 网格区 right:14,内 42×42 小卡按 `equip1..6` 四角+中定位)/`judges`(延时锦囊小卡)/`marks`(标记小图)/`chain`(铁索)/`handcards1/2`。**自局与对手是同一组件**:自局只是 `data-position="0"` 放到底部中央,并把两个手牌容器搬进底部条带(见 2.2)。

降档与状态:`.player.minskin { width: 120px }`(半宽档);`slim_player/uslim_player/mslim_player` 三档瘦框只微调名字位;死亡=`.player.dead * { filter: grayscale(1) }`;当前行动者=`glow_phase` 头像光晕 + `node.action` 徽章(「行动」字)。

### 2.2 自局仪表:`#me` 条带(全宽 140px)

- `#me`/`#mebg`(layout.css `#me, #mebg`):全宽、高 140px、贴底;`#mebg` z-index -1 垫底色。
- 手牌双排容器 `#handcards1`(left:0,宽 `calc(50% - 140px)`)/`#handcards2`(left:`calc(50% + 120px)`)——**中缝约 260px 正好留给自局席位框**(`.player[data-position="0"]`:`top: calc(100% - 130px); left: calc(50% - 120px)`),即「自局框坐落底部条带正中,手牌左右各一排」。
- 手牌容器的搬家是显式动作:`game/index.js` 对局初始化里 `ui.handcards1Container.appendChild(game.me.node.handcards1)`——手牌视觉上不属于席位框,属于底部条带;`ui.updatehl()`(ui/index.js)再做压缩排布(公式旧文 §2.1 已摘)。
- 自动化时 `#autonode`(全宽 140px、`display: table` 居中大字)盖在条带上提示托管进行中——**托管态是条带级提示,不占席位框**。

### 2.3 席位环绕(详见 §4 对比)

- ≤8 人:layout.css `/*位置(N人)*/` 系列手写矩阵,`[data-number="N"] > .player[data-position="k"]` 逐条 top/left;且 **`.player`/`.card`(出牌人牌影)/`.popup`(对话泡,框下 130-140px)三套平行坐标各写一份**。U 形:1=右下、2=右上(`left: calc(100% - 240px)`),3/4/5=顶行(`top: 0/10px`),6/7=左列(`left: 0`);2 人=对面顶中;3 人=顶行两端。
- \>8 人:`ui.updatePlayerPositions()`(apps/core/noname/ui/index.js)动态注入 CSS,不再用矩阵: opponents 单行顶排,`columnCount = N-1` 均占 90% 宽(`percentage = 90/(columnCount-1)`,左右各留 5%),**整体缩放 `scale = 6/N`**,top 走「拱桥」公式 `max(0, round(N/5) - min(|i-1|, |N-1-i|)) × quarterHeight`——两端下沉、中间上拱;自局(data-position 0)不参与、仍在底部。
- 联机大厅 `updateConnectPlayerPositions()`:上排(顶 1/3)与下排(底 2/3)各均分(`100/(half+1)`%),`scale = 10/N`。

### 2.4 动作区/倒计时/目标高亮/HUD

- **`#control` 中央浮带**(layout.css `#control`):`top: calc(200%/3)`、宽 `calc(90% - 480px)`(两侧各让出玩家列)、按钮绝对居中(`left: 50%`)。确定/取消=`ui.confirm` 动态换装(`ui/create/index.js` `confirm()`:按需 create/replace/close ok/cancel);技能钮=`ui.skills` 同条;选牌/弃牌等场景切 `top: 80%`。**动作区浮在桌面上,不占条带**。
- **全局倒计时 `ui.timer`**(`ui/create/index.js` 创建,`.skillbar` 竖条,fill 从上往下退):`setTimerPosition` 点击循环 4 个屏幕角落(左上 180,210 / 右上 / 左下 / 右下)——全局条位置用户可调,不挡人。
- **玩家级倒计时 `.timerbar`**(layout.css):挂在 player 框内(top:165,100×5px,金红渐变,`transform-origin: left`)——「谁在决策,谁框上跳条」;与全局条并存(旧文 §6.2 已摘超时语义)。
- **目标高亮纯 box-shadow 分层**(layout.css 阴影段):`selectable` 蓝光 `rgb(0,133,255)`、`selected` 红光 `rgb(255,0,0)`、`.glows` 橙、`.glow2` 绿(友方);手牌选中=`#me .card.selected::after` 红光。无独立描边元素。
- HUD:右上 `touchinfo.right`(`N轮 剩余牌: M`,`ui.updateRoundNumber`);牌堆/弃牌堆全览=「牌堆」按钮弹窗(旧文 §3 已摘)。

## 3. FreeKill:席位框与布局骨架

### 3.1 Room.qml 三明治骨架(源码自带布局注释)

`Fk/Pages/Room.qml` 注释原话:`Photos(见 arrangePhotos) / tablePile / progress,prompt,btn` 上区 + `dashboard` 下区。要点:

- **roomArea** 高 = 全高 − dashboard 高 + 20;**dashboard 贴底**;**controls 条锚在 dashboard 上沿 −60(横跨分界线上下)**:prompt(富文本,居中于进度条上方)→ `progress`(宽 60% 水平居中,橙红渐变,`config.roomTimeout` 秒倒数,归零自动回 notactive 态)→ `okCancel` 行(条件显示的「跳过无懈」+ 确定 + 取消,居中);`endPhaseButton`(「结束回合」)独立**右下角**(rightMargin 30 / bottomMargin 40),仅 playing 态可见;一张牌多种用法时 `specialCardSkills` 单选行出现在 okCancel 左侧;技能交互件 `skillInteraction` 同区。
- **状态机四态驱动可见性**:`notactive / playing / responding / replying`,每个 Transition 的 ScriptAction 统一拨 dashboard 卡牌/技能钮、progress、okCancel、endPhaseButton 的可见与可用——**组件不自查状态,状态机单点分发**(对应我们 choices 选项集驱动的 UI 可见性,ADR-0013 同思想)。
- 左下 `dashboardBtn` 按钮 列(>15 张「选一张手牌」/撤销选择/理牌/聊天);dashboard 宽度 = 全宽 − 该列宽。
- 全屏件:`bigAnim` Loader(z 999);弹窗 `popupBox/manualBox` 居中于 roomArea 高度 67% 处(盖住桌心偏下,不遮 dashboard)。
- **战报/聊天 = 右抽屉 `roomDrawer`**(宽 36%,`LogEdit` + `AvatarChatBox` 双 tab,T 键呼出)——常驻零占位,用时滑入。
- 快捷键:Enter=确定、Space=取消、D=距离徽章显隐、T=抽屉。

### 3.2 Photo 席位框解剖(175×233,统一 `scale: 0.75` ≈ 131×175)

`Fk/RoomElement/Photo.qml`,部件与锚位:

| 部件           | 锚位                    | 符号/备注                                                                                                                     |
| -------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 框底           | 全框                    | `SkinBank.getPhotoBack(kingdom)` 按国别换色                                                                                   |
| 武将大图       | (31,5) 138×222 圆角蒙版 | 副将对半分 + 分割线;竖排武将名(width 24,>6 字转旋转长名)                                                                      |
| 体力条         | 左下,bottomMargin 36    | `HpBar`(珠式)                                                                                                                 |
| 身份           | 右上角(−4,−4)           | `RoleComboBox`;下方 `LimitSkillArea` 限定技计数                                                                               |
| **手牌数徽章** | 左下角(bottomMargin −6) | `handcardNum` 图标叠数字;格式 `n` 或 `n/maxCard`(≥900 显 ∞);**点击弹 ViewPile 浏览牌背列表**                                  |
| 装备区         | (31,157)                | `EquipArea` + equipbg 底图                                                                                                    |
| 标记区         | 装备区上方 / 框下右     | `MarkArea`(数字标)/ `PicMarkArea`(图标标)                                                                                     |
| 席位号         | 框下居中                | 汉字「一」~「十二」;倒计时条可见时隐藏                                                                                        |
| 独立倒计时     | 框底 4px                | `progressBar` + `progressTip`(谁被询问谁框下跳条+提示词)                                                                      |
| 当前回合光圈   | 框中心                  | `playing` 属性 → `animPlaying` 帧动画光圈                                                                                     |
| 可选目标       | 框中心                  | candidate 态 `animSelectable/animSelected` 光圈;不可选叠 `disable` 图                                                         |
| 聊天泡         | 框宽同宽矩形            | `chat()`:200ms 入 → 2500ms 停 → 150ms 出                                                                                      |
| 状态覆盖       | 框面                    | 死亡 `Colorize` 去饱和+死亡/投降图标;`drank` 红罩(opacity=0.4+log(n)×0.12);翻面/铁索叠图;离线 `netstat` 角标;托管 `rest` 大字 |
| 距离徽章       | 框上白圆数字            | D 键全桌显隐(`Room.qml` `showDistance`)                                                                                       |
| 座位交换动画   | x/y                     | `Behavior on x/y` 600ms InOutQuad                                                                                             |

自局也是 Photo:`Room.qml` 里 `photos.itemAt(0)` 即 Self,`dashboard.self = this`,被 `arrangePhotos` 放到**右下角、叠在 dashboard 尾部预留区上**。

### 3.3 `arrangePhotos()` 摆位(Fk/Pages/RoomLogic.js)

- ≤8 人:**8 固定槽**。我方槽 0=右下(`y = height - 220`,叠 dashboard);槽 1=右侧、2-6=顶行、7=左侧;`regularSeatIndex[playerNum - 2]` 查表决定启用哪些槽,按**对称成对填充**:2 人=[0,4](对家顶中)、3=[0,3,5]、4=[0,1,4,7](右+顶中+左)、5=[0,1,3,5,7]、6=[0,1,3,4,5,7]、7=[0,1,2,3,5,6,7]、8=全槽。顶行 x 由 `(roomArea.width − 0.75×175×7)/8` 匀布。
- \>8 人:`arrangeManyPhotos()` 顶行单排:先按 `photoWidth = (width − 8·spacing·N)/(N−1)` 试排;若 > `photoMaxWidth`(175×0.75=131.25)则定宽、匀 spacing;否则**整体缩放** `photoScale = photoWidth/175`(缩小不重叠);首末槽下沉 `verticalSpacing×3`、次端 ×1 成浅弧;我方仍在右下。
- 与旧文的差异点:旧文 §3 摘过「8 标准槽位(自己右下,其余沿上边一行+左右两列)」——本轮补齐的是**具体槽位坐标表、regularSeatIndex 逐人数查表值、>8 人的压缩-缩放公式与浅弧下沉参数**。

### 3.4 全局信息件:MiscStatus / banner / Danmaku

- `Fk/RoomElement/MiscStatus.qml`:右上角(菜单钮左侧)三件套——回合数文本、对局时长(1s 定时器)、**牌堆余量=32×42 小牌背图标叠大数字**。「棋盘不占画面的堆信息」都收在这里。
- `banner`(`PhotoElement.MarkArea`,左上 12,12,scale 0.75):全局横幅标记区(结算/阶段横幅的常驻挂点)。
- `Danmaku`:全宽弹幕层,战报流镜像(不点开抽屉也能瞥见事件)。

### 3.5 Dashboard:手牌区即万能交互面

`Fk/RoomElement/Dashboard.qml` 是一个 RowLayout:`[5px] + HandcardArea(fillWidth,高 130,bottomMargin 24)+ SkillArea + 尾部 175×233 空位`。

- **尾部 175×233 空位(负 rightMargin 拼接)= 右下自局 Photo 的重叠预留**——布局上显式给席位框让位,手牌条不满铺。
- `SkillArea`(`Fk/RoomElement/SkillArea.qml`):Flickable(上限 180×200,内容右锚),三段 Grid:预示技 2 列 / active 技 2 列 / 非 active 技 3 列(更小)。
- **`expandPile()/retractPile()`(Dashboard.qml)是本票最有价值的机制**:点装备区/标记/木牛流马 → 把那些牌**临时展入同一手牌行**(逐张带 footnote 标签),收起时按原坐标飞回。手牌行由此成为全游戏「牌」的唯一临时展示面——与我们「手牌架成为回合内出牌唯一交互面」的决议完全同构;军师幕退役后,珍宝/名将的「展开查看」可走同一模式(点席位徽章 → 展入牌架行 → 收起)。

## 4. 席位环绕策略对比(3-8 人)

| 维度         | 无名杀                                                                                                                               | FreeKill                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 摆位范式     | 我方恒底部中央,对手沿「右下→右上→顶行→左列」逆时针 U 形;`.player`/`.card`/`.popup` 三套平行坐标手写矩阵(≤8);>8 顶排+拱桥+`scale 6/N` | 我方恒右下(叠 dashboard),对手 8 固定槽查表(`regularSeatIndex`);>8 顶排浅弧+先压间距后缩放 |
| 2 人         | 对面顶中(top 0 居中)                                                                                                                 | [0,4] 对家顶中                                                                            |
| 3 人         | 顶行两端                                                                                                                             | [0,3,5] 顶行两翼                                                                          |
| 4 人         | 右上+顶中+左上(对称十字)                                                                                                             | [0,1,4,7] 同构对称十字                                                                    |
| 5-8 人       | 逐对补右列/左列/顶行                                                                                                                 | 逐对补槽,始终左右对称                                                                     |
| N 人降档     | 框有 minskin 半宽档;>8 靠整体 scale(允许缩到很小)                                                                                    | 定宽 131×175 优先,挤不下才整体 scale;牌多折叠(旧文已摘)                                   |
| 事件弹泡坐标 | `.popup` 与席位框平行写死(框下 130-140px)                                                                                            | 聊天泡/倒计时条直接挂 Photo 内部,天然跟随                                                 |

**两家共同范式**(可直接升格为我们的规则):①我方恒底,对手沿「右→顶→左」逆时针环绕;②槽位对称成对填充,先补对家/正中再补两翼;③>8 不再环绕,退化为顶行+缩放;④**弹泡/倒计时/等待态作为席位框的内生部件,不另设浮层**。

**与我们的差异与适配**:两家是「贴屏桌面」(无 pan/zoom),席位坐标是屏幕坐标;我们是**可缩放平移的棋盘**,席位框有两种挂法——(a)贴屏(棋盘边缘 8 槽,与视图变换无关,学 FreeKill 槽位表);(b)贴棋盘(锚定各玩家出生城/都城,随 pan/zoom 走)。本轮不拍板(见 §7 未决 2),但两类参照实现都在:贴屏=FreeKill;贴对象=noname `.popup` 挂席位坐标的思想。

## 5. 「若右栏删除」建议去向表

| 信息件     | 推荐锚位                                                                                                                                                                                              | 参照依据                                                                                                                                              | 风险与对策                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ① 自局九项 | **底部仪表条**:HandRack 端头固定「自局徽章区」,压缩为「章+数字」一排;托管钮=条角热钮(现金大数唯一呈现留在手牌区,现状口径不变)                                                                         | FreeKill dashboard 尾部 175×233 给自局 Photo 让位、noname #me 条带中缝留给自局框——**仪表与手牌同条是两家共识**;托管提示=noname `#autonode` 条带级大字 | 一排塞 9 项会爆:学 Photo 手牌数徽章「常驻 3-4 项+点开展全量」分层;点开方式用 §3.5 `expandPile` 模式(展入牌架行,不弹窗)                 |
| ② 对手×N   | **席位框**:棋盘四周 8 槽位表(FreeKill `regularSeatIndex` 直译)或贴出生城;内容裁为最小集:国号章/现金/身价/体力/手牌数/珍宝·名将计数                                                                    | Photo 解剖表(§3.2);noname `.player` 同构框(§2.1);等待态=Photo `progressBar`+`progressTip`                                                             | pan/zoom 跟随策略未决(§7 未决 2);8 项徽章堆叠会糊——学 Photo「图标叠数字」密度(handcardNum/牌堆余量两处同式)                            |
| ③ 对局信息 | **顶部条**:回合数/目标身价常驻右上(MiscStatus 式),活跃方=左上回合 chip(已有)+席位框光圈(非ame `glow_phase`/Photo `playing` 双先例)                                                                    | `MiscStatus` 右上三件套;`touchinfo.right`;光圈动画                                                                                                    | 与安全区/静音钮冲突:沿现状 `--safe-top` 网格排;目标身价是本作特有,放回合旁同排                                                         |
| ④ 签面     | **保留 DiceOverlay 全屏焦点**;结果以 chip 形式短暂驻留顶部条(或棋盘角)                                                                                                                                | FreeKill `bigAnim`(全屏 Loader,z 999)——一次性全屏事件独立于布局;驻留 chip=MiscStatus 式                                                               | 骰子两家无直接对应物,此条是模式迁移而非照抄;演出时长已有 E2E_TIME_SCALE 管线                                                           |
| ⑤ 出牌面   | **HandRack 唯一交互面**(决议已定);确认/跳过贴手牌架**右端**(OpenDuelyst 结束回合钮位,基线 §2.5 已摘);「无事可做」可抄 `.finished` 态                                                                  | FreeKill `endPhaseButton` 右下独立钮(okCancel 居中做布尔决策,end 钮做流程推进——两类按钮分开);§3.5 手牌行万能交互面                                    | 手牌 0 张时确认钮无处贴:按钮锚定仪表条右端而非手牌张数(锚条不锚牌)                                                                     |
| ⑥ 事件提示 | 三层:落格事件=居中卷轴(已有,FreeKill popupBox 居中 67% 高同型);**他人抉择等待=对应席位框倒计时条+微标**(Photo progressBar 式),WaitingBar 仍兜全局;**战报=折叠条/右抽屉**(roomDrawer 式,T 键/把手呼出) | §3.1 右抽屉;§3.2 per-Photo 倒计时;§2.4 noname 玩家级 `.timerbar`                                                                                      | 战报抽屉注意与「零兜底」口径:抽屉是正常业务态(显式入口),非静默兜底;他人等待若只做席位条,联机掉线态需另有微标(Photo `netstat` 角标先例) |

## 6. 不值得抄(反面清单)

- **noname ≤8 手写坐标矩阵**:每人数一套、三套平行坐标(`.player`/`.card`/`.popup`)各写一份,7 张表×多套皮肤纯手工——FreeKill 的「固定槽+查表」好得多;我们直接数据驱动(棋盘坐标或槽位表),不写 CSS 矩阵。
- **noname 弹泡坐标与席位 CSS 强耦合**:改席位要同步三处;弹泡应作为席位框内生部件(FreeKill 做法)。
- **FreeKill dashboardBtn 左下按钮列与 dashboard 的负 margin 拼接**:QML absolute 布局的将就,React/flex 里没必要;我们仪表区直接并入同一容器。
- **数值内联字符串拼接**(`N轮 剩余牌: M`):单语硬编码;我们若做文案统一走符号表,不留裸模板串。

## 7. 与既有调研的增量、未决问题

**增量**(本篇新增,旧文未覆盖):

1. 席位框解剖(旧文只讲了手牌区与摆位思想):noname `.player` 十余个信息件的锚位/尺寸、FreeKill Photo 全部件表(§2.1/§3.2);
2. 自局仪表形态:#me 条带中缝构图、FreeKill dashboard 尾部预留区、`#autonode` 托管条带(§2.2/§3.5);
3. > 8 人(>对手 7 人)的两套降档算法全文:noname 拱桥公式、FreeKill 压缩-缩放-浅弧(§2.3/§3.3);
4. 状态机驱动 UI 可见性的 FreeKill 四态迁移(§3.1);
5. `expandPile` 手牌行万能交互面(§3.5)——军师幕退役后珍宝/名将查看的候选模式;
6. 事件提示三件套:per-Photo 倒计时、右抽屉战报、Danmaku 镜像(§3.1/§3.2/§3.4);
7. MiscStatus 全局信息件构图与手牌数徽章「点开看牌背」(§3.2/§3.4)。

**未决问题**(留 #243 主线拍板):

1. 席位框贴屏(棋盘边缘槽位)vs 贴棋盘对象(锚出生城):两家参照都是贴屏桌面,本仓棋盘可缩放平移,两种挂法的连线/遮挡表现需原型验证;倾向「席位框贴屏 + 点击高亮对应城池」折中,待定。
2. 自局徽章区放 HandRack 左端还是右端:OpenDuelyst 右端是结束回合钮(基线 §2.5),若确认/跳过也贴右端则徽章区应居左;两参照里自局框都是右下(FreeKill)/中下(noname),无左端先例。
3. FreeKill 间距公式新版位置:C++ `CardArea` 类,旧文所引 `LunarLtk/.../ItemArea.qml updatePosition()` 路径已失效;引用旧文公式时注明「LunarLtk 时代实现,新版下沉 C++」,公式本身未变。
4. 骰子签面无参照物,§5-④ 是模式迁移;若要更贴参照,可考虑把骰子结果同时镜像进战报流(FreeKill Danmaku 思想)。
