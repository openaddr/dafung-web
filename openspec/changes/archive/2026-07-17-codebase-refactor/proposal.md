## Why

dafung-web 经过多轮迭代(城池规模分档、机遇/命运、货币进制、棋盘缩放平移、地图编辑器、签筒/锦囊主题化等),代码积累了技术债:

- **重复**:骰面/签字同时存在于 `render/animate.ts` 与 `render/state.ts`;棋子同格错位偏移量 `[-22,-8]…` 同时存在于 `render/board.ts`(updateTokens)与 `render/animate.ts`(animateMove);最小间距(80)校验逻辑同时存在于 `core/board-loader.ts` 与 `render/editor.ts`(overlappingTiles)。
- **大文件职责过载**:`render/board.ts`(~470 行,SVG 画布 + 城池图标 + 道路/地形 + 缩放平移 + tile/token 更新全在一起)、`render/state.ts`(~490 行,App 上帝对象)。
- **魔法数字散落**:viewBox、城池 base 尺寸、字号、棋子偏移、动画时长、MIN_DIST、缩放上下限等硬编码各处。
- **陈旧引用**:未用的 `.dice-tray` CSS、以及指向已删除/改名特性的"机遇/命运""掷骰""¥""jail/shop/airport"等注释与命名。
- **可靠性短板**:地图校验直接 `throw`,曾把用户 localStorage 里的旧图卡死(v1.9.4 已热修),暴露了缺少降级兜底。

需要在**不改变玩法行为**的前提下,合并去重、拆分大文件、抽常量、清死代码、加兜底,让代码更可靠、更易扩展。

## What Changes

- **合并去重**:骰面/签字、棋子同格错位、最小间距(80)等重复常量与逻辑统一到单一来源(共享常量模块);`overlappingTiles` 与加载器校验共用同一阈值/函数。
- **拆分大文件**:`render/board.ts` 按职责拆分(SVG 画布 / 城池图标绘制 / 道路与地形 / 缩放平移相机 / tile&token 更新);`render/state.ts` 的 App 拆出回合调度、弹窗、选都等关注点。
- **抽魔法数字为命名常量**:viewBox、城池 base 尺寸/字号、棋子偏移、动画时长、MIN_DIST、缩放上下限等集中命名。
- **清死代码与陈旧引用**:移除未用的 `.dice-tray` 等;把"机遇/命运""掷骰""¥""jail/shop/airport"等注释/命名与现状对齐。
- **加兜底/可靠性**:地图加载失败一律降级到内置图并清坏档(v1.9.4 已部分实现,本次**固化为规范**并扩展到编辑器/试玩路径);统一错误处理与可读错误信息。
- **增强扩展性**:内容更数据驱动(TileType / 事件类别 / 货币档位 / 捷径后果等枚举与表集中),减少硬编码,便于后续加城池、加格子类型、加事件。

纯内部重构,无玩法行为变更;唯一对外行为变化是"坏图不再卡死游戏"(向下兼容)。无 **BREAKING**。

## Capabilities

### New Capabilities
- `map-loading-resilience`: 地图加载的韧性——自定义/存档地图校验失败时,降级到内置地图、清除坏档、绝不硬崩溃;编辑器实时预览与试玩路径容忍中途非法状态。把 v1.9.4 的兜底固化为规范,并为后续更多校验/更多加载源打基础。

### Modified Capabilities
<!-- openspec/specs/ 当前为空(无已提交 capability),故无修改项。custom-map-editor 的 map-config/map-editor 规约尚未归档,不在本次修改范围。 -->

## Impact

- **代码**:几乎覆盖整个 `src/`(重点 `render/board.ts`、`render/state.ts`、`core/` 常量与枚举、`render/editor.ts`、`main.ts`)。
- **依赖/API**:无外部依赖变更;`window.__dafung` 调试面、`loadMap(data, opts?)` 签名保持兼容。
- **测试**:现有单测(41)与 e2e(10)应保持全绿(行为不变);新增少量针对共享常量与降级路径的单测。
- **风险**:文件拆分会移动大量代码——需保证导入路径、`window.__dafung`、`loadMap` 签名不变;分阶段实施,每阶段跑 `npm test` + `npm run build` + 关键 e2e。
