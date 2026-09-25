# 三国杀类开源项目手牌区/对局 UI 调研

> 调研日期:2026-09-23。服务于 dafung-web「锦囊牌(手牌)+ 反应牌(即时打出)」的 UI 设计参考。
> 代码引用均为仓库内相对路径,摘录有删节。
> **2026-09-23 更新**:noname 已本地实机构建运行并实测对局(§6),响应窗/超时语义/询问链为新增专题;授权口径更新(本仓已定 GPLv3,见 §6.4)。

## 1. 项目概览

| 项目            | 仓库                                                            | 技术栈                                                     | 活跃度                               | UI 形态                                                                    |
| --------------- | --------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| 无名杀 noname   | `libnoname/noname`(GitHub)                                      | 纯 JS + DOM(CSS transform 排牌,无框架),pnpm workspace 构建 | 极活跃(最近 commit 2026-09-23,#4465) | HTML5 DOM:玩家元素 + 手牌 DOM 挂在自己节点下,绝对定位环绕桌面              |
| 新月杀 FreeKill | `Qsgs-Fans/FreeKill`(GitHub 镜像;上游 gitee `NaisuYa/FreeKill`) | C++/Qt Quick(QML)+ Lua 逻辑;UI 在 `LunarLtk/` 皮肤包       | 活跃(2026-09-08 发 v0.5.25)          | QML 声明式场景图:Photo(他人面板)/Dashboard(自己仪表盘)/TablePile(牌桌中央) |

两者共同点:手牌区都是**横条重叠排列**(非扇形),间距随张数压缩;选牌=整张上浮;非法牌置灰/下沉。

## 2. 手牌区实现对比

### 2.1 无名杀:容器宽度驱动的一维压缩布局

手牌是 `game.me` 玩家元素的子节点,双排容器 `handcards1/handcards2`(`noname/library/element/player.js` 构造节点),底部 `#me` 全宽 140px 条带,两排各 `width: calc(50% - 140px)`(`layout/default/layout.css` #handcards1)。

核心算法在 `noname/ui/index.js` 的 `ui.updatehl()`:

```js
// 间距 = min(卡宽 112, 可用宽/张数);挤不下则整排横向滚动
offset1 = Math.min(112, (ui.handcards1Container.offsetWidth - 128) / (hs1.length - 1));
if (hs1.length > 1 && offset1 < 32) {
  offset1 = 32;
  ui.handcards1Container.classList.add("scrollh"); // 横向滚动兜底
}
for (var i = 0; i < hs1.length; i++) {
  var x1 = i * offset1;
  // ...悬停展开偏移
  hs1[i].style.transform = hs1[i].classList.contains("selected")
    ? baseTransform1 + " translateY(-20px)" // 选中整张上浮 20px
    : baseTransform1;
}
```

三个配套机制值得细看:

- **悬停展开(spread)**:`ui.getSpreadOffset()`(`ui/index.js`)——鼠标悬停某张重叠牌时,该牌左侧邻居左移重叠量的 20%、右侧邻居右移全量重叠,被悬停牌完整露出;触屏设备改用"选中即展开"。入口 `ui.click.cardmouseenter`:仅当没有任何已选牌时生效。
- **折叠档位**:`ui.updatehx()` 按每张 78/93/112px 三档阈值给容器加 `fold0~3` class,CSS 侧再做名称缩略——牌多到挤爆时连牌名都换成缩写,信息密度逐级降级。
- **窄间距下的文字自适应**:`offset < 100` 时把角标(花色点数 `node.info`)与牌名做位移/缩放变换,长牌名加 `scale(0.85)` 并隐藏附注 span。

**牌面渲染**(`noname/library/element/card.js` `$init`):卡牌 DOM 固定 8 个槽位 `.image/.info/.name/.name2/.background/.intro/.range/.gaintag`。`info` 槽 = 花色翻译 + 点数(红 suit 加 `.red`),`name` 槽 = 牌名(≥5 字加 `.long`,≥7 字加 `.longlong` 驱动 CSS 缩排),`background` 槽 = 无图时退化为牌名首字水印。无插图也完全不破坏版式——**这套"文字底牌"是纯 CSS 可复刻的**。

**交互**(`noname/ui/click/index.js` `ui.click.card`):click 切换 `.selectable/.selected` class → 全局 `ui.selected.cards` → `game.check()` 统一重校验。`game.check()`(`noname/game/index.js`)是中枢:每次点击后按 `filterCard/filterTarget` 重算所有可选目标并刷新"确定"按钮可用性——**选中状态单向流入引擎校验,引擎校验单向刷回 UI 可选集**。

### 2.2 FreeKill:两阶段压缩 + 拖拽三合一

手牌区 `LunarLtk/Components/HandcardArea.qml`,间距算法下沉到通用件 `Fk/Components/GameCommon/ItemArea.qml`:

```qml
function updatePosition(animated) {
  let overflow = false;
  for (i = 0; i < items.length; i++) {       // 第一遍:按整卡宽排
    card.origX = i * card.width;
    if (card.origX + card.width >= root.width) { overflow = true; break; }
  }
  if (overflow) {                             // 第二遍:压缩间距
    const xLimit = root.width - card.width;
    const spacing = xLimit / (items.length - 1);
    for (i = 0; i < items.length; i++) {
      items[i].origX = i * spacing;
      items[i].z = i + 1;                     // z 序=索引,右侧压左侧
      items[i].maxZ = items.length;           // 拖拽时 z 提到 maxZ
    }
  }
}
```

交互上 FreeKill 把三种手势合并进同一张牌(`HandcardArea.qml`):

- **点选**:`selectCard()` → `cardSelected()` 回调 Lua 校验(`Lua.updateRequestUI("CardItem", ..., "click", { selected, autoTarget })`),选中牌 `origY -= 20` 上浮,不可选牌 `origY += 60` 下沉变暗(`Config.hideUseless`)。
- **拖拽指目标(Super Drag)**:`dragMovement()` 把拖拽中的牌的坐标与每个 Photo(玩家面板)矩形做命中测试,压到谁头上就切换谁的目标选中态——**拖牌选人,松手前可反复改目标**;拖到面板区外松手直接触发"确定"(`updateCardReleased` → `okButton.clicked()`)。
- **拖动排序**:落在手牌区内松手,按 `card.x` 找插入位 `movepos` 重排(`dataModel.swapHandcard`)。

**牌面**(`LunarLtk/Components/CardItem.qml` + `Fk/Components/GameCommon/PokerCard.qml`):基底左上角两张小图(点数图 + 花色图,按红/黑分目录);上层叠:虚拟牌名横幅(`virtName`,视作牌时显示"视为××")、牌上标记堆(marks,自动按数量压高度)、**不可选原因竖排红字**(`prohibitReason`,如"距离不足"直接印在牌上)、区域角标(`areaText`,黄底红字"装备区"等)、技能提示 GlowText。右键弹 `CardDetail` 详情浮窗。

**超长手牌折叠**:手牌 >15 张时整区折叠成 `min(cards*93, 120)` 宽的一叠,左下角出现"Choose one handcard"按钮,点开右侧抽屉选牌(`LunarLtk/Pages/Room.qml`)。

## 3. 对局主界面布局对比

**无名杀**:U 形环绕。座位=纯 CSS:玩家数(`data-number`)× 座位号(`data-position`,0=自己永远在底部)各自写死 top/left(`layout/default/layout.css` `/*位置(8人)*/` 段,8 人从右下逆时针铺到左下)。移动换座 = `player.changeSeat()` 先量 getBoundingClientRect 差值再 transform 动画。牌堆不占画面:`#cardPile/#discardPile` 是隐形容器,堆信息走两个 HUD——右上角剩余张数浮层(`ui.cardPileNumber`)+「牌堆」按钮弹小窗(剩余数/轮数/洗牌数/弃牌堆全览,`ui.click.cardPileButton`)。中央是弹出的对话框(选牌/选将)与按钮条(`ui.control`),出牌轨迹用 `player.line()` 在玩家中心点之间画线。

**FreeKill**:三明治。上区 roomArea 放 Photo(他人面板)+ TablePile(中央打牌区,宽 70%),下区 dashboard(手牌区+技能按钮区),两区之间是 prompt 文案 + 倒计时进度条 + 确定/取消按钮(`LunarLtk/Pages/Room.qml` 布局注释图非常直白)。座位排布 `arrangePhotos()`(`LunarLtk/Pages/RoomBase.qml`):8 个标准槽位(自己右下,其余沿上边一行+左右两列),按人数查 `regularSeatIndex` 表决定启用哪些槽;>8 人走压缩缩放版 `arrangeManyPhotos()`。**出牌轨迹**是 `LunarLtk/Components/IndicatorLine.qml`:从使用者中心到各目标画渐变细线,`ratio 0→1` OutCubic 生长 200ms → 停 200ms → 淡出 300ms。目标可选中/已选中态用帧动画光圈套在 Photo 上(`Photo.qml` animSelectable/animSelected)。TablePile 的牌可配置随机 ±2.5° 旋转(`Config.rotateTableCard`),离场牌 1.5s 后淡出。

## 4. 值得 dafung-web 借鉴的 Top 5

1. **一维压缩间距公式**(两家一致):`spacing = min(卡宽, (容器宽 - 边距) / (n - 1))`,低于下限转横向滚动/折叠。dafung-web 手牌区可直接用 SVG/absolute 定位实现同款;锦囊牌不会太多,通常只走 min 的前半支。出处:`noname/ui/index.js` `updatehl()`、`Fk/Components/GameCommon/ItemArea.qml` `updatePosition()`。
2. **悬停/选中展开重叠牌**:`noname/ui/index.js` `getSpreadOffset()`——悬停牌左侧邻居挪开 20% 重叠、右侧挪开 100%,零额外 UI 就能让重叠牌完全可读。反应牌在结算窗选目标时同样适用。
3. **非法原因印在牌上**:`LunarLtk/Components/CardItem.qml` 的 `prohibitReason`(红描边竖排字)+ noname 的 `.selectable` 置灰。锦囊/反应牌"为什么不能出"(如"无有效目标")直接写牌面,比禁用后让玩家猜好得多。
4. **拖牌指目标 + 拖离即确认**:`HandcardArea.qml` `dragMovement()/updateCardReleased()`。反应牌的典型操作是"指定某玩家打出"——把牌拖到目标头上、松手即出的手感远优于点牌→点目标→点确认三段式。SVG 棋盘上可映射为拖锦囊到玩家 Token 上。
5. **选中态中枢校验**:noname `game.check()` 模式——每次点击只改选中集合,全部可选性/确认按钮状态由一个纯函数统一重算。对应 dafung-web 的 `choices` 选项集(ADR-0013):UI 只管渲染 `available/reason`,自己不算合法性。

另注(小而美,值得一并抄):FreeKill `IndicatorLine.qml` 的生长-停留-淡出三段指示线,适合 dafung-web 出牌时的目标指向动画;`TablePile` 随机微旋转(`(Math.random()-0.5)*5°`)让牌桌有"人手摆上去"的质感。

## 5. 不值得抄的反面清单

- **座位排布写死 CSS**:noname 每种人数×座位各一条 CSS 规则(`[data-number="8"] > .player[data-position="1"] { top: calc(200%/3 - 90px); ... }`),7 种人数×多套 layout 皮,纯手工矩阵;FreeKill 的槽位表+函数计算好得多。dafung-web 玩家本就绕棋盘坐,无需此物,但若做"绕桌"布局务必走数据驱动。
- **全局可变单例选区**:`ui.selected.cards`/`_status.clicked/_status.dragged` 一类全局标志散落各处,触屏/鼠标/拖拽状态机互相咬合(`ui.click.card` 开头一连串 if 排除),是 bug 温床;React 里用 state + reducer 即可。
- **1.6 万行单文件**:noname `player.js`(16018 行)把玩家节点/资产/动画/交互全揉一起,无拆分。反例警示:组件按职责拆,别按"领域对象大杂烩"堆。
- **双排手牌**(`handcards1/2`):两排各 50% 宽的旧布局在 noname 已属遗留(长条布局只用一排),FreeKill 也只做单排+滚动/折叠。除非刻意复古,别做两排。
- **素材强耦合**:noname 牌面默认走官方 `image/card/*.png` fullskin,分支极多(`fullskin/fullimage/fullborder/background` 五类渲染路径);我们自绘 SVG 牌面,只抄它的槽位结构(角标/牌名/水印底),不抄素材分支树。

## 6. 实机验证补充(2026-09-23 本地构建运行)

**跑法(可复现)**:浅克隆 `libnoname/noname` → `pnpm install && pnpm build && pnpm serve`(静态服务 8089 端口)。一个坑:`@fastify/static` 把 `.ts` 模块的 MIME 判成 `video/mp2t`,浏览器按严格 MIME 检查拒绝执行 module script——在 `packages/fs/src/index.ts` 注册 `onSend` 钩子,把 `video/mp2t` 改写为 `text/javascript` 即可。驱动方式:headless Chromium + Playwright,点「身份」→ 双击候选将 → 轮询应答「确定/取消/可选目标」跑完整局。

实测截图 10 张存 [sanguosha/noname-live/](./sanguosha/noname-live/)(逐张登记 `manifest.jsonl`;含官方三国杀商用美术,按网图口径仅内部参考、勿入 git)。§2/§3 的代码结论(手牌横排压缩、选中上浮、目标蓝框、详情浮层、指向线)全部与实机一致。

### 6.1 响应窗专题(P1-D 反应窗的直接证据)

实拍见截图 07(鸩毒)/08(匡襄),形态四件套:

1. **标题问句**:「是否对孙权发动【鸩毒】?」——对象名 + 【牌/技名】,一行动作指令;
2. **规则全文**:弹窗正文常驻完整效果文本,玩家无需记忆牌面;
3. **需求计数**:居中「0/1」,选够才亮确认;
4. **决策键**:只需拒绝的布尔窗仅一颗「取消」居下(确认键在完成选牌/选目标后才出现)。

弹窗为屏幕居中半透明横幅,**牌桌与手牌照常可见、不遮蔽**;引擎暂停等待应答。与方案 P1-D 的「下缘窄卷轴条」对比:noname 遮挡更小,但信息分层弱(全文塞一窗);P1-D 的分段条 + 呼吸金边在 3 人局小手牌场景更贴身。

### 6.2 超时兜底语义(`countChoose`,`noname/game/index.js`)

决策窗开启即 `ui.timer.show()` + `game.countDown(num, finish)`;超时 `finish()` 的兜底序列:

- 有「结束回合」按钮 → 自动点击取消;
- 有确定/取消键 → 按确认串自动点「取消」(串含 `c`)或「确定」(串含 `o`);
- `chooseControl/chooseBool` 型 → `result = "ai"`,**直接把决策交给 AI**;
- 其余 → `ui.click.auto("forced")` 自动执行强制行为。

倒计时数值**按事件类型查配置表**(per-event `num`),不是全局单值;联机模式每个玩家节点自带独立倒计时(`player.hideTimer()` / `ui.timer`)——"谁在决策,谁头上跳条"。这直接回答了 #188 Q2 的一半:超时动作分型(取消/交 AI)与时长配置都可以表驱动,对号 dafung 的 `choices` 选项集每个相位各自定超时。

### 6.3 无懈可击询问链

锦囊结算触发 `chooseToUse(type=="wuxie")`,按座位序逐个询问;任何人响应则原效果被抵消。降噪口值得照抄:**「暂定无懈」**(`ui.tempnowuxie`)——一键"本回合不再询问我",且同一结算链的最后一次询问自动关闭该开关(见 `content.ts` 的 `chooseToUse` 分支中 `tempnowuxie` 处理段)。反应窗若做"本回合不再提示",语义与收口时机可直接对齐。

### 6.4 授权口径更新(2026-09-23 用户拍板)

本仓决定以 **GPLv3 开源**,定位学习 demo、永不商业化:

- noname(GPL-3.0-only)与 FreeKill(GPL-3.0)的**代码可以移植进本仓**,保留出处即可;
- 但 noname 素材混有官方三国杀商用美术(武将头像、牌面插图),`noname-live/` 截图因此继续按网图口径仅内部参考、勿入 git;方案 P0-A 的自绘纸墨印牌面路线不受影响,也无需调整;
- FreeKill 的 QML 交互逻辑(ItemArea 压缩布局、Super Drag 拖牌指目标、IndicatorLine 三段指示线)可翻译成 React/SVG 实现,现在连许可证障碍也没有了。
