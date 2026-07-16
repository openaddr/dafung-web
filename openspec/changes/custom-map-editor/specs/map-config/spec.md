## ADDED Requirements

### Requirement: 地图 JSON 数据格式
系统 SHALL 用单一 JSON schema 描述完整地图:顶层含 `version`、`targetNetWorth`、`startingCash`;`tiles` 为有序数组,每项含 `id`/`name`/`pos`/`group`/`region` 与价格字段;`shortcuts` 每项含 `from`/`to`/`consequence` 与可选 `waypoints`。`tiles` 数组顺序 SHALL 同时表示主路行进顺序与相邻关系。

#### Scenario: 内置地图可序列化为该 schema
- **WHEN** 从内置三国地图导出
- **THEN** 生成合法 JSON,含 30 个 tiles(顺序=主路环)、5 条 shortcuts、版本号与参数

#### Scenario: tiles 顺序即主路
- **WHEN** loader 读取 JSON 构建棋盘
- **THEN** 主路相邻关系为 tiles[i-1]↔tiles[i]↔tiles[i+1](首尾闭合),与数组顺序一致

### Requirement: 地图加载与强校验
系统 SHALL 在加载任意地图 JSON 时执行校验:版本号存在且受支持;tiles 非空且 pos 不完全重叠;shortcuts 的 from/to 引用有效 tile 且 from≠to;价格/升级/buildCost 为非负数。校验失败 SHALL 抛出可读错误且不创建棋盘。

#### Scenario: 合法 JSON 正常加载
- **WHEN** 加载符合 schema 的 JSON
- **THEN** 成功构建 Board 并可进入对局

#### Scenario: 损坏 JSON 不崩
- **WHEN** 加载缺字段 / 端点无效 / 坐标重叠的 JSON
- **THEN** 不抛未捕获异常,UI 显示具体错误,回退到内置地图或停在导入界面

### Requirement: 统一避城路线算法
系统 SHALL 对所有边(主路段与捷径)默认使用同一「避城算法」计算路线途经点:在两个候选弧线方向中,选择离其他城池更远的那个,使路线尽量不穿过非端点城池。

#### Scenario: 主路长边绕开中途城池
- **WHEN** 主路相邻两城距离大于阈值且直线会贴近第三座城
- **THEN** 绘制与行军路径使用远离该城池的弧线途经点

#### Scenario: 短边走直线
- **WHEN** 相邻两城距离小于阈值
- **THEN** 不插入途经点,直接直线连接

### Requirement: 边 waypoints 手动覆盖
系统 SHALL 允许任一边在 JSON 中携带可选 `waypoints`;若提供,SHALL 优先使用它作为该边的路线途经点,跳过自动避城结果。

#### Scenario: 提供 waypoints 时按手配走
- **WHEN** 某条 shortcut 带有 `waypoints`
- **THEN** 该捷径的绘制与行军路径使用这些 waypoints

#### Scenario: 不提供时自动
- **WHEN** 某条边不带 `waypoints`
- **THEN** 使用自动避城算法结果

### Requirement: 导入自定义地图
系统 SHALL 支持玩家在应用内导入本地 JSON 文件作为自定义地图,导入后经校验即可用于开局。

#### Scenario: 导入合法地图后可开局
- **WHEN** 玩家选择一份合法 JSON 并确认导入
- **THEN** 该地图进入「自定义地图」列表,可用它开局

#### Scenario: 导入非法文件被拒
- **WHEN** 玩家选择的 JSON 校验失败
- **THEN** 提示具体错误,不加入列表

### Requirement: 导出地图为 JSON
系统 SHALL 支持把当前地图(内置或自定义)导出为 JSON 文件下载,内容符合加载 schema,可用于分享与备份。

#### Scenario: 导出当前地图
- **WHEN** 玩家在地图选择或编辑器中点「导出」
- **THEN** 浏览器下载一份完整 JSON,内容可被本应用重新导入并还原同一地图
