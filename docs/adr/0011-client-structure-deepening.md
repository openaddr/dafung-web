# 客户端结构深化:驱动仲裁器 + 网络模块拆分

架构评审(2026-08-16)认定客户端两大结构性风险:①单机控制器里 `busy` 布尔被四路异步流程争抢(人类步/bot 接棒/托管代打/开局接棒),时序 bug 只有 e2e 能抓;②OnlineController 一类五职责(REST/WS 重连/协议分发/表现 diff/换图重建),是 ADR-0007 在服务器侧已解决过的同款问题。本 ADR 记录客户端对偶解法。

## 决策

### 1. 驱动仲裁器(DriveArbiter)
"谁有资格推进引擎"收口为显式 module:`requestDrive(kind): Promise<DriveSession>` FIFO 互斥,`busy` 成为其私有态。关键语义:
- **空闲时同步占用**——保持旧 `busy=true` 同步置位,interactive 检查与锁占用之间无异步间隙(否则人类可双击穿透)
- `release()` 幂等且仅活跃会话生效(迟到句柄不误杀后继)
- 托管的 `delay(80)` 轮询等锁改为排队唤醒

**为何**:时序竞态集中到一个可单测的调度器(6 例 bun test),与联机端服务器 `driveBots` 单点驱动的模型在概念上对齐。

### 2. bot 循环的 stall 检测
`safety++ < 500` 计数兜底升级为**状态指纹**判空转(每步取 phase/turnPhase/turnNumber/activeIndex/各玩家资产负债指纹,不变即 warn 并中断;500 上限保留防单链失控)。经 60 局全 bot 对局 17340 步零误报实证——与 room.ts driveBots 的指纹思路对齐,单机/联机的防死循环不变量不再两套弱实现。

### 3. 客户端网络模块拆分(ADR-0007 对偶)
- `ReconnectingSocket`:WS 生命周期 + 指数退避重连,可注入 socket 工厂/timer/随机源(退避序列可单测)
- `LobbyApi`:REST 大厅客户端,回包类型收窄
- `SnapshotEffects`:快照 diff 表现提取器(ADR-0010 的联机侧提取器独立成文件)
- OnlineController 瘦身为协议桥(消息分发/hydrate/store 灌数/换图重建),门面签名不变

**为何**:重连策略首次可单测;协议桥回到单一职责;"一个 module 一件事"让每次变更不用在 400 行里找位置。

## 关联
ADR-0006(控制器基类,本 ADR 不动其裁定)、ADR-0007(服务器侧同款拆分)、ADR-0010(表现事件流,SnapshotEffects 是其联机提取器)
