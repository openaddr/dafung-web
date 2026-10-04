// 折叠投影器(#386,ADR-0020 决策 1 折叠切换④):服务端事件批 → 本地引擎副本字段
// 的纯函数投影。联机端引擎是「只读副本」(快照水合而来),本模块把事件批直接折进副本
// 的现金/位置两族字段——这是应用层投影,不是引擎行为:不往 src/core 加任何方法,
// 副本仍保持只读语义(外部不 submitCommand,红线 3 的「走公共方法」约束的是引擎权威态
// 变更,副本投影属协议消费面)。
//
// 折叠范围(本票口径,后续工单按词汇表生长扩围):
//   cashChanged                → players[seat].cash += delta(delta 带符号,逐条累加)
//   marchArrived / capitalHalt → players[seat].position = tileIndex(辅路落位的
//                                tileIndex = 主路锚点占位,与引擎 position 语义一致)
// 其余 kind 一律忽略——这是折叠范围的定义,不是吞错:词汇表在生长(game-events.ts),
// 未登记进折叠范围的族由快照校准覆盖(每次 flush 的水合无条件覆盖全量字段,快照 =
// 校准锚;漂移在下一帧快照即被纠正,ADR-0020 决策 3)。
//
// 零兜底:cashChanged/marchArrived/capitalHalt 产出契约恒带具体座位(见 game-events.ts
// 各产出点,行动者=座位主),seat=null 的该族事件 = 产出契约违反,当场炸出不静默跳过;
// delta/tileIndex 缺失由类型系统在编译期兜住(线上形状以 core GameEvent 为准)。
import type { GameEngine } from "@core/authority";
import type { Player } from "@core/model";
import type { GameEvent } from "@core/game-events";

/** 折叠目标玩家解析:两族事件都是座位主行为,无主座位(seat=null)= 契约违反,炸出。 */
function foldTarget(engine: GameEngine, ev: GameEvent): Player {
  if (ev.seat == null) throw new Error(`折叠投影:${ev.kind} 无主座位(事件产出契约违反)`);
  return engine.players[ev.seat];
}

/** 事件批折叠:按批内顺序逐条投影进引擎副本(顺序即服务端结算序,后写覆盖先写)。
 *  调用方(controllers/online.ts)负责批粒度的重渲:一次事件批一次 syncFromEngine,
 *  不逐事件;批消费后随后的快照水合会无条件覆盖这两字段(对账纠偏)。 */
export function foldEventBatch(engine: GameEngine, events: readonly GameEvent[]): void {
  for (const ev of events) {
    switch (ev.kind) {
      case "cashChanged":
        foldTarget(engine, ev).cash += ev.delta;
        break;
      case "marchArrived":
      case "capitalHalt":
        foldTarget(engine, ev).position = ev.tileIndex;
        break;
      default:
        break; // 未登记进折叠范围的族:忽略,由快照校准覆盖(见文件头折叠范围)
    }
  }
}
