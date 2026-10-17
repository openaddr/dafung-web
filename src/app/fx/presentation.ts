// 表现事件(Wave1 统一表现事件流):把「一次引擎推进 / 一次快照 diff」翻译成
// 与介质无关的判别联合。为什么要有这一层:此前单机(orchestrator.playStepEffects)
// 与联机(online.playSnapshotEffects)各自拼装"骰子→行军→浮字→横幅"链,形状完全
// 不同且已发生漂移(联机缺破产表现)。统一成事件数组后:
//   - 提取器(local/online 两个 adapter)只负责"发生了什么"(纯数据);
//   - 播放器 present() 只负责"按什么顺序怎么播"(消费 FxSink);
//   - FxSink 收窄 audio/dice/fxStore/march 四个能力,生产 adapter 组装单例,
//     测试用 createMemorySink() 录制调用断言顺序与内容(ADR-0006 预留位)。
// 设计取舍:坐标(x/y,棋盘逻辑系)在提取期解析进事件——浮字锚定依赖提取时刻的
// 玩家状态,事后无法从 atTile 单独还原,故事件自带坐标,
// atTile 仅保留语义信息供测试断言。
import type { MovePath } from "@core/board";
import type { PropertyChangeTrace } from "@core/authority";
import type { SoundEvent } from "./audio";

/** 表现事件:数组顺序 = 播放顺序(present 串行 await)。宁可少而精,按两侧现有
 *  调用收口;新增表现 = 加判别分支,而不是在控制器里另起内联链。 */
export type PresentationEvent =
  | {
      kind: "diceRolled";
      die: number;
      /** C1:bot 驱动的掷骰走半速(提取期按推进前活跃玩家 isBot 判定)。
       *  速度不进 FxSink.rollDice 签名——生产实现(sinks.ts)不透传附加参数,
       *  由 present() 在掷前设置签面演出的模块级速度开关(见 orchestrator)。 */
      fast?: boolean;
    }
  | { kind: "tokenMoved"; playerId: string; path: MovePath }
  | {
      kind: "cashDelta";
      playerId: string;
      amount: number;
      /** 铜钱雨扩容(S7 #513):纳税付银随雨落币(补给走独立 supplyRain,不带本档)。 */
      coins?: boolean;
      /** 棋盘逻辑坐标(SVG 系,提取期已按 旧优先级 锚定)。 */
      x: number;
      y: number;
      /** 语义锚点(浮字发生在哪格;null=锚到玩家自身)。 */
      atTile: number | null;
    }
  | {
      kind: "supplyRain";
      playerId: string;
      amount: number;
      x: number;
      y: number;
      atTile: number | null;
    }
  | {
      kind: "textFloat";
      playerId: string;
      /** 文案(无金额,ADR-0013 唯一选项自动执行的轻提示,如「银两不足,未能购城」)。 */
      text: string;
      x: number;
      y: number;
      atTile: number | null;
    }
  | {
      kind: "sealStamped";
      tileIndex: number;
      char: string;
      /** 印色档(S7 #513):缺省=朱砂深底(据/筑/驻);gold=漆金印(探宝拼点「得」),
       *  漆金化口径(#492:金印留给得/平语义,朱砂保留给危险/破产)。 */
      tone?: "gold";
    }
  | { kind: "turnBanner"; guohao: string; colorIndex: number }
  /** 落格定音(S7 #513,BRIEF 台账 #9 翻案件):行军落在事件/机遇格(税/仓/锦囊/
   *  天命/卧龙)的金圈一拍——零新引擎事件,提取期按落点格型直译,同步下发 CSS 自走。 */
  | { kind: "landPulse"; tileIndex: number }
  /** 拼点双印(S7 #513):拦检拼点平/负(reactionFailed)的双骰点印——a/b=双方掷点,
   *  左右错拍钤下后合成大印:verdict=lose 钤「失」、tie 钤金「平」(#492 平局诚实呈现);
   *  得宝侧(拼点胜)不走本事件,由 treasureGained 的金「得」印承担。 */
  | {
      kind: "duelStamps";
      tileIndex: number;
      x: number;
      y: number;
      a: number;
      b: number;
      verdict: "lose" | "tie";
    }
  /** 都城路过必停全屏宣告(S7 #513):capitalHalt 事件的漆金横幅级宣告(与回合横幅
   *  同语感、更高强度),haltGong 号角+震屏由 sink 同拍发起。 */
  | {
      kind: "haltBanner";
      playerId: string;
      guohao: string;
      colorIndex: number;
      /** 都城名(提取期按 tileIndex 查盘)。 */
      cityName: string;
    }
  /** 破产仪式(S7 #513):playerBankrupt 的三拍全屏演出——旌旗缓倒(倒旗)→
   *  铭牌墨渍晕开 → 铜钱撒落;bankrupt 长锣/rain 雨床/coinsBox 入匣三音由 sink
   *  按拍发起(x/y=破产者落点,提取期解析,锚墨渍与撒币现场)。 */
  | { kind: "bankruptCeremony"; playerId: string; x: number; y: number }
  /** 出牌指示线(#281 P2-E,ADR-0010 表现事件流的 UI 侧新事件类型):锦囊/反应牌
   *  生效点由事件批直译(#385 event-extract:jinnangAnnounced/jinnangVoided/
   *  reactionAnswered → 本事件),按「使用者 → 各目标」展开为若干段墨线端点
   *  (棋盘逻辑坐标,提取期按当时牌局状态解析)。播放为同步下发、
   *  CSS 三段(生长 200ms→停 200ms→淡出 300ms)自走,不占编排时长。 */
  | {
      kind: "jinnangPlayed";
      /** 使用者玩家 id(事件语义信息;线段端点已解析,渲染不再回查)。 */
      playerId: string;
      cardId: string;
      lines: { x1: number; y1: number; x2: number; y2: number }[];
    }
  /** 窥探弹层(#575,军情密探即时窥探):viewer-only 一次性演出——peekApplied 事件
   *  直译,弹层陈列被窥者锦囊手牌(hand 随事件走,redactEvents 逐座位裁、非 viewer
   *  恒空,ADR-0016),牌背→翻面 stagger 入场,点击任意处/X 关闭,关闭即逝、无持续
   *  窗口。同步下发(无编排时长,不占演出锁);弹层组件按 viewerSeat===本座自门。 */
  | {
      kind: "peekRevealed";
      /** 窥方座位(仅此座位的客户端渲染弹层)。 */
      viewerSeat: number;
      /** 被窥者座位。 */
      targetSeat: number;
      /** 被窥者国号(提取期解析,弹层副题「窥 {国号} 营锦囊」)。 */
      guohao: string;
      /** 被窥者锦囊手牌内容(非 viewer 座位恒空——redactEvents 逐座位裁,ADR-0016)。 */
      hand: string[];
    }
  /** 语义音效(得宝/破产/扩军/买入等):不绑定视觉的纯声音事件。 */
  | { kind: "sound"; event: SoundEvent }
  /** 城池宣告(ADR-0015):扩军/易主的可播放信号,字段 = 引擎结算留痕
   *  (PropertyChangeTrace)原样透传。消费端双路:sink.announceTileChange 经 fxStore
   *  下发 nonce 驱动 Tile 重播宣告动画;与 sealStamped 等"浮层印"不同,宣告动效
   *  (印重钤/楼生长/易主流光)锚在 Tile 本体,须由 Tile 订阅重播而非 FxLayer 叠加。 */
  | ({ kind: "propertyChanged" } & PropertyChangeTrace);

/** propertyChanged 事件的独立类型(FxSink.announceTileChange 的窄签名用)。 */
export type PropertyChangedEvent = Extract<PresentationEvent, { kind: "propertyChanged" }>;

/**
 * 表现能力收口(真 seam):present() 通过本接口驱动一切外设。四个能力对应
 * 旧 orchestrator 直接 import 的四组单例——audio / dice / fxStore / march。
 * 生产实现见 sinks.ts createEngineSink;测试实现见 createMemorySink。
 */
export interface FxSink {
  /** 播一条语义音效(带声音的事件本身如骰子/印章/横幅由对应方法内发声)。 */
  playSound(event: SoundEvent): void;
  /** 掷骰动画(含 diceRoll/diceLand 音与 fallback 停顿),await 到落面。 */
  rollDice(die: number): Promise<void>;
  /** 行军锚定(同步):把棋子放进接管集并锚回路径起点(#385:路径随表现事件走),
   *  必须先于 React 渲染终态。 */
  marchBegin(playerId: string, path: MovePath): void;
  /** 行军动画(异步):沿给定路径(#385 起事件自带,不再读引擎 lastMove 单槽)逐段推进。 */
  marchToken(playerId: string, path: MovePath): Promise<void>;
  /** 浮动金额(coins=true 时附带补给铜钱雨)。 */
  spawnFloater(x: number, y: number, amount: number, coins: boolean): void;
  /** 文案浮字(无金额的小字提示,风格对齐浮动金额)。 */
  spawnTextFloater(x: number, y: number, text: string): void;
  /** 回合横幅(含 whoosh 音)。 */
  showBanner(guohao: string, colorIndex: number): void;
  /** 朱砂印章(含 stamp 音);坐标由实现按 tileIndex 换算(需要引擎/棋盘)。
   *  tone="gold"=漆金印(S7 探宝「得」印)。 */
  stampSeal(tileIndex: number, char: string, tone?: "gold"): void;
  /** 落格定音(S7):落点格金圈一拍,同步下发 CSS 自走(生产实现按 tileIndex 换算)。 */
  landPulse(tileIndex: number): void;
  /** 拼点双印(S7):双骰点印错拍钤下→合印,音画错拍由实现编排(同步下发)。 */
  stampDuel(ev: Extract<PresentationEvent, { kind: "duelStamps" }>): void;
  /** 都城停全屏宣告(S7):haltGong+震屏同拍,横幅经 fxStore 下发(动画 CSS 自走)。 */
  showHaltBanner(ev: Extract<PresentationEvent, { kind: "haltBanner" }>): void;
  /** 破产仪式(S7):三拍串行编排(倒旗→墨渍→撒币),await 到仪式收口。 */
  bankruptCeremony(ev: Extract<PresentationEvent, { kind: "bankruptCeremony" }>): Promise<void>;
  /** 出牌指示线(#281 P2-E):一段「使用者→目标」墨线端点(棋盘逻辑坐标),
   *  同步下发、CSS 三段自走(生产实现经 fxStore,渲染归 BoardFxLayer 的 #bv-fx 层)。 */
  spawnJinnangLine(x1: number, y1: number, x2: number, y2: number): void;
  /** 窥探弹层(#575):viewer-only 一次性演出开关态下发(fxStore.peek,关闭即清);
   *  同步、无编排时长,非 viewer 座位由弹层组件自门。 */
  revealPeek(ev: Extract<PresentationEvent, { kind: "peekRevealed" }>): void;
  /** 城池宣告(ADR-0015):扩军/易主时驱动 Tile 重播宣告动画。生产实现经 fxStore
   *  下发 nonce(Tile 订阅,nonce 变化即重挂重播);测试实现录制供断言序列。 */
  announceTileChange(ev: PropertyChangedEvent): void;
}
