# ADR-0055: 协议级联机 e2e——故障注入代理 + react-online 逻辑断言下沉

日期:2026-11-07 · 状态:已采纳 · 票:[#1164](https://github.com/openaddr/dafung-web/issues/1164)(棒一 99cd9e92 地基 + 棒二收口) · 地图:[#1160](https://github.com/openaddr/dafung-web/issues/1160)(无头确定性 e2e 测试体系,wayfinder;前置 [ADR-0052](./0052-headless-deterministic-testing.md))

## 背景

联机「对不对」的验证此前压在浏览器 e2e 一层:react-online-{events,secrecy,cutover,autopilot} 四条 spec 混装两类断言——**协议面逻辑**(事件批序/校准形状/保密 redaction/托管语义/断线重连)与 **UI 壳**(横幅可见性/开关交互)。协议面断言坐浏览器层成本畸高:每例要起双页 build、Playwright framereceived 线级捕获、满载下 WS 广播抖动放大墙钟,且故障注入(延迟/丢帧/杀连接)根本进不去——浏览器客户端与服务器之间的网络路径不可编程。本 ADR 记 #1164 收口:真服务器进程 + 无头 WS 客户端 + 故障注入代理的协议级测试层(test/protocol-online.test.ts),浏览器侧只留 UI 壳断言。

参考仓 vera20k(路径见 [ADR-0052](./0052-headless-deterministic-testing.md) 头注)`src/bin/lan-fault-proxy.rs`(94 行)+ `src/net/fault_proxy.rs`。

## 参考与取舍

### 学了什么(照单;采纳/变体逐条注明)

| vera20k 文件与机制                                                               | 学到的                                                     | 落地形态(采纳/变体)                                                                                                                                                |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| fault_proxy.rs 头注:「转发真实双端字节流,绝不改参与者/模拟状态/可靠性/中继鉴权」 | 故障代理是**哑管道**:只对传输单位做文章,协议语义对它不可见 | `scripts/fault-proxy.ts`:WS→WS 逐帧转发,不 import wire.ts、不解析消息(采纳)                                                                                        |
| Direction 枚举 HostToGuest/GuestToHost                                           | 故障按**方向**独立配施(双向各一套旋钮)                     | `FaultDirection` = toServer/toClient,dropEveryN 按向独立(采纳,命名对偶)                                                                                            |
| Notice 观测面(Ready/Armed/Corruption/Stopped,机器可读)                           | 故障发生点必须**可断言**,不靠猜                            | `FaultProxyNotice`(ready/pair-open/dropped/killed/pair-closed)+ `getStats()` 计数器(relayed/dropped/kills/pairs);变体:本仓是同步回调,vera 是 JSON 打印+stdout 通道 |
| Corruption 一次一帧、落点由 after_frame 序号定                                   | 故障落点是**序号确定**的,同一帧序列下可精确复现            | 变体:verbal20k 损坏「after_frame 之后首个校验帧」;本仓 dropEveryN 按「方向到达序(含被丢帧)%N==0」确定性丢帧,notice 带 ordinal,测试断言可到「第几帧」               |
| lan-fault-proxy.rs 作为 bin 的存在(94 行参数解析+stdin 控制)                     | 故障面独立于游戏二进制,normal build 零故障钩子             | 变体(见下「不适用」):本仓不需要 bin——测试与代理同进程,直接 import 类;scripts/server.ts 同样零故障钩子                                                              |
| 双真实客户端经代理对连的组织                                                     | 故障矩阵的受试者=真实协议端点,不是 mock                    | `OnlineClient`(wire.ts 编码单源上行)+ 真 spawn server.ts;每客户端独立代理连接对(采纳)                                                                              |
| Stopped 汇总计数(corrupted_directions/forwarded/rejected_sources)                | 结账时对账「故障确实发生了几次」                           | getStats() 断言 dropped/kills 计数(采纳)                                                                                                                           |

### 什么不适用、为什么

- **独立进程控制通道(stdin 指令 + mpsc Control)**——vera20k 的 Rust 测试与代理跨进程,故障旋钮只能走 CLI 参数/stdin/信号;本仓 bun test 与代理同进程,`setLatencyMs/setDropEveryN/armKillAfterMs/killNow` 直接方法调用,运行中可调。「先建连零故障、中途注入」的矩阵用法在同进程编程接口下更直接,不需要控制协议。
- **校验和损坏(corruption)旋钮**——vera20k 是 UDP + 自校验帧(FRAMEINFO checksum),字节级损坏是真实故障面;本仓 WS over TCP,传输完整性由 TCP 保证,应用层帧无自校验,可注入的故障面只剩传输行为三件:延迟/丢弃/断连。造「坏 JSON 帧」会是应用层故障而非网络故障,且无头客户端 ingest 对非协议形状本来就地炸(零兜底),旋钮无意义。
- **after_frame 帧号武装(≥300 帧起步)**——vera20k 是 lockstep 逐帧模拟,帧号是全局时钟,故障按帧号武装才可跨端复现;本仓回合制 + 事件驱动,无全局帧号,武装语义退化为时间(`armKillAfterMs` 一次性定时)与编程即时调用(`killNow`)。
- **UDP 单 socket 双向转发**——本仓 WS 每条客户端连接独立拨一条上游(连接对),故障按连接对生效,killNow 只杀连接对、代理继续监听(重连原 URL 直连即得全新连接对);vera20k 断连即局毁(lockstep 双端对称),本仓权威服务器在,断连=座位离线+重连校准(ADR-0020 决策 4)——**故障矩阵的断言面因此完全不同**:断服务器侧行为(房主移交/决策门冻结/整房摘要回正),不是断双端一致性破裂。
- **故障概率参数化(丢包率)**——见下节,刻意不采纳。

### 故障旋钮确定性化(禁随机抖动)

三个旋钮全部确定性,禁 `Math.random`/真随机抖动:延迟=每帧固定排队 ms;丢帧=方向到达序 %N==0(计数含被丢帧、不因旋钮中途调整重置,同帧序列下丢哪几帧是确定的);杀连接=编程即时或定时硬断。理由两条:

1. **flake 零容忍纪律**(AGENTS 验证纪律,2026-11-02 #987 拍板):随机 seed/时序竞速可致挂的用例发现即删。概率丢帧让「丢的是摘要还是事件批」变成抽奖,断言只能写宽,宽断言守不住回归——等于花墙钟买噪声。
2. **断言可精确**:确定性旋钮下,notice 的 ordinal/计数可逐帧对账(场景四:丢帧序号全落 N=2 图案、跨旋钮调整序号单调连续、饿死窗内客户端 frames 零增长而代理 dropped 持续增长——两侧对照正着断,不做「等一会再看还在不在」的负时序赌)。

### 回读三律(2026-11-07 收口轮实锤沉淀)

无头客户端的上行命令都要「发+回读」,回读实现有三条纪律,破一条就是假绿:

1. **回读只认命令之后到达的帧**——客户端缓冲里有开关之前的旧载体帧(开局序列托管标记恒 false),FIFO 扫描会拿旧帧冒充回读;`setAutoPilotEchoed` 以「发命令前的 frames.length」为界做后缀扫描。
2. **回读落定之前不许碰传输面**——场景五首版把「收回托管」命令发出后立即 `killNow`,回收帧还在代理转发链里就被硬断作废,座位实际仍被托管,冻结断言整盘皆错(对局日志无 `on=false` 行取证)。
3. **冻结时相钉种子**——冻结时点=收回座位首个「含决策」的回合(autoRoll 代摇不代决策;无决策回合 autoRoll 会空转数轮),第几回合到来由骰流决定:场景五 seed 4 / 场景七 seed 1(20 种子扫描全数在 recall 后 ≤12s 冻结;钉 seed 让时点也确定)。骰流变更先红于这些用例,处置走种子哨兵同款重钓配方。

vera20k 的「丢包率」类参数因此在翻译时改形为「每 N 帧丢 1」:随机面收敛为周期图案,覆盖率靠矩阵组合(延迟档×丢帧档×杀房主档三例)而非单例内随机抽样。

### 慢例池归属

test/protocol-online.test.ts 整文件入慢例池(判据=「单例实测 ≥3s 且属整局骑局/整局恢复/**真实进程类**」的真实进程支:真 spawn 服务器 ~3s 是文件级固定开销,与 test/server-cmd-error.test.ts 先例同判),默认池不留用例——核心确定性已有两跑门 + check:goldens 管。开关用 **describe 级 skipIf**(server-cmd-error 探针先例:it 全跳时文件级 beforeAll 照跑,describe 级才连钩子一起跳——默认池不白起一台真服务器,并行会话撞口假红)。跑法:`DAFUNG_SLOW=1 bun test test/protocol-online.test.ts`(配方要点见 [开发与测试](../how-to/开发与测试.md)「协议级联机 e2e」节)。

## react-online 逻辑断言迁移落点总表

断言语义等价迁移,不逐字搬运;观测口从 Playwright framereceived / `__dafung` 调试钩子换成 OnlineClient 的 frames/batches/snapshot 归档与确定性等待原语。

| 旧 spec(用例)                                                                                              | 迁移去向                                                                                                                                          | 断言面                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| react-online-events「事件批下行:开局选都逐转移到达双端,内容与顺序符合批语义」                              | test/protocol-online.test.ts 场景六(整文件迁入,spec 已删)                                                                                         | 批非空、首部齐全、(round,turn) 非降、capitalSelected×2、setupCompleted/gameStarted/turnStarted 收尾链                         |
| react-online-autopilot「双端托管:推进,host 中途收回即停(冻结),重开推进恢复」                               | 同上 场景七(逻辑面;UI 壳留原文件用例二)                                                                                                           | 托管推进、收回回读复位、收回后滚动静默窗冻结(停点唯一性=权威语义:guest 受控,唯一未受控人类决策门是推进唯一钥匙)、重开恢复推进 |
| react-online-cutover「托管骑局:零逐步快照,状态下行只走事件批与校准快照」                                   | 同上 场景八(帧形状断言)                                                                                                                           | 每连接首帧=整房摘要豁免,此后逐步快照必须为零(校准判定口径与 server.ts 同源镜像)                                               |
| react-online-cutover「对局中掉线:元数据走 lobby 指纹通道」                                                 | 同上 场景九(整例迁入)                                                                                                                             | started=true + 他人座位 online=false 翻转、房主未动;重连翻回 online=true                                                      |
| react-online-cutover「断线重连:整房摘要按座位投影水合…双端状态收敛一致…依旧零逐步快照」                    | 场景二(重连摘要校准)+ 场景四(重连摘要保密投影断言)+ 场景八(重连后仍零逐步快照的审计口径);UI 壳(横幅可见性)留 react-online-cutover(改组后唯一用例) | 首帧摘要、他人手牌/牌库序不出网、续局推进、横幅可见→消失                                                                      |
| react-online-secrecy 用例一「guest 视角:摘要/校准快照无他人手牌、无牌库序;事件批询问集只含自己或匿名占位」 | 同上 场景十(整文件迁入,spec 已删;原文无 UI 壳断言,故整删)                                                                                         | 逐帧 redaction 对账(双端)                                                                                                     |
| react-online-secrecy 用例二「种子局:被询问者见[自己],非被询问席只见匿名占位」                              | 同上 场景十一(种子 419+魏+3 座 bot2 逐字对齐)                                                                                                     | god-view 询问集按座位裁剪、数量保留、身份匿名                                                                                 |

spec 计数:4 文件 5 例 → 2 文件 2 例(events/secrecy 整删;cutover 留横幅可见性一例;autopilot 留开关交互一例)。

## 故障矩阵(旋钮×断言)

| 场景          | 旋钮                                | 关键断言                                                                                                                                                                                                                |
| ------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 一 零故障基线 | 无(双代理零故障档)                  | 双端按序收批、代理 relayed 双向 >0                                                                                                                                                                                      |
| 二 断线重连   | killNow 硬断                        | close 事件必达、服务器不炸、重连首帧=整房摘要、续局推进                                                                                                                                                                 |
| 三 延迟档     | setLatencyMs(80) 双端               | 建连/选都/托管全程带延迟推进、批序非降、撤除后新 turnStarted 到达(无积压卡死)                                                                                                                                           |
| 四 丢帧档     | setDropEveryN(toClient, 2→1)        | 丢帧序号落 N=2 图案、跨调整序号单调、N=1 饿死(frames 零增长 vs dropped 持续增长)、重连摘要校准回正(含保密投影)、续局不炸                                                                                                |
| 五 杀房主档   | killNow 断房主对(另一真人+bot 在局) | 房间元数据=座位下线+房主移交在场真人(ADR-0002;载体 lobby/校准快照二选一)、掉线未托管座位回合链滚动静默(重连摘要 decisionOwner 钉死停点在其决策门;autoRoll 代摇不代决策)、重连归座但房主不回迁、托管续推、解散权随移交走 |

## 落地物

- `scripts/fault-proxy.ts` — 三旋钮哑管道代理(棒一;运行中可调 + notices/getStats 观测面)。
- `scripts/online-client.ts` — 无头联机客户端(棒一;棒二补 `frames` 全量下行归档——逐帧审计需要完整帧流,不只是一份 latest 快照)。
- `test/protocol-online.test.ts` — 十一场景收口门(棒一两例 + 棒二矩阵三例 + 迁移六例;整文件慢例池)。
- `e2e/react-online-{autopilot,cutover}.spec.ts` — 删缩后只留 UI 壳断言;events/secrecy 整删。
- [开发与测试](../how-to/开发与测试.md)「协议级联机 e2e」节 — 何时跑/配方要点/与浏览器 e2e 的分工。

## 承认的取舍

- **种子局用例(场景十一)绑种子 419 签名**:骰流变动会断相,处置走种子哨兵同款「先红=信号,重钓配方」(开发与测试「种子哨兵与重钓配方」条),不逐例排查。
- **测试文件间的出处注释漂移**:test/event-feed.test.ts、test/downlink-assembly.test.ts、test/seat-projection.test.ts、test/online-map-rebuild.test.ts 头注仍指 react-online-events/secrecy spec(「发送面接线归 e2e spec」的旧分工);spec 删除后这些指针待后续触到该文件的票顺手改写为指向本 ADR/场景号,不在本票文件所有权内(test/ 其他文件禁碰)。
- **冻结类断言的静默阈值(12s)是时长换置信**:阈值必须大于运转时回合间隔上限(托管 2s/拍 × 每回合 2-3 拍 ≈ 6-10s),无决策回合会空转数轮才停在首个含决策的回合——静默只证「推进已停」,停点位置由重连摘要 `decisionOwner`(场景五)/恢复推进反证(场景七)钉死;阈值只影响「若语义被破坏多久能测出」,不影响误报率。
- **元数据下行断言读态不读车种**:react-online-cutover 原文断言「掉线元数据走 lobby 通道」,Setup/校准流里实测元数据搭校准快照车(server.ts flush 形态:校准拍快照自带 WireRoomFields 且指纹随车更新,lobby 形状只在非校准拍补发)——迁移后断言接受 lobby/snapshot 任一载体,「指纹变化才发」的防重发语义不变。
