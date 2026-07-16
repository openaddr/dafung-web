## ADDED Requirements

### Requirement: 编辑器入口
系统 SHALL 在主菜单提供「编辑地图」入口,进入可视化地图编辑器模式;编辑器与对局模式相互切换,互不破坏各自状态。

#### Scenario: 从主菜单进入编辑器
- **WHEN** 玩家在主菜单点「编辑地图」
- **THEN** 进入编辑器,显示当前选中地图(默认内置或上次编辑的自定义地图)

### Requirement: 城池位置拖拽编辑
系统 SHALL 允许在编辑器中用指针拖拽任意城池改变其 `pos`;拖拽时该城相关的边路线 SHALL 实时按避城算法重算。

#### Scenario: 拖动城池更新位置与路线
- **WHEN** 拖动一座城池到新坐标
- **THEN** 该城 pos 更新,与之相邻的边路线实时刷新

### Requirement: 城池属性编辑
系统 SHALL 在编辑器提供侧栏属性面板,可编辑选中城池的 name / group / region / price / upgrade / buildCost 等字段。

#### Scenario: 改价格即时反映
- **WHEN** 在属性面板修改某城购入价
- **THEN** 棋盘上该城价格标签与底层数据同步更新

### Requirement: 主路顺序编辑
系统 SHALL 允许调整 tiles 的数组顺序(进而改变主路相邻关系),例如通过列表拖拽排序或增删城池;顺序变更 SHALL 保持主路环闭合。

#### Scenario: 在两城间插入新城
- **WHEN** 在主路 A 与 B 之间插入新城 X
- **THEN** 主路变为 A→X→B,X 相邻 A 与 B

### Requirement: 捷径编辑
系统 SHALL 允许在编辑器中创建或删除捷径:指定 branch 城与 rejoin 城,并配置后果(FixedCost 或 CoinFlip)。

#### Scenario: 新建一条捷径
- **WHEN** 选定 branch 城与 rejoin 城并设置后果
- **THEN** 生成一条新捷径,棋盘绘制对应支路线

### Requirement: 路线 waypoints 编辑
系统 SHALL 允许对任一边进行路线精修:双击边可添加控制点、拖拽控制点调整路径;编辑结果 SHALL 作为该边的 `waypoints` 保存。

#### Scenario: 手动绕开冲突
- **WHEN** 某条自动路线穿过其他城池,玩家添加控制点绕开
- **THEN** 该边 waypoints 保存,路线按手配绘制

### Requirement: 编辑器持久化
系统 SHALL 把编辑中的自定义地图保存到 localStorage,并支持新建 / 另存 / 加载 / 删除自定义地图。

#### Scenario: 刷新后恢复
- **WHEN** 玩家编辑地图后刷新页面再进入编辑器
- **THEN** 上次编辑的自定义地图恢复

### Requirement: 编辑器内导入导出
系统 SHALL 在编辑器内提供与全局一致的导入/导出能力(见 map-config),用于分享编辑成果或加载他人地图继续编辑。

#### Scenario: 编辑后导出分享
- **WHEN** 玩家完成编辑点「导出」
- **THEN** 下载该自定义地图 JSON,可被其他玩家导入
