# 表现事件流:双端表现链统一为「提取器 → 播放器」单管道

React 重构后,同一条「掷骰→行军→浮字→印章→横幅」表现链在单机(playStepEffects 按 prevPhase 路由)与联机(playSnapshotEffects 按 snapshot diff 推导)各实现一遍,形状不同且已漂移(联机缺破产表现);而这条链是全仓库 bug 密度最高、测试覆盖为零的区域(骰子反向求解、e2e 时序抖动均发生于此)。本 ADR 记录统一决策。

## 决策

### 1. 表现 = 事件流,播放器单份
定义 `PresentationEvent` 判别联合(diceRolled / tokenMoved / cashDelta / supplyRain / sealStamped / turnBanner / sound)与串行播放器 `present(events, sink)`——事件数组顺序即播放顺序。单机与联机各自只写**事件提取器**(单机读引擎表现态,联机 diff 相邻快照),播放逻辑只存在一份。

**为何**:表现 bug 的本质几乎都是时序/遗漏(骰子没排在行军前、联机漏破产音),时序集中到一个播放器 = locality;新表现(如将来的骰子多端同步)只加事件类型,不动两端 = leverage。

### 2. FxSink:四个能力的窄接口,可注入
audio/dice/fxStore/march 收口为 `FxSink` 接口;生产 adapter 组装既有单例,测试用 `createMemorySink()` 录制并断言事件序列。表现层首次获得 bun test 级测试面(此前只有 Playwright)。

**为何**:orchestrator 硬连单例是其不可测的根因;"接口即测试面"——内存 adapter 就是第二个 adapter,seam 因此为真。

### 3. 已接受的偏差(记录防翻案)
- cashDelta/supplyRain 携带提取期解析的坐标 x/y:浮字锚定优先级依赖提取时刻玩家状态,事后不可还原
- 单机横幅不进事件数组(与 bot 接棒时序耦合),联机横幅走事件——两端口径不同但共用同一去重游标
- 联机铜钱声维持缺失(非本次授权的行为变化范围)

## 关联
- ADR-0006 预留的"共享动画编排器"位置即本 ADR 的落点;动画仍不进 controller 基类
- `engine.applyPresentationMove`(联机注入 diff 路径)是 tokenMoved 事件在联机侧的载体,红线 3 合规
