// 联机大厅屏(阶段 8,对照旧 src/render/lobby.ts + network-client 的连接屏合并为一屏):
// - 未入座:建房(诸侯数/目标身价)或凭房间码加入;
// - 已入座:房间码 / 座位列表(在线·离线·bot·托管)/ 当前地图(host 可换)/ 房主开局;
// - 被解散:提示 + 返回首页。
// 服务器地址固定 location.origin(网页与引擎服务器同源部署,scripts/server.ts 托管 dist);
// 房间状态来自 netStore(OnlineController 把 REST 回包与 WS 广播灌进去),本屏无本地真源。
import { useEffect, useMemo, useRef, useState } from "react";
import { isCustomId } from "@core/map-source";
import { getMapSource } from "@app/map-sources";
import { useNetStore, type NetSeatMeta } from "@app/store/netStore";
import { getController } from "@app/controllers/registry";
import type { OnlineController } from "@app/controllers/online";
import { MapSelectPanel } from "@app/screens/setup/MapSelectPanel";
// #28:国号预设 key 与 SoloSetup 同源(起兵时写入,此处读出自动带入)
import { GUOHAO_PREF_KEY } from "@app/screens/setup/SoloSetupScreen";
import { HintBar } from "@app/screens/shared/HintBar";
import { ConnectionBanner } from "@app/screens/shared/ConnectionBanner";
import { LID } from "./testids";
// W2:大厅局部动画(座位点亮 keyframe 定义在此,见文件内注释)
import "./lobby.css";

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

/** 座位行的状态标签(对照旧 renderSeats:你/人/电脑/空 + 房主 + 离线)。L-5:统一全中文,不混排「bot」。 */
function seatTag(s: NetSeatMeta, mySeat: number, host: number): string {
  const who = s.seat === mySeat ? "你" : s.kind === "bot" ? "电脑" : s.taken ? "人" : "空";
  const suffix = [
    s.seat === host ? "房主" : "",
    s.taken && !s.online && s.kind === "human" ? "离线" : "",
    s.autoPilot ? "托管" : "",
  ].filter(Boolean).join("·");
  return suffix ? `${who}·${suffix}` : who;
}

/** 建房目标身价校验(L-2,零兜底:非法阻止提交并显式告知,不静默):
 *  空 = 默认值合法;否则须为正整数且不超过上限(上限取服务器 intField 可表达范围的实用子集)。 */
const TARGET_MAX = 99_999_999;
function validateTarget(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return "目标身价需为正整数";
  const n = parseInt(t, 10);
  if (n <= 0) return "目标身价需大于 0";
  if (n > TARGET_MAX) return `目标身价不能超过 ${TARGET_MAX}`;
  return null;
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
  // L-2:失焦校验后的错误文案(null = 合法或未校验);输入即清,提交前再全量校验
  const [targetErr, setTargetErr] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false); // 请求进行中:按钮防连点
  const [showMapSelect, setShowMapSelect] = useState(false);
  const [mapName, setMapName] = useState<string | null>(null);
  // W2:房间码「已复制」小态(1s 自清;不用 pushHint——那是错误/流程通道,复制是即时确认)
  const [copied, setCopied] = useState(false);
  // W2:等待文案轮换下标(3s 一换,制造"大厅还活着"的心跳感)
  const [waitIdx, setWaitIdx] = useState(0);
  // S-5:内置图源每渲染 new 会致 MapSelectPanel 重复拉取;useMemo 缓存(组件生命周期内不变)
  const mapSource = useMemo(builtinMapSource, []);
  // L-8:刚「空→有人」的座位集合(仅这些行放入场动画);ref 记上一帧 taken 做状态 diff
  const [seatEntered, setSeatEntered] = useState<ReadonlySet<number>>(new Set());
  const prevTakenRef = useRef<Map<number, boolean>>(new Map());
  // L-7:复制态自清定时器(卸载必须清,否则离开大厅后仍 setState)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current != null) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // W2:等待文案轮换。非 host 换着法子说"等房主";host 未满座时换着法子催人入座。
  // 依赖 (roomId/isHost/needMore) 变化时重置下标,避免切视角后先闪一句不合适的话。
  const isHost = host === mySeat;
  const needMore = seats.some((s) => !s.taken);
  const waitLines = !isHost
    ? ["等待房主开局…", "主公尚在谋划…", "稍安勿躁…"]
    : ["虚位以待,静候群雄…", "坐等群雄入席…", "广发英雄帖…"];
  useEffect(() => {
    setWaitIdx(0);
    const t = setInterval(() => setWaitIdx((i) => (i + 1) % waitLines.length), 3000);
    return () => clearInterval(t); // 卸载/条件变化时必须清,否则离开大厅仍在 setState
    // waitLines 按视角二选一后内容固定,长度恒 3,不列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, isHost, needMore]);

  // 房间地图展示名(id → name;失败保留 id 兜底,对照旧 builtinMapName)
  useEffect(() => {
    if (!mapId) {
      setMapName(null);
      return;
    }
    let alive = true;
    mapSource
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
  }, [mapId, mapSource]);

  // L-8:座位「空→有人」翻转检测(key 稳定后,入场动画只在此刻加 class;
  // 上/下线、托管等状态翻转不再整行 remount 重放动画)。首帧视为入场,保留挂载点亮。
  useEffect(() => {
    const newly = seats.filter((s) => s.taken && !prevTakenRef.current.get(s.seat)).map((s) => s.seat);
    for (const s of seats) prevTakenRef.current.set(s.seat, s.taken);
    if (newly.length) setSeatEntered((prev) => new Set([...prev, ...newly]));
  }, [seats]);

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

  // M-3 按钮触达 ≥40px:py-1.5 → py-2(返回/加入/建房共用基类,只改尺寸)
  const btnBase =
    "rounded border px-4 py-2 font-deco text-ink cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const inputBase = "rounded border border-ink/30 bg-bg px-2 py-1 font-deco text-ink";

  // ── 被解散:提示 + 返回(对照旧 dismissed → 回连接屏)──
  if (dismissed) {
    return (
      <div data-testid={LID.screen} className="flex min-h-full flex-col items-center justify-center gap-4 bg-bg p-6">
        <h1 className="font-brush text-3xl text-ink tracking-widest">房主已解散房间</h1>
        <button data-testid={LID.back} onClick={onExit} className={btnBase + " border-gold bg-gold/80"}>
          返回首页
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
                  {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>{n} 诸侯</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                目标身价(空=默认)
                <input
                  data-testid={LID.target}
                  value={target}
                  inputMode="numeric"
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setTargetErr(null); // 修改即清错,失焦/提交再校验
                  }}
                  onBlur={() => setTargetErr(validateTarget(target))}
                  placeholder="如 30000"
                  className={inputBase + " w-28" + (targetErr ? " border-danger" : "")}
                />
                {/* L-2:非法/越界的显式原因行(不静默) */}
                {targetErr && <span className="text-xs text-danger">{targetErr}</span>}
              </label>
              <button
                data-testid={LID.create}
                disabled={busy || targetErr != null}
                title={busy ? "处理中…" : undefined}
                onClick={() => {
                  // L-2 零兜底:提交前再校验一次,非法则阻止并显示原因(不静默吞掉)
                  const err = validateTarget(target);
                  setTargetErr(err);
                  if (err) return;
                  void guard(() =>
                    controller!.createRoom({
                      seats: seatCount,
                      target: target.trim() ? parseInt(target, 10) : undefined,
                    }),
                  );
                }}
                className={btnBase + " border-gold bg-gold/80 hover:bg-gold font-bold self-end"}
              >
                {busy ? "处理中…" : "建房"}
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
                className={inputBase + " w-44 tracking-[0.3em]"}
              />
              <button
                data-testid={LID.join}
                disabled={busy || !joinCode.trim()}
                // F1:busy 灰要说明「处理中」;未填码的灰不言自明,不额外打扰
                title={busy ? "处理中…" : joinCode.trim() ? undefined : "请输入房间码"}
                onClick={() => void guard(() => controller!.joinRoom(joinCode.trim(), localStorage.getItem(GUOHAO_PREF_KEY) ?? undefined))}
                className={btnBase + " border-ink/40 bg-panel-hi hover:bg-bg-deep"}
              >
                {busy ? "处理中…" : "加入"}
              </button>
            </div>
          </div>
          {/* F4:统一 hint 组件(inline 行样式,过期口径与 game/App 一致) */}
          <HintBar hint={hint} level={hintLevel} variant="inline" />
          <button onClick={onExit} className={btnBase + " border-ink/30 bg-panel-hi hover:bg-bg-deep self-start text-sm"}>
            返回首页
          </button>
        </div>
      </div>
    );
  }

  // ── 已入座:房间大厅 ──
  // W2:房间码点击复制(clipboard API + 1s「已复制」小态;房码是高频转述物,复制比抄写友好)
  const copyRoomCode = () => {
    navigator.clipboard?.writeText(roomId).then(
      () => {
        setCopied(true);
        // L-7:定时器入 ref,卸载 effect 统一清理(重复点击先清旧,防提前熄灭)
        if (copyTimerRef.current != null) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1000);
      },
      () => pushHint("复制失败,请手动抄录", "info"),
    );
  };
  return (
    <div
      data-testid={LID.screen}
      className="relative flex min-h-full flex-col items-center justify-center bg-bg p-6"
    >
      {/* F2 断线横幅:卡片上方常驻(重连成功自动消失) */}
      <ConnectionBanner />
      <div className="w-[min(420px,92vw)] rounded-lg border border-gold/60 bg-panel p-5 shadow-xl">
        <h1 className="font-brush text-2xl text-ink tracking-[0.3em] text-center">大厅</h1>
        {/* 房间码:大字 + 字距;W2 点击复制 + xs 提示(testid 不变,e2e 只读文本) */}
        <button
          type="button"
          data-testid={LID.roomCode}
          onClick={copyRoomCode}
          title="点击复制房间码"
          className="mt-2 block w-full text-center font-brush text-4xl tracking-[0.4em] text-ink cursor-pointer hover:text-gold"
        >
          {roomId}
        </button>
        <div className="mt-1 text-center font-deco text-xs text-ink-dim">
          {copied ? "已复制" : "点击复制"}
        </div>
        <div className="mt-1 text-center font-deco text-xs text-ink-dim">
          {isHost
            ? needMore
              ? waitLines[waitIdx] // host 未满座:轮换催座文案
              : "坐席已满,可开局;点开局后未入座自动 bot 填充。"
            : waitLines[waitIdx] /* 非 host:轮换等待文案 */}
        </div>

        {/* 座位列表(L8:key=座位号稳定;入场动画只在「空→有人」翻转时加 class,见 seatEntered effect) */}
        <div className="mt-3 flex flex-col gap-1">
          {seats.map((s) => (
            <div
              key={s.seat}
              data-testid={LID.seatRow(s.seat)}
              className={
                (seatEntered.has(s.seat) ? "lobby-seat-in " : "") +
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
                        ? "bg-success"
                        : "bg-ink/30")
                }
                data-testid={LID.seatOnline(s.seat)}
              />
              {/* S7:在线状态不能只靠颜色点传达(色弱不可辨)——点旁加文字标签 */}
              {s.taken && s.kind !== "bot" && (
                <span
                  className={
                    "text-xs " + (s.online ? "text-success" : "text-ink-dim")
                  }
                >
                  {s.online ? "在线" : "离线"}
                </span>
              )}
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
                {busy ? "处理中…" : "选择地图"}
              </button>
              <button
                data-testid={LID.start}
                disabled={busy || !mapId}
                // F1:disabled 必须解释原因——未选图还是请求进行中,hover 可知
                title={busy ? "处理中…" : mapId ? undefined : "需先选择地图"}
                onClick={() => void guard(() => controller!.startGame())}
                className={btnBase + " border-gold bg-gold/80 hover:bg-gold font-bold"}
              >
                {busy ? "处理中…" : "开局"}
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

        {/* P0-2:常驻「离开房间」入口(此前唯一退出=房主解散,玩家被困)。
            服务端无 /room/leave 路由(scripts/server.ts 只有 new/join/map/start/takeover/dismiss),
            故走本地退出:onExit = App.handleExitLobby(setController(null) → destroy 关 WS 清重连定时器
            + netStore.reset + 回设置屏)。座位 token 服务器侧掉线冻结机制已有,重进可重新加入。 */}
        <button
          data-testid="lobby-leave"
          disabled={busy}
          title={busy ? "处理中…" : undefined}
          onClick={() => {
            if (!busy) onExit();
          }}
          className={btnBase + " border-ink/40 bg-panel hover:bg-bg-deep mt-3 mx-auto block text-sm"}
        >
          {busy ? "处理中…" : "离开房间"}
        </button>
      </div>

      {/* 选图二级屏:复用 setup 的 MapSelectPanel(仅内置图源;S-5:mapSource 已 useMemo 缓存) */}
      {showMapSelect && (
        <MapSelectPanel
          mapSource={mapSource}
          currentMapId={mapId}
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
