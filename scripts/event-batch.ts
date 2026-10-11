// 事件批下行通道·共享批语义(#411 抽单源):联机通路(server.ts broadcast/flushRoom)
// 与单机传输面(room.ts transportBroadcast/flushTransport)的「累积 + 引用换新去重 +
// 拼接序 + 幂等排空 + setTimeout(0) 合并拍」由本模块同一份代码保证——原先两处逐字
// 同契约的双写(靠注释互指维稳)就此收口。#388 校准判定与 #381 per-seat 过滤
// (redactEvents 每座位各一份)不在此处:那是各通道 flush 体自己的下行判定,
// 排空(drain)后照旧归各自消费,本模块只管批本身的累积与节奏。
//
// 口径(与拆分前 server.ts accumulateEventBatch / room.ts transportBroadcast 逐字同义):
//   - 批来源 = engine.gameEvents(#375),以「数组引用换新」为界——beginGameEventBatch
//     弃批建新数组;同一转移的重复通知(托管开关/终态推送等不触碰引擎的广播)引用
//     不变,不重收。
//   - 累积:新引用且非空才追加;首批拷贝入袋,后续批 push 拼接,保发生序。
//   - 排空:取走即清(幂等——重复 drain 不再产出);空袋返回 undefined。
//   - 节奏:每房间至多一个 setTimeout(0) 合并拍,回调先自摘句柄再执行 flush;
//     已排定时未到点时 schedule 为无操作(本 tick 的脏标记由同一拍带走)。
//   - 断线即丢(无排队无补发,ADR-0020 决策 4):袋内批只在本 tick 拍点下发,
//     通道清理(dispose/forget)即弃,不复活。
import type { GameEvent } from "../src/core/game-events";

export class EventBatchChannel {
  /** 最近收过的批引用(roomId → 批):同一转移重复通知的去重凭据(#388 恢复播种同款)。 */
  private readonly seen = new Map<string, GameEvent[]>();
  /** 本 tick 累积的事件批(roomId → 拼接袋):拍点排空后即清。 */
  private readonly pending = new Map<string, GameEvent[]>();
  /** 每房间至多一个的合并拍定时器(setTimeout(0),双通道同节奏)。 */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** 转移通知入口:批引用换新才收(去重),非空才入袋(拼接保发生序)。
   *  batch 可空(Lobby 无引擎即无事件批),直接忽略。 */
  accumulate(roomId: string, batch: GameEvent[] | null | undefined): void {
    if (!batch) return;
    if (this.seen.get(roomId) === batch) return; // 批引用未换新 = 同一转移的重复通知
    this.seen.set(roomId, batch);
    if (batch.length === 0) return; // 空转转移无内容可拼接
    const acc = this.pending.get(roomId);
    if (acc) acc.push(...batch);
    else this.pending.set(roomId, [...batch]);
  }

  /** 幂等排空:取走并清空本 tick 累积批;空袋返回 undefined(调用方不发 events 消息)。 */
  drain(roomId: string): GameEvent[] | undefined {
    const events = this.pending.get(roomId);
    this.pending.delete(roomId);
    return events;
  }

  /** 排定合并拍(setTimeout(0)):每房间至多一个,已排定则无操作;回调先自摘句柄再 flush。 */
  schedule(roomId: string, flush: () => void): void {
    if (this.timers.has(roomId)) return;
    this.timers.set(
      roomId,
      setTimeout(() => {
        this.timers.delete(roomId);
        flush();
      }, 0),
    );
  }

  /** 撤已排定的拍(不 clearTimeout):强制同步排空前的覆盖——迟到的回调照常点火,
   *  对已排空的通道幂等空转(dirty 标记与累积袋均已被同步 flush 清走)。 */
  cancelScheduled(roomId: string): void {
    this.timers.delete(roomId);
  }

  /** 登记「已下行」批基线(#388 恢复播种):只记引用,不累积不排空——恢复快照自带的
   *  当前批视为已下发,防止恢复后首次广播把旧批当新批重发(客户端折叠二次落账)。 */
  seedSeen(roomId: string, batch: GameEvent[]): void {
    this.seen.set(roomId, batch);
  }

  /** 弃累积状态(seen + pending;房间散场路径,联机侧):已排定的拍不撤——迟到回调
   *  点火时房间已不在,flush 空转即清残表(与拆分前 server.ts dismiss 行为一致)。 */
  forget(roomId: string): void {
    this.pending.delete(roomId);
    this.seen.delete(roomId);
  }

  /** 全撤(含 clearTimeout;房间散场路径,单机侧):在途定时器一并撤销,
   *  端点残表由调用方自理。 */
  dispose(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (timer != null) clearTimeout(timer);
    this.timers.delete(roomId);
    this.pending.delete(roomId);
    this.seen.delete(roomId);
  }
}
