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
export const TESTIDS = {
  // ── 三区布局(#253):顶部条 / 席位竖卡列 / 底部仪表条 ──
  topBar: "top-bar",
  topbarRound: "topbar-round",
  /** 活跃方名 chip(「X之回合」;终局=「「X」称帝」)。 */
  topbarActive: "topbar-active",
  topbarTarget: "topbar-target",
  topbarDeck: "topbar-deck",
  topbarDiscard: "topbar-discard",
  /** 席位竖卡列容器(含右列/左列/顶行三槽位)。 */
  seatRail: "seat-rail",
  /** 席位竖卡(seat = 绝对座位号);观战与自身不出卡。 */
  seat: (seat: number) => `seat-${seat}` as const,
  seatCash: (seat: number) => `seat-cash-${seat}` as const,
  /** 体力血条(条内数字即刻度;low 类转红)。 */
  seatStamina: (seat: number) => `seat-stamina-${seat}` as const,
  /** 属性徽章(attr ∈ warrant|city|hand|rep|gem|hero;值裸排,名词在 aria-label)。 */
  seatAttr: (seat: number, attr: string) => `seat-attr-${attr}-${seat}` as const,
  dashboardBar: "dashboard-bar",
  /** 全屏唯一现金大数。 */
  dashCash: "dash-cash",
  /** 仪表条属性徽章(attr ∈ warrant|city|rep;值裸排,名词在 aria-label)。 */
  dashAttr: (attr: string) => `dash-attr-${attr}` as const,
  dashStamina: "dash-stamina",
  /** 珍宝/名将计数徽章(纯展示计数,#361 起不可点——明细看牌架双入口)。 */
  dashTreasures: "dash-treasures",
  dashHeroes: "dash-heroes",
  /** 仪表条身份头的「你」印(观战为灰「观」印,不挂本 testid)。 */
  dashYou: "dash-you",
  /** 属性浮签内容件(Tip 组件的 Popup;hover/长按/聚焦三通路同签)。 */
  attrTip: "attr-tip",

  // ── 战报抽屉(#255):仪表条上缘右角竖把手 + 右缘抽屉(对局日志渲染)──
  logTab: "log-tab",
  logDrawer: "log-drawer",
  /** 「加载更早」:窗口化渲染(#战报性能)按窗放开更早历史的按钮。 */
  logEarlier: "log-earlier",

  // ── 牌架双入口与藏品弹层(#361,expandPile 明细行退役核销)──
  /** 架右端并排入口小件:点「珍宝」开珍宝弹层、点「名将」开名将弹层(标题随入口)。 */
  rackTreasures: "rack-treasures",
  rackHeroes: "rack-heroes",
  /** 两独立弹层容器(无互切页签;右上 X 关闭,关闭钮 testid 共用)。 */
  treasureModal: "treasure-modal",
  heroModal: "hero-modal",
  modalClose: "modal-close",
  /** 扩展将旗(#378 渲染 hook,挂 HeroCardFace;heroId=名将 id,无旗不渲染)。 */
  heroFlag: (heroId: string) => `hero-flag-${heroId}` as const,

  // ── 动作条(#256 军师窗态:军师幕弹窗退役,浮于仪表条上缘,两段制)──
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
  /** 目标段席位点击层(真按钮覆盖席位卡;点席位即出,免二次确认)。 */
  seatTarget: (seat: number) => `seat-target-${seat}` as const,

  // ── 手牌架(#238 常驻;#256 军师窗态;#254 叠加压缩)──
  /** 锦囊(#122):己方手牌容器 / 单张牌面(带牌名)。#238/T3:jinnangHand 挂手牌架的
   *  「手牌行」(有牌才存在);架本体挂 jinnangRack(常驻,观战除外)。 */
  jinnangHand: "jinnang-hand",
  jinnangCard: (cardId: string) => `jinnang-card-${cardId}` as const,
  /** #238/T3:底部常驻手牌架容器(架首章 + 手牌行/空态牌背)。 */
  jinnangRack: "jinnang-rack",
  /** #238/T3:点牌详情弹层容器(ui/dialog 底件,桌面底部面板/窄屏抽屉双皮)。 */
  jinnangDetail: "jinnang-detail",
  diceFace: "dice-face",
  /** 决策按钮(交互重构后按钮本体住在各决策卷轴里,testid 命名不变,减少 e2e 震荡)。 */
  actionButton: (action: string) => `action-${action}` as const, // action-buy / action-skip / …

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

  // ── 托管(联机;spec: autopilot)──
  autopilotButton: "autopilot-button",
  autopilotSpeed: "autopilot-speed",

  // ── 覆盖提示 ──
  hint: "hint", // App.tsx(设置屏兜底)也引用本常量,勿裸写字符串
  thinking: "thinking",
  waitingBar: "waiting-bar", // G-3/16/21 统一等待状态条(WaitingBar.tsx)
  /** 竖屏手机「请横屏」提示层(#276 纠偏:移动端只做横屏形态;显隐全在 layout.css
   *  媒询,常驻 DOM——桌面窄窗口 pointer:fine 不触发)。 */
  rotateHint: "rotate-hint",

  // ── 棋盘区小组件 ──
  muteButton: "mute-button",
  /** 总览复位(还原 pan/zoom;等价旧 BoardView.resetView)。 */
  resetView: "reset-view",

  // ── 选都确认(#35:按钮搬进城池详情卷轴,testid 不变,e2e 选择器零震荡)──
  /** 详情卷轴选都模式的「定都于此」按钮(旧独立确认框容器 testid 已退役)。 */
  confirmCapitalOk: "confirm-capital-ok",
  confirmCapitalCancel: "confirm-capital-cancel",

  // ── 未开局兜底页(S9)──
  /** 「尚未开局」卡片的「回到首页」按钮(快照缺失时的引导逃生口)。 */
  notStartedBack: "not-started-back",
} as const;
