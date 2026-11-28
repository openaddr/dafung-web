import {
  LobbyApi,
  type RoomCreateOptions,
  type RoomJoinReply,
  type RoomSeatCredentials,
} from "@dafung/core/protocol/lobby-api";
import type { ServerMsg } from "@dafung/core/protocol/wire";
import type { LobbyView } from "@dafung/core/room/seat-projection";
import { OnlineClient } from "./online-client";

type DismissedMsg = Extract<ServerMsg, { type: "dismissed" }>;

function createLobbyApi(serverBase: string): LobbyApi {
  return new LobbyApi(
    () => serverBase,
    (url, init) => fetch(url, init),
  );
}

/** 占用一个真实房间的座位。`connection` 可直接交给 HeadlessPlayer.connect。 */
export class HeadlessLobby<Admission extends RoomSeatCredentials = RoomSeatCredentials> {
  private constructor(
    private readonly api: LobbyApi,
    /** 首次入座的回包或原座凭证。当前房间状态由认证连接下发。 */
    readonly room: Readonly<Admission>,
    readonly connection: OnlineClient,
  ) {}

  static async createRoom(
    serverBase: string,
    options: RoomCreateOptions,
  ): Promise<HeadlessLobby<RoomJoinReply>> {
    const api = createLobbyApi(serverBase);
    return this.connect(api, await api.createRoom(options));
  }

  static async joinRoom(
    serverBase: string,
    roomId: string,
    guohao?: string,
  ): Promise<HeadlessLobby<RoomJoinReply>> {
    const api = createLobbyApi(serverBase);
    return this.connect(api, await api.joinRoom(roomId, guohao));
  }

  /** 凭原座连接，当前大厅或对局摘要留在连接上供调用方接收。 */
  static reconnect(
    serverBase: string,
    { roomId, seat, seatToken }: RoomSeatCredentials,
  ): Promise<HeadlessLobby> {
    return this.connect(createLobbyApi(serverBase), { roomId, seat, seatToken });
  }

  pickMap(mapId: string): Promise<void> {
    return this.api.pickMap(this.room, mapId);
  }

  startGame(): Promise<void> {
    return this.api.startGame(this.room);
  }

  dismissRoom(): Promise<void> {
    return this.api.dismissRoom(this.room);
  }

  /** 大厅等待只消费大厅帧，开局摘要留在同一连接上供局内接管。 */
  waitForLobby(matches: (lobby: LobbyView) => boolean, timeoutMs = 5_000): Promise<LobbyView> {
    return this.connection.waitFor<LobbyView>(
      (message) => message.type === "lobby" && matches(message),
      "大厅状态",
      timeoutMs,
    );
  }

  /** 解散通知先于连接关闭。已由局内玩家读过的消息仍可读取。 */
  async waitForDismissal(timeoutMs = 5_000): Promise<DismissedMsg> {
    await this.connection.waitClosed(timeoutMs);
    const message = this.connection.frames.find(
      (frame): frame is DismissedMsg =>
        frame.type === "dismissed" && frame.roomId === this.room.roomId,
    );
    if (message === undefined) throw new Error("连接已关闭，未收到本房间解散通知");
    return message;
  }

  /** 主动离开只关闭本机连接。 */
  close(): void {
    this.connection.close();
  }

  private static async connect<Admission extends RoomSeatCredentials>(
    api: LobbyApi,
    room: Admission,
  ): Promise<HeadlessLobby<Admission>> {
    const connection = await OnlineClient.connect(api.wsUrl(room, room.seat));
    return new HeadlessLobby<Admission>(api, room, connection);
  }
}
