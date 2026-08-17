# 工具链切换:npm → Bun(原生 WS 服务器 + bun:test)

React 渲染层重构闭环后,项目仍是 npm/scripts-via-node 工具链:tsx 跑 TS 脚本、vitest 跑单测、ws 库承载联机 WebSocket。维护者明确被 npm 的速度与能耗困扰,决定切换 Bun。本 ADR 记录这次切换中**难逆转、无上下文会意外**的决策。

## 决策

### 1. Bun 全量接管脚本与包管理,npm 退出唯一真源
`package.json` scripts 中凡"跑 TS 脚本"的入口(serve / gen:theme)由 tsx 改为 `bun scripts/…`;锁文件 `bun.lock` 取代 `package-lock.json`(后者删除);Tauri 的 `beforeDevCommand/beforeBuildCommand` 改 `bun run`。node_modules 目录保留(Bun 复用同一目录,仅锁文件换血)。

**为何**:半套 Bun(只拿它装依赖)收益有限;全量切换后 tsx 可删、脚本入口语义统一。Tauri 不关心命令背后是 npm 还是 bun(它只是 shell 出去调),APK/Rust 侧零影响。

### 2. 单测 vitest → bun:test
测试 import 从 `vitest` 换 `bun:test`(本项目测试零 vi.mock/vi.fn,describe/it/expect 原生兼容);删 `vitest.config.ts`,`@core`/`@app` 别名走 tsconfig paths(Bun 原生解析);`bunfig.toml` 的 `[test] root = "test"` 防止把 Playwright 的 e2e spec 当单测扫进来。

**为何**:白拿 bun test 的速度(3.4s vs 4.4s)且少一个 vitest 依赖族。代价:换测试框架的心智与文档口径,一次性付清。

### 3. 联机服务器换 Bun.serve + 内置 WebSocket
`scripts/server.ts` 自 `node:http + ws(noServer)` 重写为 `Bun.serve({fetch, websocket})`:REST 路由进 fetch handler;`/ws` 升级在 fetch 里鉴权后 `server.upgrade(req, {data:{roomId,seat}})`;生命周期挪 open/message/close handlers。`room.ts`/`room-persistence.ts` 零改动(ADR-0007 的模块边界因此决策受益——传输层重写不触碰房间编排)。`ws` 依赖删除。

**为何**:Bun 内置 WS 免一个依赖且是官方推荐路径;重写风险被"room 模块零改动 + 联机双端 e2e 全绿"对冲。

### 4. Playwright 锁 1.55.0 并改用系统 Edge
Bun 重解析 `^1.55.0` 时把 Playwright 拉到 1.61,引入系统性 e2e 失败(教训:**换包管理器=锁文件重开**,宽松 semver 会静默漂移大版本)。处置:锁死 `1.55.0`;浏览器改 `channel: "msedge"` 用系统 Edge,免下载自带 Chromium。

**为何与代价**:降版本要重下对应浏览器,而系统 Edge 零下载;代价是测试环境随本机 Edge 版本漂移(个人本地项目可接受,上 CI 时删 channel 即回退锁定版)。

### 5. e2e 稳定性:轮询替代竞态读
`quickStart` 补 `waitSettled`(连续两次快照一致才算局面稳定)、胜利屏用例锁 `seed=7`。根治"行军按钮可用 ≠ bot 链结束"的竞态读——这是长期 TODO 里 e2e 时序抖动家族的通用修法。

## 后果

- 依赖树:`tsx`/`vitest`/`ws`/`@types/ws` 移除;新增 `@types/bun`/`@types/pngjs`
- 部署:服务器宿主机需 bun ≥1.3(docs/multiplayer.md runbook 已同步)
- 回退路径:全链在一个 commit,出问题整体 revert 即可
