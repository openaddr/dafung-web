---
name: dogfood
description: 狗粮 QA(探索性走查):像真玩家一样把游戏玩一遍,找 bug 与体验问题,产出带截图证据的结构化报告。触发时机:用户说"dogfood""找茬""QA 走查""探索性测试""过一遍游戏找问题";或发版打 tag 前(此时可主动提议跑一次)。不是 e2e 替代品:e2e 管回归,dogfood 管没被测试想到的问题。
---

<!--
Derived from ZCode (.agents/skills/dogfood/SKILL.md), itself derived from
vercel-labs/agent-browser (skills/dogfood/SKILL.md), Copyright 2025 Vercel Inc.,
Licensed under Apache-2.0. Modified for dafung-web: browser-use tooling,
game-specific checklist and evidence conventions.
-->

# 狗粮 QA(dogfood)

黑盒探索:以玩家身份开一局,找功能 bug、体验断点、视觉硬伤。**不读被测应用的源码**——所有发现来自浏览器里的观察;`window.__dafung` 只在取证存疑时用来佐证,不当探索入口。

## 准备

1. `bun run build && bun run preview`(http://localhost:4173,吃 dist/)。联机走查另起 `bun run serve`(:3000)。
2. 浏览器操作用会话内建能力(browser-use:control-browser / web-gui-tester);截图存 `dogfood-output/screenshots/`,报告写 `dogfood-output/report.md`。
3. 横屏是第一视口:设 932×430(与 Android 目标一致)再走查;窄竖屏只做一次冒烟。

## 走查清单(按序,发现问题就地取证)

1. **首页四入口**:单机/联机/选择地图/编辑器,每张卡可达、文案无截断。
2. **单机一局全流程**(核心,花一半时间):`?seed=` 固定种子开局 → 选都三选一 → 购地/扩军 → 珍宝拼点 → 珍宝交涉卷轴三选 → 军师幕与锦囊手牌架 → 过都城必停 → 辅路入口抉择 → 破产清算 → 胜利画面。每个决策卷轴都点开也点掉。
3. **异常路径**:托管控管、音效开关、快速连点(卷轴按钮/骰子区间狂点)、刷新恢复。
4. **编辑器**:建一张最小地图并保存/导入。
5. **联机双开**:两个 context 同房走三回合,断开一个重连。
6. **控制台**:每屏看一眼 errors,JS 报错即使无视觉异常也记。

## 取证纪律(repro-first)

- 发现问题**立即取证**,不探索完再补——先复验一次可复现,不可复现的不算。
- 交互类问题:逐步截图(前/操作/后)+ 编号复现步骤;状态时序类加录屏。
- 静态问题(截断/错字/对比度/错位):一张标注截图即可。
- 每个 issue 当场追加进 report.md(编号 ISSUE-001…),不攒批——会话断了证据不丢。
- 目标 **5–10 个有证据的问题**:5 个全证据胜过 20 个含糊描述。

## 收口

1. 核对 report.md 汇总计数与 issue 块一一对应。
2. 向用户报告:总数、按严重度分布、最要命的三个。
3. 用户拍板要修的,用 record-issue skill 记入 TODO.md;修不修、排多急由用户定。
