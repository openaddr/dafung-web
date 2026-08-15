# 群雄逐鹿 · 三国大富翁(dafung-web)

古风水墨三国主题大富翁,**TypeScript + React + SVG 棋盘** 实现。
设计目标是**可被 AI 全自动测试与迭代**:`data-testid` 语义标识 + `window.__dafung` 状态钩子 + Playwright 端到端测试。

## 玩法速览

回合制格子桌游,2–4 人(单机:1 真人对阵电脑;或联机:每人一台设备)。三国郡县州构成 30 城主环,玩家开局选都城(取代起点),通过掷骰行军、买城扩军、拼点探宝、珍宝交涉积累现金;**身价 = 仅现金**,率先达到目标身价或群雄尽灭即称帝。完整规则见 **[RULES.md](./RULES.md)**。

## 技术栈

| 层 | 技术 |
|----|------|
| 语言 | TypeScript(strict) |
| 构建 | Vite |
| UI | React 19 + zustand + Tailwind CSS v4(token 由 `core/theme.ts` 单源生成,`npm run gen:theme`) |
| 单元测试 | Vitest |
| 端到端测试 | Playwright |

**为何不用游戏引擎?** 回合制格子游戏本质是"带动画的状态机 UI",声明式组件让 AI 测试能精确断言元素状态(`[data-testid]`、`[data-tile]`、`window.__dafung.snapshot()`),而 Canvas 方案只能靠截图猜测。

## 架构

```
src/
  core/           纯游戏逻辑(无 DOM/React,可单元测试)
    types.ts        数据模型
    board.ts        棋盘:主路环 / 辅路 / computePath
    dice.ts         可注入种子的骰子
    economy.ts      购买 / 升级 / 破产裁决
    networth.ts     身价计算(单一口径)
    game.ts         回合状态机 + 开局三段式 + 胜负
    bot.ts          AI 决策(Simple/Normal)
    theme.ts        古风配色(单源,gen:theme 生成 token)
  app/            React 渲染层
    main.tsx        入口(createRoot + StrictMode)
    store/          zustand(gameStore 引擎快照 + UI 态;netStore 联机房间态)
    controllers/    GameController 基类 + local.ts(单机)+ online.ts(联机)+ registry.ts
    screens/        setup / lobby / game(卷轴弹层)/ editor 四屏
    components/     SVG 棋盘(Tile / TokenLayer / usePanZoom)
    fx/             骰子(3D 物理骰)/ 行军 / 浮字 / 横幅 / 印章 / 音效(orchestrator 编排)
test/             Vitest 单元测试(路径 / 经济 / 身价 / 回合)
e2e/              Playwright 端到端测试(含联机多客户端)
```

## 运行

```bash
npm install            # 安装依赖
npm run dev            # 开发服务器(http://localhost:5173)
npm run build          # 类型检查 + 生产构建
npm test               # 单元测试(Vitest,141 项)
npm run test:e2e       # 端到端测试(Playwright,需先 build)
```

首次跑 e2e 需下载浏览器(国内网络用镜像,否则 ECONNRESET):

```bash
PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright npx playwright install chromium
```

确定性测试:`?seed=` 注入骰子种子,让落格/抉择序列可复现(供 e2e 与调试)——

```bash
npm run dev   # 浏览器访问 http://localhost:5173/?seed=12345
```

## AI 自动化测试接口

浏览器控制台或 Playwright 可读取完整游戏状态:

```js
window.__dafung.snapshot()   // zustand store 里的引擎快照
// → { phase, turnPhase, round, activeIndex, players:[{cash,netWorth,position,capitalIndex,...}], ... }

window.__dafung.getEngine()   // GameEngine 实例,可直接调用方法
window.__dafung.controller()  // 当前 GameController(local / online)
window.__dafung.sync()        // 手动从引擎重灌快照(排查 UI 与引擎脱节)
```

所有交互元素带语义标识(`data-testid`,常量集中定义在各屏的 `testids.ts`):`[data-testid="roll-button"]`、`[data-testid="action-buy|upgrade|skip|halt|continue|main|branch|confirm|cancel"]`、`[data-testid="hand-panel"]` 等;棋盘格用 `data-tile="N"`,棋子为 `.bv-token`。

e2e 共享工具见 `e2e/helpers.ts`(`setupAndPlay` / `drivePickCapital` / `snap` / `dismissScroll`),联机多客户端见 `e2e/multi-helpers.ts`;`?seed=` 让对局序列可复现。

这让 AI(Claude Code 等)能:写代码 → build → Playwright 驱动对局 → 读 snapshot 断言 → 改代码,形成精确闭环。实测:迁到 Windows + playwright MCP 实机驱动后,立即发现并修复了全 bot e2e 漏测的「人类回合行军按钮卡 disabled」bug(`onTurnAdvanced` 复位 busy 后未重渲染,已加防回归测试)。

### AI 自主迭代 loop

Claude(或任何 agent)可形成完整自动闭环:

1. 改代码(`src/` 或 `public/maps/*.json`)
2. `npm run build && npm test`(类型 + 单元)
3. `npm run test:e2e`(浏览器端到端,**含不变量** `e2e/invariants.spec.ts`)
4. 或用 playwright MCP 实机驱动(`localhost:4173` PROD / `5173+` dev)+ `window.__dafung.snapshot()` 读状态
5. 失败 → 回 1 改

**全程不变量**(`e2e/invariants.spec.ts` 自动检查):现金非负(非破产)、位置合法、身价非负、破产无残留、终局有 winner。任何违规立即失败,锁定回归。

## 配色(古风水墨)

宣纸 `#e8dcc0` · 墨黑 `#2b2317` · 朱砂 `#b23a2e` · 赭石 `#9c6b3f` · 石青 `#2980b9` · 金 `#d4af37` · 青绿 `#5a8c5a`,配 8 地产分组色与 4 玩家色。
