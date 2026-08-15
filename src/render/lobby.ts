// 联机大厅屏(架构待办 ③):从 NetworkClient 收出的持状态模块。
// 持有大厅态 LobbyState + DOM;NetworkClient 在 onMessage 收到 lobby 消息时转发 update()。
// Host 控件(选图/开局)随 state.host 动态显隐——host 掉线移交后,新 host 自动获得按钮。
// 换图后的本地重建(rebuildForMap)仍归 NetworkClient:由 lobby 广播单路径驱动,
// host 与非 host 走同一条路,无乐观更新双路径。
import { isCustomId, type MapSource } from "@core/map-source";
import { getMapSource } from "./map-sources";
import { createMapSelectionScreen } from "./ui";
import { el } from "./dom";

/** 座位元数据:与服务器 seatMeta 输出一一对应。 */
export interface LobbySeatMeta {
  seat: number;
  kind: "human" | "bot";
  taken: boolean;
  online: boolean;
  controlled: boolean;
  /** 自助托管中(bot 代打,身份仍是真人;spec: autopilot)。 */
  autoPilot: boolean;
}

/** 大厅房间态:与服务器 lobby/snapshot 消息的房间字段一一对应(协议自描述,架构待办③)。 */
export interface LobbyState {
  roomId: string;
  seatCount: number;
  host: number;
  started: boolean;
  mapId: string | null;
  seats: LobbySeatMeta[];
}

/** NetworkClient 注入的行为:REST 请求与失败提示(本模块不持 ws/http)。 */
export interface LobbyHandlers {
  /** host 确认选图后发 /room/map;失败抛错(本模块负责提示)。 */
  onPickMap: (mapId: string) => Promise<void>;
  /** host 点开局发 /room/start;失败抛错(本模块负责提示)。 */
  onStart: () => Promise<void>;
  /** 请求失败的提示(如 flashHint)。 */
  onError: (message: string) => void;
}

/** 仅内置图的 MapSource(过滤 custom- 自建图):联机模式只支持内置图。 */
function builtinMapSource(): MapSource {
  const src = getMapSource();
  return {
    listMaps: async () => (await src.listMaps()).filter((e) => !isCustomId(e.id)),
    loadMapData: (id: string) => src.loadMapData(id),
  };
}

/** 按 id 查内置图展示名(异步 fetch 清单);查不到回退 id 本身。 */
async function builtinMapName(id: string): Promise<string> {
  try {
    const entries = await builtinMapSource().listMaps();
    const found = entries.find((e) => e.id === id);
    return found ? found.name : id;
  } catch {
    return id;
  }
}

export class LobbyController {
  private state: LobbyState;
  private readonly overlay: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly seatListEl: HTMLElement;
  private readonly mapNameEl: HTMLElement;
  private readonly hostControls: HTMLElement;

  constructor(
    /** 大厅层与选图二级屏共同挂载的父节点(= boardWrap)。 */
    parent: HTMLElement,
    /** 本端座位:座位行「你」标记 + host 控件显隐。 */
    private readonly mySeat: number,
    state: LobbyState,
    private readonly handlers: LobbyHandlers,
  ) {
    this.state = state;
    const overlay = el("div", { class: "scroll-overlay" });
    const box = el("div", { class: "scroll", style: "max-width:380px;" });
    box.appendChild(el("h2", { class: "scroll-title" }, ["大厅"]));
    box.appendChild(el("div", { class: "lobby-code", style: "font-size:34px;letter-spacing:6px;font-family:var(--font-deco);text-align:center;margin:10px 0;" }, [state.roomId]));
    this.hintEl = el("p", { style: "text-align:center;color:var(--ink-dim,#9c6b3f);" });
    box.appendChild(this.hintEl);
    this.seatListEl = el("div", { class: "lobby-seats", style: "margin:10px 0;" });
    box.appendChild(this.seatListEl);
    // 当前选中地图展示行:Host 可点「选择地图」换图(仅内置图);非 Host 只读显示图名。
    this.mapNameEl = el("span", { class: "lobby-map-name", style: "font-family:var(--font-deco);color:var(--ink);" });
    box.appendChild(el("div", { class: "lobby-map", style: "margin:8px 0;text-align:center;font-size:14px;" }, [
      el("span", { style: "color:var(--ink-dim,#9c6b3f);" }, ["当前地图:"]),
      this.mapNameEl,
    ]));
    this.hostControls = el("div", {});
    box.appendChild(this.hostControls);
    overlay.appendChild(box);
    parent.appendChild(overlay);
    this.overlay = overlay;

    // host 控件只建一次(不随 update 重建,保留 disabled 态),显隐由 renderAll 管。
    const mapBtn = el("button", { class: "btn", style: "display:block;margin:0 auto 4px;" }, ["选择地图"]) as HTMLButtonElement;
    mapBtn.addEventListener("click", () => {
      // 确认后仅发请求;本地换图由 lobby 广播统一驱动(单路径,见文件头)。
      createMapSelectionScreen(parent, builtinMapSource(), this.state.mapId ?? "sanguo", (mapId) => {
        void this.handlers.onPickMap(mapId).catch((err) => this.handlers.onError((err as Error).message));
      }, () => { /* 取消:无操作 */ });
    });
    const startBtn = el("button", { class: "btn btn-primary", style: "display:block;margin:10px auto 0;" }, ["开局"]) as HTMLButtonElement;
    startBtn.addEventListener("click", () => {
      startBtn.disabled = true; // 开局请求期间防重复点击;成功后大厅销毁,失败才回弹
      void this.handlers.onStart().catch((err) => {
        startBtn.disabled = false;
        this.handlers.onError((err as Error).message);
      });
    });
    this.hostControls.appendChild(mapBtn);
    this.hostControls.appendChild(startBtn);
    this.renderAll();
  }

  /** 收到 lobby 广播:更新状态并整体重渲(座位/图名/host 控件)。 */
  update(state: LobbyState): void {
    this.state = state;
    this.renderAll();
  }

  /** 移除大厅层(进入对局/解散/重建)。 */
  destroy(): void {
    this.overlay.remove();
  }

  private renderAll(): void {
    const isHost = this.state.host === this.mySeat;
    this.hintEl.textContent = isHost ? "把房间码发给同好;点开局后未满座位自动 bot 填充。" : "等待房主开局…";
    this.hostControls.style.display = isHost ? "" : "none";
    this.renderSeats();
    this.renderMapName();
  }

  private renderSeats(): void {
    this.seatListEl.innerHTML = "";
    for (const s of this.state.seats) {
      const tag = s.seat === this.mySeat ? "你" : s.kind === "bot" ? "bot" : s.taken ? "人" : "空";
      const host = s.seat === this.state.host ? " · 房主" : "";
      const dotClass = s.kind === "bot" ? "bot" : !s.taken ? "empty" : s.online ? "online" : "offline";
      const rowClass = s.seat === this.mySeat ? "lobby-seat-row is-you" : "lobby-seat-row";
      this.seatListEl.appendChild(el("div", { class: rowClass }, [
        el("span", { class: `seat-dot ${dotClass}` }),
        `诸侯 ${s.seat + 1} · ${tag}${host}${s.taken && !s.online ? " · 离线" : ""}`,
      ]));
    }
  }

  private renderMapName(): void {
    const id = this.state.mapId;
    this.mapNameEl.textContent = id ? id : "未选择";
    if (id) {
      void builtinMapName(id).then((name) => { this.mapNameEl.textContent = name; }).catch(() => { /* 保留 id 兜底 */ });
    }
  }
}
