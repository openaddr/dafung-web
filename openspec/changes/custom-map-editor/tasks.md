## 1. 阶段 0:地图数据 JSON 化(数据层,独立可交付)

- [x] 1.1 在 `src/core/types.ts` 定义地图 JSON schema 类型(`MapData`: `version`/`targetNetWorth`/`startingCash`/`tiles[]`/`shortcuts[]`)
- [x] 1.2 把 `boards-data.ts` 的 30 城 + 5 捷径 + 参数序列化为 `maps/sanguo.json`,内容与当前完全一致
- [x] 1.3 新增 `src/core/board-loader.ts`:fetch JSON → 校验(版本受支持 / tiles 非空 / pos 不重叠 / shortcut 端点有效且 from≠to / 数值非负)→ 构建 `TileDef[]`+`ShortcutDef[]` → `createBoard`;校验失败抛可读错误
- [x] 1.4 `types.ts`:`TileDef`/`ShortcutDef` 增加可选 `waypoints` 字段;shortcut 的 from/to 支持用 tile id 引用(loader 解析为 index)
- [x] 1.5 `board.ts`:把 `edgeWaypoints` 改用与 `sideArc` 同款避城算法(两候选方向取离其他城池更远者);`computePath` 与绘制优先使用边自带 `waypoints`
- [x] 1.6 `main.ts` 改为加载内置 `maps/sanguo.json`(用 ES import 同步加载,内置必加载故无需 loading/回退;自定义地图的 fetch 在编辑器阶段)
- [x] 1.7 单测:补 loader 校验(合法 JSON + 各类非法)与避城算法的单元测试
- [x] 1.8 回归:41 单测(含新增 12 条 loader/避城)+ 9 e2e 全绿,内置地图视觉与玩法不变

## 2. 阶段 1:编辑器 MVP(城池/属性/主路 + 持久化)

- [x] 2.1 主菜单加「编辑地图」入口;编辑器与对局模式独立切换、互不破坏状态
- [x] 2.2 编辑器骨架:复用棋盘 SVG 渲染层,叠加编辑态交互(选中/拖拽)
- [x] 2.3 城池位置拖拽:长按拖动城池改 pos,拖拽中隐藏路线,松手后重算避城并显示
- [x] 2.4 侧栏属性面板:编辑 name/group/region/price/upgrade/buildCost,实时反映到棋盘
- [x] 2.5 主路顺序编辑(暂以「拖拽改位置 + 导入导出整图」覆盖;列表式增删/排序留后续打磨)
- [x] 2.6 自定义地图 localStorage 存取(「保存」按钮写 localStorage,进入编辑器时优先加载已存)
- [x] 2.7 导入 JSON 文件 / 导出 JSON 下载(编辑器 toolbar 按钮;导入经 JSON.parse 替换、rerender)
- [x] 2.8 用编辑出的自定义地图开局试玩(编辑器「▶ 试玩这局」按钮 → loadMap 当前 mapData → App 默认 2 人开局)

## 3. 阶段 2:捷径与路线精修

- [x] 3.1 捷径编辑:在编辑器 panel 选 branch→rejoin + 代价(FixedCost)+ 加/删,棋盘自动绘制支路
- [x] 3.2 路线 waypoints 编辑:捷径控制点 panel(中点加 / 坐标列 / 删;loader 用手配 waypoints 覆盖 sideArc)
- [x] 3.3 编辑器内实时校验高亮(重叠城红圈高亮;环/端点/数值错误文字提示)
- [x] 3.4 校验失败时禁用「试玩」按钮并显示「地图无效」(loader 校验:环/坐标重叠/端点/数值)

## 4. 阶段 3:深度功能(可选,按需推进)

- [x] 4.1 撤销 / 重做(编辑历史栈:每次 rerender commit 快照,「↶ 撤销」恢复上一态)
- [ ] 4.2 事件格(Chance/Fate)编辑——依赖这些格子游戏行为先落地(暂搁置)
- [x] 4.3 编辑器内直接试玩(编辑器「▶ 试玩这局」按钮,不切回主菜单)
- [x] 4.4 内置地图「另存为自定义」继续编辑(编辑器入口加载内置/已存,编辑后「保存」写 localStorage)
- [x] 4.5 地图平衡提示(panel 显示城数/捷径数/总价/单城价格范围)
