## 变更说明

<!-- 一两句话说清做了什么、为什么 -->

## 自检清单

- [ ] `bun run typecheck` 与 `bun test` 通过(涉 UI 变更另跑 `E2E_WORKERS=2 bun run test:e2e`)
- [ ] 玩家可见机制变动?已回填 `docs/reference/rules/` 对应页(见 AGENTS.md 完成定义)
- [ ] 新术语已登记 `CONTEXT.md`(无新增术语可跳过)
- [ ] README 文档地图与受影响文档链接有效(无死链)
- [ ] 遵守架构红线(core 零 DOM / 引擎 player-agnostic / 状态走公共方法)
