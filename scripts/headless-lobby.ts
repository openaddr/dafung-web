import {
  LobbyApi,
  type RoomCreateOptions,
  type RoomJoinReply,
} from "@dafung/core/protocol/lobby-api";
import type { LobbyView } from "@dafung/core/room/seat-projection";
import { OnlineClient } from "./online-client";

/** 占用一个真实房间的座位。`connection` 可直接交给 HeadlessPlayer.connect。 */
export class HeadlessLobby {
  private constructor(
    private readonly api: LobbyApi,
    /** 入座回包中的房间状态和本席凭证。 */
    readonly room: Readonly<RoomJoinReply>,
    readonly connection: OnlineClient,
  ) {}

  static async createRoom(serverBase: string, options: RoomCreateOptions): Promise<HeadlessLobby> {
    const api = new LobbyApi(
      () => serverBase,
      (url, init) => fetch(url, init),
    );
    return this.connect(api, await api.createRoom(options));
  }

  static async joinRoom(
    serverBase: string,
    roomId: string,
    guohao?: string,
  ): Promise<HeadlessLobby> {
    const api = new LobbyApi(
      () => serverBase,
      (url, init) => fetch(url, init),
    );
    return this.connect(api, await api.joinRoom(roomId, guohao));
  }

  pickMap(mapId: string): Promise<void> {
    return this.api.pickMap(this.room, mapId);
  }

  startGame(): Promise<void> {
    return this.api.startGame(this.room);
  }

  /** 大厅等待只消费大厅帧，开局摘要留在同一连接上供局内接管。 */
  waitForLobby(matches: (lobby: LobbyView) => boolean, timeoutMs = 5_000): Promise<LobbyView> {
    return this.connection.waitFor<LobbyView>(
      (message) => message.type === "lobby" && matches(message),
      "大厅状态",
      timeoutMs,
    );
  }

  close(): void {
    this.connection.close();
  }

  private static async connect(api: LobbyApi, room: RoomJoinReply): Promise<HeadlessLobby> {
    const connection = await OnlineClient.connect(api.wsUrl(room, room.seat));
    return new HeadlessLobby(api, room, connection);
  }
}
