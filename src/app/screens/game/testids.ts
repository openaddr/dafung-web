// data-testid 常量集中导出:e2e / 测试统一从这里 import,避免散落字符串拼写漂移。
// 命名约定:kebab-case;区域容器 `xxx-panel`,条目 `xxx-item`(可带索引后缀)。
// 棋盘侧的 data 属性由 BoardView/Tile 自带(data-tile=N),此处不重复定义。
//
// ── 退役核销(#255,#253 迁移清单闭环)──
// 右栏 aside 系组件(HandPanel/StatusBar/TreasuryPanel/OthersPanel/CollapsedRail)与
// 卡详情卷轴(CardDetailScroll)已删除,其旧 testid 常量(statusBar*/hand*/treasury*/
// others*/sidebar*/roundInfo/jinnangCount/cardDetail*)一并退役;挂点去向见各现行
// 常量注释(零语义漂移)。另:dice-face(签面)语义已迁仪表条「签」徽章,testid 不变。
// #361 退役核销:pile-row(expandPile 明细行)随明细排退役删除,接替者是牌架双入口
// (rack-treasures/rack-heroes)+ 两独立弹层(treasure-modal/hero-modal)。
// 2026-10-17 退役核销:topbar-discard 随顶栏弃牌 chip 退役(18−牌库−Σ席位手牌可推导),
// 接替形态=锦囊牌库小件(topbar-deck 落朱砂角标)。
// #700 退役核销:topbar-active(回合方字条)/topbar-target(目标身价)/topbar-deck(牌库
// 角标)随旧顶栏退役——顶中只留「N 轮」浮置 chip;dashboard-bar 系(dashCash/dashAttr/
// dashStamina/dashTreasures/dashHeroes/dashYou)随仪表条本体退役(资产数值归席位格,
// 签面迁手牌区左端,testid dice-face 不变);log-tab(战报把手)退役,入口降级设置弹层
// (log-drawer 抽屉本体保留);autopilot-button(托管钮)随仪表条退役,#701 tap 弹层
// 接管(过渡期托管不可达可接受,同一集成分支收口);mute-button/reset-view(音乐钮/
// 总览复位钮)退役——音效开关降级入设置弹层,复位能力随 usePanZoom reset 一并退役。
// 接替形态=顶左两钮(topbar-overview/settings-button)+ 右下三圆钮(pile-buttons 族)
// + 设置弹层(settings-* 族)+ 手牌区(hand-zone)。
export const TESTIDS = {
  // ── 全浮层骨架(#700):顶部条(顶左两钮 + 顶中 N 轮 chip)/ 席位格列(#698 重形)
  // / 手牌区 / 右下三圆钮 ──
  topBar: "top-bar",
  /** 顶中「N 轮」浮置 chip(textContent = 「N 轮」;#700 起不含印章与目标身价)。 */
  topbarRound: "topbar-round",
  /** 顶左总览钮(诸侯总览弹窗入口;#702 点开十列分板弹层)。 */
  topbarOverview: "topbar-overview",
  /** 顶左设置钮(开设置弹层)。 */
  settingsButton: "settings-button",
  /** 席位格列容器(#698 重形:右缘单列 96×38 双行八项格,一人一格)。 */
  seatRail: "seat-rail",
  /** 席位格(seat = 绝对座位号),挂对手席;自机格挂 seatSelf(不占本族——
   *  「自身不出卡」旧契约的 e2e 以 seat-N 缺席为断言,自机入列不破它)。 */
  seat: (seat: number) => `seat-${seat}` as const,
  seatCash: (seat: number) => `seat-cash-${seat}` as const,
  /** 体力色条(#698:3px 细轨无刻度数;濒耗竭 low 类转朱砂,数值归仪表条/弹层)。 */
  seatStamina: (seat: number) => `seat-stamina-${seat}` as const,
  /** 属性计数(attr ∈ warrant|city|hand|rep|gem|hero;值裸排,名词在 aria-label)。 */
  seatAttr: (seat: number, attr: string) => `seat-attr-${attr}-${seat}` as const,
  /** 自机格根(#698:金描边+左金条+金渐变;纯展示无点击层,目标段候选层随 targets 在场)。 */
  seatSelf: "seat-self",

  // ── 手牌区(#700:透明居中浮置,签面驻左端)──
  /** 手牌区容器(签面 + 锦囊手牌架;锦囊开关收起时不挂载)。 */
  handZone: "hand-zone",

  // ── 右下三圆钮(#700:锦囊开关 / 珍宝 / 名将,44px 圆 + 计数角标)──
  /** 三圆钮容器(坐姿渲染)。 */
  pileButtons: "pile-buttons",
  /** 锦囊圆钮 = 手牌区显隐开关(亮=显示;对局内记忆,重进恢复)。 */
  jinnangToggle: "jinnang-toggle",
  /** 珍宝圆钮(角标=珍宝数;点开珍宝藏品弹层)。 */
  pileTreasures: "pile-treasures",
  /** 名将圆钮(角标=名将数/3 上限;点开名将藏品弹层)。 */
  pileHeroes: "pile-heroes",

  // ── 设置弹层(#700:顶左齿轮;战报/音效/版本/回主页入口降级入内)──
  /** 弹层容器(ui/dialog 底件,题名可拖)。 */
  settingsDialog: "settings-dialog",
  /** 音效开关(Base UI Switch;开=有声,接原 AudioProvider 单通道静音账本)。 */
  settingsSfx: "settings-sfx",
  /** 战报入口行(点开战报抽屉;数据照记,入口降级)。 */
  settingsWarReport: "settings-war-report",
  /** 回到主页行(弃局离屏:销毁控制器回 setup)。 */
  settingsHome: "settings-home",
  /** 属性浮签内容件(Tip 组件的 Popup;hover/长按/聚焦三通路同签)。 */
  attrTip: "attr-tip",

  // ── 席位格列(#698 重形)──

  // ── 战报抽屉(#255;#700 起入口降级设置弹层,把手与未读角标退役,抽屉本体保留)──
  logDrawer: "log-drawer",
  /** 「加载更早」:窗口化渲染(#战报性能)按窗放开更早历史的按钮。 */
  logEarlier: "log-earlier",

  // ── 藏品弹层(#361;#700 起入口=右下三圆钮 pile-treasures/pile-heroes,
  //  牌架双入口 testid 随 RackEntry 退役核销)──
  /** 两独立弹层容器(无互切页签;右上 X 关闭,关闭钮 testid 共用)。 */
  treasureModal: "treasure-modal",
  heroModal: "hero-modal",
  modalClose: "modal-close",
  /** 弹窗题名拖动把手(#674,与 modal-close 同族):两壳(ui/dialog 底件系与
   *  BannerShell 横幅系)的题名行 handle 同挂;叠层时 e2e 用容器作用域区分。 */
  modalDragHandle: "modal-drag-handle",

  // ── 窥探弹层(#575,军情密探即时窥探;viewer-only 演出)──
  /** 弹层容器(PileShell 壳;仅 viewer=本座渲染,关闭即清)。 */
  peekModal: "peek-modal",
  /** 被窥锦囊牌面(cardId=牌名;弹层内容区点击即关闭)。 */
  peekCard: (cardId: string) => `peek-card-${cardId}` as const,
  /** 空手牌空态(「囊中空空」浅印;目标有效性对手牌数无守卫,真业务态)。 */
  peekEmpty: "peek-empty",
  /** 扩展将旗(#378 渲染 hook,挂 HeroCardFace;heroId=名将 id,无旗不渲染)。 */
  heroFlag: (heroId: string) => `hero-flag-${heroId}` as const,

  // ── 技能全览弹框(#605,规格 #603 T2:卡面技名 chips 的唯一详情出口)──
  /** 弹层容器(PileShell 壳;点卡面任一技名 chip 弹出,只读无命令钮)。 */
  skillGlossary: "skill-glossary",
  /** 技能行(skillId=技 id;被点技挂 is-hl 高亮类)。 */
  skillGlossaryRow: (skillId: string) => `skill-glossary-row-${skillId}` as const,
  /** 卡面技名 chip 定位选择器(chip 挂 data-skill=技 id,渲染单源在 HeroCardFace;
   *  e2e 点 chip 走此选择器,勿裸写属性串)。 */
  skillChip: (skillId: string) => `[data-skill="${skillId}"]` as const,
  skillChipAny: "[data-skill]" as const,

  // ── 名下城池清单弹层(#622,规格 #621:席位格/仪表条城池图标点开)──
  /** 弹层容器(PileShell 壳,朱印「城」;只读清单,零操作项,随快照实时重渲)。 */
  cityLedger: "city-ledger",
  /** 城池行(propertyId=城 id;行序=棋盘 index 序)。 */
  cityLedgerRow: (propertyId: string) => `city-ledger-row-${propertyId}` as const,
  /** 行首真实格缩略图(#623:非交互 Tile 复用 svg 壳;propertyId=城 id)。 */
  cityLedgerThumb: (propertyId: string) => `city-ledger-thumb-${propertyId}` as const,
  /** 空态(「名下暂无城池」浅印;名下无城=真业务态,未购地/破产清场均可达)。 */
  cityLedgerEmpty: "city-ledger-empty",

  // ── 动作条(#256 出牌阶段态:旧弹窗退役,浮于仪表条上缘,两段制)──
  /** 动作条容器(卡牌段=出牌/不出;目标段=选择目标标签+作罢)。 */
  actionbar: "actionbar",
  /** 卡牌段「出牌」确认钮(选中放大牌后可用;未选中=禁用)。 */
  actionbarPlay: "actionbar-play",
  /** 卡牌段「不出」(今不用;牌不消耗)。e2e 放行点(原 scroll-jinnang-pass 语义平移)。 */
  actionbarPass: "actionbar-pass",
  /** 目标段「选择目标」标签(信息件,非按钮)。 */
  actionbarTarget: "actionbar-target",
  /** 目标段「作罢」(收回此计牌:不消耗、不记冷却)。 */
  actionbarCancel: "actionbar-cancel",
  /** 目标段席位点击层(真按钮;点席位=选中/再点同席取消,打出走动作条「出」,#417)。
   *  自选目标起仪表条身份区「你」印在目标段兼任自己候选钮,复用本族 testid
   *  (对手席位格与仪表条同一选择器通路)。 */
  seatTarget: (seat: number) => `seat-target-${seat}` as const,

  // ── 手牌架(#238 常驻;#256 出牌阶段态;#254 叠加压缩)──
  /** 锦囊(#122):己方手牌容器 / 单张牌面(带牌名)。#238/T3:jinnangHand 挂手牌架的
   *  「手牌行」(有牌才存在);架本体挂 jinnangRack(常驻)。 */
  jinnangHand: "jinnang-hand",
  jinnangCard: (cardId: string) => `jinnang-card-${cardId}` as const,
  /** #238/T3:底部常驻手牌架容器(架首章 + 手牌行/空态牌背)。 */
  jinnangRack: "jinnang-rack",
  /** #238/T3:点牌详情弹层容器(ui/dialog 底件,桌面底部面板/窄屏抽屉双皮)。 */
  jinnangDetail: "jinnang-detail",
  diceFace: "dice-face",
  /** 决策按钮(交互重构后按钮本体住在各决策卷轴里,testid 命名不变,减少 e2e 震荡)。 */
  actionButton: (action: string) => `action-${action}` as const, // action-buy / action-skip / …

  // ── 拼点签面(#637,ADR-0030 全屏拼点演出;一次性演出,全桌同见)──
  /** 全屏签面幕容器(幕启→并行摇→错拍落→判词→渐出;append 到 body,非棋盘层)。 */
  duelOverlay: "duel-overlay",
  /** 参与者签面(seat = 绝对座位号;签头=玩家色底+国号,签身=骨牌大字)。 */
  duelSign: (seat: number) => `duel-sign-${seat}` as const,
  /** 中缝朱砂「拼」印(data-verdict = pending|win|tie 判词态;tie 钤变金「平」)。 */
  duelVerdict: "duel-verdict",

  // ── 定制问询弹层(#424,ADR-0022 交互 handler 客户端半边;scroll-* 前缀族)──
  /** 问询弹层容器(横幅制式;题名随呈现意图,缺省「问询」)。 */
  inquiryScroll: "scroll-inquiry",
  /** 问询选项(下标 = snapshot.choices 序):blindCards 意图下=牌背钮,通用意图下=笺钮。 */
  inquiryOption: (index: number) => `scroll-inquiry-option-${index}` as const,

  // ── 反应窗(#281,#234 P1-D 牌架即反应窗)──
  /** 结算事件横幅(从手牌架上缘长出;仅被询问座位渲染)。 */
  reactionBanner: "reaction-banner",
  /** 左段事件文案(「X 使用【火烧连营】」/「X 行军将过你的城池」)。 */
  reactionText: "reaction-text",
  /** 右段朱砂倒计时弧(SVG,随剩余时间收敛)。 */
  reactionTimer: "reaction-timer",
  /** 落印确认墨钮(选中反应牌且 AOE 份已定时可用)。 */
  reactionConfirm: "reaction-confirm",
  /** 「不用」立即应答钮。 */
  reactionDecline: "reaction-decline",
  /** 降噪口「本回合不再询问」(点下即对当前窗应答不用,同回合后续询问静默代发)。 */
  reactionMute: "reaction-mute",
  /** AOE 选份候选笺(横征暴敛等全体域:点笺=定被保护份;seat=被保护座位,含自己)。 */
  reactionSeat: (seat: number) => `reaction-seat-${seat}` as const,

  // ── 托管:autopilot-button 常量随钮退役(头部 #700 核销注),通路=自机格弹层
  //  托管开关 seatPopAutopilot 族(#701;react-online-autopilot 已改写)──

  // ── 覆盖提示 ──
  hint: "hint", // App.tsx(设置屏兜底)也引用本常量,勿裸写字符串
  thinking: "thinking",
  waitingBar: "waiting-bar", // G-3/16/21 统一等待状态条(WaitingBar.tsx)
  /** 竖屏手机「请横屏」提示层(#276 纠偏:移动端只做横屏形态;显隐全在 layout.css
   *  媒询,常驻 DOM——桌面窄窗口 pointer:fine 不触发)。 */
  rotateHint: "rotate-hint",

  // ── 棋盘区小组件 ──
  // #700 退役核销:mute-button(音乐钮,音效开关降级入设置弹层 settings-sfx)、
  // reset-view(总览复位钮,usePanZoom reset 一并退役)随旧顶栏退役,常量删除。

  // ── 选都确认(#35:按钮搬进城池详情卷轴,testid 不变,e2e 选择器零震荡)──
  /** 详情卷轴选都模式的「定都于此」按钮(旧独立确认框容器 testid 已退役)。 */
  confirmCapitalOk: "confirm-capital-ok",
  confirmCapitalCancel: "confirm-capital-cancel",

  // ── 未开局兜底页(S9)──
  /** 「尚未开局」卡片的「回到首页」按钮(快照缺失时的引导逃生口)。 */
  notStartedBack: "not-started-back",

  // ── 席位格交互(#701,spec #697 ④):格 tap 单人格弹层 + 格上图标直达明细 ──
  /** 单人格弹层容器(seat = 座位号;tap 格面开,点外/Esc 关,挂载不夺焦)。 */
  seatPop: (seat: number) => `seat-pop-${seat}` as const,
  /** 弹层头现金章(千分位全称带「两」,与格上裸数口径区隔)。 */
  seatPopCash: (seat: number) => `seat-pop-cash-${seat}` as const,
  /** 弹层体力/声望/委任数值本体(纯数文本,e2e 与投影逐字对照)。 */
  seatPopStamina: (seat: number) => `seat-pop-stamina-${seat}` as const,
  seatPopRep: (seat: number) => `seat-pop-rep-${seat}` as const,
  seatPopWarrant: (seat: number) => `seat-pop-warrant-${seat}` as const,
  /** 弹层四徽章(attr ∈ city|hand|hero|gem;可点项挂 .click 金描边+尾「›」)。 */
  seatPopBadge: (seat: number, attr: string) => `seat-pop-badge-${attr}-${seat}` as const,
  /** 自机弹层托管开关(接现役托管引擎通路,行为=旧托管钮;仅自机格弹层渲染)。 */
  seatPopAutopilot: (seat: number) => `seat-pop-autopilot-${seat}` as const,
  /** 格上图标直达四明细弹层容器(战盔→名录 / 玉璧→珍宝列表 / 墨竹→声望 / 卷轴→委任)。 */
  seatHeroModal: "seat-hero-modal",
  seatGemModal: "seat-gem-modal",
  seatRepModal: "seat-rep-modal",
  seatWarrantModal: "seat-warrant-modal",
  /** 声望明细里程碑章(m = 门槛值 30|60|90;已献=金章 .claimed,未献=素章)。 */
  seatRepMilestone: (m: number) => `seat-rep-milestone-${m}` as const,

  // ── 诸侯总览弹窗(#702,spec #697 ⑥):顶左 ☰ 点开的十列名录直读分板 ──
  /** 弹层容器(ui/dialog 底件,题名可拖;打开不暂停对局,行随快照实时重渲)。 */
  warlordsOverview: "warlords-overview",
  /** 总览行(seat = 座位号,座序即行序;十列 grid 一人一行)。状态类挂点:
   *  自机行 .self 金描边 / 破产行 .dead 灰化 / 活跃方 .is-active(印金圈)。 */
  warlordsRow: (seat: number) => `warlords-row-${seat}` as const,
  /** 行内数值本体(cash/stamina/hand/rep/warrant;纯数文本,e2e 与投影逐字对照)。 */
  warlordsCash: (seat: number) => `warlords-cash-${seat}` as const,
  warlordsStamina: (seat: number) => `warlords-stamina-${seat}` as const,
  warlordsHand: (seat: number) => `warlords-hand-${seat}` as const,
  warlordsRep: (seat: number) => `warlords-rep-${seat}` as const,
  warlordsWarrant: (seat: number) => `warlords-warrant-${seat}` as const,
  /** 城池列(真按钮):城池名 chips 黛青,超 3 折叠「+N」;点击开 #622 名下城池清单。 */
  warlordsCities: (seat: number) => `warlords-cities-${seat}` as const,
  /** 名将列:麾下名将名 chips 朱砂 + 空槽(信息公开,纯展示)。 */
  warlordsHeroes: (seat: number) => `warlords-heroes-${seat}` as const,
  /** 珍宝计数槽(槽位=件数示意,空槽画空格;维持计数不开名录)。 */
  warlordsGems: (seat: number) => `warlords-gems-${seat}` as const,
} as const;
