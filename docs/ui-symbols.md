# 古风符号表(S6,2026-08-16)

> 目的:全项目 UI 符号「一用途一符号」,杜绝 ♪/♫、⌖/◎ 之类近义混用。
> 新增 UI 一律查此表取符号;要加新用途先在此登记。

## 符号表(每用途 1 个符号)

| 用途 | 符号 | 说明 |
| --- | --- | --- |
| 返回 | `←` | 所有「返回/回退」按钮统一(EditorScreen、TreasureVisitorScroll 已一致) |
| 撤销 | `↶` | 仅编辑器 |
| 重做 | `↷` | 仅编辑器;与撤销成对 |
| 复位/归位 | `◎` | 圆心印感,表「归中复位」。GameScreen 总览复位 ⌖→◎(2026-08-16) |
| 静音(开音) | `♪` | 有声状态 |
| 已静音 | `♪̶` | ♪ + U+0336 组合删除线。GameScreen ♪/♫ 混用→♪/♪̶(2026-08-16) |
| 播放/试玩 | `▶` | 编辑器「试玩这局」 |
| 双向通行(驿道) | `⇄` | 棋盘辅路入口记号(StaticLayers) |
| 珍宝 | `◆` | 手牌珍宝行(HandPanel),金色 |
| 关闭 | `×` | 卷轴标题栏关闭钮(ScrollShell) |
| 单字印章 | 掷/置/扩/税/济/通/宝/禁/卖/胜/纪/天 | 战报事件章(WarlogPanel,W1 已定,非几何符号体系) |

## 本次替换记录(react-rewrite,2026-08-16)

- `src/app/screens/game/GameScreen.tsx`:静音 `♪/♫` → `♪/♪̶`;复位 `⌖` → `◎`

## 遗留清单(他人文件,本批不许碰——**盘点结论:均已符合本表,无需替换**)

| 文件:行 | 现符号 | 表内符号 | 结论 |
| --- | --- | --- | --- |
| src/app/screens/editor/EditorScreen.tsx:474 | ← | ← | 一致 |
| src/app/screens/editor/EditorScreen.tsx:475 | ↶ | ↶ | 一致 |
| src/app/screens/editor/EditorScreen.tsx:476 | ↷ | ↷ | 一致 |
| src/app/screens/editor/EditorScreen.tsx:602 | ▶ | ▶ | 一致 |
| src/app/screens/game/scroll/TreasureVisitorScroll.tsx:112 | ← | ← | 一致 |
| src/app/screens/game/scroll/ScrollShell.tsx:105 | × | × | 一致 |
| src/app/components/board/StaticLayers.tsx:118 | ⇄ | ⇄ | 一致 |
| src/app/screens/game/HandPanel.tsx:84 | ◆ | ◆ | 一致 |

> 唯二的历史不一致(♪/♫、⌖)都发生在 GameScreen(本批独占文件)内,已随本批清零;
> 其余文件盘点后无漂移,后续新增 UI 以本表为准。
