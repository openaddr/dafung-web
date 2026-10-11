// 游戏时机总线:集中定义所有可挂技能/珍宝/地块/全局规则的时机点(GameMoment)。
// 设计与扩展指南 + 完整分类目录(设计技能/事件时翻目录找灵感)见 docs/explanation/时机框架.md。
//
// 术语对齐:回合(turn)= 一个人行动一次(engine.turnNumber);轮(round)= 所有人各行动一次
// (engine.round,roundAnchor 锚定)。新增时机 = ① 此处 GameMoment 加一项 + MOMENTS 注册;
// ② authority.ts 在正确点位挂一个 dispatchMoment 派发。仅此两步,再无散派。

/** 时机类型(39 个,按七类分组)。subject(时机主体座位)与 ctx 字段见各时机注释;
 *  分类目录 + 技能灵感示例见 docs/explanation/时机框架.md。 */
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
  /** 途经己都城得委任状:marchTraverse 巡幸写点(warrants += WARRANTS_PER_PASS)后,
   *  必停截断与恰落都城两路同挂。ctx.tileIndex = 都城。subject = 行军者。 */
  | "WarrantGained"
  // ── 资产与交易 ──
  /** 购城后:buyProperty 成功尾。ctx.propertyId = 购入城。subject = 买家。 */
  | "PropertyBought"
  /** 得城后(#457):机遇赐城入册处(与 PropertyBought「购」语义区分:无主城白得,不经购买)。
   *  ctx.propertyId = 得到的城。subject = 得城者。 */
  | "PropertyGained"
  /** 城池升级后:扩军 upgradeProperty 成功 + 公道买卖成交升级,两处(满级不触发)。
   *  ctx.propertyId = 升级城。subject = 城主。 */
  | "PropertyUpgraded"
  /** 城池受损·降 1 级(#457):火烧连营(锦囊路 demolishOnVictim 调用侧)与耗竭「降 1 级」
   *  处置,两写点。火攻主动技路不派(主动技结算内不派发既有口径)。
   *  ctx.propertyId/ctx.tileIndex = 涉事城。subject = 城主。 */
  | "PropertyDemolished"
  /** 失城(#457):火烧连营城防尽毁失城(锦囊路调用侧,与降级同点按果择一)与耗竭
   *  「失去整座」处置,两写点(都城不可失,失的恒为非都城)。
   *  ctx.propertyId/ctx.tileIndex = 失去的城。subject = 失城者。 */
  | "PropertyLost"
  /** 招贤后:resolveHeroPick 选定名将(tryRecruitHero 只出三选一候选)。ctx.heroId。subject = 招贤者。 */
  | "HeroRecruited"
  /** 得宝后:四处——拼点得宝(treasure-flow drawTreasureAt)/机遇授宝(encounter-flow)/
   *  escrow 交割买家得宝(bankruptcy deliverEscrow)/窃玉偷香得宝(jinnang-execution,#455 A4)。
   *  ctx.treasureId。subject = 得宝者。 */
  | "TreasureGained"
  /** 售宝后:交涉成交(escrow 交割,卖家视角;买家破产退宝不触发)+ 破产变卖珍宝,两处。
   *  ctx.treasureId/ctx.amount = 售价。subject = 卖家。 */
  | "TreasureSold"
  /** 失宝后(#457):珍宝非售出流失——以宝换贤交出代价(每件一派)与窃玉偷香失窃方,
   *  两写点,与 TreasureSold(售出)语义区分。ctx.treasureId。subject = 失宝者。 */
  | "TreasureLost"
  /** 交涉成交:escrow 买家付清价款、交割完成(fair/premium 同;买家破产退宝不触发)。
   *  ctx.buyerSeat/ctx.sellerSeat/ctx.amount = 成交价。subject = 城主(= 卖家)。 */
  | "TradeSettled"
  /** 得锦囊进手(#456):drawJinnang 物理单点内部派发(每张入手后按次数派一次),
   *  五路同覆盖——起手发牌/锦囊格/辅路军师来投/机遇授书/声望献计。
   *  ctx.count = 本次实际入手张数(牌库空落空不派,与 jinnangDrawn 事件「无转移不产」同口径)。
   *  暗牌不带牌 id(ADR-0016 保密口径)。subject = 得牌者。 */
  | "JinnangGained"
  /** 窥探生效(#456):军情密探 jinnangPeeks 入册后。ctx.targetSeat = 被窥者。
   *  subject = 使用者(窥方)。 */
  | "PeekApplied"
  // ── 玩家状态 ──
  /** 被动得银:applyResupply 补给(驻跸/落都城)/随机事件得款(锦囊/辅路;天命格 +20 声望
   *  不走银)/机遇得款与折现/玩家间收款(#455 下沉后两通道:payOrLiquidate 直付到账、
   *  confirmBankruptcySettle 清偿,均债主视角)。
   *  ctx.amount = 得银额。subject = 得银者。
   *  **防连锁**:仅经济结算点派发——效果层收益(grantSkillCash)不触发 CashGained,技能链不递归放大。 */
  | "CashGained"
  /** 玩家被动失去银两(细粒度):税/交涉付款/随机事件损失等非自愿支出(主动买城不算)。subject = 失财者。 */
  | "CashLost"
  /** 被强加跳回合(#456):skipTurns 三写点各自派发、写点语义差保留(缓兵 +=1 /
   *  辅路中伏 =1 赋值 / 耗竭 +=1)。ctx.reason = 缘由(jinnang=缓兵之计 / ambush=辅路中伏 /
   *  exhaustion=体力耗竭善后)。subject = 被跳者。 */
  | "TurnSkipImposed"
  /** 体力变更(#456):**仅机遇路**派发(encounter-flow applyEncounterStamina 的 addStamina
   *  结算处)。耗竭重置(系统复位非收益)与华佗赈济(主动技「结算内不派时机」既有口径)不派。
   *  ctx.delta = 夹紧 0~100 后的实际增减(带符号)。subject = 体力变动者。 */
  | "StaminaChanged"
  /** 声望变更(#456):挂 addReputation 唯一写口(reputation.ts)单点广播,天命格与机遇
   *  repDelta 两路天然全覆盖;事件流的 before/after 差值模式在调用点,与新时机并存不冲突。
   *  ctx.delta = 夹紧 ±100 后的实际增减(带符号)。subject = 声望变动者。 */
  | "ReputationChanged"
  // ── 破产与终局结算 ──
  /** 玩家破产出局:finalizeBankruptcy 尾(名将已释放、资产已转债主)。subject = 破产者。 */
  | "PlayerBankrupt"
  /** 破产资产被收走(#457):settleDebtTraced 破产终局一次派发(不逐件——珍宝在
   *  economy.settleDebt 内转移、名将是释放非转移),与 PlayerBankrupt(破产者视角)成对,
   *  本时机 = 债主视角;无债主(归银行/销毁)不派。ctx.creditorSeat = 债主(= subject),
   *  ctx.cities = 被收走的城 id 列表,ctx.treasureCount = 被收走的珍宝件数。subject = 债主。 */
  | "AssetsSeized"
  /** 破产每笔变卖后:变卖珍宝/变卖城池/遣散名将三个命令成功尾(变卖自救进行中,结局未定)。
   *  ctx.amount = 变卖所得。subject = 变卖者。 */
  | "BankruptcySettle"
  // ── 反应窗挂点(#281,ADR-0017)──
  /** 锦囊宣布:任何锦囊选定目标、结算前(识破诡计的反应窗挂点)。ctx.cardId = 牌 id,
   *  ctx.targetSeats = 目标座位集(全体域=受影响全员;自身域=[使用者])。subject = 使用者。 */
  | "JinnangAnnounced"
  /** 途经他人城池:rollAndMove 途经遍历中每到城主存活的他人城池格(半路杀出的拦检窗挂点,
   *  拦停成功即止、后续城不再问;行人本就停留的落点格不问)。ctx.ownerSeat = 城主,
   *  ctx.tileIndex = 涉事格。subject = 行人。 */
  | "MarchPassedCity";

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
  /** 破产债主座位(PlayerBankrupt;null=无债主归银行/销毁,#384)。 */
  creditorSeat?: number | null;
  /** 涉事 tile 索引(CapitalHalt/LandedOnProperty/PassedPlayer/BranchExited/MarchPassedCity)。 */
  tileIndex?: number;
  /** 涉事城 id(PropertyBought/PropertyUpgraded/LandedOnProperty)。 */
  propertyId?: string;
  /** 涉事珍宝 id(TreasureGained/TreasureSold)。 */
  treasureId?: string;
  /** 涉事名将 id(HeroRecruited)。 */
  heroId?: string;
  /** 锦囊牌 id(JinnangAnnounced)。 */
  cardId?: string;
  /** 目标座位集(JinnangAnnounced:全体域=受影响全员,自身域=[使用者];其余时机不带)。 */
  targetSeats?: number[];
  /** 跳回合缘由(TurnSkipImposed):jinnang=缓兵之计 / ambush=辅路中伏 / exhaustion=体力耗竭善后。 */
  reason?: "jinnang" | "ambush" | "exhaustion";
  /** 实际入手张数(JinnangGained;牌库空落空不派发,恒 ≥1)。 */
  count?: number;
  /** 单一目标座位(PeekApplied 被窥者)。 */
  targetSeat?: number;
  /** 变更量(带符号,夹紧后实际值;StaminaChanged/ReputationChanged)。 */
  delta?: number;
  /** 被收走的城 id 列表(AssetsSeized:破产终局资产转移)。 */
  cities?: string[];
  /** 被收走的珍宝件数(AssetsSeized;名将是释放非转移,不计数)。 */
  treasureCount?: number;
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
  "WarrantGained",
  // 资产与交易
  "PropertyBought",
  "PropertyGained",
  "PropertyUpgraded",
  "PropertyDemolished",
  "PropertyLost",
  "HeroRecruited",
  "TreasureGained",
  "TreasureSold",
  "TreasureLost",
  "TradeSettled",
  "JinnangGained",
  "PeekApplied",
  // 玩家状态
  "CashGained",
  "CashLost",
  "TurnSkipImposed",
  "StaminaChanged",
  "ReputationChanged",
  // 破产与终局结算
  "PlayerBankrupt",
  "AssetsSeized",
  "BankruptcySettle",
  // 反应窗挂点(#281)
  "JinnangAnnounced",
  "MarchPassedCity",
] as const;
