import { LobbyApi as SharedLobbyApi } from "@dafung/core/protocol/lobby-api";
import { getServerBase } from "@app/net/server-base";

export type { RoomJoinReply } from "@dafung/core/protocol/lobby-api";

export class LobbyApi extends SharedLobbyApi {
  constructor() {
    // 每次请求都读取当前地址，使大厅改址即时生效。
    super(getServerBase, (url, init) => fetch(url, init));
  }
}
