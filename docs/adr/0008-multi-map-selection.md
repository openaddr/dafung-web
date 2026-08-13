# 多地图选择架构:混合来源 + 清单文件 + 统一加载入口 + 联机 mapId 协议

项目已把地图抽为运行时 fetch 的数据文件,但始终只有一张 `sanguo.json`,加载路径在设置屏/编辑器/联机入口三处硬编码;编辑器保存的自建图静默覆盖 sanguo,想换回原版只能清 localStorage。地图机制的扩展性未被利用。本 ADR 记录"加多地图选择"时做出的、难逆转且无上下文会意外的架构决策。

## 决策

### 1. 混合来源:内置图 + 自建图,菜单统一呈现
内置图(随版本打包、不可改)与自建图(localStorage、可编辑)在「选择地图」菜单里并列,不按来源分页。废除旧的"自建图自动覆盖 sanguo"逻辑。

**为何**:自建图编辑保存后若不能在菜单再选,会成 UX 死胡同(存了就永远覆盖,想换回原版得手动清 storage)。统一进菜单让编辑器产物有归宿,逻辑闭环。

### 2. 清单文件作为内置图唯一发现机制
浏览器无法列目录,内置图靠一个清单文件(JSON 数组,每条含 id/name/file/desc/tileCount/targetNetWorth)发现。加新内置图 = 放 JSON + 改清单文件,**无需 rebuild、无需改代码**。客户端与联机服务器读**同一份**清单(服务器已静态托管构建产物,运行时可访问 maps 目录)。

**为何**:项目核心理念是"改 maps/*.json 后刷新即生效,无需 rebuild"(见 main.ts 加载注释)。若清单写死在代码里,加图就要 rebuild,破坏这一致性。同一份清单避免客户端/服务器漂移。

### 3. 统一加载入口 `loadMapById(id)` + 可注入地图源
引入 `loadMapById(mapSource, id)` 取代 `loadDefaultMap` 及所有硬编码 `/maps/sanguo.json` fetch。按 id 分流:内置 → 查清单得 file → fetch → `loadMap`;自建 → localStorage 图库查 data → `loadMap`。

"取数据"动作(fetch / localStorage)抽成**可注入的 MapSource 接口**,core 层只定义接口与编排;实际 fetch/localStorage 实现在 core 之外。单测用内存 MapSource。

**为何**:① 清理 3 处硬编码,加载逻辑收口一处;② 符合架构红线(core 零 DOM/浏览器 API,CLAUDE.md 红线 1)——若 `loadMapById` 直接调 fetch/localStorage,core 就耦合了浏览器 API,阻断联机化(core 要能搬服务器);③ 可注入让单元测试无需 mock 全局 fetch。选图时只存 id、起兵时才真正加载(延迟加载,避免反复切换触发多次 fetch)。

### 4. 联机选图:仅内置图,大厅设图,mapId 广播
联机模式支持选图,但**只支持内置图**(自建图跨设备 localStorage 不可达)。建房 API(`/room/new`)不变;Host 在大厅选图;新增设图端点;`/room/start` 校验已选图;lobby 广播增 mapId 字段;非 Host 客户端按 mapId 自己 fetch 内置图渲染(服务器不推完整地图 JSON)。

**为何**:① 自建图联机需"客户端上传地图到服务器"这条全新链路(上传/存储/校验/分发/信任),是独立特性,不塞进本次;② 建房不涉图、开局才构造引擎与现状一致(引擎在 `/room/start` 构造),协议向后兼容;③ 非 Host 自取而非服务器广播——内置图本就托管在服务器静态目录下,每客户端自取比广播 N 份省带宽,且复用 `loadMapById` 内置分支,代码统一;④ Host 掌开局前管理权(CONTEXT.md Host 定义),选图归 Host,非 Host 只读显示。

## 与既有 ADR 的关系
- **ADR-0001(中心权威服务器)**:成立——地图仍在服务器侧为每个房间加载构建,客户端不裁决。
- **ADR-0007(Room 模块抽离)**:成立——设图逻辑进 RoomRegistry(深模块),HTTP 路由是薄适配器。
- **CLAUDE.md 架构红线 1(core 零 DOM)**:本决策的"可注入 MapSource"正是为此服务。

## 不选的方案
- 清单写死在代码里(加图要 rebuild,违背刷新即生效理念)。
- 联机广播完整地图 JSON(WS 消息体陡增,且复用现有静态托管即可)。
- localStorage 自建图做存档迁移(项目无已发布版本,无真实存档,迁移是伪需求)。
