// 事件消费档位表(#430,ADR-0020 事件流):每个事件 kind 的消费档位登记——判定决策
// 从注释散文(net/event-fold.ts 文件头判定表、fx/event-extract.ts 尾注)升为机器可查
// 数据,折叠面与表现面两消费器对表穷尽(缺档位=编译期红);同表单源双消费器共享的
// 批上下文取数(宣布游标型 + 名将和主动技目录回查 + 座位契约校验,原 fold/extract
// 成对 helper 的单源化,错误文案不再分叉)。
//
// ── 消费档位词汇(#430 票面五档的坐标化:fold 面 × fx 面两格)──
//   fold 面(net/event-fold.ts 消费):
//     must-fold        精确折:折叠落账即精确,无已知漂移;
//     fold+calibration 折+校准双覆盖:折叠落账,已知漂移窗由快照校准纠正(#384 判定表
//                      「事件+校准」双覆盖档);
//     declarative      声明性无转移:宣告性事件,折叠面零状态转移(行为=忽略,理由登记);
//     calibration-only 校准兜底:折叠面刻意不折,转移由校准节点全量覆盖。
//   fx 面(fx/event-extract.ts 消费):presented 有表现 / silent 无表现。
//   票面五档映射:「must-fold 精确折」「折+校准双覆盖」「声明性无转移」= fold 面三档;
//   「无折叠纯表现」= calibration-only × presented;「双面全登记」= 每 kind 恒有两格
//   (fold+fx),这正是本表的存在意义。
//
// ── 穷尽性(本票的防遗漏机器)──
//   1. 表对 GameEventBody["kind"] 穷尽(satisfies 映射类型):词汇表新增 kind 未登记
//      档位 = 编译期红(写码那一刻,非运行时);
//   2. 派生集 FoldHandledKind / FxPresentedKind(从表按面推导):两消费器 switch 只
//      case 本面活跃 kind,default 分支守卫 `Exclude<Kind, 活跃集>`——漏 case 的活跃
//      kind 落入 default = 编译期红;线上未知 kind 不在联合内,运行时照旧忽略
//      (ADR-0020 既定口径,范围定义非吞错);
//   3. 折叠器不折清单与 server 侧校准集合的「同决策对账」(#431 下行装配票)以本表为
//      对账底册:calibration-only 与 fold+calibration 的漂移窗即校准集合的消费面。
import type { GameEngine } from "./authority";
import type { Player } from "./model";
import type { GameEvent, GameEventBody } from "./game-events";
import { heroById, type HeroDef } from "./heroes";
import { activeSkillById, type ActiveSkillDef } from "./skills";

// ─────────────────────── 档位与条目型 ───────────────────────
/** 折叠面档位(net/event-fold.ts 对表消费)。 */
type EventFoldTier = "must-fold" | "fold+calibration" | "declarative" | "calibration-only";

/** 表现面档位(fx/event-extract.ts 对表消费)。 */
type EventFxFace = "presented" | "silent";

/** 单 kind 消费档位条目:fold/fx 两格 + 判据,词汇缺口显式声明(零消费面登记)。 */
interface EventTier {
  /** 折叠面档位。 */
  readonly fold: EventFoldTier;
  /** 表现面档位。 */
  readonly fx: EventFxFace;
  /** 判据:该档位的决策理由(判定表的机器可查正文)。 */
  readonly why: string;
  /** 词汇缺口声明(#430 票项 4):已知占位/无消费面在此显式登记,不留散文注释。 */
  readonly declaredGaps?: readonly string[];
}

// ─────────────────────── per-kind 档位表(全 kind 登记)───────────────────────
export const EVENT_TIERS = {
  // ── 回合/胜负族 ──
  gameStarted: {
    fold: "must-fold",
    fx: "silent",
    why: "开局批锚:phase=Playing+首动者 activeIndex/roundAnchor,折叠即精确",
  },
  setupCompleted: {
    fold: "calibration-only",
    fx: "silent",
    why: "Setup 期字段(draftOrder/offeredCapitals 等)不在事件面=校准兜底五项之五,开局全量覆盖",
  },
  turnEnded: {
    fold: "must-fold",
    fx: "silent",
    why: "回合收口:交涉窗口此时必已 resolution,清 treasureVisitor",
  },
  turnStarted: {
    fold: "fold+calibration",
    fx: "presented",
    why: "回合翻页+开账清场;出牌阶段挂起(AwaitingJinnang)不可知,水合纠正;表现=批末位 turnBanner",
  },
  roundStarted: { fold: "must-fold", fx: "silent", why: "轮次锚点主体(roundAnchor)" },
  roundEnded: { fold: "must-fold", fx: "silent", why: "轮次锚点主体(roundAnchor)" },
  gameOver: {
    fold: "must-fold",
    fx: "presented",
    why: "终局:isOver/winner/winReason/phase/turnPhase;表现=胜利音;异常终局(reason=aborted #642)不播胜利音——作废面板由快照 GameOver 相位驱动挂载,非事件演出",
  },
  // ── 掷骰/行军族 ──
  diceRolled: {
    fold: "must-fold",
    fx: "presented",
    why: "lastRoll 落账+擂鼓加成消费(引擎 DieRolled 派发后取走);表现=骰子动画",
  },
  marchArrived: {
    fold: "must-fold",
    fx: "presented",
    why: "行军落位与路径；落格结算后的决策由 landingResolved 宣告",
  },
  landingResolved: {
    fold: "must-fold",
    fx: "silent",
    why: "权威落格决策事实:相位/pendingLand/落格表现态/交涉到来;招贤候选仍走既有校准",
  },
  capitalHalt: {
    fold: "must-fold",
    fx: "presented",
    why: "驻跸落位+OwnProperty 态;补给金额由相邻 cashChanged(reason=supply)回填",
  },
  // ── 城池族 ──
  capitalSelected: {
    fold: "fold+calibration",
    fx: "presented",
    why: "建城入册(占都/落位/Lv1 持有);建城扣费无 cashChanged,Setup 期现金不入折叠由开局校准覆盖(#386 注记)",
  },
  propertyBought: {
    fold: "must-fold",
    fx: "presented",
    why: "现金-价/地产入册,主动支出随领域事件不产 cashChanged",
  },
  propertyUpgraded: {
    fold: "fold+calibration",
    fx: "presented",
    why: "将城池等级对齐 newLevel 并重置防御值",
  },
  propertyDamaged: {
    fold: "must-fold",
    fx: "silent",
    why: "以权威结算后的城池等级、防御值、燃烧和伤害排行榜更新持有记录",
  },
  propertyBurningChanged: {
    fold: "must-fold",
    fx: "silent",
    why: "按权威进度更新城池燃烧",
  },
  propertyBurningTicked: {
    fold: "declarative",
    fx: "presented",
    why: "以扣防前的标记数播放满焰；扣防和剩余标记由随后 propertyDamaged 同步",
  },
  propertyRejected: {
    fold: "declarative",
    fx: "presented",
    why: "ADR-0013 自动按兵不动的宣告:零状态转移,相位由同批 turnStarted 收场;表现=按 reason 派生文案浮字",
  },
  exhaustionResolved: {
    fold: "must-fold",
    fx: "presented",
    why: "进入休整并按 restTurns 累加跳过回合；演出宣告归零伤害来源及降级失城清单",
  },
  assetTransferred: {
    fold: "must-fold",
    fx: "presented",
    why: "原城主逐城出册。接手者保等级、满防、清空伤害排行榜；无接手者时回无主",
  },
  // ── 金钱族 ──
  cashChanged: {
    fold: "must-fold",
    fx: "presented",
    why: "被动经济结算逐条累加(delta 带符号)+落格表现态相邻回填(supply 金额/tax/stock 破产标记)",
  },
  // ── 珍宝族 ──
  treasureGained: {
    fold: "must-fold",
    fx: "presented",
    why: "得宝入册(流水号实例 id 按静态表回溯);表现=treasure 音",
  },
  treasureSold: {
    fold: "fold+calibration",
    fx: "silent",
    why: "只做出册防双计(交割价随 treasureTraded、变卖所得随 assetLiquidated);窃玉缺口级联查无略过,水合纠正",
  },
  treasureTraded: {
    fold: "must-fold",
    fx: "presented",
    why: "escrow/visitor 收口+买卖双方按价动账(交易最终事实);托管置位半边无事件由校准覆盖",
  },
  treasureStolen: {
    fold: "calibration-only",
    fx: "presented",
    why: "窃玉偷香转移=校准兜底五项之二:双方珍宝列表由校准覆盖,事件只宣告不折;表现=窃得浮字",
  },
  // ── 名将族 ──
  heroRecruited: {
    fold: "must-fold",
    fx: "presented",
    why: "麾下入槽(skillIds=本次授技随事件,折叠建槽不重掷)+招贤池占位(recruitedHeroIds);表现=来投浮字",
  },
  playerBankrupt: {
    fold: "fold+calibration",
    fx: "presented",
    why: "出局善后(isBankrupt/清都城/整槽释放回招贤池/清手入弃堆);现金清零/债主收款/珍宝转债主=破产清算强制全量节点不折;表现=bankrupt 音",
  },
  heroDismissed: {
    fold: "must-fold",
    fx: "presented",
    why: "遣散(#1147):整槽出麾下(冷却随槽俱弃)+招贤池划名(再招=重掷);已学技折书随同批 treasureGained 逐册折,本事件只出麾下与招贤池两账;表现=遣散浮字(与来投/习得同通路)",
  },
  skillFired: {
    fold: "must-fold",
    fx: "presented",
    why: "被动技冷却记账(heroId 定槽,槽内 lastFired 键=skillId,#785 实例化);技参数不随事件,由技表现查;表现=token 侧技名小签浮现(#850,同 floater 通道,渲染档 skill=tag)",
  },
  skillChoiceOpened: {
    fold: "must-fold",
    fx: "silent",
    why: "当前技属主的待决选择、标记与选择相位",
  },
  skillMarksChanged: {
    fold: "must-fold",
    fx: "silent",
    why: "命中技能发动条件前累计的公开标记",
  },
  skillChoiceAnswered: {
    fold: "must-fold",
    fx: "silent",
    why: "清待决选择，折叠实际标记、跳过回合数和继续结算的相位",
  },
  skillLearned: {
    fold: "must-fold",
    fx: "presented",
    why: "用书学技(#1146):槽内池序入技(heroId 定槽)+消耗的技能书珍宝位出册(treasureId 随事件,书=习得器用后即耗);习得无冷却负债(lastFired 不落键,照新授技同款);表现=习得文案浮字(与来投/施展同通路)",
  },
  heroSkillActivated: {
    fold: "must-fold",
    fx: "presented",
    why: "主动技冷却(heroId 定槽,槽内 lastFired 键=skillId)与擂鼓加成、赈济付费在此落账；火攻城损随 propertyDamaged 折叠。表现=施法者金圈、施展浮字",
  },
  // ── 锦囊族 ──
  jinnangDrawn: {
    fold: "must-fold",
    fx: "presented",
    why: "手牌数+count/牌库数-count(内容暗牌不折,ADR-0016);表现=获锦囊浮字",
  },
  jinnangReshuffled: {
    fold: "must-fold",
    fx: "presented",
    why: "弃牌堆骰序洗回牌库:牌库数+count/弃堆清零(count=弃堆全量转移,精确折);洗后牌序=暗信息不折(中途洗牌随批全量,已登记 CALIBRATION_EVENT_KINDS);表现=洗回浮字(与获锦囊浮字同 fx 通路,单机/联机同见)",
  },
  jinnangExhausted: {
    fold: "declarative",
    fx: "presented",
    why: "牌库与弃堆双空落空宣告(#588):零状态转移(无牌可抽即无转移,#384 口径);表现=「锦囊已空」文案浮字(自引擎浮字死通道迁 fx 面,单机/联机同见)",
  },
  jinnangAnnounced: {
    fold: "fold+calibration",
    fx: "presented",
    why: "主动出牌扣账与清除目标段载荷；反应锦囊公告提供表现。直接结算后是否还有可用暗牌由权威端判定，出牌阶段闭沿由校准同步相位。表现为出牌线和浮字。",
  },
  jinnangPhaseResumed: {
    fold: "must-fold",
    fx: "silent",
    why: "城损技能应答后，批内折叠出牌或出技结清后的权威相位",
  },
  reactionOpened: {
    fold: "must-fold",
    fx: "presented",
    why: "权威窗号、影响范围与时长置窗 + AwaitingReaction;表现面=窗体 UI 直读副本 pendingReaction(窗体本身不经提取器)+ 开窗轻叩音(sound=reactionOpen,#751 窎开音,窗开即响单机/联机同见)",
    declaredGaps: ["权威续结算载荷由引擎保管；事件下行只携公告与应答，副本不消费占位载荷"],
  },
  reactionAnswered: {
    fold: "must-fold",
    fx: "presented",
    why: "应答入账，应答齐后按权威清单扣账并收窗；表现为拦检出牌线",
  },
  reactionFailed: {
    fold: "declarative",
    fx: "presented",
    why: "拼点平/负宣告:零状态转移(拦检牌扣账随最终应答);表现=事发现场浮字(点数演出归全屏签面 duelSigns,#637)",
  },
  duelResolved: {
    fold: "declarative",
    fx: "presented",
    why: "公开拼点结算与签面，列参与座位、各点数及胜者。拦停、银两和终局随既有状态事件折叠",
  },
  jinnangVoided: {
    fold: "declarative",
    fx: "presented",
    why: "份或整计作废宣告，反应锦囊已随最终应答扣账；表现为识破线和浮字",
  },
  jinnangInflicted: {
    fold: "must-fold",
    fx: "presented",
    why: "缓兵之计标记侧:目标 skipTurns+1;表现=中招浮字(实际跳过另有 turnSkipped)",
  },
  peekApplied: {
    fold: "declarative",
    fx: "presented",
    why: "窥探生效宣告(#575 即时一次性):窥探零客户端状态(账本已删,弹层纯演出、关闭即逝),fold 面零转移;表现=viewer-only 窥探弹层(hand 随事件走,redact 逐座位裁)",
  },
  // ── 体力与跳过回合 ──
  staminaChanged: {
    fold: "must-fold",
    fx: "presented",
    why: "体力直加实际增减(零实际差不产事件,#568);reason=rest=休整期满回满(耗竭善后消费侧);表现=体力浮字",
  },
  turnSkipped: {
    fold: "must-fold",
    fx: "presented",
    why: "跳过消费侧 skipTurns-1(endTurn 跳过环);表现=被跳过浮字",
  },
  // ── 破产族 ──
  assetLiquidated: {
    fold: "must-fold",
    fx: "presented",
    why: "批量变卖珍宝与非都城城池:逐件现金+所得,城池出册(珍宝由 treasureSold 唯一出册);表现=所得浮字(变卖城池另产回无主宣告)",
  },
  bankruptcySettled: {
    fold: "must-fold",
    fx: "silent",
    why: "清偿完成:清待偿债务与交涉,按交割及现金技能结算后的绝对余额落双方现金,避免与 treasureTraded 重复计款",
  },
} as const satisfies {
  readonly [K in GameEventBody["kind"]]: EventTier;
};

/** 事件 kind 全集(档位表的键域,消费器守卫与派生集共用)。 */
export type EventKind = GameEventBody["kind"];

/** 折叠面活跃 kind 集(从表推导):must-fold / fold+calibration 需要 switch case。 */
export type FoldHandledKind = {
  [K in EventKind]: (typeof EVENT_TIERS)[K]["fold"] extends "declarative" | "calibration-only"
    ? never
    : K;
}[EventKind];

/** 表现面活跃 kind 集(从表推导):fx=presented 需要 switch case。 */
export type FxPresentedKind = {
  [K in EventKind]: (typeof EVENT_TIERS)[K]["fx"] extends "presented" ? K : never;
}[EventKind];

// ─────────────────────── 双消费器共享批上下文(#430 票项 3)───────────────────────
/** 锦囊宣布游标:识破线/反应窗 targetSeats 回溯「最近一次宣布」——fold 批内锚
 *  (宣布与开窗同批)与 extract 跨批衔接(宣布批 → 应答批)共用同一形状,
 *  单源于此,fold/extract 各自实例化。 */
export interface AnnounceCursor {
  /** 宣布者座位。 */
  readonly userSeat: number;
  /** 所宣布的锦囊牌 id。 */
  readonly cardId: string;
  /** 受影响份清单(宣布时快照)。 */
  readonly targetSeats: number[];
}

/** 行动者座位契约校验(零兜底):座位型事件恒带有效 seat;null/越界=产出侧 bug,
 *  当场炸出。fold(折叠目标解析)与 extract(表现锚定)共用同一校验与文案。 */
export function eventSeat(engine: GameEngine, ev: GameEvent): number {
  if (ev.seat == null || ev.seat < 0 || ev.seat >= engine.players.length)
    throw new Error(`事件消费:${ev.kind} 无有效座位(seat=${ev.seat},产出侧契约违反)`);
  return ev.seat;
}

/** 目标座位解析(零兜底):事件携带的座位越界=契约违反,当场炸出(不静默写 undefined)。 */
export function eventSeatPlayer(engine: GameEngine, seat: number, label: string): Player {
  const p = engine.players[seat];
  if (p == null) throw new Error(`事件消费:${label} 目标座位越界 seat=${seat}(契约违反)`);
  return p;
}

/** 名将静态目录回查:heroId 查无=数据 bug,当场炸出(单源 heroes.heroById;
 *  extract 来投文案共用)。 */
export function heroDefOf(heroId: string): HeroDef {
  return heroById(heroId);
}

/** 主动技静态回查(技表 skills.ts SKILLS;skillId 同时是冷却键)。查无=数据 bug,炸出。 */
export function activeSkillDefOf(skillId: string): ActiveSkillDef {
  return activeSkillById(skillId);
}
