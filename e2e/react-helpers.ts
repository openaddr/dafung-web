// ──────────────────────────── e2e 共享工具门面(#1255,ADR-0059 决策 5)────────────────────────────
// 本文件不再是实现体——测试公共能力已按四层归位 e2e/helpers/(契约头注见各文件):
//   drivers.ts  桥调用封装(plant/callEngine/种局推进链 seedSolo 族)——回合驱动,消费 registry.ts
//               桥面(seedSoloToRound/瞬空钉/时钟闸);
//   scenes.ts   场景构造(quickStart 五态+开局链/种植件/联机选都)——四层顶上的组合;
//   settle.ts   沉降谓词族(waitSettled/waitFxIdle/parkMyTurn/waitMyPause/waitMyRollDone
//               +时钟冻结缝);
//   patrol.ts   巡检(读数 snap/engineState/fmtMoney+清决策点 actIfCan/skipUntilNextSeat
//               +应答代发件/反应窗流程族)——四层底座。
// 依赖单向:scenes → drivers → settle → patrol(无环,四层间无循环 import)。
// 本门面=旧路径逐名 re-export,全部调用点(41 个 spec)零改动——expand-contract 的
// expand 半;收缩不做,留给迁移波自然发生(新代码直接 import e2e/helpers/<层>)。
// 选择器纪律不变:全部走各屏 testids.ts 单源(check:e2e-testids 扫本文件与 spec)。
export { newBridgeContext, waitForEngine } from "./helpers/drivers";
export {
  quickStart,
  pickCapital,
  openSoloSetup,
  disableEncounters,
  useHalfScale,
  plantDemolishableCity,
  onlinePickCapitals,
} from "./helpers/scenes";
export {
  waitFxIdle,
  waitSettled,
  waitForSnapChanged,
  waitMyRollDone,
  waitMyPause,
  parkMyTurn,
  freezeClock,
  unfreezeClock,
} from "./helpers/settle";
export {
  snap,
  engineState,
  fmtMoney,
  actIfCan,
  dismissJinnangIfUp,
  skipUntilNextSeat,
  awaitReactionWindow,
  answerReactionWindow,
  answerMarchCounter,
  pollReactionSettled,
} from "./helpers/patrol";
export type { ReactionBaseline, ReactionSettle, ReactionAnswer } from "./helpers/patrol";
