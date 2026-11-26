// data-testid 单源:测试与明确请求的单次辅助从这里导入,避免字符串拼写漂移。
// 命名用 kebab-case;棋盘格定位由 BoardView/Tile 的 data-tile 承载。
export const TESTIDS = {
  // ── 顶部浮层与席位格 ──
  topBar: "top-bar",
  /** 顶左详情钮,打开诸侯详情弹窗。 */
  topbarOverview: "topbar-overview",
  /** 顶左设置钮(开设置弹层)。 */
  settingsButton: "settings-button",
  /** 设置钮上的战报未读金点,打开抽屉即清;已读游标归 GameScreen 本地态。 */
  settingsUnreadDot: "settings-unread-dot",
  /** 席位格列容器,一人一格。 */
  seatRail: "seat-rail",
  /** 对手席位格(seat=绝对座位号);自机格单挂 seatSelf。 */
  seat: (seat: number) => `seat-${seat}` as const,
  seatCash: (seat: number) => `seat-cash-${seat}` as const,
  cashFly: (seat: number) => `cash-fly-${seat}` as const,
  fxSeal: (char: string) => `fx-seal-${char}` as const,
  /** 体力色条,濒耗竭时 low 类转朱砂。 */
  seatStamina: (seat: number) => `seat-stamina-${seat}` as const,
  /** 属性计数(attr ∈ city|hand|gem|hero;值裸排,名词在 aria-label)。 */
  seatAttr: (seat: number, attr: string) => `seat-attr-${attr}-${seat}` as const,
  /** 托管席位的常驻展示标记;开关入口为设置弹层 settingsAutopilot(ADR-0028)。 */
  seatHosted: (seat: number) => `seat-hosted-${seat}` as const,
  /** 自机格根;只在目标段挂候选点击层。 */
  seatSelf: "seat-self",

  // ── 手牌区 ──
  /** 手牌区容器(签面 + 锦囊手牌架;锦囊开关收起时不挂载)。 */
  handZone: "hand-zone",

  // ── 右下三圆钮 ──
  /** 三圆钮容器(坐姿渲染)。 */
  pileButtons: "pile-buttons",
  /** 锦囊圆钮,临时切换手牌区显隐;回合/窗态变化时由 GameScreen 重新同步。 */
  jinnangToggle: "jinnang-toggle",
  /** 珍宝圆钮(角标=珍宝数;点开珍宝藏品弹层)。 */
  pileTreasures: "pile-treasures",
  /** 名将圆钮(角标=名将数/3 上限;点开名将藏品弹层)。 */
  pileHeroes: "pile-heroes",

  // ── 设置弹层 ──
  /** 弹层容器(ui/dialog 底件,题名可拖)。 */
  settingsDialog: "settings-dialog",
  /** 音效开关(Base UI Switch;开=有声,接原 AudioProvider 单通道静音账本)。 */
  settingsSfx: "settings-sfx",
  /** 战报入口行,打开战报抽屉。 */
  settingsWarReport: "settings-war-report",
  settingsDiagnostic: "settings-diagnostic",
  /** 回到主页行(弃局离屏:销毁控制器回 setup)。 */
  settingsHome: "settings-home",
  /** Base UI Switch,经 useAutopilotOn 回读、controller.setAutoPilot 下发;操作本座托管。 */
  settingsAutopilot: "settings-autopilot",
  /** 属性浮签内容件(Tip 组件的 Popup;长按/聚焦同签)。 */
  attrTip: "attr-tip",

  // ── 战报抽屉(设置内打开)──
  logDrawer: "log-drawer",
  /** 战报按窗口渲染,此按钮放开更早历史。 */
  logEarlier: "log-earlier",

  // ── 藏品弹层(PileButtons 自持)──
  /** 两独立弹层容器(无互切页签;右上 X 关闭,关闭钮 testid 共用)。 */
  treasureModal: "treasure-modal",
  heroModal: "hero-modal",
  /** 人物卷:当前麾下画像签、人物与实授技能文稿。 */
  heroInspectionSelect: (heroId: string) => `hero-inspection-select-${heroId}` as const,
  heroInspectionRoster: "hero-inspection-roster",
  heroInspectionPortrait: "hero-inspection-portrait",
  heroInspectionName: "hero-inspection-name",
  heroInspectionSkills: "hero-inspection-skills",
  heroInspectionSkill: (skillId: string) => `hero-inspection-skill-${skillId}` as const,
  heroInspectionActions: "hero-inspection-actions",
  /** 手牌架上的可研读技能书。 */
  bookUse: (treasureId: string) => `book-use-${treasureId}` as const,
  /** 名将遣散钮(heroId=麾下将 id):己方回合可用,二段确认。 */
  heroDismiss: (heroId: string) => `hero-dismiss-${heroId}` as const,
  /** 研读弹窗容器与可学者按钮(heroId=麾下将 id)。 */
  bookLearnModal: "book-learn-modal",
  bookLearnItem: (heroId: string) => `book-learn-${heroId}` as const,
  bookLearnConfirm: "book-learn-confirm",
  bookLearnCancel: "book-learn-cancel",
  modalClose: "modal-close",
  modalMinimize: "modal-minimize",
  modalBackdrop: "modal-backdrop",
  modalRestore: "modal-restore",
  /** 题名拖动把手,ui/dialog 与 BannerShell 共用;叠层时按容器作用域区分。 */
  modalDragHandle: "modal-drag-handle",
  /** PileShell 体部滚动容器。 */
  modalScrollBody: "modal-scroll-body",
  /** PileShell 固定底部操作区。 */
  modalFooter: "modal-footer",

  // ── 军情密探窥探弹层 ──
  /** 弹层容器(PileShell 壳;仅 viewer=本座渲染,关闭即清)。 */
  peekModal: "peek-modal",
  /** 被窥锦囊牌面(cardId=牌名;弹层内容区点击即关闭)。 */
  peekCard: (cardId: string) => `peek-card-${cardId}` as const,
  /** 空手牌空态(「囊中空空」浅印;目标有效性对手牌数无守卫,真业务态)。 */
  peekEmpty: "peek-empty",

  // ── 技能全览弹框 ──
  /** 弹层容器(PileShell 壳;招贤点卡/点技名 chip、技能卡主技名、麾下将点技名弹出)。 */
  skillGlossary: "skill-glossary",
  /** 招贤拍板钮(footer「收为麾下」;仅招贤消费方传 onPick 时在场,浏览语境无钮)。 */
  skillGlossaryPick: "skill-glossary-pick",
  /** 技能行(skillId=技 id;被点技挂 is-hl 高亮类)。 */
  skillGlossaryRow: (skillId: string) => `skill-glossary-row-${skillId}` as const,
  /** 技名选择器,对应 HeroCardFace chips 与 SkillCardFace 主技名的 data-skill。 */
  skillChip: (skillId: string) => `[data-skill="${skillId}"]` as const,
  skillChipAny: "[data-skill]" as const,
  /** 手牌架技能卡的独立详情入口,以名将和技能定位实例。 */
  skillCardInspect: (heroId: string, skillId: string) =>
    `skill-card-inspect-${heroId}-${skillId}` as const,

  // ── 名下城池清单(诸侯详情城池列打开)──
  /** 弹层容器(PileShell 壳,朱印「城」;只读清单,零操作项,随快照实时重渲)。 */
  cityLedger: "city-ledger",
  /** 城池行(propertyId=城 id;行序=棋盘 index 序)。 */
  cityLedgerRow: (propertyId: string) => `city-ledger-row-${propertyId}` as const,
  /** 城池行首的非交互 Tile 缩略图(propertyId=城 id)。 */
  cityLedgerThumb: (propertyId: string) => `city-ledger-thumb-${propertyId}` as const,
  /** 空态(「名下暂无城池」浅印;名下无城=真业务态,未购地/破产清场均可达)。 */
  cityLedgerEmpty: "city-ledger-empty",

  // ── 出牌动作条 ──
  /** 顶部出牌动作条。 */
  actionbar: "actionbar",
  /** 卡牌段主按钮「选目标」「出牌」或「发动」。 */
  actionbarPlay: "actionbar-play",
  /** 卡牌段「不出」,牌不消耗。 */
  actionbarPass: "actionbar-pass",
  /** 目标段主按钮「下一步」「出牌」或「发动」。 */
  actionbarTarget: "actionbar-target",
  actionbarPrevious: "actionbar-previous",
  /** 目标段「取消选牌」。 */
  actionbarCancel: "actionbar-cancel",
  /** 空闲席位格上的全员详情入口。 */
  seatOverview: (seat: number) => `seat-overview-${seat}` as const,
  /** 目标段席位按钮(含自机);首点选中、再点取消,打出经动作条确认。 */
  seatTarget: (seat: number) => `seat-target-${seat}` as const,
  /** 目标城的 Tile 根挂 data-city-target;同格再点取消、点他格改选,确认/作罢走动作条。 */
  cityTarget: (tileIndex: number) => `[data-tile="${tileIndex}"][data-city-target]`,
  city: (tileIndex: number) => `[data-tile="${tileIndex}"]`,
  /** 目标段选城·选中定靶态(实金双环停持,呼吸停;Tile 根挂 data-city-target-selected)。 */
  cityTargetPicked: (tileIndex: number) => `[data-tile="${tileIndex}"][data-city-target-selected]`,
  /** 全局计数选择器(skillChipAny 同款:候选总数/选中总数断言用)。 */
  cityTargetAny: "[data-city-target]",
  cityTargetPickedAny: "[data-city-target-selected]",

  /** 蓝盾挂 data-shield，data-defense 为当前防御值。TileThumb 复用同件。 */
  cityShield: (tileIndex: number) => `#board [data-city-art="${tileIndex}"] [data-shield]`,

  // ── 手牌架 ──
  /** 己方手牌行,有牌才挂载;牌架本体另挂 jinnangRack。 */
  jinnangHand: "jinnang-hand",
  /** 全展时承载原牌行的局部横向浏览视口。 */
  jinnangViewport: "jinnang-viewport",
  jinnangCard: (cardId: string) => `jinnang-card-${cardId}` as const,
  /** 手牌架容器,承载牌行或空态。 */
  jinnangRack: "jinnang-rack",
  /** 点牌详情弹层容器,使用 ui/dialog 底件。 */
  jinnangDetail: "jinnang-detail",
  selectedJinnangText: "selected-jinnang-text",
  /** 架尾计数章:.many 压缩态显示,点按切换持续全展;计数含锦囊与技能。 */
  jinnangSpreadBadge: "jinnang-spread-badge",
  diceFace: "dice-face",
  /** 决策卷轴内的操作按钮。 */
  actionButton: (action: string) => `action-${action}` as const, // action-buy / action-skip / …

  // ── 拼点签面(ADR-0030)──
  /** 全屏签面幕容器(幕启→并行摇→错拍落→判词→渐出;append 到 body,非棋盘层)。 */
  duelOverlay: "duel-overlay",
  /** 参与者签面(seat = 绝对座位号;签头=玩家色底+国号,签身=骨牌大字)。 */
  duelSign: (seat: number) => `duel-sign-${seat}` as const,
  /** 中缝朱砂「拼」印(data-verdict = pending|win|tie 判词态;tie 钤变金「平」)。 */
  duelVerdict: "duel-verdict",

  // ── 反应窗 ──
  /** 顶部反应动作条，仅在本座待应答时呈现。 */
  reactionBanner: "reaction-banner",
  /** 反应窗的来者和事件名称。 */
  reactionText: "reaction-text",
  /** 当前反应所需的步骤或已选目标。 */
  reactionStep: "reaction-step",
  /** 反应窗倒计时。 */
  reactionTimer: "reaction-timer",
  /** 「出牌」确认钮，按份牌须先确定保护对象。 */
  reactionConfirm: "reaction-confirm",
  /** 「不出」立即应答钮。 */
  reactionDecline: "reaction-decline",
  /** 降噪口「本回合不再询问」(点下即对当前窗应答不出,同回合后续询问静默代发)。 */
  reactionMute: "reaction-mute",

  // ── 「你可」选择闸触发卡 ──
  /** 触发卡横幅(从手牌架上缘长出,反应窗同形;仅待决属主座位渲染)。 */
  skillChoiceBanner: "skill-choice-banner",
  /** 触发卡文案(「X「放逐」可达发动条件…」)。 */
  skillChoiceText: "skill-choice-text",
  /** 发动确认墨钮(放逐=选定目标后可用;行殇=目标既定恒可用)。 */
  skillChoiceConfirm: "skill-choice-confirm",
  /** 「暂不发」立即应答钮(放弃=标记保留)。 */
  skillChoiceDecline: "skill-choice-decline",
  /** 目标候选笺(放逐选人:点笺=选中/再点同笺取消;seat=候选目标座位)。 */
  skillChoiceSeat: (seat: number) => `skill-choice-seat-${seat}` as const,
  /** 放逐标记进度挂点(seat=座位号):席位格底缘金色进度轨,攒怒中在场、满档呼吸;
   *  数值与名词在 aria-label(状态表达 §4.6,格上不落文字标牌)。 */
  seatSkillMark: (seat: number) => `seat-skill-mark-${seat}` as const,

  // ── 覆盖提示 ──
  hint: "hint", // App.tsx 的提示也共用此挂点
  thinking: "thinking",
  waitingBar: "waiting-bar", // 知会槽内的等待状态条
  /** 顶中知会槽,都城停条带/等待条/回合胶囊同槽互斥,瞬态知会优先。 */
  noticeBanner: "notice-banner",
  /** 回合宣告胶囊,显示国号印/名号/轮次,每次宣告重挂;等待附加信息另挂 waitingBar。 */
  turnCapsule: "turn-capsule",
  /** 知会槽内常驻零宽锚点,位于回合胶囊右缘(ADR-0043)。
   *  宣告批被吸附时胶囊可不物化,因此掷骰签不能依赖胶囊瞬态节点。 */
  diceSignAnchor: "dice-sign-anchor",
  /** 「请横屏」提示层常驻 DOM,显隐由 layout.css 媒询决定。 */
  rotateHint: "rotate-hint",

  // ── 选都确认 ──
  /** 详情卷轴选都模式的「定都于此」按钮。 */
  confirmCapitalOk: "confirm-capital-ok",
  confirmCapitalCancel: "confirm-capital-cancel",

  // ── 未开局空态 ──
  /** 「尚未开局」卡片的「回到首页」按钮(快照缺失时的引导逃生口)。 */
  notStartedBack: "not-started-back",

  // ── 诸侯详情钻入明细 ──
  /** 名将与珍宝明细弹层容器。 */
  seatHeroModal: "seat-hero-modal",
  seatGemModal: "seat-gem-modal",

  // ── 诸侯详情:城池/名将/珍宝列可点开明细 ──
  /** 弹层容器(ui/dialog 底件,题名可拖;打开不暂停对局,行随快照实时重渲)。 */
  warlordsOverview: "warlords-overview",
  /** 总览行(seat = 座位号,座序即行序，一人一行)。状态类挂点:
   *  自机行 .self 金描边 / 破产行 .dead 灰化 / 活跃方 .is-active(印金圈)。 */
  warlordsRow: (seat: number) => `warlords-row-${seat}` as const,
  /** 行内数值本体(cash/stamina/hand),仅含数值文本。 */
  warlordsCash: (seat: number) => `warlords-cash-${seat}` as const,
  warlordsStamina: (seat: number) => `warlords-stamina-${seat}` as const,
  warlordsHand: (seat: number) => `warlords-hand-${seat}` as const,
  /** 城池列,点击打开名下城池清单。 */
  warlordsCities: (seat: number) => `warlords-cities-${seat}` as const,
  /** 名将列(可点钻入件):公开名将数和名字，点击开名将名录。 */
  warlordsHeroes: (seat: number) => `warlords-heroes-${seat}` as const,
  /** 珍宝计数，点击开珍宝列表。 */
  warlordsGems: (seat: number) => `warlords-gems-${seat}` as const,

  // ── 联机连接横幅(shared/ConnectionBanner)──
  connectionBanner: "connection-banner",
  connectionRetry: "connection-retry",
  connectionExit: "connection-exit",
} as const;
