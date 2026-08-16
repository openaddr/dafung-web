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
