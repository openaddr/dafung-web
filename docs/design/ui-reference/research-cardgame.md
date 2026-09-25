# 卡牌对战 + 开源大富翁:手牌区与对局主界面布局调研

> 调研日期:2026-09-23。服务于 dafung-web 锦囊手牌区与对局 HUD 的 UI 设计参考,与 `research-sanguosha.md`(三国杀篇)互补。
> 代码引用均为克隆仓库内相对路径(克隆于 `/tmp/card-research/`),摘录有删节。

## 1. 项目概览

| 项目 | 仓库 | 技术栈 | 手牌形态 | 备注 |
|---|---|---|---|---|
| OpenDuelyst | `open-duelyst/duelyst`(官方开源) | CoffeeScript/JS + Cocos2d-js 棋盘渲染 + Backbone.Marionette DOM 覆盖层(底栏/玩家档案) | 底部横条,固定 6 槽均分,重叠为零 | 手牌上限 6、起手 5、换牌 1/回合 |
| Hearthstone.js | `tristiank1/hearthstone.js` | 纯 JS + DOM/CSS(无框架) | 扇形手牌 | 炉石克隆,调研中/待补 |

## 2. OpenDuelyst:底部手牌条拆解

### 2.1 固定槽位 + 均分公式

手牌区是 `app/view/layers/game/BottomDeckLayer.js`(569 行)。ctor 就按 `CONFIG.MAX_HAND_SIZE`(=6,`app/common/config.js`)预建 6 个 `BottomDeckCardNode` 固定槽位,**卡与槽一一对应,不随张数增删节点**。两套布局:

```js
// app/view/layers/game/BottomDeckLayer.js _updateCardsLayoutForActiveGame()
const cardsStartPosition = UtilsEngine.getCardsInHandStartPosition();
const cardsEndPosition = UtilsEngine.getCardsInHandEndPosition();
const dx = (cardsEndPosition.x - cardsStartPosition.x) / (numCards - 0.25);  // 6 槽均分
for (let i = 0; i < numCards; i++) {
  const cardPosition = cc.p(
    cardsStartPosition.x + CONFIG.HAND_CARD_SIZE * 0.125 + dx * i,  // 0.125 = 半张重叠余量
    cardsStartPosition.y);
  cardNode.setPosition(cardPosition);
}
```

要点:`n - 0.25` 让末尾留出 1/4 卡位空隙(右侧给结束回合按钮、左侧给换牌钮);起点偏移 `HAND_CARD_SIZE * 0.125` 补回半张卡的重叠余量。**手牌永不重叠、永不压缩**——上限 6 张的设计让"均分"比"压缩"更简单可靠。

### 2.2 手条在屏幕上的锚点

坐标单源在 `app/common/utils/utils_engine.js`(约 805–830 行):

```js
// 手牌区以"棋盘底边"为基准下移,水平居中后整体左移给右侧按钮让位
const cardsExpandX = Math.min(100.0, (winWidth - CONFIG.REF_WINDOW_SIZE.width) * 0.125); // 宽窗外扩
UtilsEngine._cardsInHandStartPosition = cc.p(
  winCenter.x - (CONFIG.HAND_CARD_SIZE * (CONFIG.MAX_HAND_SIZE - 1)) * 0.5
      + CONFIG.HAND_OFFSET_X - cardsExpandX,                 // HAND_OFFSET_X = -0.3*卡宽
  winCenter.y - screenBoardSize.height * 0.5                 // 棋盘底边
      - CONFIG.HAND_CARD_SIZE * 0.4 + CONFIG.HAND_OFFSET_Y - cardsExpandY,
);
```

- 水平:以屏幕中心对称铺开 6 张,再左移 `0.3 × 卡宽`(≈42px)——**右重左轻**,右边留给结束回合按钮。
- 垂直:棋盘(9×5 格)垂直居中,手条锚在**棋盘底边之下 0.4 卡宽处**,与战场零遮挡。
- 自适应:窗口比参考宽度(`REF_WINDOW_SIZE`)大时,手条与玩家框按溢出比例外扩(封顶 100px);`onResize` 全量重算,DOM 层按钮用同一坐标源定位,保证 canvas 与 DOM 永不错位。

### 2.3 卡牌状态机:可玩性 → 视觉

单卡状态在 `app/view/nodes/cards/BottomDeckCardNode.js`(1143 行),三态正交:

- **可玩判定**:`getDoesOwnerHaveEnoughManaToPlay()` + 轮到我才算 playable。
- **禁用态**:`updateUsability()` 不可用时给卡面挂 `Monochrome` 灰度 shader、底框换 `bottom_deck_card_background_disabled`、法力费用数字变红(费用刚被抬价时 `NERF_COLOR`)。
- **选中态**:`setSelected(true)` → `moveToSelectedPosition()` 整卡上浮 20px(`cc.moveTo` + easeSineOut);hover 高亮走 `bottom_deck_card_background_highlight` 底框 + glow 注入式视觉标签(`CardNodeVisualStateTag`),并区分"己方 glow / 对方 glow"两种色。

### 2.4 出牌交互:点选与拖拽共用一个 action

`app/view/layers/game/GameLayer.js`(6811 行)统一指针模型:

```js
// onPointerDown 只记坐标;onPointerMove 里首次超过阈值判为 dragging:
if (this.getIsGameActive() && this._player.getMouseDragging()
    && mouseWasDragging !== this._player.getMouseDragging()) {
  this._mouseSelectAtBoardOrScreenPosition(...);   // 拖起瞬间按按下位置选中卡/单位
}
// onPointerUp:无论"点了哪里",执行的是同一个动作函数
} else if (selectedHandIndex != null) {
  actionToExecute = this._actionSelectedCardFromHand(selectedHandIndex);
}
```

- **点击选卡 → 点目标落子**与**拖卡 → 松手落子**走同一个 `_actionSelectedCardFromHand`,两条手势通道零分叉。
- 选中手牌的瞬间(`app/view/Player.js` `setSelectedCard`):将军进入 `showCastingStartState`、棋盘合法落点由 `showCardTiles` 点亮、左侧换牌钮 `setTemporarilyEmphasized`;**右键 = `requestUserTriggeredCancel()`** 一键取消选中/连锁牌。
- 起手换牌(mulligan):点击切换选中,超 2 张上限时在卡上方弹浮字提醒(`showInstructionAtPosition`),不弹窗。
- 联机同屏意图:鼠标 hover/选中会广播 `network_game_hover/select` 事件,对手屏幕能看到你的指向——观战/联机共享同一套事件。

### 2.5 战场布局配比

- **棋盘 9×5 居中**(`CONFIG.BOARDCOL=9, BOARDROW=5`),是绝对视觉中心。
- **玩家 HUD 框在棋盘上沿两角外侧**(`utils_engine.js` 840–855 行):player1 = 板左边缘外 200px + 板顶上方 122px(左上角),player2 对称右上;将军头像/法力水晶在框内,3 个神器槽 + 签名牌从框向下沿棋盘左右侧边垂挂(签名牌 x = 框 +170,y −190)。**信息绕战场两翼,不占上下边**。
- **战报**(`app/view/layers/game/BattleLog.js`):贴左屏幕边缘垂直居中,平时整体移出屏外 87px 只露一线,最多保留 6 条(70px/条),点开滑入。
- **结束回合按钮在 DOM 层**(`app/ui/views/composite/game_bottom_bar.js`):`onResize` 把按钮 translate 到 `getCardsInHandEndPositionForCSS()`——即最后一张手牌右侧,和手条同源定位;它有个很细的状态:己方回合但**无事可做**(无可用牌、无待行动单位、换牌已用)时按钮加 `.finished` 类提示可以结束。
- 换牌钮(ReplaceNode)在手条左端外 15px,与结束回合钮左右对称夹住手条。

## 3. 视觉走查:图库可信核心(2026-09-24 补)

> **范围与口径**:sanguosha-ui 22 张(2026-09-23 采集,人工核对)+ noname-live 10 张(实机,详见 `research-sanguosha.md` §6)+ OpenDuelyst 代码拆解(§2)。
> **负审计**:2026-09-24 headless Bing 现搜批次(cardgame/monopoly/uidesign 三类 160 张)抽样 13 张废 12(表情包/品牌 logo 墙/电影剧照/银行卡照片等,与查询词完全无关)——无 cookie 的搜索结果页本身就低质混杂,下载管线的去重/尺寸闸门救不了相关性。该批次经用户确认**已整批删除**(连同死管线脚本),不入图库账;manifest 以 32 条为准。教训:**采集必须"现搜现筛",批量过夜路线(ID 过期)与无人工核对的批量现搜(低相关)都不可用。**

### 3.1 对照五个改造项,可信图库的结论

**P0-A 牌面**(竖笺/标签章/纹样窗/笺脚):
- 官方收集页([sanguosha-ui-03](./sanguosha/sanguosha-ui-03.jpg)):卡牌以**实物桌面扇状铺陈**,牌面=竖幅人物画 + 底部名条牌位,桌布木纹承载"牌在桌上"的实体感——与 P1-C 手牌架的笺牍隐喻同源,牌名条(banner 底 + 字)在 1/5 高度,不在顶部;
- UI 件料表([sanguosha-ui-05](./sanguosha/sanguosha-ui-05.jpg)):**框-章-钮是成体系的**:回纹边框、卷轴横幅、朱砂方章、鎏金兽首框,且同形不同色=不同品级(铜/银/金框)。→ P0-A 的标签章之外,**框色可作为将来的品级/珍宝变体通道**(方案 §7.4 珍宝复用的实现抓手);
- 抽将页([sanguosha-ui-07](./sanguosha/sanguosha-ui-07.jpg)):**三张牌背立于案上**,暗漆底 + 中央金印,背景墙一枚大圆火纹章——牌背「漆木底+朱印」决议的直接品类先例;火纹大章亦印证「一纹样一语义」的做法。

**P0-B 军师幕牌面化**:
- noname-live-03/09:选项时刻的牌面全展开、桌面其余区域退暗——牌面化后军师幕的注意力模型:卷轴壳退为背景,三张牌是唯一主角;
- OpenDuelyst §2.4:点选与拖拽共用同一 action、右键一键取消——军师幕交互手感的参照(我们已有 Esc/点外不误关,补「右键/长按=取消选中」可对齐)。

**P1-C 手牌架**(底部常驻):
- OpenDuelyst §2.1/2.2:固定槽位 + `(end-start)/(n-0.25)` 均分、右重左轻给结束回合钮让位、手条锚在棋盘底边之下 0.4 卡高——与拍板的"常驻不收拢、全展"完全同型,尺寸/让位参数可直接借用;
- OpenDuelyst §2.3:三态正交(可玩判定→灰度+费用变红;选中→上浮 20px;hover→底框高亮+glow)——手牌架交互态(金线/下沉/呼吸)的完整先例,连"非法原因"的对应物(费用变红)都有;
- 结束回合按钮的 `.finished` 态(无事可做时提示可结束)——对应我们行军自动化后"本回合已无事可做"的潜在需求,记入备选。

**详情浮层**:noname-live-05 五段式(名/来源/类型/全文)仍是最全先例;官方收集页的牌面名条提示浮层内可复用牌面放大版而非独立排版——`JinnangCardFace` 第三档尺寸(240×320)即为此设。

**反应窗**:非阻塞语义与形态见 `research-sanguosha.md` §6.1-6.3(ADR-0017);图库无新增证据(可信集内无"他人回合出手"的截图——该交互本身罕见,我们的"牌架即反应窗"是自研形制,实现期以 noname 语义为锚即可)。

### 3.2 一图一得(全量走查,2026-09-24;★=高价值)

| 图 | 一句话所得 |
|---|---|
| ★ sanguosha-ui-01 | 官方大厅:模式入口=竖长人物卡(noname 菜单同构);暗底水墨+朱砂点睛 |
| ★ sanguosha-ui-02 | 对局面板:手牌/装备/延时锦囊**三行分区**,区域名竖排章挂栏首;手牌=金底纹牌背 |
| ★ sanguosha-ui-03 | 卡牌收集:实物桌面扇状铺陈,牌=竖幅人物+底部名条(名条在牌下 1/5,不在顶部) |
| sanguosha-ui-04 | 桌游主界面:开始游戏大钮+头像框;构图参考 |
| ★ sanguosha-ui-05 | UI 料表①:回纹边框/卷轴横幅/朱砂钮/方章/鎏金兽首框——纸墨印同族件料 |
| ★ sanguosha-ui-06 | UI 料表②:圆窗棂/元宝钱袋/宝箱/红绸横幅——白银货币与珍宝图标的形制参考 |
| ★ sanguosha-ui-07 | 抽将:三张牌背立于案,漆底+中央金印,背景火纹大章——牌背决议先例 |
| ★ sanguosha-ui-08 | UI 料表③:金/红/黑/银四色卡框+①②③⑤编号顶章+铜/银/金材质——**框色=品级**体系 |
| sanguosha-ui-09 | 星宿全屏:紫青底+星图连线+竖排字,留白氛围成立——机遇卷轴叙事参照 |
| ★ sanguosha-ui-10 | 胜利结算:印章大字「胜利」+金环+底部手牌陈列——VictoryScreen 直接参照 |
| sanguosha-ui-11 | 商城长图;末屏武将特写=左图右文详情版式——详情浮层布局参考 |
| sanguosha-ui-12/13/15/17/18/19 | 运营向弹窗(月卡/福利/七日/红包/邀请/累储)——UI 无参考价值,仅美术气质 |
| sanguosha-ui-14 | 身份场房间:座位格+空位「+」槽——lobby/WaitingBar 参考 |
| sanguosha-ui-16 | 纯人物插画(无 UI)——美术气质参考 |
| sanguosha-ui-20 | 庆典页:预约奖励圆章+已领取印——「领取/已领取」印章语言 |
| ★ sanguosha-ui-21 | 长条全流程:对局桌面/选将/胜利「霸主」金印/商城格/卷轴页——一图全局走查 |
| sanguosha-ui-22 | 抽卡提示弹窗——低 |
| noname-live 10 张 | 响应窗四件套/目标蓝框/详情五段式/指向线等(详 research-sanguosha.md §6) |

**开源素材 11 件**(opensource-assets/,器物件,直接对照):noname 牌框两张(羊皮纸空白框=牌面底纹)、**牌背两张 + FreeKill 牌背一张(均=暗底+云纹+中央金印,漆木牌背决议的同类实现)**、hp-magatama 翡翠勾玉(体力珠)、player-frame-gold 头像框、bg 两张;FreeKill gamebg 水墨山水(气质最接近本项目)。

### 3.3 对既有决议的影响

**无推翻项**。七项决议与 spec #233 的依据本就来自这批可信资产;本轮走查的增量在实现层:①框色=品级通道(珍宝变体);②手牌架让位/锚点参数借 OpenDuelyst;③军师幕补右键取消。

