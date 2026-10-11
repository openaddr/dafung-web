// 统一传输原语(#397 单机统一 A):消息收发/断线通知/座位归属三类原语,两个实现——
// 真联机 = WsSeatTransport(承载 ReconnectingSocket,与 scripts/server.ts 的 WS 通路
// 同一建连/重连语义);单机 = MemorySocket(同进程内存双工,「服务器住在本进程」的
// 对端)。两实现同接口、同消息契约:线上载荷一律是 JSON 字符串(与 WS wire format
// 逐字对齐),解析归协议消费方(controllers),本层不认识任何消息类型。
//
// 房间编排侧(scripts/room.ts)对端点的最小视图是 SeatEndpoint(seat/send/open 三样,
// 见该文件传输面节);MemoryHostEnd 结构超集,可直接传入 registry.connectSeat。
// 设计语境:ADR-0020 事件流同步 + #379 单机统一(单机=联机同架构)。

import { ReconnectingSocket } from "./reconnecting-socket";

/** 座位端点传输原语:一个已入座连接的收发面。
 *  - 消息收发:send(上行)/ onMessage(下行),载荷=原始 JSON 字符串;
 *  - 断线通知:close(主动)/ onClose(被动);
 *  - 座位归属:seat(连接建立即绑定,token 鉴权归建立方)。 */
export interface SeatTransport {
  readonly seat: number;
  /** 上行一条消息。连接不可用时抛错(与原生 WebSocket 对非 OPEN 态 send 同语义)。 */
  send(data: string): void;
  /** 主动断开:本端置 closed,对端收 onClose;幂等。 */
  close(): void;
  /** 连接是否可收发(WS readyState === OPEN 的接口化)。 */
  readonly open: boolean;
  /** 订阅下行消息(原始字符串;多次订阅按序广播给所有回调)。 */
  onMessage(cb: (data: string) => void): void;
  /** 订阅断线通知(对端关闭或传输层断开;重连型实现的每次断开各触发一次)。 */
  onClose(cb: () => void): void;
}

/** 真联机实现:把 ReconnectingSocket(建连/退避重连)适配成座位端点。
 *  断线语义:socket 每次掉线(closed/gaveUp)对 onClose 订阅者各触发一次;
 *  未就绪 send 抛错(调用方以 open 门控,直抛与原生 WS 行为一致,零兜底)。 */
export class WsSeatTransport implements SeatTransport {
  constructor(
    readonly seat: number,
    private readonly sock: ReconnectingSocket,
  ) {}

  get open(): boolean {
    return this.sock.isOpen;
  }

  send(data: string): void {
    if (!this.sock.isOpen) throw new Error("WsSeatTransport:socket 未就绪,不可发送");
    this.sock.send(data);
  }

  close(): void {
    this.sock.close();
  }

  onMessage(cb: (data: string) => void): void {
    this.sock.onMessage(cb);
  }

  onClose(cb: () => void): void {
    this.sock.onStatus((s) => {
      if (s !== "open") cb();
    });
  }
}

/** 内存双工的宿主侧端点(房间编排把单机连接接到这里):客户端消息回调 + 下行 send。
 *  结构上是 room.ts SeatEndpoint 的超集,可直接传 registry.connectSeat。 */
export interface MemoryHostEnd {
  readonly seat: number;
  /** 对偶连接是否完好(任一端 close 即 false,与 WS 对端断开同语义)。 */
  readonly open: boolean;
  /** 下行一条消息(原始 JSON 字符串)。连接断开后抛错。 */
  send(data: string): void;
  /** 宿主侧主动断开:客户端收 onClose。幂等。 */
  close(): void;
  /** 客户端上行消息(原始字符串,到达序 = 发送序)。 */
  onClientMessage(cb: (data: string) => void): void;
  /** 客户端断开通知(客户端 close 触发一次)。 */
  onClientClose(cb: () => void): void;
}

/** 内存双工对(#397 实现二):同进程「客户端 ↔ 房间编排」的直连通道。
 *  与 WS 对齐的语义:载荷=字符串原样透传(契约=JSON 字符串);双向各自保序;
 *  任一端 close 后两端 open 均为 false,再 send 抛错(与对已关闭 socket 发送同语义);
 *  close 幂等,断开回调恰触发一次。内存直连无建连时延:创建即可用(open 恒真直到
 *  close),不存在 CONNECTING 中间态——这是单机「无网络级重连」语义的传输面根据。 */
export function createMemorySocketPair(seat: number): {
  client: SeatTransport;
  host: MemoryHostEnd;
} {
  let pairOpen = true;
  let closedBy: "client" | "host" | null = null;
  const clientMessageCbs = new Set<(data: string) => void>();
  const clientCloseCbs = new Set<() => void>();
  const hostMessageCbs = new Set<(data: string) => void>();
  const hostCloseCbs = new Set<() => void>();

  const closeBy = (who: "client" | "host"): void => {
    if (!pairOpen) return;
    pairOpen = false;
    closedBy = who;
    // 断开通知只发给对端(主动方自己知道;与 WS close 事件只落在对端同构)
    const cbs = who === "client" ? hostCloseCbs : clientCloseCbs;
    for (const cb of cbs) cb();
  };

  const client: SeatTransport = {
    seat,
    get open() {
      return pairOpen;
    },
    send(data: string): void {
      if (!pairOpen)
        throw new Error(
          `MemorySocket:客户端端点已关闭(${closedBy === "client" ? "本端主动" : "对端断开"}),不可发送`,
        );
      for (const cb of hostMessageCbs) cb(data);
    },
    close(): void {
      closeBy("client");
    },
    onMessage(cb: (data: string) => void): void {
      clientMessageCbs.add(cb);
    },
    onClose(cb: () => void): void {
      clientCloseCbs.add(cb);
    },
  };

  const host: MemoryHostEnd = {
    seat,
    get open() {
      return pairOpen;
    },
    send(data: string): void {
      if (!pairOpen)
        throw new Error(
          `MemorySocket:宿主端点已关闭(${closedBy === "host" ? "本端主动" : "对端断开"}),不可发送`,
        );
      for (const cb of clientMessageCbs) cb(data);
    },
    close(): void {
      closeBy("host");
    },
    onClientMessage(cb: (data: string) => void): void {
      hostMessageCbs.add(cb);
    },
    onClientClose(cb: () => void): void {
      hostCloseCbs.add(cb);
    },
  };

  return { client, host };
}
