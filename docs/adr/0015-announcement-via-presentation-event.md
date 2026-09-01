# 宣告动效归表现事件流:CSS 只承担常驻氛围与纯状态样式

R3(#96)给城池加了三拍宣告动效(扩军印章重钤、顶层生长、易主流光),实现走了组件内自触发:Tile.tsx 以 `key={state.level}` 重挂播 `bv-build-grow`/`bv-level-seal-pop`,以 `useOwnerChangeFlash` 上一值钩子播 `bv-own-flash`,动画定义在 board.css。这等于在表现事件流之外出现**没有播放器的第三个提取器**:同一逻辑事件被劈成两半——一次扩军,"音效走事件流、视觉宣告走 props diff",两半各自为政,宣告既不与骰子/行军/浮字排序,也无法测试。ADR-0010 的表现事件流已收口"提取器 → 播放器 → FxSink"单管道,本 ADR 记录把宣告动效收编进该管道的裁决(扩展收编,非重开)。

## 背景与问题

### 1. props diff 宣告 = 旁路提取器
组件渲染时 diff 自己的 props(上一值快照/key 变化)推导"发生了什么",再自行动画:
- **触发源错位**:props diff 只知道"值变了",不知道"谁让它变"——终态加载(快照恢复/换图)与真实引擎推进在 props 上同形,宣告只能靠首挂例外等补丁区分;
- **时序失控**:宣告在 React 渲染时发生,与事件流的骰子→行军→浮字序列无任何排序保证;
- **测试为零**:props diff 无法在 bun test 断言,memorySink 录不到它。

### 2. 三个"盖章"渲染器并存
同一"钤章"视觉有三份实现:fx-svg-seal-stamp(浮层印,fx.css)、bv-level-seal-pop(board.css,注释自认是对前者的语义拷贝)、Tile 静态都/起印。位姿参数(-12°→-8°、scale 2.2→1)重复维护。

### 3. 决策成败信号已被清理(实施中核实的实证)
extractStepEvents 原以 `lastTransaction.status === Ok` 判买/扩军成败——但 endTurn 随决策载荷清理(spec #107 C2)把 lastTransaction 置 null,而提取发生在命令完成之后:该分支**实际已死**,买城的「据」章/buy 音/upgrade 音在单机不再播出(存量测试因 `if (lastTransaction?.status === "Ok")` 守卫空转而未察觉)。宣告接线必须先有一个活着的成败信号。

## 决策

### 1. 裁决规则
凡「引擎推进产生的可播放信号」——一次性、需要与骰子/行军/浮字/印章排序的表现——**必须走表现事件扩展**(PresentationEvent 加判别分支 + 双提取器产出),经唯一播放器 present() 消费。CSS 类只允许承担:
- **常驻氛围**(infinite:呼吸/旌旗摇曳/虚线行进);
- **纯状态样式**(transition/hover/静态形状)。

"何时播"归播放器/sink,"怎么播"归 CSS(keyframes 本体留在样式层)。判定口诀:需要 memorySink 断言顺序的,不许是 props diff。

### 2. 两体系对照

| | 表现事件流(ADR-0010) | R3 props-diff 宣告(被收编) |
|---|---|---|
| 触发源 | 引擎结算 → 提取器 → 事件 | 组件渲染时 diff 自身 props / key 变化 |
| 与骰子/行军/浮字排序 | 数组序即播放序(present 串行 await) | 无排序保证,随 React 渲染时机漂移 |
| 终态加载(快照恢复/换图) | 提取器不产出事件 → 不播 | 与真实推进同形,只能靠首挂例外打补丁 |
| 测试面 | memorySink 录制可断言 | 零(只能 e2e 目测) |
| 承担「何时播」的层 | 播放器/sink | 组件自身(越权) |

### 3. 事件与能力扩展
- `PresentationEvent` 增 `propertyChanged { tileIndex; level; ownerColorIndex|null; levelChanged; ownerChanged }`,字段 = 引擎结算留痕 `PropertyChangeTrace`(core/game.ts,与 FloaterEvent 同居引擎层)原样透传;
- `FxSink` 增第五能力 `announceTileChange(ev)`:生产 adapter 经 fxStore 下发**按城宣告记录**(level/owner 两维独立单调 nonce + 最新归属色),Tile 订阅 `announces.get(tileIndex)`,nonce 变化即以之为 React key 重挂对应元素、重播动画类;memorySink 只录制(op: announceTile)供断言。nonce 播完自然过期,不做清理定时器。

### 4. 成败信号改走结算留痕(修复死分支)
引擎在成交结算点写入 `propertyChanges` 留痕(私有缓冲,`presentation.drainPropertyChanges()` 破坏性读,同 drainFloaters 口径):buyProperty/upgradeProperty 成交、公道买卖升级、破产资产转移(settleDebt 收口为 settleDebtTraced)、变卖给银行。提取器改为"有留痕 = 成交":upgrade 音/「据」章/buy 音据留痕产出,**音效在前、宣告紧随**;被拒不产出。这同时修复了 §背景3 的死分支,且「据」章锚定改用留痕自带 tileIndex(endTurn 已推进回合,activePlayer.position 不再是成交格)。联机侧 SnapshotEffects 以 propertyId diff 相邻快照产出同一事件(首帧只记基准,排在行军后、破产音前)。

### 5. 盖章归一
「落章弧」(抬印 -12°/2.2/透明 → 钤定 -8°/1/实)收敛为共享 keyframes `fx-seal-slam`(fx.css):浮层印按属性分工引用(rotate 走落章弧,opacity/scale 走 linger 时间线,动画列表后者同属性胜出,轨迹逐段等价),等级印整段引用并参数化时长/缓动(`--dur-slow` + `--ease-out-back`)。静态都/起印不动。

## 后果
- 新宣告 = 加事件类型 + 双提取器产出,不在组件里另起自触发;
- 宣告序列 memorySink 可断言(顺序、内容、与音效的相对序);
- Tile 回归纯 props 渲染 + 外部信号订阅:终态加载不播动画(nonce=0 静置),消除整盘印章齐 pop 的伪出场;
- 破产易主/变卖回无主此前无任何视觉,现走同一宣告通道;
- lastTransaction 仍归快照口径(瞬态),但表现层不再读它——它"存活期过短"的教训记录在案:表现信号必须与结算点同生,不能依赖被后续阶段清理的字段。

## 关联
- ADR-0010(表现事件流)是本裁决的基础:propertyChanged 是该判别联合的常规扩展,播放器/双 adapter 结构零改动(接口加一能力);
- `bv-build-grow`/`bv-own-flash`/`bv-level-seal-pop` 的 keyframes 本体留在 board.css,类名不变(reduced-motion 清单不受影响);
- 引擎侧 PropertyChangeTrace 与 FloaterEvent 同为"结算留痕 + 破坏性读"口径,红线 3 合规(引擎态读取走 presentation 视图)。
