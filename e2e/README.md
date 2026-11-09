# 浏览器 e2e——目录天然分类(#1345)

分类=目录,判词=各 spec 文件头注(地板名册行),本 README 只住导览与判据指针。文字分类表(docs/reference/e2e-分类表.md)已退役(2026-11-09,#1337 拍板五拍之 5;历史逐条账 git 考古)。

## 目录轴

| 目录        | 族                                                                   | 池   |
| ----------- | -------------------------------------------------------------------- | ---- |
| `spine/`    | 脊柱六条+构造器守卫(真 UI 开局链/骑局拆出前的快例/教程走查),永不迁移 | 快池 |
| `geometry/` | 几何钉/哨(真实排版几何与渲染测量,happy-dom 无真值)                   | 快池 |
| `browser/`  | 真浏览器运行时面(⑥真 API:剪贴板/下载/UA/LoAF;真网络 CORS 双端冒烟)   | 快池 |
| `slow/`     | 慢池:联机真链路族、整局骑局(脊柱⑥)、单例实测 >30s(#1026 判据)        | 慢池 |

- 快池入口 `bun run test:e2e` = 路径制(spine/geometry/browser 三目录);慢池 `bun run test:e2e:slow` = `e2e/slow`。`{ tag: "@slow" }` 标签随目录制退役(#1345)。
- 池成员等价对账(#1345 迁移日):快池 51 例 1.5m、慢池 12 例,与迁移前逐例等价;墙钟基线唯一口径源=[耗时回顾](../docs/agents/耗时回顾.md)基线账。
- 判层与迁移判据单源=[ADR-0062](../docs/adr/0062-test-layering-constitution.md) 测试分层宪法(地板名册);到站形制判据=[ADR-0059](../docs/adr/0059-midgame-constructor-e2e-migration.md) 决策 4;直通/真实段判据=[ADR-0058](../docs/adr/0058-e2e-direct-path-doctrine.md);分类判据史=[ADR-0056](../docs/adr/0056-e2e-slimming.md)。
- 定向跑 `bun run test:e2e:one <路径|文件>`(不过锁);全量=两池并集,经全量测试锁。
