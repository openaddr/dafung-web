// 时长常量(bot 延时/动画节奏),集中调参——迁移自 src/render/timings.ts,
// 并补阶段 6 新增的行军/瞬时特效时长(render/ 删除前两处不要交叉引用)。
// 与 CSS 动效 token 的关系(C8 #107):唯一源 core/theme.ts Motion,gen:theme 产出 tokens.css。
// 本文件数值恰等于某 --dur-* 的字段直接引用 Motion(app→core 单向依赖,theme.ts 零依赖无环),
// 改 Motion 一处 CSS/JS 同步;不等的字段是编排窗口(非 token 节拍),保留字面量单独调参。
import { Motion } from "@core/theme";

/** e2e 时间倍率(#114):共享 fixture 在页面加载前写入 localStorage;生产/真人局
 *  无此键,S===1 时 sc 直通(不落地板——80ms 级短拍必须保持原值)。 */
export const E2E_TIME_SCALE_KEY = "dafung-e2e-time-scale";
/** e2e 调试桥门禁键(双门禁之一,同 ZCode VITE_ZCODE_E2E_STORE_BRIDGE 口径):
 *  `__dafung` 引擎钩子只在 `import.meta.env.DEV` 或本键非空时注册——生产构建
 *  默认不暴露引擎改写面(单机模式控制台可作弊/误触),e2e 与截图脚手架经
 *  addInitScript 预置本键即开,测试/生产分野不靠约定靠门禁。 */
export const E2E_DEBUG_BRIDGE_KEY = "dafung-e2e-debug-bridge";
/** e2e 反应窗时长覆盖(单机,毫秒):联机的同款配置经 server env E2E_REACTION_MS
 *  注入 registry(#284);单机进程内房间(LocalController)经本键走同一 registry
 *  选项。键由 e2e fixtures 页面加载前写入;生产/真人局无此键=不覆盖,走 core
 *  REACTION_WINDOW_MS 常量表——配置缺席不是兜底,与 server.ts 同模式。 */
export const E2E_REACTION_MS_KEY = "dafung-e2e-reaction-ms";
/** 读反应窗覆盖(0 = 不覆盖):无 localStorage 环境(bun 单测跑 app 模块)按未注入。 */
export const e2eReactionWindowMs = (): number => {
  if (typeof localStorage === "undefined") return 0;
  return Number(localStorage.getItem(E2E_REACTION_MS_KEY) ?? "") || 0;
};
/** 地板:headless+软渲下 expect 轮询的可观察下限,保瞬态演出(骰子签面/横幅)可被断言。 */
export const TIME_SCALE_FLOOR_MS = 100;

/** 缩放工厂(纯函数单测缝):乘倍率、四舍五入、地板托底;非法倍率按 1 语义(仍带地板)。 */
export const makeScaler = (scale: number): ((ms: number) => number) => {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return (ms) => Math.max(Math.round(ms * s), TIME_SCALE_FLOOR_MS);
};

const S = (() => {
  if (typeof localStorage === "undefined") return 1;
  const raw = Number(localStorage.getItem(E2E_TIME_SCALE_KEY) ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
})();
/** e2e 时间缩放(模块内约定俗成的 sc;desk.ts 等新演出模块同源取数,不各自造轮子)。 */
export const sc = S === 1 ? (ms: number) => ms : makeScaler(S);

export const BOT = {
  stepDelayMs: sc(750),
} as const;

/** 令牌行军(旧 animate.ts animateMove 的逐段节奏,语义不变):
 *  每段时长 ∝ 距离(匀速),夹在 [minSegMs, maxSegMs] 之间。 */
export const MARCH = {
  minSegMs: sc(80),
  maxSegMs: sc(460),
  /** 像素/秒:距离 ÷ speed = 段时长(旧实现 dist / 720,单位 px/s) */
  speed: 720,
  /** 每段 transition 结束后的额外缓冲。S6(#39):10→0——缓动改 easeInOutSine
   *  (board.css .bv-token-marching)后段尾速度趋零,10ms 硬等待反成顿挫;
   *  无缝衔接读作一气呵成,终点落定感由缓动尾段承担。 */
  segSlackMs: 0,
} as const;

/** 瞬时特效存活时长(与 fx.css 的 keyframe 时长保持一致;超时自清防 store 积压)。
 *  CSS 侧时长/缓动唯一源 core/theme.ts Motion(经 gen:theme 产出 tokens.css):
 *  floaterMs/bannerMs 与 --dur-fx/--dur-banner 同源(经 Motion);bannerMs 的
 *  +100 清理余量保留字面量。coinMs/sealMs/roadFlowMs 不等于任何 token,是编排窗口,
 *  保留字面量,与编排类 keyframe 硬同步,改任一侧须两处同改。 */
export const FX = {
  floaterMs: sc(Motion.dur.fx), // 与 --dur-fx 同源(经 Motion)
  coinMs: sc(1500),
  bannerMs: sc(Motion.dur.banner + 100), // fx-banner-fly 全长同源(--dur-banner,经 Motion)+ 100 清理余量(#117 同源化,余量保留字面量)
  /** C3 回合横幅占用编排时长:等横幅走到峰值停留段(1.8s 动画的 20%-75% 区间),
   *  取 1.0s——下一演出(骰子)不再与横幅入场重叠,又不把回合节奏拖满全长。 */
  bannerHoldMs: sc(1000),
  sealMs: sc(900),
  roadFlowMs: sc(700), // 驿道流光高亮存留
  /** 出牌指示线全程存活(#281 P2-E):生长 200ms → 停 200ms → 淡出 300ms(FreeKill
   *  IndicatorLine 同参数),三段编排进 fx.css 的单条 keyframes(百分比刻度),本值
   *  只作 store 清理窗口与动画全长硬同步,改任一侧须两处同改。 */
  jinnangLineMs: sc(700),
  /** 落格定音金圈一拍(S7 #513):fx-svg-pulse 全长 0.65s + 清理余量,fx.css 同名
   *  keyframe 硬同步,改任一侧须两处同改。 */
  landPulseMs: sc(750),
  /** 都城停全屏横幅存活(S7 #513):fx-halt-banner-fly 全长 2.2s + 清理余量,
   *  与 fx.css 同名 keyframe 硬同步(特例字面量,同 seal/骰签口径)。 */
  haltBannerMs: sc(2400),
  /** 都城停横幅占用编排时长(同 bannerHoldMs 口径):等入场展开+驻停读过一拍,
   *  驻章与补给铜钱雨在其后接续。 */
  haltHoldMs: sc(1400),
  /** 破产仪式墨渍晕开全程(S7):fx-inkblot-bloom 1s + 清理余量,fx.css 硬同步。 */
  inkBlotMs: sc(1100),
  /** 破产仪式撒币全程(S7):fx-coin-burst 1.3s + 清理余量,fx.css 硬同步。 */
  coinBurstMs: sc(1400),
} as const;

/** 掷骰签面节奏(#483 3D 骰退役,签面转正为唯一掷骰演出;时长集中调参)。
 *  S7 两段式(#513/#492 拍板:标准档摇签 0.6s):先摇签段(墨字虚影 60ms 级轮换,
 *  全段恰 10 次换签,DiceOverlay 按 shakeMs/10 求轮换周期)→ 大字 outBack 落定
 *  (金圈同拍+桌面微震 4px,desk.ts)→ 停留 → 渐隐。
 *  C1 bot 掷骰半速:bot 摇签/停留都压半,回合节奏优先。任何掷骰(含 bot)结束后
 *  都有 ≥300ms 可读结果(holdMs+fadeOutMs,由 test/choreography-invariants.test.ts
 *  钉住;非终局局的承诺——终局封场(orchestrator.finishPresentation)后骰子演出
 *  可在事件边界被整体截断,是生命周期规则不是回归)。
 *  与 token 同值者(holdMs=--dur-reveal / botHoldMs=--dur-slow / fadeOutMs=--dur-med)
 *  经 Motion 取数;改 Motion 一处 CSS/JS 同步。摇签段无 token 对应,保留字面量。 */
export const DICE = {
  shakeMs: sc(600), // 摇签段(人类标准档 0.6s,#492);fx.css .dice-sign-shaking 虚影态同段硬同步
  botShakeMs: sc(300), // 摇签段(bot 半速档)
  holdMs: sc(Motion.dur.reveal), // 签面停留(人类);与 --dur-reveal 同源(经 Motion)
  botHoldMs: sc(Motion.dur.slow), // 签面停留(bot 半速档);与 --dur-slow 同源(经 Motion)
  fadeOutMs: sc(Motion.dur.med), // overlay 渐隐退场;与 --dur-med 同源(经 Motion),fx.css .dice-overlay-out 消费同一 token
} as const;

/** 拼点演出节拍(#637,ADR-0030,全屏签面 DuelSignsOverlay 消费):错拍/判词两拍
 *  延续既有拼点节拍(ADR-0030 原文「签面落定延续既有拼点节拍」;旧棋盘双印的节拍组
 *  随 T3 #638 整线退役,组名与两拍原值留用)。全组经 sc 缩放;签面整场固定全速,
 *  不随 bot 半速(公共大事件非回合等待,#637 口径)。 */
export const DUEL = {
  curtainMs: sc(200), // 签面·幕启:玄墨幕渐入+两签虚位
  shakeMs: sc(600), // 签面·并行起摇:虚影轮换段(与 DICE.shakeMs 同值,语义独立——全速恒定)
  clackGapMs: sc(150), // 签面·座位序错拍落定间隙(第二签延迟落定的空拍;各拍落定自发声)
  verdictMs: sc(520), // 签面·末签落定→判词拍:金圈/沉暗/金「平」钤落(stamp 音,大胜负同拍震屏)
  holdMs: sc(600), // 签面·判词停留
  fadeOutMs: sc(Motion.dur.med), // 签面·整幕渐出;与 --dur-med 同源(经 Motion),fx.css .duel-overlay-out 消费同一 token
  /** 拼点大胜负点差(S7 #492 震屏大事件档):|a−b|≥本值判词拍震屏(DESIGN §6)。
   *  时间表里只此一个非时长字段,签面判词拍同源取数。 */
  blowoutMargin: 3,
} as const;

/** 破产仪式时间轴(S7 #513,三拍:倒旗→墨渍→撒币):累计毫秒锚点(经 sc 缩放),
 *  sinks.bankruptCeremony 串行消费。与 fx.css fx-flag-fall(1.1s)/fx-inkblot-bloom
 *  (1s)/fx-coin-burst(1.3s)硬同步,改任一侧须两处同改。 */
export const CEREMONY = {
  fallMs: sc(1100), // 旌旗缓倒全长(墨渍在其尾段 1.0s 拍开晕)
  blotAtMs: sc(1000), // 铭牌墨渍晕开起始拍
  coinsAtMs: sc(1500), // 铜钱撒落拍(coinsBox 音同拍)
  settleMs: sc(2600), // 仪式收口(撒币看完再交还编排链)
  coinCount: 10, // 撒币枚数(8–12 档中值,#492 决议)
} as const;

export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 幽灵帧协议(#107 批次 6 收编 #117):useGhostChild 的退场帧驻留时长——子节点身份
 *  变化后上一帧快照再渲染多久。与 ScrollShell closing 出口同一条 210 口径:收起动画
 *  scroll-anim-rollback 走 --dur-fast = 150ms(Motion.dur.fast,经 gen:theme),210 =
 *  150 + 60ms 余量,保证动画播完有余再卸载。刻意字面量而不读运行时 CSS——
 *  getComputedStyle 首帧未就绪且触发强制布局;同源关系以此注释钉死,改 --dur-fast 时
 *  这里要跟着核一遍。 */
export const GHOST = {
  frameMs: sc(210),
} as const;

/** 托管代打空转(#117 收编):local.ts apLoop 在无人类决策点时(真 bot 轮次由 runBots
 *  驱动/Setup 待手选)的轮询间隔——空转让步,不与 bot 节奏(BOT.stepDelayMs)混用。 */
export const AUTOPILOT = {
  idleMs: sc(200),
} as const;

/** 行军自动化(#188 第 1 步):人类回合 Roll 相位的自动起摇节奏。
 *  进入 Roll 后等 rollAtMs(约 1s,起签的静默酝酿拍)→ 钤「签」印起签 →
 *  再等 qiqianMs(约 0.8s,起签印章的驻留)→ 自动 rollAndMove(与手点同一条命令路径)。
 *  服务器侧(room.ts)的同类定时用固定 1s:scripts 不吃 localStorage 倍率,见 room.ts 注释。 */
export const AUTO_MARCH = {
  rollAtMs: sc(1000),
  qiqianMs: sc(800),
} as const;

/** 反应窗时长缩放包装(#281 引入,#284 单源收口):开窗时长的权威值是
 *  `ReactionView.windowMs`(引擎开窗时查 core/constants REACTION_WINDOW_MS 写入,
 *  随快照 view 走;联机权威侧可经服务器 env E2E_REACTION_MS 覆盖,两端同长自动成立)。
 *  UI 倒计时弧/横幅与单机权威侧定时器(LocalController)一律「取 windowMs → 过本函数」
 *  消费,不再各自引常量表(双源消灭);E2E_TIME_SCALE 缩放通道(#225)收口在此。 */
export const scaleReactionMs = (windowMs: number): number => sc(windowMs);

/** 界面层反馈节奏(#117 收编,非棋盘特效):提示/状态条的自动清除 TTL 与胜利屏
 *  交互件的延后挂载。UI 直改即生效的反馈,不吃编排链,独立于 FX/DICE 调参。 */
export const UI = {
  /** F4 三屏统一提示 TTL(gameStore.pushHint / netStore.pushHint 单一口径)。 */
  hintTtlMs: sc(1800),
  /** 编辑器状态条反馈自动清除(EditorScreen 保存/另存/重置/导入四处 setStatus)。 */
  statusClearMs: sc(1500),
  /** 胜利屏「再战」按钮延后挂载(E2:入场演出高潮期防误触重开)。 */
  victoryButtonMs: sc(1800),
  /** 大厅国号复制成功反馈的自动熄灭(L-7:ref 计时防重复点击提前熄灭)。 */
  copyFeedbackMs: sc(1000),
} as const;

/** 等一帧(requestAnimationFrame 两拍:先让 React commit,再拿稳定 DOM)。 */
export const nextFrame = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
