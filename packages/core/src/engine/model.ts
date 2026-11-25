// 核心领域模型(#326 types.ts 解散,ADR-0019 类型随域走):跨域共用的基础数据形状。
// 判定标准:谁拥有概念,类型住谁的文件;唯有多域共用、不属于任何单一机制域的
// 基础记录(Player/PropertyHolding/LogEvent)集中于此。纯数据,无 DOM 依赖。
import type { CityDamageEntry } from "./city-damage";
import type { HeroSlot } from "./roster";
import type { TreasureDef } from "./treasures";

/** 一组火焰标记共用最近的施火者与当前周期的进度。 */
export interface CityBurning {
  readonly sourceSeat: number;
  readonly marks: number;
  readonly progress: number;
  readonly ignitedTurn: number;
}

/** 玩家持有的地产。等级 1..maxLevel(购入、建都从 1 级起);升级免费(到达触发)。
 *  不存购入价:身价=仅现金、变卖走 def.valueByLevel,持有价零玩法消费(已删)。 */
export interface PropertyHolding {
  propertyId: string;
  group: string;
  level: number;
  maxLevel: number;
  /** 防御值(#1386/#1387):城池等级附带的受损额度,持有态恒有。等级一变(升级/降级/
   *  易主)即重置满值(单口 resetToFull,满值表单源 defense.ts;升级回满=奖励),
   *  平时不回复;扣减经 applyCityDamage。 */
  defense: number;
  burning: CityBurning | null;
  /** 当前持有期的伤害排行榜，累计伤害降序，同分按到达顺序。 */
  damageRanking: readonly CityDamageEntry[];
}

/** 玩家。CapitalIndex=-1 表示尚未选都。 */
export interface Player {
  id: string;
  name: string;
  guohao: string; // 国号(单汉字,装饰)
  colorIndex: number;
  isBot: boolean;
  cash: number;
  isBankrupt: boolean;
  position: number;
  capitalIndex: number;
  skipTurns: number; // 待跳过的回合计数(耗竭休整/缓兵之计)
  resting: boolean; // 体力耗竭休整中(见 GLOSSARY「休整」):skipTurns 消费完即回满体力,跳回合环消费
  properties: PropertyHolding[];
  heroes: HeroSlot[]; // 麾下槽位(#785,ADR-0036):{heroId, 已授技(池序), 按技冷却账};上限 HERO_CAPACITY
  treasures: TreasureDef[]; // 持有的珍宝
  stamina: number; // 体力 0~100:补给、技能和伤害增减，归 0 触发耗竭(见 GLOSSARY.md;#130)
  jinnangHand: string[]; // 锦囊手牌(#122):暗置牌 id,内容仅本人可见(联机经投影,ADR-0016)
  /** 锦囊手牌数(公开信息,引擎状态):与 jinnangHand.length 同步维护于唯一改动点
   *  (抽牌/打牌)。为什么独立成字段:联机客户端经「restore→重新 snapshot」hydrate,
   *  投影层注入的视图字段会在重生成时丢失——数量是全员可见的游戏状态,必须由引擎持有。 */
  jinnangHandCount: number;
}

/** 对局日志条目。字段格式、写入点和用途见 docs/reference/对局日志.md。 */
export interface LogEvent {
  ts: number; // 时间(epoch ms,引擎侧 Date.now())
  round: number; // 全桌轮次（engine.round）
  turn: number; // 全桌回合编号（engine.turnNumber）
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
    | "halt"
    | "setup"
    | "skill"
    | "victory"
    | "final"
    | "cmd"
    | "room";
  amount?: number; // 仅现金收付(+收入 / -支出);非现金资产估价走 detail value=(#617)
}
