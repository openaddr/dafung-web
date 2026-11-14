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

## 默认浏览器环境

默认档为移动横屏 844×390、`isMobile: true`、`hasTouch: true`,唯一装配单源为 [mobile-context.ts](../scripts/mobile-context.ts) 的 `MOBILE_CONTEXT_OPTIONS`。Playwright 项目与 fixture 页面从配置继承;手工创建的多客户端页面经 `newMobileContext(browser)`,需要调试桥时经 `newBridgeContext(browser)`,两者使用同一环境。`browser.newContext()` 和 `browser.newPage()` 不继承 fixture 的 `use`,不直接调用。

667×375 矮横屏与 390×844 竖屏提示仍由对应 spec 显式声明。真实 hover 专项只覆盖 `isMobile: false`、`hasTouch: false`,尺寸仍沿用标准档;不新增桌面布局验收档。

`hasTouch` 只声明设备能力,不会把 `.click()` 转成触控。起兵、选都确认与双端大厅的代表性现役路径用 `.tap()`;牌架长按例经 CDP `Input.dispatchTouchEvent` 送可信触点,保留长按与抬指合成 click 的真实输入语义。默认页、独立上下文与调试桥上下文的 viewport/coarse/maxTouchPoints 由 `react-setup` 的环境守卫核对。

本域复跑使用脚本入口,按需打包后跑代表例:

```bash
bun run test:e2e:one e2e/spine/react-setup.spec.ts
bun scripts/e2e-one.ts e2e/geometry/react-jinnang-rack.spec.ts --grep '长按 500ms|hover 挥出'
bun run test:e2e:one e2e/slow/react-online.spec.ts --grep 'E7/X14'
```
