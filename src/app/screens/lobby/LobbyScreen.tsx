// 组件收口：沿用大厅和地图选择底件；大厅入口和开局操作由各自组件承载。
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import { formatMoney } from "@core/money";
import { getMapSource } from "@app/map-sources";
import { useNetStore } from "@app/store/netStore";
import { getController } from "@app/controllers/registry";
import { UI } from "@app/fx/timings";
import type { OnlineController } from "@app/controllers/online";
import { MapSelectPanel } from "@app/screens/setup/MapSelectPanel";
// #28:国号预设 key 与 SoloSetup 同源(起兵时写入,此处读出自动带入)
import { GUOHAO_PREF_KEY } from "@app/screens/setup/SoloSetupScreen";
import { HintBar } from "@app/screens/shared/HintBar";
import {
  ConnectionBanner,
  CONN_BANNER_BODY_H,
  useConnDown,
} from "@app/screens/shared/ConnectionBanner";
import { useIsShortLandscape } from "@app/hooks/use-media-query";
import { useMapCatalog } from "@app/screens/setup/useMapCatalog";
import { LobbyEntry } from "./LobbyEntry";
import { LobbyRoomSeats } from "./LobbyRoomSeats";
import { LobbyStartActions } from "./LobbyStartActions";
import { LID } from "./testids";
import { useLobbyStart } from "./use-lobby-start";
// W2:大厅局部动画(座位点亮 keyframe 定义在此,见文件内注释)
import "./lobby.css";
// S1(#34):大厅卡片入场复用现成卷轴展开动画(0.35s;reduced-motion 由 app.css 全局兜层瞬时化)
import "@app/screens/game/scroll/scroll.css";

interface LobbyScreenProps {
  /** 退出联机回设置屏(接线方负责销毁 controller 与清 store)。 */
  onExit: () => void;
}

/** 最近一次入座成功的房间码，供独立的重进入口使用。 */
const LAST_ROOM_KEY = "dafung.lastRoomCode";

export function LobbyScreen({ onExit }: LobbyScreenProps) {
  const connDown = useConnDown();
  const connectionSpace = connDown
    ? { paddingTop: `calc(var(--safe-top) + ${CONN_BANNER_BODY_H + 8}px)` }
    : undefined;
  const roomId = useNetStore((s) => s.roomId);
  const mySeat = useNetStore((s) => s.mySeat);
  const host = useNetStore((s) => s.host);
  const mapId = useNetStore((s) => s.mapId);
  const seats = useNetStore((s) => s.seats);
  const dismissed = useNetStore((s) => s.dismissed);
  const hint = useNetStore((s) => s.hint);
  const hintLevel = useNetStore((s) => s.hintLevel);
  const pushHint = useNetStore((s) => s.pushHint);

  const [lastRoom, setLastRoom] = useState(() => localStorage.getItem(LAST_ROOM_KEY));
  const [createdRoom, setCreatedRoom] = useState<{ id: string; target: number | undefined } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [showMapSelect, setShowMapSelect] = useState(false);
  // W2:房间码「已复制」小态(1s 自清;不用 pushHint——那是错误/流程通道,复制是即时确认)
  const [copied, setCopied] = useState(false);
  // S-5:内置图源每渲染 new 会致 MapSelectPanel 重复拉取;useMemo 缓存(组件生命周期内不变)
  // 联机只支持内置图;#947 自建图通路退役后全仓只剩内置图源,直取进程级单例。
  const mapSource = useMemo(() => getMapSource(), []);
  // 房间地图展示名(C6 收口):id→name 经 useMapCatalog 单源清单解析;清单未到或
  // 无此 id 时显示 id(待数据语义,非兜底);拉取失败显式报错(下方 effect,零静默回退)。
  const { entries: mapEntries, error: mapError } = useMapCatalog(mapSource);
  useEffect(() => {
    if (mapError) useNetStore.getState().pushHint(`地图清单加载失败:${mapError}`);
  }, [mapError]);
  const selectedMap = mapEntries?.find((entry) => entry.id === mapId);
  const mapName = selectedMap ? selectedMap.name : mapId;
  // L-7:复制态自清定时器(卸载必须清,否则离开大厅后仍 setState)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isShortLandscape = useIsShortLandscape();

  useEffect(() => {
    return () => {
      if (copyTimerRef.current != null) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const isHost = host === mySeat;
  const start = useLobbyStart(isHost && roomId ? roomId : null);
  const takenCount = seats.filter((seat) => seat.taken).length;
  const knownRoomTarget = createdRoom?.id === roomId && isHost ? createdRoom : null;

  // F4:hint 过期已下沉 netStore.pushHint(1.8s 统一口径),本屏不再挂定时器。

  const controller = getController() as OnlineController | null;
  const reconnect = () => {
    if (controller === null) throw new Error("恢复横幅缺少联机控制器");
    controller.reconnect();
  };

  const guard = async (fn: (owner: OnlineController) => Promise<unknown>) => {
    if (busy || start.pending) return;
    if (!controller) {
      pushHint("联机会话已结束");
      return;
    }
    const owner = controller;
    setBusy(true);
    try {
      await fn(owner);
    } catch (err) {
      if (getController() === owner) pushHint((err as Error).message);
    } finally {
      if (getController() === owner) setBusy(false);
    }
  };

  const rememberRoom = (id: string) => {
    localStorage.setItem(LAST_ROOM_KEY, id);
    setLastRoom(id);
  };
  const roomActionsLocked = busy || start.pending;
  const hintBar = hint ? <HintBar hint={hint} level={hintLevel} variant="inline" /> : null;
  const vacancyNote = takenCount < seats.length && (
    <p className="text-paper-dim">开局时空位由电脑补齐</p>
  );

  // ── 被解散:提示 + 返回(对照旧 dismissed → 回连接屏)──
  if (dismissed) {
    return (
      <div
        data-testid={LID.screen}
        className="lobby-safe flex min-h-full flex-col items-center justify-center gap-4 bg-bg p-6"
      >
        <h1 className="font-title text-3xl text-paper tracking-widest">房主已解散房间</h1>
        <Button
          data-testid={LID.back}
          onClick={onExit}
          className="ink-btn min-h-(--touch-primary) px-4 font-brush"
        >
          返回首页
        </Button>
      </div>
    );
  }

  if (!roomId) {
    return (
      <div
        data-testid={LID.screen}
        className="lobby-safe lobby-root relative flex h-full flex-col overflow-y-auto bg-bg p-6"
        style={connectionSpace}
      >
        <ConnectionBanner onReconnect={reconnect} onExit={onExit} />
        <LobbyEntry
          busy={busy}
          shortLandscape={isShortLandscape}
          lastRoom={lastRoom}
          onCreate={(seats, target) => {
            void guard(async (owner) => {
              const reply = await owner.createRoom({
                seats,
                target,
                guohao: localStorage.getItem(GUOHAO_PREF_KEY) ?? undefined,
              });
              if (getController() !== owner) return;
              setCreatedRoom({ id: reply.roomId, target });
              rememberRoom(reply.roomId);
            });
          }}
          onJoin={(code) => {
            void guard(async (owner) => {
              const reply = await owner.joinRoom(
                code,
                localStorage.getItem(GUOHAO_PREF_KEY) ?? undefined,
              );
              if (getController() !== owner) return;
              setCreatedRoom(null);
              rememberRoom(reply.roomId);
            });
          }}
          onExit={onExit}
          hint={hintBar}
        />
      </div>
    );
  }

  // ── 已入座:房间大厅 ──
  // W2:房间码点击复制(clipboard API + 1s「已复制」小态;房码是高频转述物,复制比抄写友好)
  const copyRoomCode = () => {
    if (start.pending) return;
    navigator.clipboard?.writeText(roomId).then(
      () => {
        setCopied(true);
        // L-7:定时器入 ref,卸载 effect 统一清理(重复点击先清旧,防提前熄灭)
        if (copyTimerRef.current != null) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), UI.copyFeedbackMs);
      },
      () => pushHint("复制失败，请手动抄录", "info"), // A4:标点全角统一
    );
  };

  return (
    <div
      data-testid={LID.screen}
      data-connection-down={connDown}
      className="lobby-room-root relative flex h-full bg-bg"
      style={connectionSpace}
    >
      <ConnectionBanner onReconnect={reconnect} onExit={onExit} />
      <section className="lobby-room scroll-anim-unroll note-card">
        <header className="lobby-room-header">
          <h1 className="font-title text-2xl text-gold-bright">联机大厅</h1>
          <div className="min-w-0 wrap-anywhere text-right font-wenkai text-sm text-paper-dim">
            当前地图
            <span data-testid={LID.mapName} className="ml-2 text-paper">
              {mapName ?? "未选择"}
            </span>
            {/* 自定义目标只来自本座的建房请求。重进和来宾可读取地图预设。 */}
            {knownRoomTarget?.target !== undefined ? (
              <div className="text-xs">自定义目标 {formatMoney(knownRoomTarget.target)}</div>
            ) : selectedMap ? (
              <div className="text-xs">地图默认 {formatMoney(selectedMap.targetNetWorth)}</div>
            ) : knownRoomTarget && !mapId ? (
              <div className="text-xs">目标身价按地图默认</div>
            ) : null}
          </div>
        </header>

        <div className="lobby-room-body">
          <div className="lobby-room-table">
            <div className="lobby-room-invitation font-wenkai">
              <p className="lobby-room-count text-sm text-paper-dim">
                已入座 {takenCount}/{seats.length}
              </p>
              <p className="text-xs text-paper-dim">房间码</p>
              <Button
                type="button"
                data-testid={LID.roomCode}
                onClick={copyRoomCode}
                disabled={start.pending}
                aria-label={`房间码 ${roomId}，点击复制`}
                className="lobby-room-code note-btn min-h-(--touch-target) min-w-(--touch-target) disabled:opacity-40"
              >
                {roomId}
              </Button>
              <p role="status" className="min-h-4 text-xs leading-4 text-paper-dim">
                {!start.pending && (copied ? "已复制" : "点击复制")}
              </p>
            </div>
            <LobbyRoomSeats seats={seats} mySeat={mySeat} host={host} />
          </div>
        </div>

        <footer className="lobby-room-footer">
          <Button
            data-testid={LID.leave}
            disabled={roomActionsLocked}
            onClick={onExit}
            className="note-btn min-h-(--touch-target) min-w-(--touch-target) shrink-0 whitespace-nowrap px-3 font-brush text-sm disabled:opacity-40 sm:px-4"
          >
            离开房间
          </Button>
          {isHost ? (
            <LobbyStartActions
              state={start.state}
              mapSelected={mapId !== null}
              disabled={busy}
              connectionDown={connDown}
              hint={hintBar}
              idleNote={vacancyNote}
              onSelectMap={() => setShowMapSelect(true)}
              onStart={() => {
                if (roomActionsLocked || connDown || !mapId) return;
                if (showMapSelect) {
                  setShowMapSelect(false);
                  pushHint("请先在地图面板点「确认选择」", "info");
                  return;
                }
                start.submit(async () => {
                  if (!controller) throw new Error("联机会话已结束");
                  await controller.startGame();
                });
              }}
            />
          ) : (
            <div className="lobby-room-message text-paper-dim">
              {!connDown && (
                <>
                  {hintBar ?? <p>等待房主开局…</p>}
                  {vacancyNote}
                </>
              )}
            </div>
          )}
        </footer>
      </section>

      {/* 选图二级屏:复用 setup 的 MapSelectPanel(仅内置图源;S-5:mapSource 已 useMemo 缓存) */}
      {showMapSelect && (
        <MapSelectPanel
          mapSource={mapSource}
          currentMapId={mapId}
          onConfirm={(id) => {
            setShowMapSelect(false);
            // 只发请求;本地换图由 lobby 广播单路径驱动(见 online.ts rebuildForMap)
            void guard((owner) => owner.pickMap(id));
          }}
          onCancel={() => setShowMapSelect(false)}
        />
      )}
    </div>
  );
}
