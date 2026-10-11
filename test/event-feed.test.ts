// 事件批下行通道·客户端接收面单测(#390):stash 语义(整批覆盖暂存 + 到达计数单调
// 递增 + 空批/未知字段容错)与 reset 清空。通道服务端形状见 scripts/server.ts flush;
// 线上端到端断言(消息真实到达客户端)归 e2e/react-online-events.spec.ts。
import { describe, it, expect } from "bun:test";
import { useNetStore } from "@app/store/netStore";
import { stashEventBatch } from "@app/net/event-feed";
import type { GameEvent } from "@core/game-events";

function ev(kind: string, extra: Record<string, unknown> = {}): GameEvent {
  // 测试事件只需形状(首部三件套 + kind);extra 模拟未来词汇扩展的未知字段透传。
  return { kind, seat: 0, round: 1, turn: 2, ...extra } as unknown as GameEvent;
}

describe("netStore.pushEventBatch(#390 事件批暂存)", () => {
  it("整批覆盖暂存,计数单调递增", () => {
    useNetStore.getState().reset();
    expect(useNetStore.getState().lastEvents).toBeNull();
    expect(useNetStore.getState().eventBatchSeq).toBe(0);

    stashEventBatch([ev("diceRolled", { die: 3 })]);
    expect(useNetStore.getState().lastEvents).toHaveLength(1);
    expect(useNetStore.getState().eventBatchSeq).toBe(1);

    stashEventBatch([ev("turnStarted"), ev("marchArrived", { tileIndex: 5 })]);
    expect(useNetStore.getState().lastEvents).toHaveLength(2);
    expect(useNetStore.getState().eventBatchSeq).toBe(2);
  });

  it("空批容错:照存不炸,计数照进", () => {
    useNetStore.getState().reset();
    stashEventBatch([]);
    expect(useNetStore.getState().lastEvents).toEqual([]);
    expect(useNetStore.getState().eventBatchSeq).toBe(1);
  });

  it("未知字段透传不炸(消息级容错:不校验、不裁剪)", () => {
    useNetStore.getState().reset();
    stashEventBatch([ev("capitalSelected", { tileIndex: 7, someFutureField: { x: 1 } })]);
    const stored = useNetStore.getState().lastEvents![0] as unknown as Record<string, unknown>;
    expect(stored["someFutureField"]).toEqual({ x: 1 });
  });

  it("reset 清空暂存与计数(退出联机防残留)", () => {
    stashEventBatch([ev("gameStarted")]);
    useNetStore.getState().reset();
    expect(useNetStore.getState().lastEvents).toBeNull();
    expect(useNetStore.getState().eventBatchSeq).toBe(0);
  });
});
