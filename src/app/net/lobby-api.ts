// REST 大厅客户端(从 controllers/online.ts 拆出):建房/加入/选图/开局/接管/解散的
// fetch 包装 + 入座回包收窄 + WS 升级 URL 拼接。为什么独立:「URL 与回包形状」是纯协议
// 知识,与引擎/store/表现无关,原先混在控制器里无法单测;独立后 OnlineController 只剩
// 「协议桥」职责(收消息→灌 store)。逻辑逐行照搬拆分前实现,零行为变化。
import type { NetRoomFields } from "@app/store/netStore";

/** REST 入座回包(对照 scripts/server.ts:/room/new、/room/join 端点返回:
 *  {ok, seat, seatToken, ...lobbyView};lobbyView 房间字段与 WS 广播同构)。 */
export interface RoomJoinReply extends NetRoomFields {
  ok: true;
  /** 分到的座位(建房=0 即 host)。 */
  seat: number;
  /** 座位归属凭证(WS 连接与后续 REST 鉴权用)。 */
  seatToken: string;
}

/** 入座后的鉴权凭证对(所有需要 seatToken 的端点共用)。 */
export interface RoomCreds {
  roomId: string;
  seatToken: string;
}

export class LobbyApi {
  /** 去尾斜杠的 server 基址(http(s)://host)。 */
  private readonly base: string;

  constructor(serverUrl: string) {
    this.base = serverUrl.replace(/\/$/, "");
  }

  /** WS 升级 URL(http→ws,query 带 room/seat/token;ADR-0002:token 夺回座位)。 */
  wsUrl(creds: RoomCreds, seat: number): string {
    return `${this.base.replace(/^http/, "ws")}/ws?room=${creds.roomId}&seat=${seat}&token=${creds.seatToken}`;
  }

  private http(path: string, body: unknown): Promise<Record<string, unknown>> {
    return fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => {
      const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      if (!r.ok || !j?.ok) throw new Error((j?.error as string) ?? `HTTP ${r.status}`);
      return j;
    });
  }

  /** 建房(POST /room/new)。 */
  createRoom(opts: { seats: number; bot?: number[]; seed?: number; target?: number }): Promise<RoomJoinReply> {
    return this.http("/room/new", opts).then((r) => this.parseRoomReply(r));
  }

  /** 按房间码加入(POST /room/join;房间码统一大写)。guohao=预设国号,重名时开局由服务器加方位前缀。 */
  joinRoom(roomId: string, guohao?: string): Promise<RoomJoinReply> {
    return this.http("/room/join", { roomId: roomId.toUpperCase(), guohao }).then((r) => this.parseRoomReply(r));
  }

  /** host 选图(POST /room/map;本地换图由 lobby 广播单路径驱动,无乐观更新)。 */
  pickMap(creds: RoomCreds, mapId: string): Promise<Record<string, unknown>> {
    return this.http("/room/map", { ...creds, mapId });
  }

  /** host 开局(POST /room/start;引擎在服务器侧构造,本端只等首帧 snapshot)。 */
  startGame(creds: RoomCreds): Promise<Record<string, unknown>> {
    return this.http("/room/start", creds);
  }

  /** host 强令 bot 接管掉线座位(POST /room/takeover;ADR-0002)。当前 UI 未接,协议侧先备齐。 */
  takeover(creds: RoomCreds, seat: number): Promise<Record<string, unknown>> {
    return this.http("/room/takeover", { ...creds, seat });
  }

  /** host 解散房间(POST /room/dismiss;当前 UI 未接,协议侧先备齐)。 */
  dismissRoom(creds: RoomCreds): Promise<Record<string, unknown>> {
    return this.http("/room/dismiss", creds);
  }

  /** REST 入座回包(/room/new、/room/join)的一次性收窄:
   *  原先用 6 个 as 硬取字段,现按 server.ts 端点返回(ok + 入座凭证 + lobbyView 房间字段,
   *  房间字段与 WS 广播同构)在此处集中做运行时校验/转换,后续代码全部走类型化字段。 */
  parseRoomReply(r: Record<string, unknown>): RoomJoinReply {
    return {
      ok: true,
      roomId: String(r.roomId),
      seat: Number(r.seat),
      seatToken: String(r.seatToken),
      host: Number(r.host),
      started: r.started === true,
      mapId: typeof r.mapId === "string" ? r.mapId : null,
      // seats 数组结构由 server.ts seatMeta 产出,这里只做边界防御(非数组按空处理)
      seats: Array.isArray(r.seats) ? (r.seats as NetRoomFields["seats"]) : [],
    };
  }
}
