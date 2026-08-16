// 联机大厅屏(阶段 8,对照旧 src/render/lobby.ts + network-client 的连接屏合并为一屏):
// - 未入座:建房(诸侯数/目标身价)或凭房间码加入;
// - 已入座:房间码 / 座位列表(在线·离线·bot·托管)/ 当前地图(host 可换)/ 房主开局;
// - 被解散:提示 + 返回设置屏。
// 服务器地址固定 location.origin(网页与引擎服务器同源部署,scripts/server.ts 托管 dist);
// 房间状态来自 netStore(OnlineController 把 REST 回包与 WS 广播灌进去),本屏无本地真源。
import { useEffect, useState } from "react";
import { isCustomId } from "@core/map-source";
import { getMapSource } from "@app/map-sources";
import { useNetStore, type NetSeatMeta } from "@app/store/netStore";
import { getController } from "@app/controllers/registry";
import type { OnlineController } from "@app/controllers/online";
import { MapSelectPanel } from "@app/screens/setup/MapSelectPanel";
import { HintBar } from "@app/screens/shared/HintBar";
import { ConnectionBanner } from "@app/screens/shared/ConnectionBanner";
import { LID } from "./testids";

export interface LobbyScreenProps {
  /** 退出联机回设置屏(接线方负责销毁 controller 与清 store)。 */
  onExit: () => void;
}

/** 仅内置图的地图源(联机只支持内置图;对照旧 lobby.ts 的 builtinMapSource)。 */
function builtinMapSource() {
  const src = getMapSource();
  return {
    listMaps: async () => (await src.listMaps()).filter((e) => !isCustomId(e.id)),
    loadMapData: (id: string) => src.loadMapData(id),
  };
}

/** 座位行的状态标签(对照旧 renderSeats:你/人/bot/空 + 房主 + 离线)。 */
function seatTag(s: NetSeatMeta, mySeat: number, host: number): string {
  const who = s.seat === mySeat ? "你" : s.kind === "bot" ? "bot" : s.taken ? "人" : "空";
  const suffix = [
    s.seat === host ? "房主" : "",
    s.taken && !s.online && s.kind === "human" ? "离线" : "",
    s.autoPilot ? "托管" : "",
  ].filter(Boolean).join("·");
  return suffix ? `${who}·${suffix}` : who;
}

export function LobbyScreen({ onExit }: LobbyScreenProps) {
  const roomId = useNetStore((s) => s.roomId);
  const mySeat = useNetStore((s) => s.mySeat);
  const host = useNetStore((s) => s.host);
  const mapId = useNetStore((s) => s.mapId);
  const seats = useNetStore((s) => s.seats);
  const dismissed = useNetStore((s) => s.dismissed);
  const hint = useNetStore((s) => s.hint);
  const hintLevel = useNetStore((s) => s.hintLevel);
  const pushHint = useNetStore((s) => s.pushHint);

  const [seatCount, setSeatCount] = useState(2);
  const [target, setTarget] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false); // 请求进行中:按钮防连点
  const [showMapSelect, setShowMapSelect] = useState(false);
  const [mapName, setMapName] = useState<string | null>(null);

  // 房间地图展示名(id → name;失败保留 id 兜底,对照旧 builtinMapName)
  useEffect(() => {
    if (!mapId) {
      setMapName(null);
      return;
    }
    let alive = true;
    builtinMapSource()
      .listMaps()
      .then((entries) => {
        const found = entries.find((e) => e.id === mapId);
        if (alive) setMapName(found ? found.name : mapId);
      })
      .catch(() => {
        if (alive) setMapName(mapId);
      });
    return () => {
      alive = false;
    };
  }, [mapId]);

  // F4:hint 过期已下沉 netStore.pushHint(1.8s 统一口径),本屏不再挂定时器。

  const controller = getController() as OnlineController | null;

  const guard = async (fn: () => Promise<unknown>) => {
    if (!controller || busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      pushHint((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const btnBase =
    "rounded border px-4 py-1.5 font-deco text-ink cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const inputBase = "rounded border border-ink/30 bg-bg px-2 py-1 font-deco text-ink";

  // ── 被解散:提示 + 返回(对照旧 dismissed → 回连接屏)──
  if (dismissed) {
    return (
      <div data-testid={LID.screen} className="flex min-h-full flex-col items-center justify-center gap-4 bg-bg p-6">
        <h1 className="font-brush text-3xl text-ink tracking-widest">房主已解散房间</h1>
        <button data-testid={LID.back} onClick={onExit} className={btnBase + " border-gold bg-gold/80"}>
          返回设置
        </button>
      </div>
    );
  }

  // ── 未入座:建房 / 加入 ──
  if (!roomId) {
    return (
      <div
        data-testid={LID.screen}
        className="relative flex min-h-full flex-col items-center justify-center bg-bg p-6"
      >
        {/* F2 断线横幅:挂在卡片上方(未入座也可能在加入后断线;横幅绝对定位不挤布局) */}
        <ConnectionBanner />
        <h1 className="font-brush text-4xl text-ink tracking-widest mb-1">联机对局</h1>
        <div className="font-deco text-ink-dim mb-6 tracking-[0.4em]">— 群雄逐鹿 —</div>
        <div className="w-[min(420px,92vw)] rounded-lg border border-gold/60 bg-panel p-5 shadow-xl flex flex-col gap-5">
          {/* 建房:建房者 = Seat0(host) */}
          <div className="font-deco text-sm text-ink">
            <div className="font-brush text-base mb-2">建房</div>
            <div className="flex items-center gap-2">
              <label className="flex flex-col gap-1">
                诸侯数
                <select
                  data-testid={LID.seatCount}
                  value={seatCount}
                  onChange={(e) => setSeatCount(Number(e.target.value))}
                  className={inputBase}
                >
                  {[2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n} 诸侯</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                目标身价(空=默认)
                <input
                  data-testid={LID.target}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="如 3000"
                  className={inputBase + " w-28"}
                />
              </label>
              <button
                data-testid={LID.create}
                disabled={busy}
                title={busy ? "处理中…" : undefined}
                onClick={() =>
                  void guard(() =>
                    controller!.createRoom({
                      seats: seatCount,
                      target: target.trim() ? parseInt(target, 10) : undefined,
                    }),
                  )
                }
                className={btnBase + " border-gold bg-gold/80 hover:bg-gold font-bold mt-5"}
              >
                建房
              </button>
            </div>
          </div>
          {/* 加入:凭码占第一个空 human 座位 */}
          <div className="font-deco text-sm text-ink border-t border-gold/30 pt-4">
            <div className="font-brush text-base mb-2">加入</div>
            <div className="flex items-center gap-2">
              <input
                data-testid={LID.joinInput}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="房间码"
                maxLength={8}
                className={inputBase + " w-24 tracking-[0.3em]"}
              />
              <button
                data-testid={LID.join}
                disabled={busy || !joinCode.trim()}
                // F1:busy 灰要说明「处理中」;未填码的灰不言自明,不额外打扰
                title={busy ? "处理中…" : joinCode.trim() ? undefined : "请输入房间码"}
                onClick={() => void guard(() => controller!.joinRoom(joinCode.trim()))}
                className={btnBase + " border-ink/40 bg-panel-hi hover:bg-bg-deep"}
              >
                加入
              </button>
            </div>
          </div>
          {/* F4:统一 hint 组件(inline 行样式,过期口径与 game/App 一致) */}
          <HintBar hint={hint} level={hintLevel} variant="inline" />
          <button onClick={onExit} className={btnBase + " border-ink/30 bg-panel-hi hover:bg-bg-deep self-start text-sm"}>
            返回设置
          </button>
        </div>
      </div>
    );
  }

  // ── 已入座:房间大厅 ──
  const isHost = host === mySeat;
  return (
    <div
      data-testid={LID.screen}
      className="relative flex min-h-full flex-col items-center justify-center bg-bg p-6"
    >
      {/* F2 断线横幅:卡片上方常驻(重连成功自动消失) */}
      <ConnectionBanner />
      <div className="w-[min(420px,92vw)] rounded-lg border border-gold/60 bg-panel p-5 shadow-xl">
        <h1 className="font-brush text-2xl text-ink tracking-[0.3em] text-center">大厅</h1>
        {/* 房间码:大字 + 字距(对照旧 .lobby-code 的展示口径) */}
        <div
          data-testid={LID.roomCode}
          className="mt-2 text-center font-brush text-4xl tracking-[0.4em] text-ink"
        >
          {roomId}
        </div>
        <div className="mt-1 text-center font-deco text-xs text-ink-dim">
          {isHost ? "把房间码发给同好;点开局后未满座位自动 bot 填充。" : "等待房主开局…"}
        </div>

        {/* 座位列表 */}
        <div className="mt-3 flex flex-col gap-1">
          {seats.map((s) => (
            <div
              key={s.seat}
              data-testid={LID.seatRow(s.seat)}
              className={
                "flex items-center gap-2 rounded border px-2 py-1 font-deco text-sm " +
                (s.seat === mySeat ? "border-gold bg-gold/10 text-ink" : "border-ink/20 text-ink-dim")
              }
            >
              <span
                className={
                  "w-2.5 h-2.5 rounded-full " +
                  (s.kind === "bot"
                    ? "bg-ink/40"
                    : !s.taken
                      ? "bg-transparent border border-ink/30"
                      : s.online
                        ? "bg-emerald-600"
                        : "bg-ink/30")
                }
              />
              <span className="text-ink">诸侯 {s.seat + 1}</span>
              <span>{seatTag(s, mySeat, host)}</span>
            </div>
          ))}
        </div>

        {/* 当前地图:host 可换(仅内置图);非 host 只读 */}
        <div className="mt-3 text-center font-deco text-sm text-ink-dim">
          当前地图:
          <span data-testid={LID.mapName} className="text-ink ml-1">
            {mapName ?? "未选择"}
          </span>
        </div>

        {/* host 控件:选图 + 开局(需先选图;开局后由首帧 snapshot 切屏) */}
        {isHost && (
          <div className="mt-3 flex flex-col items-center gap-1">
            <div className="flex items-center justify-center gap-3">
              <button
                data-testid={LID.selectMap}
                disabled={busy}
                title={busy ? "处理中…" : undefined}
                onClick={() => setShowMapSelect(true)}
                className={btnBase + " border-ink/30 bg-panel-hi hover:bg-bg-deep text-sm"}
              >
                选择地图
              </button>
              <button
                data-testid={LID.start}
                disabled={busy || !mapId}
                // F1:disabled 必须解释原因——未选图还是请求进行中,hover 可知
                title={busy ? "处理中…" : mapId ? undefined : "需先选择地图"}
                onClick={() => void guard(() => controller!.startGame())}
                className={btnBase + " border-gold bg-gold/80 hover:bg-gold font-bold"}
              >
                开局
              </button>
            </div>
            {/* F1:按钮下方 xs 原因行(title 之外的无障碍旁注,不依赖 hover) */}
            {!mapId && !busy && <div className="font-deco text-xs text-ink-dim">需先选择地图</div>}
          </div>
        )}
        {/* F4:统一 hint 组件(inline 行样式,过期口径与 game/App 一致) */}
        {hint && (
          <div className="mt-2">
            <HintBar hint={hint} level={hintLevel} variant="inline" />
          </div>
        )}
      </div>

      {/* 选图二级屏:复用 setup 的 MapSelectPanel(仅内置图源) */}
      {showMapSelect && (
        <MapSelectPanel
          mapSource={builtinMapSource()}
          currentMapId={mapId ?? "sanguo"}
          onConfirm={(id) => {
            setShowMapSelect(false);
            // 只发请求;本地换图由 lobby 广播单路径驱动(见 online.ts rebuildForMap)
            void guard(() => controller!.pickMap(id));
          }}
          onCancel={() => setShowMapSelect(false)}
        />
      )}
    </div>
  );
}
