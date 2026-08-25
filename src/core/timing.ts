// 游戏时机总线:集中定义所有可挂技能/珍宝/地块/全局规则的时机点(GameMoment)。
// 设计与扩展指南 + 完整分类目录(设计技能/事件时翻目录找灵感)见 docs/timing-framework.md。
//
// 术语对齐:回合(turn)= 一个人行动一次(engine.turnNumber);轮(round)= 所有人各行动一次
// (engine.round,roundAnchor 锚定)。新增时机 = ① 此处 GameMoment 加一项 + MOMENTS 注册;
// ② game.ts 在正确点位挂一个 dispatchMoment 派发。仅此两步,再无散派。

/** 时机类型(26 个,按七类分组)。subject(时机主体座位)与 ctx 字段见各时机注释;
 *  分类目录 + 技能灵感示例见 docs/timing-framework.md。 */
export type GameMoment =
  // ── 生命周期 ──
  /** 对局开始:finishSetup 进入 Playing 处、首个 TurnStart 之前。subject = roundAnchor(首动者)。 */
  | "GameStart"
  /** 选都完成:最后一位 pickCapital 成功后、finishSetup 收尾前。subject = 该落子者。 */
  | "SetupComplete"
  /** 终局:endTurn 胜负判定确定 isOver 处(净资产达标/群雄尽灭两条路径同挂)。subject = 胜者。 */
  | "GameOver"
  // ── 回合与轮 ──
  /** 一轮开始:round 即将 +1 后、轮首玩家 TurnStart 之前。subject = roundAnchor。 */
  | "RoundStart"
  /** 一轮结束:最后一位玩家 TurnEnd 后、round +1 之前。subject = roundAnchor。 */
  | "RoundEnd"
  /** 回合开始:新 activeIndex 确定后(含开局首个回合进 Playing 时)。subject = 新活跃玩家。 */
  | "TurnStart"
  /** 回合结束:endTurn() 入口(胜负判定/推进之前)。subject = 即将结束回合的玩家。 */
  | "TurnEnd"
  // ── 掷骰与行军 ──
  /** 行军前:rollAndMove 入口、掷骰之前(可累计行军加成,如 moveBonus)。subject = 行军玩家。
   *  与 BeforeRoll 的区分:BeforeMarch 改步数(行军系);BeforeRoll 挂骰子机制(见下)。 */
  | "BeforeMarch"
  /** 掷骰前:rollAndMove 内 BeforeMarch 之后、dice.roll 之前。subject = 掷骰者。
   *  骰子机制系技能(「重掷」「骰运」类)的挂点:效果只能读状态/置标记,不能直接改骰面——
   *  联机确定性靠引擎 rng(重掷=吃一次 rng 消耗),效果层不允许旁路随机源。 */
  | "BeforeRoll"
  /** 骰子掷出后(细粒度):die 已定、行军尚未计算。ctx.die = 骰面。subject = 掷骰者。 */
  | "DieRolled"
  /** 行军后:移动执行完(位置/lastMove 就绪)、落格结算(驻跸必停/辅路分派/resolveLanding)之前。subject = 行军玩家。 */
  | "AfterMarch"
  /** 入辅路:selectBranch("Branch") 置 onBranch={step:-1}(待入辅路)后、endTurn 前。subject = 抉择者。 */
  | "BranchEntered"
  /** 出辅路:辅路推进汇入主路处(落点回主路,含汇入后必停都城的截断落点),AfterMarch 之前。
   *  ctx.tileIndex = 主路落点。subject = 行军玩家。 */
  | "BranchExited"
  // ── 落格与路径 ──
  /** 驻跸:经过自己都城必停,applyResupply(cause="halt") 结算处(AfterMarch 之后)。
   *  ctx.tileIndex = 都城。subject = 驻跸者。 */
  | "CapitalHalt"
  /** 落他人城:resolveProperty 城池有主且非本人(无论是否触发珍宝交涉)。回合外玩家高频触发点。
   *  ctx.ownerSeat = 城主,ctx.propertyId/ctx.tileIndex = 该城。subject = 访客。 */
  | "LandedOnProperty"
  /** 途经他人棋子:rollAndMove path 计算后,遍历 traversed(不含起点,含落点)上非破产他人逐个派发。
   *  ctx.passedSeat = 被途经者,ctx.tileIndex = 途经格。subject = 行军者。 */
  | "PassedPlayer"
  // ── 资产与交易 ──
  /** 购城后:buyProperty 成功尾。ctx.propertyId = 购入城。subject = 买家。 */
  | "PropertyBought"
  /** 城池升级后:扩军 upgradeProperty 成功 + 公道买卖成交升级,两处(满级不触发)。
   *  ctx.propertyId = 升级城。subject = 城主。 */
  | "PropertyUpgraded"
  /** 招贤后:resolveHeroPick 选定名士(tryRecruitHero 只出三选一候选)。ctx.heroId。subject = 招贤者。 */
  | "HeroRecruited"
  /** 得宝后:拼点得宝 drawTreasureAt 成功 + escrow 交割买家得宝,两处。ctx.treasureId。subject = 得宝者。 */
  | "TreasureGained"
  /** 售宝后:交涉成交(escrow 交割,卖家视角;买家破产退宝不触发)+ 破产变卖珍宝,两处。
   *  ctx.treasureId/ctx.amount = 售价。subject = 卖家。 */
  | "TreasureSold"
  /** 交涉成交:escrow 买家付清价款、交割完成(fair/premium 同;买家破产退宝不触发)。
   *  ctx.buyerSeat/ctx.sellerSeat/ctx.amount = 成交价。subject = 城主(= 卖家)。 */
  | "TradeSettled"
  // ── 玩家状态 ──
  /** 被动得银:applyResupply 补给(驻跸/落都城)/随机事件得款(锦囊/天命/辅路)/交涉收款(卖家)。
   *  ctx.amount = 得银额。subject = 得银者。
   *  **防连锁**:仅经济结算点派发——效果层收益(grantSkillCash)不触发 CashGained,技能链不递归放大。 */
  | "CashGained"
  /** 玩家被动失去银两(细粒度):税/交涉付款/随机事件损失等非自愿支出(主动买城不算)。subject = 失财者。 */
  | "CashLost"
  // ── 破产与终局结算 ──
  /** 玩家破产出局:finalizeBankruptcy 尾(名士已释放、资产已转债主)。subject = 破产者。 */
  | "PlayerBankrupt"
  /** 破产每笔变卖后:变卖珍宝/变卖城池/遣散名士三个命令成功尾(变卖自救进行中,结局未定)。
   *  ctx.amount = 变卖所得。subject = 变卖者。 */
  | "BankruptcySettle";

/** 时机派发上下文(dispatchMoment 入参 → EffectCtx):subject 必填,其余字段按各时机语义携带。 */
export interface MomentCtx {
  /** 时机主体座位(骰是谁掷的/银是谁得的/城是谁买的…)。 */
  subject: number;
  /** 骰面(DieRolled)。 */
  die?: number;
  /** 时机涉及金额(CashLost 失财额/CashGained 得银额/TreasureSold 售价/TradeSettled 成交价/BankruptcySettle 变卖所得)。 */
  amount?: number;
  /** 被途经者座位(PassedPlayer)。 */
  passedSeat?: number;
  /** 城主座位(LandedOnProperty)。 */
  ownerSeat?: number;
  /** 交易买家座位(TradeSettled)。 */
  buyerSeat?: number;
  /** 交易卖家座位(TradeSettled)。 */
  sellerSeat?: number;
  /** 涉事 tile 索引(CapitalHalt/LandedOnProperty/PassedPlayer/BranchExited)。 */
  tileIndex?: number;
  /** 涉事城 id(PropertyBought/PropertyUpgraded/LandedOnProperty)。 */
  propertyId?: string;
  /** 涉事珍宝 id(TreasureGained/TreasureSold)。 */
  treasureId?: string;
  /** 涉事名士 id(HeroRecruited)。 */
  heroId?: string;
}

/** 时机集中注册表(单一事实源)。新增时机必须在此登记——派发器与文档据此校验完备性。 */
export const MOMENTS: readonly GameMoment[] = [
  // 生命周期
  "GameStart",
  "SetupComplete",
  "GameOver",
  // 回合与轮
  "RoundStart",
  "RoundEnd",
  "TurnStart",
  "TurnEnd",
  // 掷骰与行军
  "BeforeMarch",
  "BeforeRoll",
  "DieRolled",
  "AfterMarch",
  "BranchEntered",
  "BranchExited",
  // 落格与路径
  "CapitalHalt",
  "LandedOnProperty",
  "PassedPlayer",
  // 资产与交易
  "PropertyBought",
  "PropertyUpgraded",
  "HeroRecruited",
  "TreasureGained",
  "TreasureSold",
  "TradeSettled",
  // 玩家状态
  "CashGained",
  "CashLost",
  // 破产与终局结算
  "PlayerBankrupt",
  "BankruptcySettle",
] as const;
