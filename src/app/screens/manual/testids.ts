// 手册 data-testid 单源(#1070,spec #1069 T1 一次定全):弹层壳 + 五签 + 卡片/
// 详情参数化工厂。T2/T3 填肉与 T4 e2e 只消费不新增,缺了回 #1070 补;命名约定同其余
// testids:kebab-case,前缀 manual- 防串扰(弹层经 Portal 挂 body,作用域靠前缀)。
export const MANUAL_TID = {
  /** 手册全区锚(弹层内容包络,包题名行/五签行/体部;T4 断言手册在场的定位口)。 */
  screen: "manual-screen",
  /** 弹层容器(ui/dialog 底件,题名可拖;顶带 ≥44px 让位,ADR-0049)。 */
  modal: "manual-modal",
  /** 右上 X 关闭钮。 */
  close: "manual-close",
  /** 题名行拖动把手(#674 同族;手册自有前缀,不入 game 的 modal-drag-handle 族)。 */
  dragHandle: "manual-drag-handle",
  /** 体部内滚容器(#708 同规范;T4 内滚可达/不溢出断言定位口)。 */
  body: "manual-body",
  /** 五签 tab(签序=名将/技能/锦囊/珍宝/机遇,spec #1069 决议④)。 */
  tabHeroes: "manual-tab-heroes",
  tabSkills: "manual-tab-skills",
  tabJinnang: "manual-tab-jinnang",
  tabTreasures: "manual-tab-treasures",
  tabEncounters: "manual-tab-encounters",
  /** 卡片(目录 id 参数化工厂;T2/T3 装配卡墙时挂)。 */
  card: (id: string) => `manual-card-${id}` as const,
  /** 详情叠层容器(目录 id 参数化工厂;T2/T3 装配详情时挂)。 */
  detail: (id: string) => `manual-detail-${id}` as const,
} as const;
