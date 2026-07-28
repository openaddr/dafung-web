# map-loading-resilience Specification

## Purpose
TBD - created by archiving change codebase-refactor. Update Purpose after archive.
## Requirements
### Requirement: 无效存档地图降级到内置地图
当 localStorage 中保存的自定义地图校验失败时,系统 SHALL 降级加载内置 `sanguo.json`,并清除失败的存档,绝不因一张坏图阻塞游戏启动。

#### Scenario: 旧版/坏档城池重叠
- **WHEN** localStorage `dafung-custom-map` 里是一张含城池间距 < 最小阈值的旧图,玩家点击"起兵"
- **THEN** 游戏不报错卡死,改为加载内置 `sanguo.json`(39 城),并从 localStorage 移除该坏档,控制台输出一条降级提示

#### Scenario: 自定义地图版本不符
- **WHEN** 存档地图的 `version` 不被当前加载器支持
- **THEN** 系统降级到内置地图并清坏档,而不是抛出未处理异常

### Requirement: 地图加载失败不硬崩溃
任何地图加载源(存档 / 内置 fetch)失败时,系统 SHALL 以可读方式反馈或降级,保持应用可交互(可重开、可进编辑器重置),不出现整屏不可恢复的白屏/异常。

#### Scenario: 内置地图 fetch 失败
- **WHEN** fetch `/maps/sanguo.json` 网络失败或返回非 2xx
- **THEN** 启动流程展示一条可读错误信息(而非抛未处理异常),玩家可刷新重试

### Requirement: 编辑器实时预览容忍中途非法状态
编辑器在拖拽编辑过程中遇到的暂时非法状态(城池过近)SHALL 不阻塞预览渲染;系统 SHALL 以可视化方式标出问题位置,并在地图非法时禁用"试玩"。

#### Scenario: 拖拽中两城过近
- **WHEN** 编辑者把一座城拖到距另一座 < 最小阈值的位置
- **THEN** 棋盘仍然渲染(宽松加载),相关城池以红圈高亮,"试玩这局"按钮禁用并提示"地图无效"

#### Scenario: 试玩非法地图被阻止
- **WHEN** 地图存在校验错误时点击"试玩"
- **THEN** 试玩按钮处于禁用态,无法进入对局

### Requirement: 间距校验单一来源
地图最小间距阈值(防止 UI 重叠)SHALL 在加载器与编辑器之间共用同一常量/函数,避免两处各写一套产生分歧。

#### Scenario: 加载器与编辑器阈值一致
- **WHEN** 加载器判定"过近"的阈值被调整
- **THEN** 编辑器的重叠高亮采用同一阈值,二者判定结果一致

