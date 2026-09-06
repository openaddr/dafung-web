// 联机大厅屏(阶段 8,对照旧 src/render/lobby.ts + network-client 的连接屏合并为一屏):
// - 未入座:建房(诸侯数/目标身价)或凭房间码加入;
// - 已入座:房间码 / 座位列表(在线·离线·bot·托管)/ 当前地图(host 可换)/ 房主开局;
// - 被解散:提示 + 返回首页。
// 服务器地址固定 location.origin(网页与引擎服务器同源部署,scripts/server.ts 托管 dist);
// 房间状态来自 netStore(OnlineController 把 REST 回包与 WS 广播灌进去),本屏无本地真源。
import { useEffect, useMemo, useRef, useState } from "react";
import { isCustomId } from "@core/map-source";
import { resolveGuohaoClash } from "@core/guohao";
import { getMapSource } from "@app/map-sources";
import { useNetStore, type NetSeatMeta } from "@app/store/netStore";
import { getController } from "@app/controllers/registry";
import { UI } from "@app/fx/timings";
import type { OnlineController } from "@app/controllers/online";
import { MapSelectPanel } from "@app/screens/setup/MapSelectPanel";
// #28:国号预设 key 与 SoloSetup 同源(起兵时写入,此处读出自动带入)
import { GUOHAO_PREF_KEY } from "@app/screens/setup/SoloSetupScreen";
import { HintBar } from "@app/screens/shared/HintBar";
import { ConnectionBanner } from "@app/screens/shared/ConnectionBanner";
// X10(#29):建房诸侯数原生 select → stepper(screens/shared;e2e 点 -/+ 与读数值)
import { Stepper } from "@app/screens/shared/Stepper";
import { LID } from "./testids";
// W2:大厅局部动画(座位点亮 keyframe 定义在此,见文件内注释)
import "./lobby.css";
// S1(#34):大厅卡片入场复用现成卷轴展开动画(0.35s;reduced-motion 由 app.css 全局兜层瞬时化)
import "@app/screens/game/scroll/scroll.css";

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

  // W2:等待文案轮换。非 host 换着法子说"等房主";host 未满座时轮换催座趣味句
  // (#84:首句固定为发码指引,不走轮换——房码是开局第一步,常驻不让趣味句顶掉)。
  // 依赖 (roomId/isHost/needMore) 变化时重置下标,避免切视角后先闪一句不合适的话。
  const isHost = host === mySeat;
  const needMore = seats.some((s) => !s.taken);
  const hostInviteLine = "把房间码发给好友，入座即可开局"; // #84:固定首句(发码指引)
  const waitLines = !isHost
    ? ["等待房主开局…", "主公尚在谋划…", "稍安勿躁…"]
    : ["虚位以待，静候群雄…", "坐等群雄入席…", "广发英雄帖…"]; // A4:标点全角统一
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

  // E7(#19):开局国号演算——与服务器 startGame 用同一 core 纯函数(先到先得,重名排前缀),
  // 预设 ≠ 演算名的座位行下出 xs 预告,「静默改前缀」变「提前知情」。
  const finalGuohao = useMemo(() => resolveGuohaoClash(seats.map((s) => s.guohao)), [seats]);

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
  // A5:「返回首页」含「回」——XiaoWei 离线镜像缺字形已剔出 fonts.css(回退楷体),deco 下即混排;
  // 返回类按钮字族落 wenkai(混排红线)。btnBase 单源替换,免抄两份基类。
  const backBase = btnBase.replace("font-deco", "font-wenkai");
  // R3-B11(#83):输入框与 Stepper(h-10)/按钮等高——建房排三控件同高,「诸侯数/目标身价」不再错位
  const inputBase = "h-10 rounded border border-ink/30 bg-bg px-2 py-2 font-deco text-ink";

  // ── 被解散:提示 + 返回(对照旧 dismissed → 回连接屏)──
  if (dismissed) {
    return (
      <div data-testid={LID.screen} className="flex min-h-full flex-col items-center justify-center gap-4 bg-bg p-6">
        <h1 className="font-brush text-3xl text-ink tracking-widest">房主已解散房间</h1>
        <button data-testid={LID.back} onClick={onExit} className={backBase + " ink-btn font-bold"}>
          返回首页
        </button>
      </div>
    );
  }

  // ── 未入座:建房 / 加入 ──
  if (!roomId) {
    return (
      // E1(#13):根节点只做滚动容器(flex-col overflow-y-auto),内层 m-auto 居中——
      // 内容不溢出时视觉与 justify-center 一致,溢出(小屏键盘弹起/横屏)时可滚达
      <div
        data-testid={LID.screen}
        className="relative flex h-full flex-col overflow-y-auto bg-bg p-6"
      >
        {/* F2 断线横幅:挂在卡片上方(未入座也可能在加入后断线;横幅绝对定位不挤布局) */}
        <ConnectionBanner />
        <div className="m-auto flex w-full flex-col items-center">
        <h1 className="font-brush text-4xl text-ink tracking-widest mb-1">联机对局</h1>
        {/* R3-A7(#70):破折号首尾对称,无法抵消 letter-spacing 尾空白,仍补 pl(同 HomeScreen「— 三国大富翁 —」) */}
        <div className="font-deco text-ink-dim mb-6 tracking-[0.4em] pl-[0.4em]">— 群雄逐鹿 —</div>
        {/* S1(#34):卡片入场复用 scroll-anim-unroll(0.35s 一次;reduced-motion 瞬时) */}
        <div className="scroll-anim-unroll note-card w-[min(420px,92vw)] rounded-[8px] p-5 flex flex-col gap-5">
          {/* 建房:建房者 = Seat0(host)。A4:分段头入 note-head 制式(印「建」+ wenkai 标签 + 发丝线) */}
          <div className="font-deco text-sm text-ink">
            <h3 className="note-head mb-2 text-xs tracking-[0.25em] text-ink-dim">
              <i>建</i>
              <span>建房</span>
            </h3>
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1">
                诸侯数
                <Stepper
                  testid={LID.seatCount}
                  ariaLabel="诸侯数"
                  value={seatCount}
                  min={2}
                  max={8}
                  onChange={setSeatCount}
                />
              </div>
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
                  // X14(#33):回车与失焦同口径即时校验(小屏回车不必先点别处)
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setTargetErr(validateTarget(target));
                  }}
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
                      // R3-D1(#99):建房者预设国号与加入同源(SoloSetup 起兵时写入),不再只有加入路径带
                      guohao: localStorage.getItem(GUOHAO_PREF_KEY) ?? undefined,
                    }),
                  );
                }}
                // R3-B11(#83):h-10 py-0 与输入框/Stepper 等高;等高后 self-end 不再需要(items-center 对齐)
                className={btnBase + " ink-btn font-bold h-10 py-0"}
              >
                {busy ? "处理中…" : "建房"}
              </button>
            </div>
          </div>
          {/* 加入:凭码占第一个空 human 座位;X14(#33) form 包裹——回车即提交(等价点「加入」;
              空码/处理中不动,与按钮禁用同口径)。小屏键盘弹起时按钮随 #13 滚动容器可达 */}
          <form
            className="font-deco text-sm text-ink border-t border-[rgba(43,35,23,0.22)] pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy || !joinCode.trim()) return;
              void guard(() => controller!.joinRoom(joinCode.trim(), localStorage.getItem(GUOHAO_PREF_KEY) ?? undefined));
            }}
          >
            {/* A4:分段头 note-head 制式,印文取「入」(加入) */}
            <h3 className="note-head mb-2 text-xs tracking-[0.25em] text-ink-dim">
              <i>入</i>
              <span>加入</span>
            </h3>
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
                type="submit"
                data-testid={LID.join}
                disabled={busy || !joinCode.trim()}
                // F1:busy 灰要说明「处理中」;未填码的灰不言自明,不额外打扰
                title={busy ? "处理中…" : joinCode.trim() ? undefined : "请输入房间码"}
                // R3-B11(#83):h-10 py-0,与房间码输入框等高
                className={btnBase + " note-btn h-10 py-0"}
              >
                {busy ? "处理中…" : "加入"}
              </button>
            </div>
          </form>
          {/* F4:统一 hint 组件(inline 行样式,过期口径与 game/App 一致) */}
          <HintBar hint={hint} level={hintLevel} variant="inline" />
          <button onClick={onExit} className={backBase + " note-btn self-start text-sm"}>
            返回首页
          </button>
        </div>
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
        copyTimerRef.current = setTimeout(() => setCopied(false), UI.copyFeedbackMs);
      },
      () => pushHint("复制失败，请手动抄录", "info"), // A4:标点全角统一
    );
  };
  return (
    // E1(#13):同未入座态——根节点滚动容器 + 内层 m-auto(8 座位满员时离开按钮也可滚达)
    <div
      data-testid={LID.screen}
      className="relative flex h-full flex-col overflow-y-auto bg-bg p-6"
    >
      {/* F2 断线横幅:卡片上方常驻(重连成功自动消失) */}
      <ConnectionBanner />
      <div className="m-auto flex w-full flex-col items-center">
      {/* S1(#34):卡片入场复用 scroll-anim-unroll(0.35s 一次;reduced-motion 瞬时) */}
      <div className="scroll-anim-unroll note-card w-[min(420px,92vw)] rounded-[8px] p-5">
        {/* R3-A7(#70):0.3em 字距令居中文本尾侧多一格空白,pl 同量补偿视觉居中(同 HomeScreen 副标题先例) */}
        <h1 className="font-brush text-2xl text-ink tracking-[0.3em] pl-[0.3em] text-center">大厅</h1>
        {/* 房间码:大字 + 字距;W2 点击复制 + xs 提示(testid 不变,e2e 只读文本)
            R3-A7(#70):0.4em 字距尾空白以 pl 同量补偿(同 HomeScreen 先例) */}
        <button
          type="button"
          data-testid={LID.roomCode}
          onClick={copyRoomCode}
          title="点击复制房间码"
          aria-label={`房间码 ${roomId}，点击复制`}
          // R3-B13(#85):hover 用底色反馈不动字色——金字于浅底对比不足(原 hover:text-gold 会掉到 1.8:1)
          className="mt-2 block w-full rounded-[3px] border-y-2 border-[rgba(43,35,23,0.4)] py-1 text-center font-brush text-4xl tracking-[0.4em] pl-[0.4em] text-ink cursor-pointer hover:bg-gold/10"
        >
          {roomId}
        </button>
        <div className="mt-1 text-center font-deco text-xs text-ink-dim">
          {copied ? "已复制" : "点击复制，发给好友凭码入座"}
        </div>
        <div className="mt-1 text-center font-deco text-xs text-ink-dim">
          {isHost
            ? needMore
              ? `${hostInviteLine}；${waitLines[waitIdx]}` // #84:固定首句 + 轮换趣味句(A4:全角分号)
              : "坐席已满，可开局；点开局后未入座自动 bot 填充。" // A4:标点全角统一
            : waitLines[waitIdx] /* 非 host:轮换等待文案 */}
        </div>

        {/* 座位列表(L8:key=座位号稳定;入场动画只在「空→有人」翻转时加 class,见 seatEntered effect) */}
        <div className="mt-3 flex flex-col gap-1">
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
                  {/* E7(#19):国号单字方章(与 HandPanel「你」印同款章形;未预设/bot 无章,
                      不放假国号——开局由引擎分配后自见)。
                      R3-B13(#85):金字叠金底对比不足,章形保留金边金底、字改 ink(约 11.7:1) */}
                  {s.guohao != null && (
                    <span
                      data-testid={LID.seatGuohao(s.seat)}
                      title={`预设国号「${s.guohao}」`}
                      className="inline-flex h-5 w-5 shrink-0 rotate-[-3deg] items-center justify-center rounded-[2px] bg-danger font-brush text-[13px] leading-none text-[#f6ead6]"
                    >
                      {s.guohao}
                    </span>
                  )}
                  <span className="text-ink">诸侯 {s.seat + 1}</span>
                  {/* A4:空座位浅印——「空」字位改一枚浅墨小方章「虚」(虚位以待,归墨不归金);
                      空座位仅 host 离席理论态才带「房主」后缀,保留不吞信息;testid 零变化 */}
                  {!s.taken ? (
                    <>
                      <span
                        title="虚位以待"
                        className="inline-flex h-5 w-5 shrink-0 rotate-[-3deg] items-center justify-center rounded-[2px] border border-[rgba(43,35,23,0.25)] font-brush text-[11px] leading-none text-ink-dim/70"
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
                    // R3-B13(#85):整行降为 ink-dim(约 5.3:1),被改的单字 ink 加粗强调
                    className="mt-0.5 px-2 font-deco text-xs text-ink-dim"
                  >
                    开局将改为『<span className="text-ink font-bold">{finalGh}</span>』
                  </div>
                )}
              </div>
            );
          })}
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
                className={btnBase + " note-btn text-sm"}
              >
                {busy ? "处理中…" : "选择地图"}
              </button>
              <button
                data-testid={LID.start}
                disabled={busy || !mapId}
                // F1:disabled 必须解释原因——未选图还是请求进行中,hover 可知
                title={busy ? "处理中…" : mapId ? undefined : "需先选择地图"}
                onClick={() => void guard(() => controller!.startGame())}
                className={btnBase + " ink-btn font-bold"}
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
          className={btnBase + " note-btn mt-3 mx-auto block text-sm"}
        >
          {busy ? "处理中…" : "离开房间"}
        </button>
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
            void guard(() => controller!.pickMap(id));
          }}
          onCancel={() => setShowMapSelect(false)}
        />
      )}
    </div>
  );
}
