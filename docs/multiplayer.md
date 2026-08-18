# 联机对局设计与部署

> 状态:**已联机可玩**——第 1 步(权威服务器骨架)与第 2 步(多房间 WS + 浏览器联机客户端)均已完成,仅剩第 3 步(CLI 改 fetch server)。本文是设计与部署依据。

## 1. 目标

从本地热座(单设备轮流)演进为**每人一设备、经中心云服务器同步**。引擎权威不变,客户端变瘦(只发 GameCommand、收 snapshot 渲染)。

## 2. 拓扑

```
   dafung.openaddr.cn  ──A 记录──►  111.170.6.111
        │
     ┌──┴── Caddy :443 ─(自动 Let's Encrypt)─ WSS / HTTPS
     │           │
     │         反代 → Node :3000  (systemd 守护)
     │           │
     │     ┌─────┴──────────────────────────┐
     │     │  scripts/server.ts              │
     │     │  • Map<roomId, GameEngine>      │ ← 单进程内存多房间
     │     │  • 每手 snapshot → rooms/<id>    │ ← 崩溃恢复
     │     │  • 托管 dist/(网页同源)          │
     │     │  • WS 收发 GameCommand / snapshot│
     │     └─────────────────────────────────┘
     │
   客户端:浏览器 (https://dafung.openaddr.cn)
         Android Tauri (自带 dist/,烘入服务器 URL)
```

## 3. 决策索引

| # | 决策 | 出处 |
|---|---|---|
| 1 | 中心权威 Node + 小骨架(放弃 DO / P2P) | [ADR-0001](adr/0001-authoritative-central-node-server.md) |
| 2 | 掉线冻结 + 房主解散/bot + 房主掉线移交 | [ADR-0002](adr/0002-disconnect-freeze-with-host-override.md) |
| 3 | WebSocket(放弃 SSE+POST / 轮询) | [ADR-0003](adr/0003-websocket-transport.md) |
| 4 | 房间码大厅 + FCFS + 房主开局 + 自动国号 | [ADR-0004](adr/0004-room-code-lobby.md) |
| 5 | Seat 归属凭 seatToken,码只占空座 | [ADR-0005](adr/0005-seat-ownership-by-token.md) |
| 6 | 每局一文件、每手落盘 | §5 |
| 7 | 同一 Node 托管 dist/ | §5 |
| 8 | 部署现有 VPS + systemd + Caddy + openaddr.cn | §6 |

术语见 [CONTEXT.md](../CONTEXT.md):Authority / Room / Lobby / Seat / Host / Client。

## 4. 实现状态

**已完成(第 1 步)**:
- `scripts/server.ts` 单局 REST 引擎(权威、落盘、与 CLI 互换 state.json)
- `scripts/engine-helpers.ts` 共享层(序列化 / bot 自动驱动 / 状态摘要)
- `src/core/*` 零 DOM;`snapshot()` / `restoreFromSnapshot()` 完整可序列化

**已完成(第 2 步 — "能联机玩")**:
- 服务器:`scripts/server.ts`(瘦传输层)+ `scripts/room.ts`(多房间编排:座位/接管/bot 驱动/host 移交/纯视图)+ `scripts/room-persistence.ts`(每手落盘 + 启动恢复)。REST 大厅 `/room/new|join|start|takeover|dismiss`、WS `/ws?room=&seat=&token=`、seatToken 鉴权、掉线冻结 + 房主解散/bot 接管 + 房主掉线身份移交、同进程静态托管 `dist/`。
- 客户端(React 版,取代旧 `src/render/network-client.ts`):`src/app/controllers/online.ts` 的 `OnlineController` —— REST 建房/加入/选图/开局,WS 发 `{type:"cmd"}` GameCommand;收 snapshot 即 `restoreFromSnapshot` 重 hydrate 只读引擎,经 `syncFromEngine` 灌 zustand store,React 组件声明式重渲。大厅 UI 归 `src/app/screens/lobby/LobbyScreen.tsx`(房间态走 `src/app/store/netStore.ts`)。单机与联机共用 `GameController` 基类(`src/app/controllers/controller.ts`),屏幕组件对两种模式无感。
- 已验:多客户端 e2e(`e2e/react-online.spec.ts` 双端同步全流程)。

**待实现(第 3 步)**:CLI 改 fetch server(弃本地 state.json)。

## 5. 运行模型(目标态)

- 一个 Node 进程:`Map<roomId, GameEngine>` 内存挂多局;每次命令 `saveEngineAt(rooms/<roomId>.json, ...)` 落盘;同一进程静态托管 `dist/`。
- 环境变量:`PORT`(默认 3000)、`HOST`(默认 127.0.0.1,经反代)、`STATE_FILE`(rooms 目录)。
- ⚠️ `.env` 里的 `server_ip` / `server_pwd` 是 **SSH 运维凭据,应用不读**——应用 env 是另一份,别混(见 §6)。

## 6. 部署 runbook(VPS: 111.170.6.111 + openaddr.cn)

### 6.1 前置
- Node 20 LTS、Caddy 2
- DNS:`dafung.openaddr.cn` A 记录 → `111.170.6.111`(apex 也可,自选)
- ⚠️ **VPS 在国内?** `.cn` 域名对外提供 Web 需 **ICP 备案**,否则 80/443 可能被运营商拦截;海外机器不受限——请确认。

### 6.2 拉代码 + 构建
```bash
cd /opt
git clone <repo> dafung-web && cd dafung-web
bun install && bun run build   # 产出 dist/
```

### 6.3 应用 env(`/opt/dafung-web/.env.app`,与 SSH 凭据的 `.env` 分开)
```
PORT=3000
HOST=127.0.0.1
STATE_FILE=./rooms/
```

### 6.4 systemd(`/etc/systemd/system/dafung.service`)
```ini
[Unit]
Description=dafung-web multiplayer engine
After=network.target

[Service]
Type=simple
User=dafung
WorkingDirectory=/opt/dafung-web
EnvironmentFile=/opt/dafung-web/.env.app
ExecStart=/usr/local/bin/bun scripts/server.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
> Bun 原生跑 TS(2026-08 自 tsx 迁移):无运行时转译依赖, `bun --version` ≥1.3 即可;原 tsx/esbuild 打包方案作废。

### 6.5 Caddy(`/etc/caddy/Caddyfile`)— 自动签 Let's Encrypt、自动续期,反代含 WS upgrade
```
dafung.openaddr.cn {
    reverse_proxy 127.0.0.1:3000
}
```

### 6.6 启动 + 验证
```bash
sudo systemctl enable --now caddy
sudo systemctl enable --now dafung
curl https://dafung.openaddr.cn/health    # 期望 {"ok":true,...}
```

### 6.7 Android
Tauri 构建时烘入 `wss://dafung.openaddr.cn`(dev 可覆盖);包内 `dist/` 连此地址。

### 6.8 当前限制
多房间 / WS / 静态托管 / 大厅均已就绪(第 2 步完成),可按本 runbook 部署联机。仅剩 CLI 尚未改走 server(第 3 步)。
