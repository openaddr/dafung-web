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
// 角标)随旧顶栏退役;dashboard-bar 系(dashCash/dashAttr/
// dashStamina/dashTreasures/dashHeroes/dashYou)随仪表条本体退役(资产数值归席位格,
// 签面迁手牌区左端,testid dice-face 不变);log-tab(战报把手)退役,入口降级设置弹层
// (log-drawer 抽屉本体保留);autopilot-button(托管钮)随仪表条退役,#701 tap 弹层
// 接管(过渡期托管不可达可接受,同一集成分支收口);mute-button/reset-view(音乐钮/
// 总览复位钮)退役——音效开关降级入设置弹层;复位能力随 #700 退役,取景恒
// computeFitView 总览定格(usePanZoom 已随 #946 平移缩放退役整删,复位语义不复存在)。
// #853 退役核销:topbar-round(「N 轮」浮置 chip)随 chip 退役——轮次唯一落回合
// 胶囊(turn-capsule,#732 拍板在先、#762 胶囊诞生后的双通道冗余,复裁退役)。
// 接替形态=顶左两钮(topbar-overview/settings-button)+ 右下三圆钮(pile-buttons 族)
// + 设置弹层(settings-* 族)+ 手牌区(hand-zone)。
// #1097 退役核销(#1096 决议1/2):seat-pop 系单源常量(seatPop/seatPopCash/
// seatPopNotice/seatPopStamina/seatPopRep/seatPopBadge/seatPopAutopilot)随单人格
// 弹层(SeatPopModal)退役——查档收编诸侯详情四钻入(warlords* 族),托管开关
// 收编设置弹层(settings-autopilot);席位格五图标退化为纯展示挂点(seatAttr 族
// 不变,名词在 aria-label)。
export const TESTIDS = {
  // ── 全浮层骨架(#700;#732 顶左行序:设置→详情两钮,顶中让给知会槽):
  //  顶部条 / 席位格列 / 手牌区 / 右下三圆钮 ──
  topBar: "top-bar",
  /** 顶左详情钮(诸侯详情弹窗入口,#732 正名;#702 点开十列分板弹层)。 */
  topbarOverview: "topbar-overview",
  /** 顶左设置钮(开设置弹层)。 */
  settingsButton: "settings-button",
  /** 战报未读金点挂件(#768):⚙ 设置钮右上 6px 金点,有未读战报时在、打开抽屉
   *  即清(GameScreen 本地已读游标,不进快照);纯视觉表达,断言只论在场与否。 */
  settingsUnreadDot: "settings-unread-dot",
  /** 席位格列容器(#698 重形:右缘单列 96×38 双行八项格,一人一格)。 */
  seatRail: "seat-rail",
  /** 席位格(seat = 绝对座位号),挂对手席;自机格挂 seatSelf(不占本族——
   *  「自身不出卡」旧契约的 e2e 以 seat-N 缺席为断言,自机入列不破它)。 */
  seat: (seat: number) => `seat-${seat}` as const,
  seatCash: (seat: number) => `seat-cash-${seat}` as const,
  /** 体力色条(#698:3px 细轨无刻度数;濒耗竭 low 类转朱砂,数值归仪表条/弹层)。 */
  seatStamina: (seat: number) => `seat-stamina-${seat}` as const,
  /** 属性计数(attr ∈ city|hand|rep|gem|hero;值裸排,名词在 aria-label)。 */
  seatAttr: (seat: number, attr: string) => `seat-attr-${attr}-${seat}` as const,
  /** 托管常驻微标(seat = 座位号,#770):托管(AI 代打)开启的席位格,国号印右 8px
   *  齿轮,纯展示挂点——开关交互唯一通路=设置弹层 settingsAutopilot(ADR-0028,
   *  #1097 起原单人格弹层开关随格 tap 退役)。 */
  seatHosted: (seat: number) => `seat-hosted-${seat}` as const,
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
  /** 托管开关(#1097 收编,#1096 决议2):Base UI Switch,接 ADR-0028 现役引擎通路
   *  (useAutopilotOn 回读 + controller.setAutoPilot);仅自机语义(本弹层只属屏前真人)。 */
  settingsAutopilot: "settings-autopilot",
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
  /** 弹层体部内滚容器(#708 矮屏规范,PileShell 壳单挂):夹高/滚动可达/滚动提示
   *  断言的定位口。 */
  modalScrollBody: "modal-scroll-body",

  // ── 窥探弹层(#575,军情密探即时窥探;viewer-only 演出)──
  /** 弹层容器(PileShell 壳;仅 viewer=本座渲染,关闭即清)。 */
  peekModal: "peek-modal",
  /** 被窥锦囊牌面(cardId=牌名;弹层内容区点击即关闭)。 */
  peekCard: (cardId: string) => `peek-card-${cardId}` as const,
  /** 空手牌空态(「囊中空空」浅印;目标有效性对手牌数无守卫,真业务态)。 */
  peekEmpty: "peek-empty",

  // ── 技能全览弹框(#605,规格 #603 T2;#818 起技能卡主技名同为入口)──
  /** 弹层容器(PileShell 壳;招贤点卡/点技名 chip、技能卡主技名、麾下将点技名弹出)。 */
  skillGlossary: "skill-glossary",
  /** 招贤拍板钮(footer「收为麾下」;仅招贤消费方传 onPick 时在场,浏览语境无钮)。 */
  skillGlossaryPick: "skill-glossary-pick",
  /** 技能行(skillId=技 id;被点技挂 is-hl 高亮类)。 */
  skillGlossaryRow: (skillId: string) => `skill-glossary-row-${skillId}` as const,
  /** 卡面技名定位选择器(挂 data-skill=技 id,渲染单源在 HeroCardFace chips 与
   *  SkillCardFace 主技名;e2e 点技名走此选择器,勿裸写属性串)。 */
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
  /** 架尾计数章(#751 C2):.many 压缩态常驻(pointer:coarse 档显示),点按=临时
   *  全展 2.5s;textContent = 手牌张数。 */
  jinnangSpreadBadge: "jinnang-spread-badge",
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

  // ── 托管:autopilot-button 常量随钮退役(头部 #700 核销注),#1097 起通路=
  //  设置弹层 settings-autopilot(原自机格弹层开关随 #1096 决议1 退役)──

  // ── 覆盖提示 ──
  hint: "hint", // App.tsx(设置屏兜底)也引用本常量,勿裸写字符串
  thinking: "thinking",
  waitingBar: "waiting-bar", // G-3/16/21 统一等待状态条(WaitingBar.tsx;#732 起渲染宿主在知会槽)
  /** 顶中知会横幅槽(#732):都城停条带/等待条/常驻回合胶囊共用的一条带容器——
   *  可排队、同槽互斥,瞬态知会优先于等待条(NoticeBanner.tsx;回合全幅横幅已退役 #958)。 */
  noticeBanner: "notice-banner",
  /** 常驻回合胶囊(回合宣告唯一形制,#762 立/#958 起):当前回合方(国号印+名号+轮次),
   *  每次宣告重挂、常驻于知会槽(NoticeBanner.tsx;融合的等待附加信息仍走 waiting-bar)。 */
  turnCapsule: "turn-capsule",
  /** 掷骰签锚点(#927,ADR-0043):知会槽内的常驻零宽件,几何=回合胶囊右缘——
   *  掷骰签定位读它。不读胶囊节点本身:bot 配速关 0 的批洪流下,宣告批可能
   *  作为过时批被吸附作废(ADR-0029),胶囊节点合法地不物化,瞬态节点不可为锚。 */
  diceSignAnchor: "dice-sign-anchor",
  /** 竖屏手机「请横屏」提示层(#276 纠偏:移动端只做横屏形态;显隐全在 layout.css
   *  媒询,常驻 DOM——桌面窄窗口 pointer:fine 不触发)。 */
  rotateHint: "rotate-hint",

  // ── 棋盘区小组件 ──
  // #700 退役核销:mute-button(音乐钮,音效开关降级入设置弹层 settings-sfx)、
  // reset-view(总览复位钮)随旧顶栏退役,常量删除;取景恒 computeFitView 总览定格
  // (#946 平移缩放退役,usePanZoom 整删,复位语义不复存在)。

  // ── 选都确认(#35:按钮搬进城池详情卷轴,testid 不变,e2e 选择器零震荡)──
  /** 详情卷轴选都模式的「定都于此」按钮(旧独立确认框容器 testid 已退役)。 */
  confirmCapitalOk: "confirm-capital-ok",
  confirmCapitalCancel: "confirm-capital-cancel",

  // ── 未开局兜底页(S9)──
  /** 「尚未开局」卡片的「回到首页」按钮(快照缺失时的引导逃生口)。 */
  notStartedBack: "not-started-back",

  // ── 席位明细弹层(#701 格上图标直达的明细族;#1097 起唯一入口=诸侯详情四钻入)──
  /** 明细弹层容器(战盔→名录 / 玉璧→珍宝列表 / 墨竹→声望;PileShell 壳)。 */
  seatHeroModal: "seat-hero-modal",
  seatGemModal: "seat-gem-modal",
  seatRepModal: "seat-rep-modal",

  // ── 诸侯详情弹窗(#702,spec #697 ⑥,#732 正名):顶左 ☰ 点开的十列名录直读分板;
  //  #1097 起四元素可点钻入(#1096 决议3):城池 chips→#622 清单 / 名将 chips→名录 /
  //  珍宝槽→列表 / 声列→声望明细(金描边+尾「›」,钻入式单层互斥)──
  /** 弹层容器(ui/dialog 底件,题名可拖;打开不暂停对局,行随快照实时重渲)。 */
  warlordsOverview: "warlords-overview",
  /** 总览行(seat = 座位号,座序即行序;十列 grid 一人一行)。状态类挂点:
   *  自机行 .self 金描边 / 破产行 .dead 灰化 / 活跃方 .is-active(印金圈)。 */
  warlordsRow: (seat: number) => `warlords-row-${seat}` as const,
  /** 行内数值本体(cash/stamina/hand/rep;纯数文本,e2e 与投影逐字对照)。 */
  warlordsCash: (seat: number) => `warlords-cash-${seat}` as const,
  warlordsStamina: (seat: number) => `warlords-stamina-${seat}` as const,
  warlordsHand: (seat: number) => `warlords-hand-${seat}` as const,
  warlordsRep: (seat: number) => `warlords-rep-${seat}` as const,
  /** 城池列(可点钻入件):城池名 chips 黛青,超 3 折叠「+N」;点击开 #622 名下城池清单。 */
  warlordsCities: (seat: number) => `warlords-cities-${seat}` as const,
  /** 名将列(可点钻入件):麾下名将名 chips 朱砂 + 空槽(信息公开);点击开名将名录。 */
  warlordsHeroes: (seat: number) => `warlords-heroes-${seat}` as const,
  /** 珍宝计数槽(可点钻入件):槽位=件数示意,空槽画空格;点击开珍宝列表。 */
  warlordsGems: (seat: number) => `warlords-gems-${seat}` as const,
  /** 声列钻入钮(seat = 座位号;数值本体 warlordsRep 单独挂——e2e 纯数断言不受
   *  钮身「声」字串扰,#1097 四钻入)。 */
  warlordsRepCell: (seat: number) => `warlords-rep-cell-${seat}` as const,

  // ── 联机连接横幅(#664 补登:挂点在 shared/ConnectionBanner,GameScreen/LobbyScreen
  //  顶部长出;断线重连状态条)──
  connectionBanner: "connection-banner",
} as const;
