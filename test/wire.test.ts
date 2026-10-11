// wire 协议编解码单源(#429)单测:锁消息形状 + 错误分类。
// 守卫两条契约:①下行构造函数产出的线上形状逐字固定(收编自 server.ts/room.ts 双写);
// ②上行 dispatch 的错误回报是返回值的一部分(badJson/unknownShape/rejected 三类),
// 任何失败都不抛出到传输层之外(非法命令→错误回报值,#428 口径的 codec 侧对偶)。
import { describe, it, expect } from "bun:test";
import type { GameCommand } from "@core/authority";
import type { GameEvent } from "@core/game-events";
import {
  autoPilotMsg,
  cmdMsg,
  dispatchInbound,
  dismissedMsg,
  encodeDownlink,
  errorMsg,
  eventsMsg,
  pickCapitalMsg,
  type InboundOps,
  type ServerMsg,
} from "../scripts/wire";

/** 任意合法形状事件(事件载荷透传,编解码不关心词汇表——core GameEvent 为准)。 */
function sampleEvent(): GameEvent {
  return {
    kind: "capitalSelected",
    seat: 2,
    round: 0,
    turn: 0,
    tileIndex: 0,
    propertyId: "prop-changan",
    cost: 2000,
  };
}

/** 不触达即失败的 ops(每个分发测试按需覆写)。 */
function noCallOps(): InboundOps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    cmd: () => {
      calls.push("cmd");
    },
    pickCapital: () => {
      calls.push("pickCapital");
    },
    setAutoPilot: () => {
      calls.push("setAutoPilot");
    },
  };
}

describe("wire 下行构造(#429 形状单源)", () => {
  it("events/error/dismissed 三构造:JSON 文本解出即线上形状", () => {
    const ev = sampleEvent();
    expect(JSON.parse(eventsMsg([ev]))).toEqual({ type: "events", events: [ev] });
    expect(JSON.parse(errorMsg("非法命令"))).toEqual({ type: "error", error: "非法命令" });
    expect(JSON.parse(dismissedMsg("ABCD"))).toEqual({ type: "dismissed", roomId: "ABCD" });
  });

  it("encodeDownlink:任意 ServerMsg 成员原样序列化(lobby/snapshot 由 seat-projection 产出,编解码只管封装)", () => {
    const msg: ServerMsg = { type: "dismissed", roomId: "XYZ" };
    expect(JSON.parse(encodeDownlink(msg))).toEqual({ type: "dismissed", roomId: "XYZ" });
    const batch: ServerMsg = { type: "events", events: [sampleEvent()] };
    expect(JSON.parse(encodeDownlink(batch))).toEqual(batch);
  });
});

describe("wire 上行 dispatch(#429 错误回报=返回值)", () => {
  it("编码→分发 round-trip:三族消息各达其 op,载荷原样", async () => {
    const seen: unknown[] = [];
    const ops: InboundOps = {
      cmd: (cmd) => {
        seen.push(cmd);
      },
      pickCapital: (tileIndex) => {
        seen.push(tileIndex);
      },
      setAutoPilot: (on, speed) => {
        seen.push({ on, speed });
      },
    };
    const cmd = { type: "respondReaction", seat: 0, use: false } as GameCommand;
    expect(await dispatchInbound(cmdMsg(cmd), ops)).toEqual({ ok: true });
    expect(await dispatchInbound(pickCapitalMsg(3), ops)).toEqual({ ok: true });
    expect(await dispatchInbound(autoPilotMsg(true, "slow"), ops)).toEqual({ ok: true });
    expect(seen).toEqual([cmd, 3, { on: true, speed: "slow" }]);
  });

  it("autoPilot speed 归一:非 slow 一律 fast(缺省/乱值同口径,单机联机一份)", async () => {
    const seen: { on: boolean; speed: string }[] = [];
    const ops: InboundOps = {
      cmd: () => {},
      pickCapital: () => {},
      setAutoPilot: (on, speed) => {
        seen.push({ on, speed });
      },
    };
    await dispatchInbound(JSON.stringify({ type: "autoPilot", on: true }), ops);
    await dispatchInbound(JSON.stringify({ type: "autoPilot", on: true, speed: "bogus" }), ops);
    await dispatchInbound(JSON.stringify({ type: "autoPilot", on: true, speed: "slow" }), ops);
    expect(seen).toEqual([
      { on: true, speed: "fast" },
      { on: true, speed: "fast" },
      { on: true, speed: "slow" },
    ]);
  });

  it("badJson:JSON 解析失败归 badJson,ops 不被触达", async () => {
    const ops = noCallOps();
    const r = await dispatchInbound("not-json{", ops);
    expect(r).toEqual({ ok: false, reason: "badJson", message: "bad json" });
    expect(ops.calls).toEqual([]);
  });

  it("unknownShape:形状不符逐字分类(缺字段/错类型/未知 type/非对象),缺省文案 + 可覆写", async () => {
    const ops = noCallOps();
    const shapes = [
      "{}",
      "null",
      "5",
      '"str"',
      "[]",
      JSON.stringify({ type: "bogus" }),
      JSON.stringify({ type: "cmd" }), // 缺 cmd
      JSON.stringify({ type: "cmd", cmd: null }),
      JSON.stringify({ type: "pickCapital" }), // 缺 tileIndex
      JSON.stringify({ type: "pickCapital", tileIndex: "3" }),
      JSON.stringify({ type: "autoPilot" }), // 缺 on
      JSON.stringify({ type: "autoPilot", on: "yes" }),
    ];
    for (const raw of shapes) {
      expect(await dispatchInbound(raw, ops)).toEqual({
        ok: false,
        reason: "unknownShape",
        message: "expected {type:'cmd',cmd:...}",
      });
    }
    expect(ops.calls).toEqual([]);
    // WS 面按房间状态覆写文案(对局未开始引导),分类不变
    const r = await dispatchInbound("{}", ops, { unknownShapeText: "对局未开始" });
    expect(r).toEqual({ ok: false, reason: "unknownShape", message: "对局未开始" });
  });

  it("rejected:ops 同步抛错/异步拒绝都归入返回值,文本原样;非 Error 抛出物 String 化", async () => {
    const boom = new Error("座位非法");
    const r1 = await dispatchInbound(cmdMsg({ type: "rollAndMove" } as GameCommand), {
      cmd: () => {
        throw boom;
      },
      pickCapital: () => {},
      setAutoPilot: () => {},
    });
    expect(r1).toEqual({ ok: false, reason: "rejected", message: "座位非法" });

    const r2 = await dispatchInbound(pickCapitalMsg(1), {
      cmd: () => {},
      pickCapital: () => Promise.reject(new Error("非选都阶段")),
      setAutoPilot: () => {},
    });
    expect(r2).toEqual({ ok: false, reason: "rejected", message: "非选都阶段" });

    const r3 = await dispatchInbound(autoPilotMsg(false, "fast"), {
      cmd: () => {},
      pickCapital: () => {},
      setAutoPilot: () => {
        throw "纯字符串异常"; // eslint-disable-line no-throw-literal
      },
    });
    expect(r3).toEqual({ ok: false, reason: "rejected", message: "纯字符串异常" });
  });

  it("非法命令注入(#428 口径对偶):引擎形 op 抛 TypeError → rejected 返回值,不炸调用方", async () => {
    // 模拟 respondReaction 携带越界 seat:players[99] 取 undefined 抛 TypeError
    const r = await dispatchInbound(
      cmdMsg({ type: "respondReaction", seat: 99, use: false } as GameCommand),
      {
        cmd: (cmd) => {
          const players = [{}, {}] as unknown[];
          const p = (players as { guohao?: string }[])[(cmd as { seat: number }).seat];
          if (!p)
            throw new TypeError(
              `Cannot read properties of undefined (seat=${(cmd as { seat: number }).seat})`,
            );
        },
        pickCapital: () => {},
        setAutoPilot: () => {},
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("rejected");
  });
});
