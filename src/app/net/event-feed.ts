// 事件批下行通道·客户端接收面(#390,ADR-0020 折叠切换①):服务端随快照 flush 节奏
// 下发 {type:"events", events} 类型化消息(一批发 = 一次编排转移的产出,词汇表见
// core/game-events.ts),本模块只做「接收 + 暂存」——整批入 netStore(lastEvents +
// eventBatchSeq 单调计数),不驱动任何 UI/行为:事件折叠为本地状态的消费端归后续工单
// (伞票 #377)。容错口径 = 消息级透传:只认 type 与 events 字段,未知字段随对象整体
// 暂存不炸、空批照存(线上形状以 core GameEvent 为准,运行时不做字段校验=零兜底)。
import type { GameEvent } from "@core/game-events";
import { useNetStore } from "@app/store/netStore";

/** 服务端事件批消息(线上形状;与 lobby/snapshot/dismissed/error 同族,type 判别)。 */
export interface EventBatchMsg {
  type: "events";
  events: GameEvent[];
}

/** 事件批入站:整批暂存并推进到达序计数。无过滤无校验(缺事件源让它炸,零兜底)。 */
export function stashEventBatch(events: GameEvent[]): void {
  useNetStore.getState().pushEventBatch(events);
}
