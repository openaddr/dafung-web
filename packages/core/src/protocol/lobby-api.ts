import type { WireRoomFields } from "./wire";

export interface RoomCreateOptions {
  seats?: number;
  /** 逗号分隔的零基 bot 座位号。 */
  bot?: string;
  seed?: number;
  target?: number;
  guohao?: string;
}

/** 建房或加入后交付房间信息与本席凭证。 */
export interface RoomJoinReply extends WireRoomFields {
  ok: true;
  seat: number;
  seatToken: string;
}

export type RoomSeatCredentials = Pick<RoomJoinReply, "roomId" | "seat" | "seatToken">;

type RoomCredentials = Pick<RoomSeatCredentials, "roomId" | "seatToken">;
type LobbyFetch = (url: string, init: RequestInit) => Promise<Response>;

export class LobbyHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LobbyHttpError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRoomSeat(row: unknown, index: number): row is WireRoomFields["seats"][number] {
  return (
    isObject(row) &&
    row.seat === index &&
    (row.kind === "human" || row.kind === "bot") &&
    typeof row.taken === "boolean" &&
    typeof row.online === "boolean" &&
    typeof row.autoPilot === "boolean" &&
    (typeof row.guohao === "string" || row.guohao === null)
  );
}

function readRoomReply(reply: Record<string, unknown>): RoomJoinReply {
  const { roomId, seat, seatToken, host, started, mapId, seats } = reply;
  if (
    typeof roomId !== "string" ||
    roomId.length === 0 ||
    typeof seatToken !== "string" ||
    seatToken.length === 0 ||
    typeof seat !== "number" ||
    !Number.isSafeInteger(seat) ||
    seat < 0
  )
    throw new Error("服务器入座回包缺少有效的房间或座位凭证");
  if (
    !Array.isArray(seats) ||
    !seats.every(isRoomSeat) ||
    seat >= seats.length ||
    typeof host !== "number" ||
    !Number.isSafeInteger(host) ||
    host < 0 ||
    host >= seats.length ||
    typeof started !== "boolean" ||
    (typeof mapId !== "string" && mapId !== null)
  )
    throw new Error("服务器入座回包的房间状态无效");
  return { ok: true, roomId, seat, seatToken, host, started, mapId, seats };
}

/** 安卓与无界面玩家共用的房间请求。房间变化及首份开局摘要从认证连接接收。 */
export class LobbyApi {
  constructor(
    private readonly getServerBase: () => string,
    private readonly fetch: LobbyFetch,
  ) {}

  async createRoom(options: RoomCreateOptions): Promise<RoomJoinReply> {
    return readRoomReply(await this.post("/room/new", options));
  }

  async joinRoom(roomId: string, guohao?: string): Promise<RoomJoinReply> {
    return readRoomReply(await this.post("/room/join", { roomId: roomId.toUpperCase(), guohao }));
  }

  async pickMap({ roomId, seatToken }: RoomCredentials, mapId: string): Promise<void> {
    await this.post("/room/map", { roomId, seatToken, mapId });
  }

  async startGame({ roomId, seatToken }: RoomCredentials): Promise<void> {
    await this.post("/room/start", { roomId, seatToken });
  }

  async dismissRoom({ roomId, seatToken }: RoomCredentials): Promise<void> {
    await this.post("/room/dismiss", { roomId, seatToken });
  }

  wsUrl({ roomId, seatToken }: RoomCredentials, seat: number): string {
    const url = this.endpoint("/ws");
    url.protocol = url.protocol.replace(/^http/, "ws");
    url.search = new URLSearchParams({
      room: roomId,
      seat: String(seat),
      token: seatToken,
    }).toString();
    return url.href;
  }

  private endpoint(path: string): URL {
    return new URL(`${this.getServerBase().replace(/\/+$/, "")}${path}`);
  }

  private async post(path: string, body: object): Promise<Record<string, unknown>> {
    const response = await this.fetch(this.endpoint(path).href, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const failure = `服务器连接失败(HTTP ${response.status})`;
    let reply: unknown;
    try {
      reply = await response.json();
    } catch (cause) {
      throw new LobbyHttpError(response.status, failure, { cause });
    }
    if (!isObject(reply)) throw new LobbyHttpError(response.status, failure);
    if (!response.ok || reply.ok !== true) {
      const reason = typeof reply.error === "string" ? reply.error : failure;
      throw new LobbyHttpError(response.status, reason);
    }
    return reply;
  }
}
