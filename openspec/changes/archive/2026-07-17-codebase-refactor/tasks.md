## 进度小结

- **Phase 1–5 全部完成并验证**(build ✅ · 单测 44 ✅ · e2e 10/10 ✅ · v1.9.7)。
- **Phase 6/7/8 暂缓**(理由见各组标题):属"架构偏好"型改动,当前代码可用且有测试覆盖,收益递减、风险递增;留待明确需要时再做。
- **Phase 9 跳过**(可选打磨,价值低)。

## 1. 共享模块(纯新增,零行为变更)

- [x] 1.1 `src/core/constants.ts`:`SIGN_FACES`、`TOKEN_SLOT_OFFSETS`、`MIN_TILE_DIST`、`TAP_MAX_MOVE`、`isSingleCjk`。
- [x] 1.2 `src/render/timings.ts`:`delay`、`BOT`。
- [ ] 1.3 `src/core/bot-policy.ts`:并入 2.8。
- [x] 1.4 `src/core/geometry.ts`:`findTooClosePairs`。
- [x] 1.5 `src/render/svg-util.ts`:`polylinePath`、`svgCoordHelpers`。
- [x] 1.6 `npm test` + `build` 全绿。

## 2. 去重

- [x] 2.1 `SIGN_FACES`(3 处)→ 单一来源。
- [x] 2.2 `TOKEN_SLOT_OFFSETS`(board + animate)。【byTile/slotForPlayer 提取未做】
- [x] 2.3 `MIN_TILE_DIST` + `findTooClosePairs`(loader + editor)。
- [x] 2.4 `polylinePath`(board 主/支路 + animate)。
- [x] 2.5 `svgCoordHelpers`(animate + editor,消除 `svg` shadow)。
- [x] 2.6 `isSingleCjk`(game + ui)。
- [x] 2.7 `delay`/`BOT` → `timings.ts`。
- [ ] 2.8 魔法数字 sweep(ANIM/bot-policy/Tax/Stock/zoom/sideArc)—— 量大,单独一批。
- [x] 2.9 每步全绿。

## 3. 可靠性 bug 修复

- [x] 3.1 `doDraftRoll` n>6 死循环(防御性)。
- [x] 3.2 编辑器 导入/重置丢字段 → `Object.assign`。
- [x] 3.3 CoinFlip `win>=0 && lose<=0` 校验。
- [ ] 3.4 group `"z"` —— 经核实 `groupNames` 未被读取、`groupColor` 已兜底,**非真 bug**(留待清死代码时处理)。
- [x] 3.5 捷径 id → `crypto.randomUUID()`。
- [x] 3.6 overlay 生命周期统一 + `restart` 去冗余。
- [x] 3.7 `lastRoll/lastMove` 不清空不变量 → 新增单测。
- [x] 3.8 全绿。

## 4. 地图加载韧性

- [x] 4.1 `loadDefaultMap` try/catch 降级 + 清坏档(v1.9.4)。
- [x] 4.2 编辑器"试玩"路径 try/catch(已有)。
- [x] 4.3 `migrate(data)` 钩子(v1→v1 passthrough;升版本时在此转换)。
- [x] 4.4 单测:lenient 跳过间距校验、CoinFlip 符号非法抛错。
- [x] 4.5 全绿。

## 5. 死代码与陈旧引用清理

- [x] 5.1 删 `.dice-tray`、`rentFor`、`setText`、board.ts 的 `NS`/`void NS`。
- [x] 5.2 从 `TileType` 删 `Shop/Airport/Jail`(无产生/处理)。
- [x] 5.3 收敛 `SetupPhase` → `"Guohao"|"PickCapital"|"Done"`(删瞬态 DraftRoll/DraftOrder)。
- [x] 5.4 注释对齐:机遇/命运→锦囊/天命、掷骰→抽签、去 ¥。
- [x] 5.5 skip 日志类别 `"buy"` → `"system"`。
- [x] 5.6 全绿。

## 6. 数据驱动扩展(注册表)— 暂缓

> **暂缓理由**:属"未来扩展性"投资,非当前痛点——现有 switch 工作正常且有测试。`onLand` 表会与引擎内部(settleDebt/pushFloater/logEvent)耦合,收益不明确、风险中等。需要时再做。

- [ ] 6.1 `SPECIAL_TILES` 注册表(resolveSpecial + buildGate)。
- [ ] 6.2 `CONSEQUENCE_HANDLERS` 注册表(game/bot/state 三处 switch)。
- [ ] 6.3 `LogEvent.category` CSS 兜底色。
- [ ] 6.4 `coinFlipWins(roll)` 抽出。
- [ ] 6.5 `MIN/MAX_PLAYERS` + playerColor 算法生成。
- [ ] 6.6 `animateDice` 改 seeded 骰。

## 7. 拆分 `render/board.ts` — 暂缓

> **暂缓理由**:`board.ts` 用闭包共享状态(`activeCatalog` 模块级、pan-zoom 的 `vb`、`tokenEls`),"干净拆分"需动闭包,比看起来风险高;在长会话末尾仓促拆容易留下半拆状态。值得做但应单独、专注、fresh context 执行(可配合 subagent + 严格验证)。

- [ ] 7.1 拆为 `board/{svg-root,background,roads,tile,token}.ts`。
- [ ] 7.2 保持 `BoardView` 接口不变。
- [ ] 7.3 全绿。

## 8. 拆分 `render/state.ts` — 暂缓(高风险)

> **暂缓理由**:App 是 god-object,`busy`/`overlay`/`animator`/`engine` 等状态被各方法共享,拆分交叉调用多、回归面大。可降级为只抽 `overlays`(8.1),但整体收益/风险比不划算,留待明确需要。

- [ ] 8.1 抽 `overlay-controller.ts`(最低风险)。
- [ ] 8.2–8.4 抽 setup/turn/input。
- [ ] 8.5 降级:仅做 8.1。
- [ ] 8.6 全绿。

## 9. 编辑器打磨 — 跳过(可选,价值低)

- [ ] 9.1–9.3 防抖 / 内联样式抽类 / 试玩缓存。

## 10. 收尾验证

- [x] 10.1 `npm test`(44)+ `npm run build` 全绿。
- [x] 10.2 `npm run test:e2e`(**20** 全绿:原 10 + 新增 resilience/click/board/editor 各一组,覆盖坏档降级、点城定都、缩放平移、弹窗拖动、编辑器开/重置/试玩)。
- [ ] 10.3 Playwright 起一局人工复核(行为不变)— 由用户实机确认。
- [x] 10.4 bump `src/version.ts`(v1.9.7)。
