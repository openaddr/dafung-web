# UI 参考图库(ui-reference)

服务于「锦囊牌/手牌区 UI 改造」的参考素材库。母报告:`docs/design/锦囊牌UI优化方案.md`。
逐图来源登记在同目录 `manifest.jsonl`(一行一张:`file/query/title/source`)。

> ⚠ **版权口径**:网图目录(`sanguosha/ cardgame/ monopoly/ uidesign/`)是**从网上采集的他人游戏截图,仅供本团队内部设计参考,禁止提交进 git、禁止用于任何对外发布的素材**。开源素材目录(`opensource-assets/`)按各仓库 LICENSE 同样仅作参考。`current-ui/` 是本项目自己的截图,可入库;`opensource-assets/` 同样不入库。

## 目录

| 目录                 | 内容                                                                                                                                                                                                                                                                                              | 来源                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `current-ui/`        | 现状 master 基线截图(2026-09-23):首页/配置/大厅/选都卷轴/军师幕/棋盘全景/购地卷轴                                                                                                                                                                                                                 | 本项目 `tmp/shot-ui2026.mjs` 拍摄                                                                     |
| `opensource-assets/` | 无名杀、FreeKill 的牌框/牌背/体力/背景素材精选(11 张,器物参考,不逐张登记 manifest)——**与网图同口径,仅本地参考、不入库**(部分素材可能含官方商用美术,如 cardback-official)                                                                                                                          | 克隆仓库直拷,见子目录                                                                                 |
| `sanguosha/`         | 三国杀系官方界面/手牌区/牌面 22 张(2026-09-23 人工核对);`noname-live/` 无名杀本地构建实机截图 10 张(响应窗/目标选择/详情浮层等)                                                                                                                                                                   | 顶层为 Bing 图片采集(经 th.bing.com 代理);`noname-live/` 为本地实测,复现见 `research-sanguosha.md` §6 |
| `prototype-layout/`  | **对局屏布局重构定稿原型**(v3.2,#244 验收基线):自包含单页五分区(常态/军师窗态/目标段/解剖与去向/8 人降档)+ 定稿基线截图 8 张(manifest 已登记)。窄屏/短横屏票的降档口径参照此件。**看原型**:直接浏览器打开可读,笔刷字体需把 `public/fonts` 映射到 `/fonts`(如 `python3 -c` 起带映射的 http.server) | 本项目自制(用户逐屏走查定稿,2026-09-25)                                                               |

> ⚠ **2026-09-24 批量采集失败记录**:headless Bing"现搜现下"批次(cardgame/monopoly/uidesign 三类 160 张)抽样审计**废图率约九成**(搜索结果页低质混杂,下载闸门救不了相关性),经用户确认**已整批删除**,不入图库。图库可信核心 = sanguosha 22 + noname-live 10,视觉走查结论见 `research-cardgame.md` §3。**教训**:采集必须"现搜现筛"(人工核对),批量过夜路线(ID 隔夜过期 404)与无核对的批量现搜(低相关)都不可用;配套的死管线脚本(jobs 文件/fetch-batch/总控)已一并清除,仅保留单主题工具 `tmp/fetch-ref-images.mjs`(供将来人工核对式采集复用)。
> | `research-sanguosha.md` | 无名杀 + FreeKill 手牌区/主界面**代码**调研 | 见文内仓库路径引用 |
> | `research-cardgame.md` | 开源卡牌/大富翁游戏(OpenDuelyst/hearthstone.js/rich4 等)代码调研 | 同上 |
> | `research-layout-redesign.md` | 对局屏布局重构调研:无名杀/FreeKill 席位框解剖、槽位查表、expandPile、>8 人缩放算法 | 同上(参照仓 clone 到 `~/code/`;FreeKill 用 gitee 镜像 NaisuYa/FreeKill) |

> **current-ui 时效口径**:`current-ui/` 现存 7 张摄于 2026-09-23(布局重构**前**的历史基线,含已退役的军师幕弹窗/右栏);现状以 `prototype-layout/` 基线截图与实机为准,历史系列仅作改造前后对照留档。

## 采集管线备忘(2026-09-23,本机网络受限下验证)

发现走 `web_reader` MCP(服务端带 JS 渲染,只收纯 ASCII URL,空格用 `+`);
下载走 `th.bing.com/th/id/OIP.<id>?w=<原宽>&h=<原高>&rs=1&pid=ImgDet`(本地可达但间歇抖动,需 3-5 次重试)。
`tmp/fetch-ref-images.mjs` 是单查询脚本(本机 Playwright 路线,因 HTTP/2 被中间设备掐断仅部分可用,主路线是 web_reader)。
