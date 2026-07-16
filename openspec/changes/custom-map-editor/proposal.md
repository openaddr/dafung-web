## Why

当前地图数据硬编码在 `src/core/boards-data.ts`(TypeScript),改任何一座城池/路线都要改代码并重新构建,玩家也无法自定义。把地图数据外部化为 JSON、再提供应用内可视化编辑器,既能**让玩家造并分享自定义地图**(重玩性 / 社区),也能**让内部维护变成「改 JSON 即改地图」**(我帮你改地图时也好定位),是这类大富翁游戏长线生命力的关键基础设施。

## What Changes

- **地图数据外部化**:把 `boards-data.ts` 的城池/捷径/参数抽到 `maps/*.json`(内置三国地图转为 `maps/sanguo.json`)
- **加载器 + 强校验**:新增 `board-loader.ts`,fetch JSON → 校验(主路环闭合 / 坐标不重叠 / 数值合法 / shortcut 端点有效 / 校验版本号)→ `createBoard`;不合法时给明确报错
- **路线算法统一并升级**:`edgeWaypoints`(主路)改用 `sideArc` 同款「避城算法」(选离其他城池更远的弧线方向),主路也不再穿过别的城;边支持可选 `waypoints` 字段,用户手配时覆盖自动结果
- **应用内地图编辑器**(新模式):可视化拖拽城池位置、侧栏编辑属性(名/价格/分组/区域/buildCost/补给)、主路列表排序、画捷径(branch→rejoin)、路线控制点拖拽
- **导入 / 导出**:可在应用内加载自定义 JSON 文件开局;可把当前地图(内置或编辑中的)导出为 JSON 文件下载,用于分享与版本备份
- **持久化**:自定义地图存 `localStorage`,主菜单加入口(「编辑地图」/「导入地图」)
- 实现按阶段推进(数据层先行,编辑器 UI 其后),见 `tasks.md`

## Capabilities

### New Capabilities
- `map-config`:地图 JSON 数据格式、加载与校验、统一避城路线算法、可选边 waypoints、导入/导出
- `map-editor`:应用内可视化地图编辑器(编辑城池/路线/属性,保存到 localStorage,导入/导出 JSON)

### Modified Capabilities
<!-- dafung-web 目前无 openspec/specs,全部为新增能力 -->

## Impact

- `src/core/boards-data.ts` → 拆为 `maps/sanguo.json` + `src/core/board-loader.ts`
- `src/core/board.ts`:`edgeWaypoints` 改用避城算法(与 `sideArc` 统一);`computePath` 支持边自带 waypoints
- `src/core/types.ts`:`TileDef`/`ShortcutDef` 增加可选 `waypoints` 字段;地图 JSON 顶层加 `version`/`targetNetWorth`/`startingCash`
- 新增 `src/render/editor/`(编辑器 UI,复用棋盘 SVG 渲染层)
- `src/render/state.ts` / `src/main.ts`:改为 async 加载地图;主菜单加编辑器/导入入口
- 校验失败必须可读报错(不能让坏 JSON 崩游戏)
- 现有规则逻辑(`game.ts`、`computePath`)尽量不动,改动集中在数据层与渲染/编辑器层
