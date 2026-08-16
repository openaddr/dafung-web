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
  /** 连接全量状态(F2 断线横幅的数据源;idle = 尚未建连,不显示横幅)。
   *  二值 connected 区分不了「还没连过」与「断了正在重连」,横幅只要后者,
   *  且重连耗尽(gaveUp)要换文案「请刷新页面」——所以透出三值全量。 */
  connection: "idle" | "open" | "closed" | "gaveUp";
  /** 房主已解散(大厅/对局都该退出)。 */
  dismissed: boolean;
  /** 操作提示(加入失败/开局失败等;F4 起过期逻辑下沉到本 store 统一 1.8s)。 */
  hint: string | null;
  /** 提示级别(error = 红底白字 chip;info = 灰字面板)。 */
  hintLevel: "error" | "info";
  /** 命令已发出、快照未回(UI F3 的行军中… 态)。写入端点在 online.ts,读取端点在 HandPanel;
   *  并行边界:本文件只允许这三行(pending 字段 + setter + EMPTY 初值),其余归本线独占。 */
  pending: boolean;

  /** 入座成功(REST 回包)或收到广播后统一灌房间字段。 */
  setRoom: (v: Partial<NetRoomFields> & { roomId: string }) => void;
  setPending: (pending: boolean) => void;
  setMySeat: (seat: number) => void;
  setConnected: (connected: boolean) => void;
  /** F2:写入 socket 全量状态(open/closed/gaveUp);connected 由其派生同步。 */
  setConnection: (status: "open" | "closed" | "gaveUp") => void;
  setDismissed: () => void;
  pushHint: (hint: string | null, level?: "error" | "info") => void;
  /** 退出联机(回设置屏)时清空,防止残留房间态泄漏到下一次会话。 */
  reset: () => void;
}

const EMPTY: Pick<NetStoreState, "host" | "started" | "mapId" | "seats" | "mySeat" | "connected" | "connection" | "dismissed" | "hint" | "hintLevel" | "pending"> = {
  host: -1,
  started: false,
  mapId: null,
  seats: [],
  mySeat: -1,
  connected: false,
  connection: "idle",
  dismissed: false,
  hint: null,
  hintLevel: "error",
  pending: false,
};

// F4:hint 过期定时器归 store 持有(单一 1.8s 口径)。原三处渲染点各自 setTimeout
//(game 1.5s / lobby 1.8s / App+solo-setup 永不过期——评审 F4 的三套口径问题);
// 下沉后重复 push 先清旧定时器,无论哪个屏触发、是否切屏,过期时长都一致。
const HINT_TTL_MS = 1800;
let netHintTimer: ReturnType<typeof setTimeout> | null = null;

export const useNetStore = create<NetStoreState>((set) => ({
  roomId: "",
  ...EMPTY,
  // started=true(开局首帧的 lobby/snapshot 都带)时顺手清掉残留 hint:
  // "请先选择地图"等开局失败提示若不清,切屏(进对局)后屏上定时器已卸载,
  // 会一直留在 store,下次回大厅屏重闪(TODO #5 残留路径)。开局即视作时序已过。
  setRoom: (v) => {
    if (v.started && netHintTimer != null) {
      clearTimeout(netHintTimer);
      netHintTimer = null;
    }
    set(v.started ? { ...v, hint: null } : v);
  },
  setMySeat: (mySeat) => set({ mySeat }),
  setConnected: (connected) => set({ connected }),
  // F2:socket 全量状态入 store;connected 由此派生(onError 回调按 connected 判断
  // "正常在线"才闪提示,gaveUp 后不该再走在线分支,故一并置 false)。
  setConnection: (status) => set({ connection: status, connected: status === "open" }),
  setPending: (pending) => set({ pending }),
  setDismissed: () => set({ dismissed: true, connected: false }),
  pushHint: (hint, level = "error") => {
    if (netHintTimer != null) clearTimeout(netHintTimer); // 重复 push 先清旧定时器
    netHintTimer = hint === null ? null : setTimeout(() => set({ hint: null }), HINT_TTL_MS);
    set({ hint, hintLevel: level });
  },
  reset: () => {
    if (netHintTimer != null) {
      clearTimeout(netHintTimer);
      netHintTimer = null;
    }
    set({ roomId: "", ...EMPTY });
  },
}));

/** 我的座位当前是否托管中(服务器 seats 广播回读,无本地乐观态)。 */
export function myAutoPilotOn(s: NetStoreState): boolean {
  return s.seats[s.mySeat]?.autoPilot ?? false;
}
