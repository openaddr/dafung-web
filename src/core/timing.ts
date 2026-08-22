// 游戏时机总线:集中定义所有可挂技能/珍宝/地块/全局规则的时机点(GameMoment)。
// 设计与扩展指南见 docs/timing-framework.md。
//
// 术语对齐:回合(turn)= 一个人行动一次(engine.turnNumber);轮(round)= 所有人各行动一次
// (engine.round,roundAnchor 锚定)。新增时机 = ① 此处 GameMoment 加一项 + MOMENTS 注册;
// ② game.ts 在正确点位挂一个 dispatchMoment 派发。仅此两步,再无散派。

/** 时机类型。subject(时机主体座位)见各时机注释。 */
export type GameMoment =
  /** 一轮开始:round 即将 +1 后、轮首玩家 TurnStart 之前。subject = roundAnchor。 */
  | "RoundStart"
  /** 一轮结束:最后一位玩家 TurnEnd 后、round +1 之前。subject = roundAnchor。 */
  | "RoundEnd"
  /** 回合开始:新 activeIndex 确定后(含开局首个回合进 Playing 时)。subject = 新活跃玩家。 */
  | "TurnStart"
  /** 回合结束:endTurn() 入口(胜负判定/推进之前)。subject = 即将结束回合的玩家。 */
  | "TurnEnd"
  /** 行军前:rollAndMove 入口、掷骰之前(可累计行军加成,如 moveBonus)。subject = 行军玩家。 */
  | "BeforeMarch"
  /** 行军后:移动执行完(位置/lastMove 就绪)、落格结算(驻跸必停/辅路分派/resolveLanding)之前。subject = 行军玩家。 */
  | "AfterMarch"
  /** 骰子掷出后(细粒度):die 已定、行军尚未计算。ctx.die = 骰面。subject = 掷骰者。 */
  | "DieRolled"
  /** 玩家被动失去银两(细粒度):税/交涉付款/随机事件损失等非自愿支出(主动买城不算)。subject = 失财者。 */
  | "CashLost";

/** 时机集中注册表(单一事实源)。新增时机必须在此登记——派发器与文档据此校验完备性。 */
export const MOMENTS: readonly GameMoment[] = [
  "RoundStart",
  "RoundEnd",
  "TurnStart",
  "TurnEnd",
  "BeforeMarch",
  "AfterMarch",
  "DieRolled",
  "CashLost",
] as const;
