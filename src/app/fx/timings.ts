// 时长常量(bot 延时/动画节奏),集中调参——迁移自 src/render/timings.ts,
// 并补阶段 6 新增的行军/瞬时特效时长(render/ 删除前两处不要交叉引用)。
// 与 CSS 动效 token 的关系(C8 #107):唯一源 core/theme.ts Motion,gen:theme 产出 tokens.css。
// 本文件数值恰等于某 --dur-* 的字段直接引用 Motion(app→core 单向依赖,theme.ts 零依赖无环),
// 改 Motion 一处 CSS/JS 同步;不等的字段是编排窗口(非 token 节拍),保留字面量单独调参。
// #610 起分两条缩放通道,下方时长表全是各自通道的活投影(getter),取数时求值:
//   演出编排时长(MARCH/FX/DICE/DUEL/CEREMONY 五族 + desk 震屏)吃 scStage =
//   e2e 键 × 追帧除法(ADR-0029 ③ 正典方向:积压越深播得越快,1.5~3x 压缩);
//   界面/节拍类(UI.*、GHOST、AUTO_*、BOT、反应窗倒计时弧、判据时距)只吃 sc
//   (e2e 键)——它们不是棋盘演出,压缩治不了积压、只会与权威节拍失配。
// 追帧速度倍率变化即时作用于播放期取数,无键无追帧时逐位恒等(直通不落地板)。
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
/** e2e bot 步进配速覆盖(单机,毫秒;#730):联机的同款配置经 server env
 *  E2E_BOT_STEP_MS 注入 registry;单机进程内房间(LocalController)经本键走同一
 *  registry 选项 botStepMs。null = 键缺席(生产/真人局/bun 单测),生产装配层走
 *  core BOT_STEP_MS;显式 "0" = 关配速(e2e 提速通道)。 */
export const E2E_BOT_STEP_MS_KEY = "dafung-e2e-bot-step-ms";
/** 读 bot 步进配速覆盖(null = 未注入):键值非法(负数/非数)按未注入。 */
export const e2eBotStepMs = (): number | null => {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(E2E_BOT_STEP_MS_KEY);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
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

// ── 追帧运行时速度倍率(#610,ADR-0029 不变量③轻档)──
// 生产由 SnapshotEffects 出队点判档驱动(积压越深倍率越高,LAG.scaleMin~scaleMax,
// 回落到线即回 1);e2e/单测从不驱动(判据主尺 = 到达序游标差,机器时间,天然不误触发)。
// 域 = 速度倍率(#570 决议正典:「积压越深播得越快,1.5~3x 全演出压缩」),消费在
// scStage 的除法里(时长 = 基准 ÷ 倍率)。评审实锤(#608-#611 复审 F1):旧实现把
// 倍率乘进时长,积压越深播得越慢,方向与决议相反——本域注释即钉死教训。与 e2e 键的
// 合成在 scStage:两通道语义正交(整局时间轴缩放 vs 应急速播),除法天然同向可组合。
let catchupScale = 1;

/** 设置追帧运行时速度倍率(唯一生产调用口 = SnapshotEffects 判档路径):非法值当场炸
 *  (零兜底)——倍率是确定事实,静默夹取会掩盖判档 bug;<1 = 减速,与「追帧」相反,同炸。 */
export const setCatchupScale = (scale: number): void => {
  if (!(Number.isFinite(scale) && scale >= 1))
    throw new Error(`setCatchupScale:非法追帧速度倍率 ${scale}`);
  catchupScale = scale;
};

/** 界面/节拍时长缩放(模块内约定俗成的 sc):只吃 e2e 键,追帧倍率不进门——反应窗
 *  倒计时弧必须与权威窗同长(scaleReactionMs),UI TTL、GHOST、AUTO_MARCH/AUTOPILOT、
 *  bot 节拍都不是棋盘演出(追帧是播放侧治理,产出端节拍不配套,ADR-0029 判据基调)。
 *  无键时直通(不落地板,80ms 级短拍保持原值)。 */
export const sc = (ms: number): number => {
  if (S === 1) return ms;
  return Math.max(Math.round(ms * S), TIME_SCALE_FLOOR_MS);
};

/** 演出编排时长缩放(行军/特效/骰签/拼点/仪式五族的唯一取数口):e2e 通道(sc)之上
 *  再除追帧速度倍率——1.5~3x 速播 = 时长压到 1/1.5~1/3,倍率变化即时作用于播放期
 *  取数。除法不再落地板:地板(TIME_SCALE_FLOOR_MS)是 e2e 缩短方向的观察性下限,
 *  追帧若也吃地板,80ms 短拍在 1.5x 档反从 80 涨到 100,压缩方向被地板二次倒转。 */
export const scStage = (ms: number): number => {
  const base = sc(ms);
  return catchupScale === 1 ? base : Math.round(base / catchupScale);
};

/** 落后即校准判据阈值(#610,ADR-0029 ③;#570 决议:混合尺+分类非布尔;#730/ADR-0034
 *  再定标:阈值必须高于「配速后正常局」的水位,吸附回归异常治理本位,不为常规积压买单)。
 *  定标依据(#730 台架实测:bot 已按 BOT_STEP_MS 配速,健康水位 = 在播 1-2 批的回合内
 *  尾流;最长常规演出块 = 都城停链/破产仪式 ≈6s):
 *  - gapBatches=5:差 5 批 ≈ 一个完整 bot 回合的演出未开播(配速下 3-4 命令/回合),
 *    追帧介入;1-4 批 = 正常尾流与瞬时抖动,平滑吸收(colyseus peak 档);
 *  - ageMs=20s:配速下队列头等待 ≈2-3 批 × 播放时长 ≈6-10s,20s ≈ 2× 余量;兜住主尺
 *    盲区(单批超长、游标差恒小,#600);吃 sc(只随 e2e 键,判据时距不进追帧通道
 *    ——阈值追倍率会抵消负反馈),烤定值不随运行时倍率漂移;
 *  - consecutiveForSnap=6:3× 顶速连播 6 块(≈10s+)仍追不上 = 产出结构性快于播放上限
 *    (掉线追平/全 bot 观战级),才升吸附(colyseus ema 持续分量同构);
 *  - scaleMin/scaleMax=1.5~3(决议口径,速度域:scStage 时长除以倍率)、
 *    scaleStep=0.5/批:gap=5 起步 1.5×,每深一批 +0.5×,gap≥8 顶格 3×。
 *    批数/倍率无量纲,不吃 sc。 */
export const LAG = {
  gapBatches: 5,
  ageMs: sc(20000),
  consecutiveForSnap: 6,
  scaleMin: 1.5,
  scaleMax: 3,
  scaleStep: 0.5,
} as const;

/** 令牌行军(旧 animate.ts animateMove 的逐段节奏,语义不变):
 *  每段时长 ∝ 距离(匀速),夹在 [minSegMs, maxSegMs] 之间。演出编排族(吃 scStage)。 */
export const MARCH = {
  get minSegMs() {
    return scStage(80);
  },
  get maxSegMs() {
    return scStage(460);
  },
  /** 像素/秒:距离 ÷ speed = 段时长(旧实现 dist / 720,单位 px/s) */
  speed: 720,
  /** 每段 transition 结束后的额外缓冲。S6(#39):10→0——缓动改 easeInOutSine
   *  (board.css .bv-token-marching)后段尾速度趋零,10ms 硬等待反成顿挫;
   *  无缝衔接读作一气呵成,终点落定感由缓动尾段承担。 */
  segSlackMs: 0,
} as const;

/** 瞬时特效存活时长(演出编排族,吃 scStage;与 fx.css 的 keyframe 时长保持一致;
 *  超时自清防 store 积压)。CSS 侧时长/缓动唯一源 core/theme.ts Motion(经 gen:theme 产出 tokens.css):
 *  floaterMs/bannerMs 与 --dur-fx/--dur-banner 同源(经 Motion);bannerMs 的
 *  +100 清理余量保留字面量。coinMs/sealMs/roadFlowMs 不等于任何 token,是编排窗口,
 *  保留字面量,与编排类 keyframe 硬同步,改任一侧须两处同改。 */
export const FX = {
  get floaterMs() {
    return scStage(Motion.dur.fx);
  }, // 与 --dur-fx 同源(经 Motion)
  get coinMs() {
    return scStage(1500);
  },
  get bannerMs() {
    return scStage(Motion.dur.banner + 100);
  }, // fx-banner-fly 全长同源(--dur-banner,经 Motion)+ 100 清理余量(#117 同源化,余量保留字面量)
  /** C3 回合横幅占用编排时长:等横幅走到峰值停留段(1.8s 动画的 20%-75% 区间),
   *  取 1.0s——下一演出(骰子)不再与横幅入场重叠,又不把回合节奏拖满全长。 */
  get bannerHoldMs() {
    return scStage(1000);
  },
  get sealMs() {
    return scStage(900);
  },
  get roadFlowMs() {
    return scStage(700);
  }, // 驿道流光高亮存留
  /** 出牌指示线全程存活(#281 P2-E):生长 200ms → 停 200ms → 淡出 300ms(FreeKill
   *  IndicatorLine 同参数),三段编排进 fx.css 的单条 keyframes(百分比刻度),本值
   *  只作 store 清理窗口与动画全长硬同步,改任一侧须两处同改。 */
  get jinnangLineMs() {
    return scStage(700);
  },
  /** 落格定音金圈一拍(S7 #513):fx-svg-pulse 全长 0.65s + 清理余量,fx.css 同名
   *  keyframe 硬同步,改任一侧须两处同改。 */
  get landPulseMs() {
    return scStage(750);
  },
  /** 都城停条带存活(#732 降格,原 S7 #513 全屏宣告 2400):条带复用回合横幅的
   *  fx-banner-fly 全长(--dur-banner 单源)+ 清理余量,与 fx.css 同步(公式同
   *  bannerMs,语义独立——两族知会各自的清理窗)。 */
  get haltBannerMs() {
    return scStage(Motion.dur.banner + 100);
  },
  /** 都城停条带占用编排时长(#732 条带级校准,同 bannerHoldMs 口径):等条带入场
   *  展开读过一拍,驻章与补给铜钱雨在其后接续(原全屏仪式 1400 随降格退役)。 */
  get haltHoldMs() {
    return scStage(1000);
  },
  /** 破产仪式墨渍晕开全程(S7):fx-inkblot-bloom 1s + 清理余量,fx.css 硬同步。 */
  get inkBlotMs() {
    return scStage(1100);
  },
  /** 破产仪式撒币全程(S7):fx-coin-burst 1.3s + 清理余量,fx.css 硬同步。 */
  get coinBurstMs() {
    return scStage(1400);
  },
} as const;

/** 掷骰签面节奏(#483 3D 骰退役,签面转正为唯一掷骰演出;演出编排族,吃 scStage;时长集中调参)。
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
  get shakeMs() {
    return scStage(600);
  }, // 摇签段(人类标准档 0.6s,#492);fx.css .dice-sign-shaking 虚影态同段硬同步
  get botShakeMs() {
    return scStage(300);
  }, // 摇签段(bot 半速档)
  get holdMs() {
    return scStage(Motion.dur.reveal);
  }, // 签面停留(人类);与 --dur-reveal 同源(经 Motion)
  get botHoldMs() {
    return scStage(Motion.dur.slow);
  }, // 签面停留(bot 半速档);与 --dur-slow 同源(经 Motion)
  get fadeOutMs() {
    return scStage(Motion.dur.med);
  }, // overlay 渐隐退场;与 --dur-med 同源(经 Motion),fx.css .dice-overlay-out 消费同一 token
} as const;

/** 拼点演出节拍(#637,ADR-0030,全屏签面 DuelSignsOverlay 消费):错拍/判词两拍
 *  延续既有拼点节拍(ADR-0030 原文「签面落定延续既有拼点节拍」;旧棋盘双印的节拍组
 *  随 T3 #638 整线退役,组名与两拍原值留用)。全组吃 scStage(演出编排族,#610);
 *  签面整场固定全速,不随 bot 半速(公共大事件非回合等待,#637 口径)。 */
export const DUEL = {
  /** 签面·幕启:玄墨幕渐入+两签虚位 */
  get curtainMs() {
    return scStage(200);
  },
  /** 签面·并行起摇:虚影轮换段(与 DICE.shakeMs 同值,语义独立——全速恒定) */
  get shakeMs() {
    return scStage(600);
  },
  /** 签面·座位序错拍落定间隙(第二签延迟落定的空拍;各拍落定自发声) */
  get clackGapMs() {
    return scStage(150);
  },
  /** 签面·末签落定→判词拍:金圈/沉暗/金「平」钤落(stamp 音,大胜负同拍震屏) */
  get verdictMs() {
    return scStage(520);
  },
  /** 签面·判词停留 */
  get holdMs() {
    return scStage(600);
  },
  /** 签面·整幕渐出;与 --dur-med 同源(经 Motion),fx.css .duel-overlay-out 消费同一 token */
  get fadeOutMs() {
    return scStage(Motion.dur.med);
  },
  /** 拼点大胜负点差(S7 #492 震屏大事件档):|a−b|≥本值判词拍震屏(DESIGN §6)。
   *  时间表里只此一个非时长字段,签面判词拍同源取数。 */
  blowoutMargin: 3,
} as const;

/** 破产仪式时间轴(S7 #513,三拍:倒旗→墨渍→撒币;演出编排族,吃 scStage):累计毫秒锚点,
 *  sinks.bankruptCeremony 串行消费。与 fx.css fx-flag-fall(1.1s)/fx-inkblot-bloom
 *  (1s)/fx-coin-burst(1.3s)硬同步,改任一侧须两处同改。 */
export const CEREMONY = {
  get fallMs() {
    return scStage(1100);
  }, // 旌旗缓倒全长(墨渍在其尾段 1.0s 拍开晕)
  get blotAtMs() {
    return scStage(1000);
  }, // 铭牌墨渍晕开起始拍
  get coinsAtMs() {
    return scStage(1500);
  }, // 铜钱撒落拍(coinsBox 音同拍)
  get settleMs() {
    return scStage(2600);
  }, // 仪式收口(撒币看完再交还编排链)
  coinCount: 10, // 撒币枚数(8–12 档中值,#492 决议)
} as const;

export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 幽灵帧协议(#107 批次 6 收编 #117):useGhostChild 的退场帧驻留时长——子节点身份
 *  变化后上一帧快照再渲染多久。与 ScrollShell closing 出口同一条 210 口径:收起动画
 *  scroll-anim-rollback 走 --dur-fast = 150ms(Motion.dur.fast,经 gen:theme),210 =
 *  150 + 60ms 余量,保证动画播完有余再卸载。刻意字面量而不读运行时 CSS——
 *  getComputedStyle 首帧未就绪且触发强制布局;同源关系以此注释钉死,改 --dur-fast 时
 *  这里要跟着核一遍。界面帧驻留(非棋盘演出),只吃 sc 不吃追帧(F4 作用域拆分)。 */
export const GHOST = {
  get frameMs() {
    return sc(210);
  },
} as const;

/** 行军自动化(#188 第 1 步):人类回合 Roll 相位的自动起摇节奏。
 *  进入 Roll 后等 rollAtMs(约 1s,起签的静默酝酿拍)→ 钤「签」印起签 →
 *  再等 qiqianMs(约 0.8s,起签印章的驻留)→ 自动 rollAndMove(与手点同一条命令路径)。
 *  服务器侧(room.ts)的同类定时用固定 1s:scripts 不吃 localStorage 倍率,见 room.ts 注释。
 *  自动起摇 = 命令提交节拍(权威侧配速,非演出时长),只吃 sc 不吃追帧(F4 作用域拆分)。 */
export const AUTO_MARCH = {
  get rollAtMs() {
    return sc(1000);
  },
  get qiqianMs() {
    return sc(800);
  },
} as const;

/** 反应窗时长缩放包装(#281 引入,#284 单源收口):开窗时长的权威值是
 *  `ReactionView.windowMs`(引擎开窗时查 core/constants REACTION_WINDOW_MS 写入,
 *  随快照 view 走;联机权威侧可经服务器 env E2E_REACTION_MS 覆盖,两端同长自动成立)。
 *  UI 倒计时弧/横幅与单机权威侧定时器(LocalController)一律「取 windowMs → 过本函数」
 *  消费,不再各自引常量表(双源消灭);E2E_TIME_SCALE 缩放通道(#225)收口在此。
 *  只吃 sc 不吃追帧(F4 作用域拆分):倒计时弧必须与权威窗同长,追帧压缩会失配。 */
export const scaleReactionMs = (windowMs: number): number => sc(windowMs);

/** 界面层反馈节奏(#117 收编,非棋盘特效):提示/状态条的自动清除 TTL 与胜利屏
 *  交互件的延后挂载。UI 直改即生效的反馈,不吃编排链,独立于 FX/DICE 调参;
 *  只吃 sc 不吃追帧(F4 作用域拆分)。 */
export const UI = {
  /** F4 三屏统一提示 TTL(gameStore.pushHint / netStore.pushHint 单一口径)。 */
  get hintTtlMs() {
    return sc(1800);
  },
  /** 编辑器状态条反馈自动清除(EditorScreen 保存/另存/重置/导入四处 setStatus)。 */
  get statusClearMs() {
    return sc(1500);
  },
  /** 胜利屏「再战」按钮延后挂载(E2:入场演出高潮期防误触重开)。 */
  get victoryButtonMs() {
    return sc(1800);
  },
  /** 大厅国号复制成功反馈的自动熄灭(L-7:ref 计时防重复点击提前熄灭)。 */
  get copyFeedbackMs() {
    return sc(1000);
  },
} as const;

/** 等一帧(requestAnimationFrame 两拍:先让 React commit,再拿稳定 DOM)。 */
export const nextFrame = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
