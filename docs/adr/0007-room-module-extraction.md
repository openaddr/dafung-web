# 抽 Room 模块:游戏编排 vs 传输/持久化(server.ts 拆分)

`scripts/server.ts`(527 行)把房间编排(座位/接管/bot 驱动)和 HTTP 路由、WS 协议、静态托管、`rooms/*.json` 持久化混在一起——房间逻辑脱离 socket/磁盘就测不了。

抽出 `scripts/room.ts` 的 `RoomRegistry`(深模块):持有 `RoomSession` 数据 + 房间生命周期(`createRoom`/`joinSeat`/`startGame`/`takeoverSeat`/`dismissRoom`)+ `applyCommand` + bot 驱动(`driveBots`)+ host 移交 + 纯视图(`lobbyView`/`clientView`)。**零 WS/HTTP/fs 依赖**:WS 句柄挪出 `RoomSession`(传输层持 `座位→WS` 映射);`online` 状态由传输层传入(作 `clientView` 输入);`applyCommand`/`markSeatOffline` 接 `onUpdate` 回调(每次可见变化后调,传输层在回调里 broadcast,保留联机逐步直播 UX)。

持久化做成注入适配器(`RoomPersistence` 接口 + `FileRoomPersistence` 实现,落 `scripts/room-persistence.ts`);`RoomRegistry` 构造时注入,测试用 InMemory。传输层(`server.ts`)瘦成 HTTP 路由 + WS 生命周期 + broadcast,调 `RoomRegistry`。

标准 ports & adapters:Room 是深模块,传输 + 持久化是两个薄适配器。收益:房间逻辑首次可不开 socket 单测;传输可换(REST→WS 已换过一次);持久化可换 DB。ADR-0001(中心 Node 服务器)与 ADR-0002(掉线模型)均成立——Room 仍跑服务器侧,接管/掉线逻辑搬进去而非搬走;客户端看到的 JSON 不变。
