# 群雄逐鹿 · 三国大富翁(dafung-web)

古风水墨三国主题大富翁的 **TypeScript + 浏览器** 重写版,源自 Godot/C# 项目 `dafung`。
设计目标是**可被 AI 全自动测试与迭代**:纯 DOM/SVG 渲染 + `window.__dafung` 状态钩子 + Playwright 端到端测试。

> 原版:`C:\Data\Godot\dafung`(Godot 4.6 + C# + openspec 规范驱动)。本项目忠实复刻其核心规则与视觉设计,改为浏览器可自动化测试的架构。

## 玩法速览

- **30 城主环**:三国郡县州,坐标按真实中国地图方位布点(横向拉伸)。
- **5 处要隘捷径**:函谷关 / 赤壁 / 华容道 / 剑阁 / 子午谷,可选大路或抄小路(含代价 / 50·50 后果)。
- **都城机制**(取代起点):开局选都,都城 = 地产 + 补给点,按等级补给 `¥150 × (Lv+1)`。
- **地产经济**:购买 / 升级(Lv0–5)/ 租金(整组 ×2)/ 破产资产转移。
- **胜利**:率先达到目标身价(默认 ¥8000)称帝,或群雄尽灭的最后一人。
- **AI 诸侯**:Simple(随机)/ Normal(EV 启发式)两档,可 2–4 座、纯热座或混战。

## 技术栈

| 层 | 技术 |
|----|------|
| 语言 | TypeScript(strict) |
| 构建 | Vite |
| 渲染 | 纯 DOM + SVG(无运行时框架) |
| 单元测试 | Vitest |
| 端到端测试 | Playwright |

**为何不用游戏引擎?** 回合制格子游戏本质是"带动画的状态机 UI",原生 DOM 让 AI 测试能精确断言元素状态(`#roll-btn`、`[data-tile]`、`window.__dafung.snapshot()`),而 Canvas 方案只能靠截图猜测。

## 架构

```
src/
  core/           纯游戏逻辑(无 DOM,可单元测试)
    types.ts        数据模型
    boards-data.ts  30 城 + 5 捷径 + SideArc 绕城算法
    board.ts        GameBoard:ComputePath / Next / EdgeWaypoints
    dice.ts         可注入种子的骰子
    player.ts       玩家构造
    economy.ts      购买 / 升级 / 租金 / 破产
    networth.ts     身价计算(单一口径)
    game.ts         回合状态机 + 开局三段式 + 胜负
    bot.ts          AI 决策(EV)
    theme.ts        古风配色
  render/         DOM/SVG 渲染层
    board.ts        SVG 棋盘(宣纸/远山/驿道/城门/王旗/旌旗)
    animate.ts      匀速移动 / 骰子翻滚 / 铜钱雨 / 流光 / 横幅
    ui.ts           侧栏 / 开局屏 / 卷轴抉择 / 胜利屏
    state.ts        App 主控制器(事件 / AI 调度)
    dom.ts          DOM helper
  main.ts         入口
test/             Vitest 单元测试(路径 / 经济 / 身价 / 回合)
e2e/              Playwright 端到端测试
```

**核心对应关系**(与 C# 原版):`core/` ≄ `dafung.Core/`,`render/` ≄ `Main.cs / DafungUi.cs / DafungTheme.cs`。

## 运行

```bash
npm install            # 安装依赖
npm run dev            # 开发服务器(http://localhost:5173)
npm run build          # 类型检查 + 生产构建
npm test               # 单元测试(Vitest,29 项)
npm run test:e2e       # 端到端测试(Playwright,8 项,需先 build)
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
window.__dafung.snapshot()
// → { phase, turnPhase, turnNumber, activeIndex, players:[{cash,netWorth,position,capitalIndex,...}], ... }

window.__dafung.engine  // GameEngine 实例,可直接调用方法
```

所有交互元素带语义标识:`#roll-btn`、`#seat-count`、`#start-btn`、`[data-tile="N"]`、`[data-action="buy|upgrade|skip|halt|continue|main|shortcut|confirm|cancel"]`、`.pick-hint`、`.scroll-overlay`、`.token`。

e2e 共享工具见 `e2e/helpers.ts`(`setupAndPlay` / `drivePickCapital` / `snap` / `dismissScroll`),封装开局→选都→掷骰→断言的重复流程;`?seed=` 让对局序列可复现。

这让 AI(Claude Code 等)能:写代码 → build → Playwright 驱动对局 → 读 snapshot 断言 → 改代码,形成精确闭环。实测:迁到 Windows + playwright MCP 实机驱动后,立即发现并修复了全 bot e2e 漏测的「人类回合行军按钮卡 disabled」bug(`onTurnAdvanced` 复位 busy 后未重渲染,已加防回归测试)。

### AI 自主迭代 loop

Claude(或任何 agent)可形成完整自动闭环:

1. 改代码(`src/` 或 `public/maps/*.json`)
2. `npm run build && npm test`(类型 + 单元)
3. `npm run test:e2e`(浏览器端到端,**含不变量** `e2e/invariants.spec.ts`)
4. 或用 playwright MCP 实机驱动(`localhost:4173` PROD / `5173+` dev)+ `window.__dafung.snapshot()` 读状态
5. 失败 → 回 1 改

**全程不变量**(`e2e/invariants.spec.ts` 自动检查):现金非负(非破产)、位置合法、身价非负、破产无残留、终局有 winner。任何违规立即失败,锁定回归。

## 与原版差异

- 股票 / 税格 / Chance / Fate 等类型保留枚举但 v2.0 未放置(与原版一致)。
- 渲染从 Godot Canvas 改为 SVG + CSS 动画;字体改用 Web 字体(毛笔体 Ma Shan Zheng / 宋体 Noto Serif SC)。
- 都城补给、驻跸、支线、破产、身价胜利等规则与原版 spec 一致。

## 配色(古风水墨)

宣纸 `#e8dcc0` · 墨黑 `#2b2317` · 朱砂 `#b23a2e` · 赭石 `#9c6b3f` · 石青 `#2980b9` · 金 `#d4af37` · 青绿 `#5a8c5a`,配 8 地产分组色与 4 玩家色。
