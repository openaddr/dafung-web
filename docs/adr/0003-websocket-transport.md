# 实时传输用 WebSocket(放弃 SSE+POST 与轮询)

客户端与服务器之间用单条 WebSocket 双向连接:上行 GameCommand、下行 snapshot 广播。Seat 绑定、服务器推送、重连都走这一条连接。

放弃了 SSE+POST(服务器→客户端用 SSE 自带断线重连、客户端→服务器用 POST,对回合制上行稀疏本也够用,且抗代理更强)——选择 WS 是为"一条连接管双向"的统一模型,更贴 submitCommand/snapshot 的命令-快照协议,且小骨架下 `ws` 库几乎零成本挂进现有 http 服务。也放弃轮询(看到对手落子有秒级延迟、且空轮询烧请求)。
