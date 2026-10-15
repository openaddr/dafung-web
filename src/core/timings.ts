// 回合节奏单源(#399 单机统一 C):房间编排侧固定节拍的唯一定义处。
// 此前三处手抄:watchdogs.ts 的 AUTO_ROLL_DELAY_MS、bot-driver.ts 的 AUTOPILOT_SLOW_MS、
// src/app/fx/timings.ts 的 AUTO_MARCH 缩放镜像——「改任一侧须两处同改」的注释纪律收口为
// 全局恰一处:core 纯常量,联机权威侧(scripts/watchdogs|bot-driver)与单机进程内房间
// (同一份编排)同读本表。
// 命名注:本文件是「回合节拍」(wall-clock 节奏);src/core/timing.ts(单数)是时机总线
// (moment 派发框架),二者不同域。e2e 时间倍率不进本表:scripts 不吃浏览器 localStorage
// 倍率,权威节奏单机/联机同值(E2E_TIME_SCALE 只缩放演出编排,见 src/app/fx/timings.ts)。

/** 人类回合 Roll 相位自动起摇延迟(#188 第 1 步):Roll 无决策内容,服务器定时代发
 *  rollAndMove(与手点同一条命令路径);客户端起签表现为纯本地演出,不受此值影响。 */
export const AUTO_ROLL_DELAY_MS = 1000;

/** 慢速托管:每步决策间隔(ms)——玩家看得清 bot 在做什么。 */
export const AUTOPILOT_SLOW_MS = 2000;

/** 快速托管:每步决策间隔(ms)——下限节流(#529)。快档若零延迟,整条托管链在单个
 *  宏任务里同步瞬通(实测 273ms 直落终局):误触即终局,且「收回/切速」命令只能排队
 *  到链尾,中途不可撤销。40ms 让每步经注入时钟 setTimeout 让出宏任务——命令得以在
 *  步间落地,链在下一步的 seatControlled 复查处可停(切回即停);整局 ≈ 40ms × ~210 步
 *  ≈ 8-10s。权威节奏不吃 E2E_TIME_SCALE(见文件头)。 */
export const AUTOPILOT_FAST_MS = 40;
