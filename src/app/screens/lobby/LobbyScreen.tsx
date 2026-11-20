// 组件收口：沿用大厅和地图选择底件；大厅入口和开局操作由各自组件承载。
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import { resolveGuohaoClash } from "@core/guohao";
import { formatMoney } from "@core/money";
import { getMapSource } from "@app/map-sources";
import { useNetStore, type NetSeatMeta } from "@app/store/netStore";
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

/** 座位行的状态标签(对照旧 renderSeats:你/人/电脑/空 + 房主 + 离线)。L-5:统一全中文,不混排「bot」。 */
function seatTag(s: NetSeatMeta, mySeat: number, host: number): string {
  const who = s.seat === mySeat ? "你" : s.kind === "bot" ? "电脑" : s.taken ? "人" : "空";
  const suffix = [
    s.seat === host ? "房主" : "",
    s.taken && !s.online && s.kind === "human" ? "离线" : "",
    s.autoPilot ? "托管" : "",
  ]
    .filter(Boolean)
    .join("·");
  return suffix ? `${who}·${suffix}` : who;
}

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
  // L-8:刚「空→有人」的座位集合(仅这些行放入场动画);ref 记上一帧 taken 做状态 diff
  const [seatEntered, setSeatEntered] = useState<ReadonlySet<number>>(new Set());
  const prevTakenRef = useRef<Map<number, boolean>>(new Map());
  // L-7:复制态自清定时器(卸载必须清,否则离开大厅后仍 setState)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // #766:矮横屏档收紧入口标题与留量，已入座后切双列。
  const isShortLandscape = useIsShortLandscape();

  useEffect(() => {
    return () => {
      if (copyTimerRef.current != null) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const isHost = host === mySeat;
  const start = useLobbyStart(isHost && roomId ? roomId : null);
  const needMore = seats.some((seat) => !seat.taken);
  const takenCount = seats.filter((seat) => seat.taken).length;
  const knownRoomTarget = createdRoom?.id === roomId && isHost ? createdRoom : null;

  // L-8:座位「空→有人」翻转检测(key 稳定后,入场动画只在此刻加 class;
  // 上/下线、托管等状态翻转不再整行 remount 重放动画)。首帧视为入场,保留挂载点亮。
  useEffect(() => {
    const newly = seats
      .filter((s) => s.taken && !prevTakenRef.current.get(s.seat))
      .map((s) => s.seat);
    for (const s of seats) prevTakenRef.current.set(s.seat, s.taken);
    if (newly.length) setSeatEntered((prev) => new Set([...prev, ...newly]));
  }, [seats]);

  // F4:hint 过期已下沉 netStore.pushHint(1.8s 统一口径),本屏不再挂定时器。

  // E7(#19):开局国号演算——与服务器 startGame 用同一 core 纯函数(先到先得,重名排前缀),
  // 预设 ≠ 演算名的座位行下出 xs 预告,「静默改前缀」变「提前知情」。
  const finalGuohao = useMemo(() => resolveGuohaoClash(seats.map((s) => s.guohao)), [seats]);

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
  // F4:统一 hint 组件(inline 行样式,过期口径与 game/App 一致;空 hint 渲染 null)
  const hintBar = <HintBar hint={hint} level={hintLevel} variant="inline" />;

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
          className="ink-btn min-h-[44px] px-4 font-brush"
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

  // 房码块:标题 + 大字房码(点击复制)+ 复制提示 + 进度/等待文案(#766 构块化,两档共用)
  const roomBlock = (
    <div className="flex flex-col gap-1">
      {/* R3-A7(#70):0.3em 字距令居中文本尾侧多一格空白,pl 同量补偿视觉居中(同 HomeScreen 副标题先例) */}
      <h1 className="font-title text-2xl text-paper tracking-[0.3em] pl-[0.3em] text-center">
        大厅
      </h1>
      {/* 房间码:大字 + 字距;W2 点击复制 + xs 提示(testid 不变,e2e 只读文本)
        R3-A7(#70):0.4em 字距尾空白以 pl 同量补偿(同 HomeScreen 先例) */}
      <Button
        type="button"
        data-testid={LID.roomCode}
        onClick={copyRoomCode}
        disabled={start.pending}
        aria-label={`房间码 ${roomId}，点击复制`}
        // 玄墨版(#514):房码签上下金线裱边。
        // #838:房码是拉丁字母(A-Z),font-brush 花笔钩连转述字形自证性差,改 font-deco
        //(囗部四空芯码位已剔出其 unicode-range,拉丁字母不涉);金裱边与 0.4em 字距保留
        className="block w-full rounded-[3px] border-y-2 border-gold/40 py-1 text-center font-deco text-4xl tracking-[0.4em] pl-[0.4em] text-paper disabled:opacity-40"
      >
        {roomId}
      </Button>
      <div className="min-h-4 text-center font-wenkai text-xs leading-4 text-paper-dim">
        {!start.pending && (copied ? "已复制" : "点击复制，发给好友凭码入座")}
      </div>
      <div className="text-center font-wenkai text-xs text-paper-dim">
        {isHost ? `已入座 ${takenCount}/${seats.length}` : "等待房主开局…"}
        {isHost && needMore && !start.pending && "，开局时空位由电脑补齐"}
      </div>
    </div>
  );

  // 座位表(L8:key=座位号稳定;入场动画只在「空→有人」翻转时加 class,见 seatEntered effect)
  const seatsBlock = (
    <div className="flex flex-col gap-1">
      {seats.map((s) => {
        // E7(#19):预设 ≠ 演算名 = 该座位开局将被排到前缀(宁→东宁),行下 xs 预告
        const finalGh = finalGuohao[s.seat];
        const renamed = s.guohao != null && finalGh != null && finalGh !== s.guohao;
        return (
          <div key={s.seat}>
            <div
              data-testid={LID.seatRow(s.seat)}
              className={
                (seatEntered.has(s.seat) ? "lobby-seat-in " : "") +
                "flex items-center gap-2 rounded border px-2 py-1 font-deco text-sm " +
                (s.seat === mySeat
                  ? "border-gold bg-gold/10 text-paper"
                  : "border-paper/20 text-paper-dim")
              }
            >
              <span
                className={
                  "w-2.5 h-2.5 rounded-full " +
                  (s.kind === "bot"
                    ? "bg-paper/40"
                    : !s.taken
                      ? "bg-transparent border border-paper/30"
                      : s.online
                        ? "bg-success"
                        : "bg-paper/30")
                }
                data-testid={LID.seatOnline(s.seat)}
              />
              {/* S7:在线状态不能只靠颜色点传达(色弱不可辨)——点旁加文字标签 */}
              {s.taken && s.kind !== "bot" && (
                <span className={"text-xs " + (s.online ? "text-success" : "text-paper-dim")}>
                  {s.online ? "在线" : "离线"}
                </span>
              )}
              {/* E7(#19):国号单字方章(与 HandPanel「你」印同款章形;未预设/bot 无章,
                不放假国号——开局由引擎分配后自见)。
                R3-B13(#85):金字叠金底对比不足,章形保留金边金底、字改 ink(约 11.7:1) */}
              {s.guohao != null && (
                <span
                  data-testid={LID.seatGuohao(s.seat)}
                  role="img"
                  aria-label={`预设国号「${s.guohao}」`}
                  // 玄墨版(#514):国号章漆金化(.seal-gold,#506 印章漆金化)
                  className="seal-gold inline-flex h-5 w-5 shrink-0 rotate-[-3deg] items-center justify-center rounded-[2px] font-title text-[13px] leading-none"
                >
                  {s.guohao}
                </span>
              )}
              <span className="text-paper">诸侯 {s.seat + 1}</span>
              {/* A4:空座位浅印——「空」字位改一枚浅墨小方章「虚」(虚位以待,归墨不归金);
                空座位仅 host 离席理论态才带「房主」后缀,保留不吞信息;testid 零变化 */}
              {!s.taken ? (
                <>
                  <span
                    role="img"
                    aria-label="虚位以待"
                    // #559:text-paper-dim/70 → 全值 ink-dim(4.18:1 → 7.6:1,panel 上达 AA)
                    className="inline-flex h-5 w-5 shrink-0 rotate-[-3deg] items-center justify-center rounded-[2px] border border-paper/25 font-title text-[11px] leading-none text-paper-dim"
                  >
                    虚
                  </span>
                  {s.seat === host && <span>房主</span>}
                </>
              ) : (
                <span>{seatTag(s, mySeat, host)}</span>
              )}
            </div>
            {renamed && (
              <div
                data-testid={LID.guohaoPreview(s.seat)}
                // R3-B13(#85):整行降为 ink-dim(约 5.3:1),被改的单字提亮强调
                //(原 ink 加粗,#955 伪加粗清尾拔除)。
                // dogfood ISSUE-011:原文「开局将改为『东』」无主语,与「虚/离线」混排
                // 读不懂谁的国号要变——补「其国号」主语,一句话说清因果
                className="mt-0.5 px-2 font-deco text-xs text-paper-dim"
              >
                此席国号重名,开局将改为『
                <span className="text-paper">{finalGh}</span>』
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // 已知的自定义目标只来自本座成功建房的请求。重进和来宾只能读取地图预设。
  const mapLine = (
    <div className="text-center font-wenkai text-sm text-paper-dim">
      当前地图
      <span data-testid={LID.mapName} className="ml-1 text-paper">
        {mapName ?? "未选择"}
      </span>
      {knownRoomTarget?.target !== undefined ? (
        <div>自定义目标 {formatMoney(knownRoomTarget.target)}</div>
      ) : selectedMap ? (
        <div>地图默认 {formatMoney(selectedMap.targetNetWorth)}</div>
      ) : knownRoomTarget && !mapId ? (
        <div>目标身价按地图默认</div>
      ) : null}
    </div>
  );

  const hostActions = isHost ? (
    <LobbyStartActions
      state={start.state}
      shortLandscape={isShortLandscape}
      mapSelected={mapId !== null}
      disabled={busy}
      connectionDown={connDown}
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
  ) : null;

  const leaveBtn = (
    <Button
      data-testid={LID.leave}
      disabled={roomActionsLocked}
      onClick={onExit}
      className="note-btn mx-auto block min-h-[40px] px-4 py-2 font-brush text-sm disabled:opacity-40"
    >
      离开房间
    </Button>
  );

  return (
    // E1(#13):同未入座态——根节点滚动容器 + 内层 m-auto(8 座位满员时离开按钮也可滚达)。
    // #766 已入座分栏策略:高视口/竖屏单列 420 不变(房码→座位→地图→开局→离开);
    // 矮横屏档双列 min(720px,94vw)——左列=房码/文案/地图行/离开,右列=座位表+开局排
    // (host 时 sticky 钉底)。8 席竖向预算 ~340px,844×390 下 ≤1 屏,两列各自内滚兜底。
    <div
      data-testid={LID.screen}
      className="lobby-safe lobby-root relative flex h-full flex-col overflow-y-auto bg-bg p-6"
      style={connectionSpace}
    >
      {/* F2 断线横幅:卡片上方常驻(重连成功自动消失) */}
      <ConnectionBanner onReconnect={reconnect} onExit={onExit} />
      <div
        className={`m-auto flex w-full flex-col items-center ${isShortLandscape ? "lobby-wrap" : ""}`}
      >
        {/* S1(#34):卡片入场复用 scroll-anim-unroll(0.35s 一次;reduced-motion 瞬时) */}
        <div
          className={`scroll-anim-unroll note-card relative rounded-[8px] p-5 flex flex-col ${
            isShortLandscape
              ? "lobby-card lobby-card-fill w-[min(720px,94vw)] gap-2"
              : "w-[min(420px,92vw)] gap-3"
          }`}
        >
          {isShortLandscape ? (
            /* ── 矮横屏档(#766):双列栅格;开局排 sticky 见 hostActions/.lobby-actions ── */
            <div className="lobby-grid">
              <div className="lobby-col lobby-col-left">
                {roomBlock}
                {mapLine}
                {hint && hintBar}
                {leaveBtn}
              </div>
              <div className="lobby-col lobby-col-right">
                {seatsBlock}
                {hostActions}
              </div>
            </div>
          ) : (
            /* ── 高视口/竖屏档:信息架构零变化(竖屏同构,根容器滚动兜底 E1 #13)── */
            <>
              {roomBlock}
              {seatsBlock}
              {mapLine}
              {hostActions}
              {hint && <div className="mt-2">{hintBar}</div>}
              {leaveBtn}
            </>
          )}
        </div>
      </div>

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
