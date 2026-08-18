# 待办问题清单(TODO)

> 记录已发现但**暂不急着改**的问题。啥时候想改了,跟我说对应编号即可。
> 格式:每条带 `[ ]` 复选框,改完打 `[x]`。

---

## 已知问题

- [x] **行军按钮旁空白方块**:行军按钮旁边有个空白方块,之前是放骰子的位置。如今骰子动画已全屏化,这个方块没用要删掉。✅ 已删(1ae6214)
- [x] **掷骰动画结尾 snap 到结果面**(2026-08-14):3D 骰子动画播放过程中是连贯的,但最后一步(最后一帧)会突然把骰子的面"跳"到最终结果面上,而不是自然地滚到那个面。当前实现疑似结果提前设定、动画结束后 snap,导致观感"结果是预设好的"。期望:从开始到最终停在结果面的整个过程都连贯,不要在结尾瞬间跳面。✅ 已修(2026-08-16):改为**反向求解**——ThreeDice.roll(die) 先在同一物理世界无渲染试掷(≤40 次),找到能自然静止在目标面的初始条件(位置/姿态/线/角速度)再用它实播;cannon-es 定步长确定性保证实播落面与试掷一致,全程无 snap;静止后仅 <5° 最小旋转归正(≤80ms 微调兜底,超 5° 会 console.warn)
- [x] **联机下骰子动画与结果的多端一致性**(2026-08-14):需要把掷骰子动画做成一个完全随机的物理引擎动画来播放。如果这个随机效果是在客户端产生的,就会有一个问题——联机模式下,多个客户端之间如何保障播放的动画效果、以及最终掷骰子的结果,在多客户端之间保持一致?✅ 结论:各端轨迹/初始条件可不同(本地随机流),**落面一致即一致**——落面由服务器权威点数驱动(online.ts 检测 Roll 阶段迁移 → animateDice(服务器 die) → ThreeDice.roll(die) 反向求解),无需多端轨迹同步
- [x] **e2e 时序敏感测试断续失败**(2026-08-14,做架构待办②时核实):human.spec:32(购买)、human.spec:69(死锁防回归)、branch.spec:36(辅路)断续失败,基线(无改动)也失败,非新回归。症状是"固定 waitForTimeout 等 bot 回合"下 turnNumber 推进不足(如期望 >5 收到 3)。修法方向:waitForBot 改为轮询 snapshot 到目标状态,而非固定等待。→(2026-08-16 React 重构后旧 spec 已删;新套件偶发同类型抖动:全量首跑 react-online/react-resilience 各 1 例失败、单独/复跑全绿,疑 WS 握手与并行负载时序,复现后再按"轮询替代固定等待"修)✅ 已根治(2026-08-16):全部 spec 的固定等待改状态轮询(waitForSnapChanged/expect.poll/时间预算 90s);慢速托管窗 120→240s、直链加入窗 8→30s(均实测报错定位);断言零降级。agent 连续 5 轮 + 主线复验 3 轮全量 36/36 全绿。残留观察:resilience 曾现「guest 重入广播把 host 打回大厅屏」疑似产品级竞态,再复现则另立条目)
- [x] 出售给某个玩家物品时, 应该在对方付完钱时才能将物品转移到对方手中, 否则会出现: 出售--> 对方破产--> 对方使用我们给他的物品兑换现金来抵抗破产。✅ 已修(2026-08-16):珍宝交涉改为 escrow 交割——成交后珍宝进 `GameEngine.escrowTreasure` 托管区(不在买家 treasures 中,不可被 sellTreasureBankruptcy 变卖抵债);买家付清价款(含清算自救成功)才交货,破产则退回卖家。snapshot.ts 已补 escrow 序列化/恢复
- [x] 部分情况下, 联机模式开始后, 玩家地图上方仍然显示"请先选择地图" ✅ 已修(2026-08-16):根因=netStore.hint 残留——提示的过期定时器归 LobbyScreen 持有,切屏进对局即被卸载取消,失败提示永久留在 store(下次回大厅重闪);现 setRoom 收到 started=true 时顺手清 hint,开局即视作时序已过
- [x] 联机模式下, 联机多方均没有播放筛子动画(React 版 ThreeDice.roll(face?) 已留服务器权威点数接口,接入即可)。✅ 已接(2026-08-16):online.ts 快照 diff 检测「本帧前 turnPhase=Roll 且本帧已离开」的新掷骰 → fxQueue 串行触发 animateDice(engine.lastRoll.die),时序对齐单机「骰子→行军」链
- [x] **联机 WS 断线无自动重连**(2026-08-16,React 重构遗留):断线只能刷新页面重入;需要重连 + seatToken 重入座(controllers/online.ts 有注释挂点)✅ 已修(2026-08-16):onclose → 指数退避重连(1s/2s/4s…上限 30s,±30% 随机抖动,>10 次放弃并提示刷新);持原 seatToken 重升级(ADR-0002 token 夺回座位,服务器已支持),重连成功后首帧快照照常 hydrate;destroy() 清定时器防泄漏
- [x] **旧版「总览复位」与编辑器「重置」按钮未迁移**(2026-08-16):棋盘 pan/zoom 复位与编辑器重置回内置图,React 版暂无对应 UI ✅ 已补(2026-08-16):GameScreen 加 reset-view 按钮(调 BoardViewHandle.reset,置于左上避让静音钮);EditorScreen 加 editor-reset(confirm 后深拷贝 initialMap 重置,undo/redo 栈清空)
- [x] **编辑器导出/导入 JSON 未迁移**(2026-08-16):旧 editor.ts L52-84 的逻辑,需要时可补 ✅ 已补(2026-08-16):editor-export 下载 my-map.json(Blob+a[download]);editor-import 选 JSON → 严格 loadMap 校验 → 替换编辑态并推入 undo
- [x] **单机(LocalController)托管未接**(2026-08-16):旧版有 solo autopilot;基类已留 autopilotSupported 接缝,仅 OnlineController 实现 ✅ 已接(2026-08-16):autopilotSupported=true + 本地代打循环(单飞,botAct 按 decisionOwner 决策,fast=瞬间/slow=BOT.stepDelayMs),与 runBots busy 锁协同防双驱动,托管中 interactive 锁;基类补 autoPilotOn getter,HandPanel 单机自动出现托管行
- [x] bun 工具链能兼容tauri吧? …✅ 已确认(2026-08-16):完全兼容——Tauri 只经 beforeDevCommand/beforeBuildCommand 调 bun run(已切换);APK 构建链(Rust/Cargo/Gradle)与 JS 工具链零交集;将来往 Rust 倾斜不受影响。详见 ADR-0009
- [x] 每次点击行军开始移动后, 整个页面最右侧就会出现一个滚动条, 随之元素被整体往左侧挤压, 然后行军移动结束后, 页面滚动条又消失不见, 元素又向右移动, 如此反复, 这在视觉上很奇怪, 应当检查一下为什么会出现这种情况, 不能这样视觉反复跳动 ✅ 已修(2026-08-16):根因=React 版 app.css 迁移时丢了旧 style.css 的两处 overflow:hidden(html/body 与 board-wrap)——行军期间浮字/横幅等 fx 元素越界撑出滚动条,页面宽度反复伸缩导致元素横跳。已补回两处规则
- [x] **UI/UX 优化施工**(2026-08-16):完整评审已持久化至 docs/ui-improvements.md——全部条目完成(S2/S8 于 2026-08-16 收官:编辑器 prompt/alert 已卷轴化 InputScroll/ConfirmDialog,SoloSetup 国号非法红边+内联红字即时校验)
- [x] 地图边缘连续性 ✅ 已修(2026-08-16,0c87af0):地形画布外扩 560 逻辑单位 + 径向渐隐 mask(76%→100% 渐隐为透明透出页面背景),pan 到边缘无硬切
- [x] 城池视觉放大 ✅ 已修(2026-08-16,0c87af0):全局统一 TILE_SCALE=1.15 挂 Tile 根 transform,旗/匾/印/价格签等比放大,FIT_VIEW 边距同步放宽 3%
- [x] 行军音效 ✅ 已修(2026-08-16,8583016):根因=点击行军播 4s 完整鼓滚奏(drum-roll.ogg)。掷骰点击音改 WebAudio 合成(~120ms 扫频噪声,轻快);新增 marchStart 启动轻嗒(70ms,音量 0.09);50ms 去重 + 连发音量递减防吵;横幅等低频场景保留鼓滚
- [x] 选都点击无响应 ✅ 已修(2026-08-16,8a4edd6):点不可选城 → error 级 HintBar 即时反馈(区分「已被占据」/「此处不可建都」)
- [x] 国号预设 + 联机重名前缀 ✅ 已修(2026-08-16,aa1701f/0bd6261):首页 SoloSetup 记住国号(localStorage,联机加入自动带入,附说明文案);重名前缀定案 东西南北前后大+**小**(8 个),服务器开局时依次分配未占前缀,快照体现最终国号
- [x] 玩家上限扩至 8 人 ✅ 已修(2026-08-16,aa1701f):engine/房间 2-8 校验,色板补足 8 色(石青/朱砂/青绿/紫/赭橙/松绿/鎏金/玄茶),UI 人数选项放开,8 人开局有单测
- [x] 棋子视觉强化 ✅ 已修(2026-08-16,0c87af0):旗子 TOKEN_SCALE=1.25;行军中金边拖影 + 落脚金色虚线呼吸环(挂命令式动画路径,结束自然消退;reduced-motion 停环)
- [x] 地产属性修正 ✅ 已修(2026-08-16,aa1701f):等级统一 3 级(Lv.1-3,购入即 Lv.1);引擎本无过路费(误导来自 rentByLevel 字段与 UI 租金表,已删/换价值表);升级费已删——他人到达城池自动免费+1 级,自己到达仍走免费扩军决策;破产变卖改按当前等级价值
- [x] 手牌区重设计 ✅ 已修(2026-08-16,3e5448c):三级按钮阶梯(主 h-11 金 CTA/小操作 h-10/次级对齐 ScrollButton),disabled 同高仅换皮不再跳变,现金/身价/卡 chip 统一 min-h 与对齐,触屏 ≥40px 保住,纯视觉零逻辑改动
- [x] 全城池(含特殊地点)单击详情 ✅ 已修(2026-08-16,8a4edd6):Playing 期任意格可点开详情;特殊地点(Chance/Fate/Tax/Stock/Wolong/TreasureCity)显示类型说明文案
- [x] 详情页去 X ✅ 已修(2026-08-16,8a4edd6):删右上 ×,点遮罩空白/Esc 关闭(ScrollShell 新增 hideClose + 通用 Esc)
- [x] 选都灰化 + 详情内定都 ✅ 已修(2026-08-16,8a4edd6):被占城灰化(现有 isTaken),可选城首击=详情卷轴,卷轴内「定都于此/再想想」确认后才落子
- [x] 珍宝/英雄详情图片位 ✅ 已修(2026-08-16,5a50d08):详情卷轴顶部统一 3:4 双金边画像位;3 名英雄(周瑜/曹丕/张星彩)三国杀经典立绘入库 public/assets/heroes/(596KB,严格 3:4 同源尺寸);HeroDef.image 单一事实源,快照透传;珍宝用内联古风纹样;onError 显「画像缺失」错误态非静默兜底;来源与授权登记 manifest.json + CREDITS.md(仅学习娱乐不商用)
- [x] 明明不是我的选择却弹窗 ✅ 已修(2026-08-18):根因=selectableTiles 只判「处于选都相位」不判轮次,联机广播落在他人选都瞬态时我方棋盘仍高亮可选城并带「定都于此」按钮。修复:仅 currentSetupPlayerIndex===本地座位才生成 selectable。Playing 期决策卷轴复核已有 interactive=decisionOwner 门控无洞
- [ ] 说好了地图边缘和地图外界的颜色渐变过去, 以减少割裂感, 但你没做
- [ ] 所有地图统一调整一下, 将城池统一再分散一点, 增大间距之后, 再将城池的视觉效果再放大一些, 务必使玩家能清晰看清城池, 哪怕你更改地图的排布都行, 一定让城池大一些, 再大30%~60%都不过分

