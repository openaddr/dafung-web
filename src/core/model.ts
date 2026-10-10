// 核心领域模型(#326 types.ts 解散,ADR-0019 类型随域走):跨域共用的基础数据形状。
// 判定标准:谁拥有概念,类型住谁的文件;唯有多域共用、不属于任何单一机制域的
// 基础记录(Player/PropertyHolding/LogEvent)集中于此。纯数据,无 DOM 依赖。
import type { HeroDef } from "./heroes";
import type { TreasureDef } from "./treasures";

/** 玩家持有的地产。Level 0..maxLevel(购入/建都即为 Lv.0);升级免费(到达触发)。 */
export interface PropertyHolding {
  propertyId: string;
  group: string;
  purchasePrice: number;
  level: number;
  maxLevel: number;
}

/** 玩家。CapitalIndex=-1 表示尚未选都。 */
export interface Player {
  id: string;
  name: string;
  guohao: string; // 国号(单汉字,装饰)
  colorIndex: number;
  isBot: boolean;
  cash: number;
  warrants: number; // 委任状:进驻(买)新城的额度;经过自己都城补充。
  isBankrupt: boolean;
  position: number;
  capitalIndex: number;
  onBranch: { step: number } | null; // 在分岔辅路第几格(null=在主路;step=-1=入口待入辅路,棋子仍在主路入口格)
  skipTurns: number; // 待跳过的回合计数(辅路 penalty 格触发)
  properties: PropertyHolding[];
  heroes: HeroDef[]; // 已招揽的名将(上限 HERO_CAPACITY)
  treasures: TreasureDef[]; // 持有的珍宝
  heroLastFired: Record<string, number>; // 技能冷却:skill.id → 上次触发的 round(供 cooldown 判定)
  reputation: number; // 声望 -100~+100:机遇档位调制的唯一输入(见 GLOSSARY.md;#121)
  stamina: number; // 体力 0~100:机遇/技能增减,归 0 触发耗竭惩罚(见 GLOSSARY.md;#130)
  jinnangHand: string[]; // 锦囊手牌(#122):暗置牌 id,内容仅本人可见(联机经投影,ADR-0016)
  /** 已领取的声望献计里程碑(#147):值 ∈ {30,60,90};只认向上穿越且仅首次。 */
  repMilestones: number[];
  /** 锦囊手牌数(公开信息,引擎状态):与 jinnangHand.length 同步维护于唯一改动点
   *  (抽牌/打牌)。为什么独立成字段:联机客户端经「restore→重新 snapshot」hydrate,
   *  投影层注入的视图字段会在重生成时丢失——数量是全员可见的游戏状态,必须由引擎持有。 */
  jinnangHandCount: number;
}

/** 对局日志事件(ADR-0014,原「战报」):每行 = 中文自然语言 brief + 机读 detail(英文键值),
 *  外加基本信息字段(ts/round/turn/player/category)。双层用途:人类可读层复盘 + 命令流重放。
 *
 *  category 分类表(显式化,新增类别须同步 docs/reference/对局日志.md):
 *  - 局头:header(构造时首行,重放要素:gameId/mapId/seed/座位表/现金/目标)
 *  - 玩法事件:roll 掷骰 | buy 购地 | upgrade 扩军/成交升级 | trade 珍宝交涉+escrow 交割退回 |
 *    supply 补给/委任状 | tax 税关 | branch 辅路抉择/中伏跳过 | halt 驻跸必停 |
 *    setup 开局流程(定序/三候选/选都/招贤)| skill 时机技能击发 | system 其余玩法杂项
 *    (随机事件/商市/破产清算过程/警告)| victory 胜负 | final 终局行(机读终态面板,重放断言锚点)
 *  - 命令类:cmd(submitCommand 提交的玩家命令,detail=命令 JSON;bot 直调引擎方法不产生,
 *    确定性重放自动重算——见 docs/reference/对局日志.md「命令流」)
 *  - 房间类:room(房间生命周期:开局/托管/接管/离线/重连/解散;联机由 room.ts 写、
 *    单机托管由 LocalController 写,detail=机读 JSON,重放据此调整 bot 驱动座位集) */
export interface LogEvent {
  ts: number; // 时间(epoch ms,引擎侧 Date.now())
  round: number; // 轮(engine.round,所有人各行动一次 = 1 轮)
  turn: number; // 回合(engine.turnNumber)
  player: string | null; // 玩家国号(无主行为为 null)
  brief: string; // 人类可读简报(中文)
  detail: string; // 机读审计行(英文键值;cmd/room/header/final 为 JSON)
  category:
    | "header"
    | "system"
    | "roll"
    | "buy"
    | "upgrade"
    | "trade"
    | "supply"
    | "tax"
    | "branch"
    | "halt"
    | "setup"
    | "skill"
    | "victory"
    | "final"
    | "cmd"
    | "room";
  amount?: number; // 涉及金额(+收入 / -支出)
}
