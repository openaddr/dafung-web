# dafung-web 联机对局

权威引擎 + 瘦客户端的三国大富翁联机对局。由本地热座(单设备轮流)演进为每人一设备、经中心云服务器同步。

## 语言

**Authority(权威引擎)**:
唯一受信任的对局裁决者。所有掷骰、落格、胜负只在它内部发生;客户端从不自行裁决。
_Avoid_: server(过载——既指部署主机,又指 HTTP 进程)、host(与"房主"混淆)

**Room(房间)**:
一局进行中的对局。有独立的玩家、回合状态与珍宝牌堆;多局 Room 之间互不影响。
_Avoid_: game(与"一整局对局"混淆)、session(网络语境指一次登录连接)

**Lobby(大厅)**:
Room 开局前的等待态——在引擎 Setup 之前。玩家在此加入并占 Seat;Host 开局后构造引擎、进入 Setup → Playing。
_Avoid_: waiting room

**Seat(座位)**:
Room 里的一个玩家位(共 2–4 个)。轮到谁即"谁的 Seat 活跃"。
_Avoid_: player(既指真人又指数据结构)、slot

**Host(房主)**:
Room 的创建者(Seat 0),掌握开局前管理权(选座位数、开局);对局中可解散房间、强令 bot 接管掉线 Seat。
_Avoid_: owner(与城池持有者混淆)、admin

**Client(客户端)**:
玩家设备上的瘦端(浏览器 / Android)。只提交命令、接收并渲染状态,不持有权威裁决。
_Avoid_: frontend(泛指渲染层)、app
