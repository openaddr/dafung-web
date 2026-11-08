# BRIEF.md — 视觉重做 Wave-2 分包简报(已收官)

> 本文件曾是子代理的唯一上下文入口与实施台账;Wave-2 已收官,现仅存**红线 §0、
> 范本指针 §3、工作守则 §5** 供后继分包复用。
> 基线:视觉重做主体已合入 master(5214f4f,PR #139)。Wave-2 = 编排化收口:
> 逐屏审计 → 按包回炉 → 评审放行 → 全量绿。
>
> **⚠ 方向修订(2026-10-13,#489/[ADR-0026](../adr/0026-visual-direction-revision-xuanmo-liujin.md))**:
> 视觉基准已由方向 B「水墨留白·笺纸集」修订为 **方向 D「玄墨鎏金」**。原 §1 方向宣言
> 与 §2 设计系统速查按方向 B 写就,已随之退役删除(比选与宣言全文见 git 史);
> **§0 红线与 §3 范本指针继续有效**,§4 台账历史化。视觉基准一律以
> [DESIGN.md](./DESIGN.md) 方向 D 与现库为准。

## 0. 红线(违反任何一条 = 该包失败)

1. `src/core` 权威引擎**零改动**(theme.ts 仅配色/动效 token 单源,属 gen:theme 管线,非引擎裁决逻辑);UI 永不裁决,一切状态来自快照/命令/表现事件。
2. **data-testid 契约不变**(各屏 testids.ts 是唯一来源),e2e 选择器零漂移。
3. 一切动画时长经 `src/app/fx/timings.ts` 的 scaler / CSS `--dur-*`/`--ease-*` token 表达;秒级常量只活在 timings.ts 注释钉死的那几处。
4. 每屏合入门槛 = **typecheck 零错 + bun test 全绿 + 该屏 e2e 绿 + 评审放行**,四项齐。
5. 工作树中未提交改动只许避开;`tokens.css`/`app.css`/`theme.ts` 等全局样式**只归主线改**——分包需要动全局 → 停手回报,不自己动手。
6. 无障碍底线:键盘可达、焦点可见、prefers-reduced-motion 尊重、对比度达标(小字 4.5:1)、移动端可用(**仅横屏**,ADR-0018)。

## 1. 方向宣言

方向 B 命题「一纸墨戏,方寸庙堂」及其换皮测试结论已随方向 D 定稿退役(原文见 git 史);
现行方向宣言 = [DESIGN.md](./DESIGN.md) §3:**漆黑为纸,鎏金为骨,立绘为魂**。

## 2. 设计系统速查

方向 B 速查已随方向修订退役删除——现行唯一事实源:[DESIGN.md](./DESIGN.md) §4
(token 语义/控件种/字体/动效 token/投影,单源 core/theme.ts → gen:theme)。

## 3. 范本屏指针(质量基线 = 对局内)

对局屏是已过四项门槛的参照物。分包前先看这几处「对的样子」:

- `src/app/screens/game/scroll/scroll.css` + `DecisionScrolls.tsx` —— 挂轴双杆、题名朱印、墨钮/笺钮按钮种(ScrollShell 已随 #1233 桶退役收编)。
- `src/app/screens/game/HandZone.tsx` + `SeatRail.tsx` + `shared/RoundClose.tsx` —— 笺头制式、方印国号、墨钮 CTA(HandPanel/StatusBar 已随 #700 浮层骨架退役)。
- `src/app/screens/home/HomeScreen.tsx` —— 签名件(玄墨鎏金装裱横带 + 落款印)。
- `docs/design/DESIGN.md` §7 —— 前后对比图(现库图见 `ui-reference/current-ui/2026-10-13/` 系列)。

## 4. 各屏验收(Wave-2,已收官)

Wave-2 九包(棋盘演出/HUD/卷轴终局/首页/单机配置/联机大厅/地图编辑器/共享组件/落格结算动效)全部绿——四项门槛齐 + 评审放行,2026-10 收官;逐屏验收要点与包归属表见 git 史本节。

## 5. 子代理工作守则

- **文件互斥**:一包一文件集(见派单指令),不碰包外文件;全局样式冲突 → 停手回报。
- **验证**:typecheck(`bun run typecheck`)/单测(`bun test`)随时;e2e 单 spec 跑法
  (env 三件套、脚本入口、先 build)唯一事实源 = [开发与测试](../how-to/开发与测试.md)
  「把测试跑起来」。收口全量由主线跑。
- **截图**:走 `scripts/shot.mjs`(起服样板单源;测试钩子 `window.__dafung` 可构造局面);图存 `tmp/ui-shots/<主题>/`(tmp 不入库,定稿图转存 `ui-reference/`)。
- **层叠陷阱记档(包A 实证)**:app.css 控件种是非分层规则,天然压过 @layer utilities——`note-card` 后再写 `shadow-*` 工具类会被静默吃掉,覆盖投影需 Tailwind v4 尾缀 `!`(如 `shadow-[var(--ink-shadow-lg)]!`)或由 app.css 增设变体。
- 汇报格式:改动文件清单 / 验证结果(逐项)/ 截图路径 / 未决问题。
