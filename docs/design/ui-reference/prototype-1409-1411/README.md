# 三类卡牌画心比选

[打开原型索引](index.html)。三项都能切换现状、A、B，也可以直接打开 PNG 对照图。游戏场景以 844×390 为基准。

| 工单 | 可点原型 | 直接看图 |
| --- | --- | --- |
| [#1409 珍宝与技能书](https://github.com/openaddr/dafung-web/issues/1409) | [打开](treasures/index.html) | [PNG](treasures/compare.png) |
| [#1410 锦囊](https://github.com/openaddr/dafung-web/issues/1410) | [打开](jinnang/index.html) | [PNG](jinnang/compare.png) |
| [#1411 机遇](https://github.com/openaddr/dafung-web/issues/1411) | [打开](encounters/index.html) | [PNG](encounters/compare.png) |

基线为 `662bb00d2f45cc116dfe2284f7d6692b39dd354c`。共同画材采用 [#1408 的 B 案](https://github.com/openaddr/dafung-web/issues/1408#issuecomment-7032993454)。合适的器物照片可保留，需讲清行动或事件时用故事画心。三项只比较画心的题材、识读与占地，原型交互用于呈现场景。

## 实施覆盖核对

- 珍宝从 `TREASURES` 导出，应核 16 项，算筹和青梅目前缺画心。技能书由 `makeSkillBook` 按技能即时生成，覆盖清单按书型和真实技能名变化核对。手册静态目录与局内持有分开验收。
- 锦囊从 `JINNANG_CARDS` 导出，应核 9 项。先辨清三对共用族图的锦囊，再核军情密探、横征暴敛与求贤令。对照时在同一套纸底、牌框和族章内比较，查看无标题、小牌与详情三种读图状态。
- 机遇从 `ENCOUNTERS` 导出，应核 60 项。好运 21、中性 16、霉运 23。29 项有选择，31 项即时。13 项奇遇由 `isOncePerGameEncounter` 判定，与档位独立。验收时核对手册和卷轴是否以同一事件 id 找图，并核实纸底正文、真实选项、不可用理由、档位和奇遇形制均可读。
