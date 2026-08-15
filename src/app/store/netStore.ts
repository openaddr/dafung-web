// 联机状态 store(阶段 8):大厅/房间态的响应式数据源。
// 与 gameStore 分开:gameStore 管「对局快照」,本 store 管「房间元数据」(座位在线/
// 房主/选图/托管标记)——它们的生命周期不同(房间先于对局存在),混在一起会让
// snapshot 浅比较被无关字段污染。协议字段与 scripts/room.ts 的 lobbyView/seatMeta 一一对应。
import { create } from "zustand";

/** 座位元数据(服务器 seatMeta 原样转发;字段语义见 scripts/room.ts)。 */
export interface NetSeatMeta {
  seat: number;
  kind: "human" | "bot";
  taken: boolean;
  online: boolean;
  controlled: boolean;
  /** 自助托管中(bot 代打,身份仍是真人)。 */
  autoPilot: boolean;
}

/** lobby / snapshot 消息共有的房间字段(clientView 两种形态都带,见 room.ts 注释)。 */
export interface NetRoomFields {
  roomId: string;
  host: number;
  started: boolean;
  mapId: string | null;
  seats: NetSeatMeta[];
}

export interface NetStoreState extends NetRoomFields {
  /** 本端座位(-1 = 未入座)。 */
  mySeat: number;
  /** WS 是否连着(连接屏态的展示位)。 */
  connected: boolean;
  /** 房主已解散(大厅/对局都该退出)。 */
  dismissed: boolean;
  /** 操作提示(加入失败/开局失败等;由 UI 层过期)。 */
  hint: string | null;

  /** 入座成功(REST 回包)或收到广播后统一灌房间字段。 */
  setRoom: (v: Partial<NetRoomFields> & { roomId: string }) => void;
  setMySeat: (seat: number) => void;
  setConnected: (connected: boolean) => void;
  setDismissed: () => void;
  pushHint: (hint: string | null) => void;
  /** 退出联机(回设置屏)时清空,防止残留房间态泄漏到下一次会话。 */
  reset: () => void;
}

const EMPTY: Pick<NetStoreState, "host" | "started" | "mapId" | "seats" | "mySeat" | "connected" | "dismissed" | "hint"> = {
  host: -1,
  started: false,
  mapId: null,
  seats: [],
  mySeat: -1,
  connected: false,
  dismissed: false,
  hint: null,
};

export const useNetStore = create<NetStoreState>((set) => ({
  roomId: "",
  ...EMPTY,
  setRoom: (v) => set(v),
  setMySeat: (mySeat) => set({ mySeat }),
  setConnected: (connected) => set({ connected }),
  setDismissed: () => set({ dismissed: true, connected: false }),
  pushHint: (hint) => set({ hint }),
  reset: () => set({ roomId: "", ...EMPTY }),
}));

/** 我的座位当前是否托管中(服务器 seats 广播回读,无本地乐观态)。 */
export function myAutoPilotOn(s: NetStoreState): boolean {
  return s.seats[s.mySeat]?.autoPilot ?? false;
}
