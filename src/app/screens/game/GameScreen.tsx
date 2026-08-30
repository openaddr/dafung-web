// Game 屏(阶段 5a):棋盘区 + 右侧栏四区,布局对照旧 createLayout 的结构比例。
//   棋盘占主体,侧栏固定宽(旧 .sidebar 同角色):回合状态 / 手牌+动作 / 珍宝·名士 / 诸侯
//   (L48:战报区移除,日志走胜利屏「导出日志」落 jsonl 文件,ADR-0014)。
// 数据流:gameStore.snapshot → 声明式渲染;交互统一经 registry 取 controller 下发。
import { useEffect, useMemo, useRef, useState } from "react";
import { BoardView, type BoardViewHandle } from "@app/components/board/BoardView";
import { loadMap } from "@core/board-loader";
import { useGameStore, useLocalPlayer } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { getController, getControllerMap } from "@app/controllers/registry";
import { formatMoney } from "@core/money";
import { playerColor, rgba } from "@core/theme";
import { AudioProvider, useAudio } from "@app/fx/AudioProvider";
import { DiceOverlay } from "@app/fx/DiceOverlay";
import { FxLayer } from "@app/fx/FxLayer";
import { useFxStore } from "@app/fx/fxStore";
import { HandPanel } from "./HandPanel";
import { TreasuryPanel } from "./TreasuryPanel";
import { OthersPanel } from "./OthersPanel";
import { WaitingBar } from "./WaitingBar";
import { StatusBar } from "./StatusBar";
import { DecisionScrollLayer } from "./scroll/DecisionScrollLayer";
import { HintBar } from "@app/screens/shared/HintBar";
import { ConnectionBanner } from "@app/screens/shared/ConnectionBanner";
import { TESTIDS } from "./testids";
import { IS_NARROW_QUERY, useIsNarrow } from "@app/hooks/use-media-query";
import { VERSION } from "../../../version";

/** 静音开关:棋盘区右上小按钮(须挂在 AudioProvider 内读 context,故独立组件)。 */
function MuteButton() {
  const audio = useAudio();
  if (!audio) return null;
  return (
    <button
      type="button"
      data-testid={TESTIDS.muteButton}
      title={audio.muted ? "开音" : "静音"}
      onClick={audio.toggleMuted}
      // W5:点击目标 ≥40px——py-2 + min-h/w-10 扩触达区,视觉字号不变
      className="absolute top-[calc(var(--safe-top)+8px)] right-[calc(var(--safe-right)+8px)] z-10 flex min-h-10 min-w-10 items-center justify-center rounded border border-gold/50 bg-panel/90 px-2 py-2 font-brush text-sm text-ink-dim hover:text-ink"
    >
      {/* S6 符号表统一:有声 ♪ / 静音 ♪̶(音符+删除线组合字符),不再 ♪/♫ 混用
          两种音符表达"有无声"(语义弱);同一符号加删除线直观表"关闭"。 */}
      {audio.muted ? "♪\u0336" : "♪"}
    </button>
  );
}

export function GameScreen() {
  // 城池详情(Playing 相位点城查看;Setup 选都期点可选城也走详情,内嵌「定都于此」)
  const [detailTileIndex, setDetailTileIndex] = useState<number | null>(null);
  // #35 详情卷轴的选都模式:选都期首击=查看详情,详情内确认才 setupPickCapital
  // (整合旧 pendingCapital「定都于此?」确认框——确认框不再独立存在)。
  const [detailPickCapital, setDetailPickCapital] = useState(false);
  // S5 遗留补全:侧栏抽屉折叠——收起成窄条(棋盘全屏看戏),状态记忆到 localStorage。
  // P0-7 窄屏(<768px)复用同一状态:侧栏变覆盖式滑入抽屉,只有 开/合 两态(无 w-12 窄条);
  // 首访默认——桌面展开、窄屏收起(棋盘优先),其后按用户选择记忆。
  // X6 #25:窄屏判定与 useIsNarrow 同源(IS_NARROW_QUERY,含横屏手机 ②分支),844×390 首访也收起。
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      const saved = localStorage.getItem("dafung.sidebar");
      if (saved === "open") return true;
      if (saved === "collapsed") return false;
      return !window.matchMedia(IS_NARROW_QUERY).matches;
    } catch {
      return true;
    }
  });
  const setSidebar = (open: boolean) => {
    setSidebarOpen(open);
    try {
      localStorage.setItem("dafung.sidebar", open ? "open" : "collapsed");
    } catch {
      /* 隐私模式写失败不阻塞 */
    }
  };
  const toggleSidebar = () => setSidebarOpen((open) => {
    const next = !open;
    try {
      localStorage.setItem("dafung.sidebar", next ? "open" : "collapsed");
    } catch {
      /* 隐私模式写失败不阻塞 */
    }
    return next;
  });
  // 模块级取控制器(不在 React 状态里:实例含方法/WS,非渲染数据,见 registry.ts 注释)
  const controller = getController();
  // 棋盘 pan/zoom 复位句柄(BoardView forwardRef 暴露 reset;总览复位按钮用)
  const boardRef = useRef<BoardViewHandle>(null);
  const map = getControllerMap();
  const snapshot = useGameStore((s) => s.snapshot);
  const interactive = useGameStore((s) => s.interactive);
  const viewSeat = useGameStore((s) => s.viewSeat);
  const hint = useGameStore((s) => s.hint);
  const hintLevel = useGameStore((s) => s.hintLevel);
  const localPlayer = useLocalPlayer();
  // 托管标记与联机 pending(G-8 托管可见性 / P0-3 窄条热钮防连点):与 HandPanel 同一回读口径
  const net = useNetStore();
  // 托管态单源取值:联机=座位广播(已入座,seats[mySeat] 恒存在);单机=控制器本地标记。
  // 不做链式回退——两种模式各有唯一事实源,取错源即暴露接线 bug。
  const autopilotOn = net.roomId !== "" ? net.seats[net.mySeat].autoPilot : (controller?.autoPilotOn ?? false);
  // P0-7 窄屏判定(<768px):决定侧栏走覆盖式抽屉还是桌面并排布局
  const isNarrow = useIsNarrow();
  // 行军接管的棋子(阶段 6):fxStore.marching → BoardView.skipTokenIds,
  // 行军期间 React 声明式定位让位给 useMarch 的逐段命令式动画。
  const marching = useFxStore((s) => s.marching);
  // F4:hint 过期已下沉 gameStore.pushHint(1.8s 统一口径),本屏不再挂定时器。

  // X4(#23) 选都候选:引擎三选一候选(snapshot.offeredCapitals,跨玩家不重复)全座位可见——
  // 旁观席位静态低透明金圈 + 壹贰叁序号印(不可点不脉冲),「轮到本地选」才升格为可点脉冲。
  const offeredCapitals =
    snapshot && snapshot.phase === "Setup" && snapshot.setupPhase === "PickCapital"
      ? snapshot.offeredCapitals
      : null;
  // 候选集内容串作键:快照每次 sync 都换新对象,按引用订阅会让 select 集/镜头效果
  // 随同步反复重建;同一候选集只应生效一次。
  const pickKey = offeredCapitals ? offeredCapitals.join(",") : null;
  // 轮到本地视角选都(单机真人固定首座;联机按房间座位)才有可点交互。
  const myPickKey =
    pickKey &&
    snapshot &&
    snapshot.currentSetupPlayerIndex === (net.roomId !== "" ? net.mySeat : 0)
      ? pickKey
      : null;
  const selectableTiles = useMemo(
    () => (myPickKey ? new Set(myPickKey.split(",").map(Number)) : undefined),
    [myPickKey],
  );
  // X4(#23) 选都仪式·镜头:轮到本地选都时缓动飞向三候选质心——候选常散布地图三隅,
  // 先给一眼定位,再由脉冲金圈/序号印接管注意力;同候选集只飞一次,不抢用户手动
  // pan/zoom 的镜头。board 由地图单源重建,positionOf 坐标即镜头逻辑系。
  const board = useMemo(() => (map ? loadMap(map).board : null), [map]);
  useEffect(() => {
    if (!board || !myPickKey) return;
    const pts = myPickKey.split(",").map((t) => board.positionOf(Number(t)));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    boardRef.current?.flyTo(cx, cy);
  }, [board, myPickKey]);

  if (!snapshot || !map) {
    // S9 未开局兜底页:此前只是一行灰字,玩家会卡死在空屏。
    // 理论上 setScreen("game") 前必有 controller+map(刷新丢快照/路由错误会到这里),
    // 给「回到首页」逃生口而不是让玩家面对空棋盘干瞪眼。
    const back = useGameStore.getState().setScreen;
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg p-6">
        <div className="rounded-lg border-2 border-gold/60 bg-panel px-10 py-8 text-center shadow">
          <div className="font-brush text-3xl text-ink tracking-widest">尚未开局</div>
          <div className="mt-2 font-deco text-sm text-ink-dim">对局数据不存在或已丢失</div>
          <button
            type="button"
            data-testid={TESTIDS.notStartedBack}
            onClick={() => back("setup")}
            className="mt-6 rounded-lg border border-gold bg-gold/80 px-8 py-3 font-brush text-xl tracking-[0.3em] text-ink hover:bg-gold cursor-pointer"
          >
            回到首页
          </button>
        </div>
      </div>
    );
  }

  // 快照玩家是 BoardPlayer 的结构超集(heroes/treasures 等展示字段棋盘不消费):
  // BoardView 的 props 已按真实消费面声明为最小接口,直接透传即可,无需断言。
  const players = snapshot.players;

  // 活跃方国号(引擎不变量:Playing 期 activeIndex 恒有效;非 Playing 不会被渲染消费)
  const activeGuohao = snapshot.phase === "Playing" ? snapshot.players[snapshot.activeIndex].guohao : "";

  // 「轮到我」条件(桌面窄条金框与窄屏浮动条共用口径):本地人类可操作且非托管的行军相位
  const myTurnToRoll =
    interactive && !autopilotOn && snapshot.phase === "Playing" && snapshot.turnPhase === "Roll";

  // 选都阶段的引导文案(三选一:引擎按价格分层+地理分散滚出 3 候选)
  const setupHint =
    snapshot.phase === "Setup" && snapshot.setupPhase === "PickCapital"
      ? `「${snapshot.players[snapshot.currentSetupPlayerIndex].guohao}」三选一:于候选城中择一定都`
      : null;

  // 关详情卷轴(#35:一并退出选都模式)
  const closeDetail = () => {
    setDetailTileIndex(null);
    setDetailPickCapital(false);
  };
  // #35 详情内「定都于此」:确认才落子推进
  const confirmCapital = (i: number) => {
    closeDetail();
    controller?.setupPickCapital(i);
  };

  return (
    <AudioProvider>
      {/* 3D 骰子(自建全屏 overlay,不渲染内容)——与 AudioProvider 同挂在 Game 屏,
          生命周期=一局;行军按钮点击后控制器 busy 锁 interactive,骰子播放期间防连点。 */}
      <DiceOverlay />
      <div className="relative flex h-full w-full bg-bg text-ink">
      {/* 棋盘区(相对定位承载 hint/WaitingBar/fx 覆盖层,同旧 board-wrap)。
          id="board-wrap":FxLayer 的逻辑坐标→容器像素换算锚点。 */}
      <div id="board-wrap" className="relative min-w-0 flex-1 overflow-hidden">
        {/* F2 断线横幅:z-20 压过 hint,断线是对局中优先级最高的状态反馈 */}
        <ConnectionBanner />
        <BoardView
          ref={boardRef}
          map={map}
          players={players}
          /* L47:视角玩家 id 透传——自己棋子加玩家色微光圈(棋盘侧「我是谁」锚点) */
          viewSeat={localPlayer?.id}
          onTileClick={(i) => {
            // 相位路由收口于此(Wave3 候选2,原 controller.tileClick 的职责上移):
            // Playing=任何格查看详情(#33,含特殊地点);Setup 选都期:
            // 可选城首击=详情卷轴(#35,确认在详情内),灰城点=即时 hint 反馈(#27)。
            if (snapshot.phase === "Playing") {
              setDetailTileIndex(i);
            } else if (selectableTiles) {
              if (selectableTiles.has(i)) {
                setDetailTileIndex(i);
                setDetailPickCapital(true);
              } else {
                const taken = snapshot.takenCapitalIndices.includes(i);
                useGameStore
                  .getState()
                  .pushHint(taken ? "该城已被占据,另择他城" : "本轮三选一:仅候选之城可选", "error");
              }
            }
          }}
          selectableTiles={selectableTiles}
          /* X4(#23):候选集全座位透传——旁观席位也见静态金圈与壹贰叁序号印 */
          candidateTiles={offeredCapitals ?? undefined}
          activeTileIndex={snapshot.phase === "Playing" ? players[snapshot.activeIndex].position : null}
          isSetupPhase={snapshot.phase === "Setup"}
          skipTokenIds={marching}
        />
        {/* 阶段 6:浮字/铜钱雨/回合横幅/印章(store 驱动的瞬时表现) */}
        <FxLayer />
        {setupHint && (
          // S8(#41):从 top-3(+12px,与 HintBar 同位重叠)下移到 WaitingBar 槽
          // (+48px)——选都期 WaitingBar 恒空(phase≠Playing 直接 null),同槽复用,
          // 任意 pushHint(+12px)与引导(+48px)上下错开不再叠字。
          <div
            data-testid={TESTIDS.hint}
            className="pointer-events-none absolute top-[calc(var(--safe-top)+48px)] left-1/2 -translate-x-1/2 rounded bg-panel/90 px-4 py-1 font-brush text-lg shadow"
          >
            {setupHint}
          </div>
        )}
        {/* F4:统一 hint 组件(样式与过期口径与 lobby/App 一致) */}
        <HintBar hint={hint} level={hintLevel} />
        {/* G-3/16/21 统一等待状态条:bot 运筹 / 远端人类落子 / 对方抉择 / 变卖抵债。
            X7 #26:底部「运筹中…」角标已删(同屏重复),thinking testid 迁入 WaitingBar 文案 span */}
        <WaitingBar
          snapshot={snapshot}
          interactive={interactive}
          viewSeat={viewSeat}
          online={net.roomId !== ""}
        />
        {/* 决策卷轴路由(阶段 6 接线):按相位弹招贤/珍宝/破产/胜利/城池详情。
            容器 pointer-events-none:无弹层时不挡棋盘;各弹层自带遮罩(z-30)接管交互。 */}
        <div id="scroll-layer" className="pointer-events-none absolute inset-0">
          <DecisionScrollLayer
            snapshot={snapshot}
            viewSeat={viewSeat}
            interactive={interactive}
            detailTileIndex={detailTileIndex}
            onDetailClose={closeDetail}
            detailPickCapital={detailPickCapital}
            onConfirmCapital={confirmCapital}
          />
        </div>
        {/* G-5 常驻回合 chip:左上悬浮钮下方(避开复位钮),国号色圆徽 +「X之回合」;
            bot 活跃时附「运筹中」微标(与 WaitingBar 文案口径一致),只读不拦交互。 */}
        {snapshot.phase === "Playing" &&
          (() => {
            const active = snapshot.players[snapshot.activeIndex];
            if (!active) return null;
            return (
              <div className="pointer-events-none absolute top-[calc(var(--safe-top)+56px)] left-[calc(var(--safe-left)+8px)] z-10 flex items-center gap-1.5 rounded bg-panel/90 px-2 py-1 shadow">
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full font-brush text-xs text-white"
                  style={{ backgroundColor: rgba(playerColor(active.colorIndex)) }}
                >
                  {active.guohao.charAt(0)}
                </span>
                <span className="font-brush text-sm text-ink">{active.guohao}之回合</span>
                {active.isBot && (
                  <span className="rounded bg-ink/80 px-1 font-brush text-xs text-panel">运筹中</span>
                )}
              </div>
            );
          })()}
        {/* 总览复位(对照旧版 reset-view):置于左上,与右上的静音按钮错开 */}
        <button
          type="button"
          data-testid={TESTIDS.resetView}
          title="总览复位"
          onClick={() => boardRef.current?.reset()}
          // W5:同静音按钮——min-h/w-10 触达区,符号视觉大小不变
          className="absolute top-[calc(var(--safe-top)+8px)] left-[calc(var(--safe-left)+8px)] z-10 flex min-h-10 min-w-10 items-center justify-center rounded border border-gold/50 bg-panel/90 px-2 py-2 font-brush text-sm text-ink-dim hover:text-ink"
        >
          {/* S6 符号表统一:复位统一 ◎(圆心居中,古印感),不再用光学校准符号 ⌖ */}
          ◎
        </button>
        {/* 静音开关(对照旧 board-wrap 顶栏;须在 AudioProvider 内层,故抽小组件) */}
        <MuteButton />
        {/* 版本角标(对照旧 main.ts 右下角,构建排查用;R3-A9 随 Noto Serif 移除改挂文楷) */}
        <span className="pointer-events-none absolute right-1 bottom-0.5 font-wenkai text-[10px] text-ink-dim/70">
          {VERSION}
        </span>
        {/* P0-7 窄屏浮动小条(侧栏抽屉收起时):把手 + 「轮到我」金框 + 行军热钮 + 「托」印。
            波1 加在桌面折叠窄条上的信息在此平移到棋盘右缘,窄屏收起时行军入口不丢。 */}
        {isNarrow && !sidebarOpen && (
          <div
            data-testid={TESTIDS.sidebarCollapsed}
            className={
              "absolute top-1/2 right-0 z-10 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l border border-r-0 border-gold/60 bg-panel/95 px-1 py-2 shadow-md " +
              (myTurnToRoll ? "bg-gold/10 ring-1 ring-gold/60" : "")
            }
          >
            <button
              type="button"
              data-testid={TESTIDS.sidebarToggle}
              title="展开侧栏"
              onClick={toggleSidebar}
              className="flex min-h-10 min-w-10 items-center justify-center rounded font-brush text-ink-dim hover:text-ink"
            >
              «
            </button>
            {/* G-8:托管中「托」印,收起态仍可见(点开抽屉可收回) */}
            {autopilotOn && (
              <span
                title="托管中,展开侧栏可收回"
                className="rounded border border-gold bg-gold/20 px-1 py-1 font-brush text-sm text-gold"
                style={{ writingMode: "vertical-rl" }}
              >
                托
              </span>
            )}
            <span
              title={`当前回合:${activeGuohao}`}
              className="font-brush text-lg text-ink"
              style={{ writingMode: "vertical-rl" }}
            >
              {activeGuohao}
            </span>
            {localPlayer && (
              <span
                title={`我的现金 ${formatMoney(localPlayer.cash)}`}
                className="font-brush text-sm text-money"
                style={{ writingMode: "vertical-rl" }}
              >
                {formatMoney(localPlayer.cash)}
              </span>
            )}
            {/* P0-3 行军热钮:与 HandPanel 主按钮同发 rollAndMove,pending 防连点 */}
            {myTurnToRoll && (
              <button
                type="button"
                title="行军"
                disabled={net.pending}
                onClick={() => controller?.dispatchCommand({ type: "rollAndMove" })}
                className="min-h-10 min-w-10 rounded border border-gold bg-gold/80 px-1 font-brush text-ink hover:bg-gold disabled:opacity-40"
                style={{ writingMode: "vertical-rl" }}
              >
                {net.pending ? "行军中…" : "行军"}
              </button>
            )}
          </div>
        )}
        {/* P0-7 窄屏遮罩:抽屉展开时压暗棋盘,点击即收(点心即关) */}
        {isNarrow && sidebarOpen && (
          <div
            data-testid="sidebar-backdrop"
            className="absolute inset-0 z-10 bg-ink/40"
            onClick={() => setSidebar(false)}
          />
        )}
      </div>
      {/* 右侧栏(四区:状态 / 手牌+动作 / 珍宝·名士 / 诸侯,标题横幅置顶)。
          L48:战报区已移除(日志保留在引擎快照,胜利屏「导出日志」落 jsonl 文件);
          珍宝·名士区接管原战报的弹性纵向空间,诸侯条独立成节钉底。
          S5 窄屏棋盘优先 + 抽屉折叠:宽屏 288px(w-72),md 以下 min(288px,45vw) 可压;
          收起时折叠为窄条(棋盘拿满),折叠/展开状态记忆 localStorage。四区 flex-col
          自适应,桌面压缩宽度下靠现有 overflow-hidden/内滚不破版。
          P0-7 窄屏(<768px)覆盖式抽屉:absolute 贴右滑入(translate 200ms),棋盘始终全宽;
          无 w-12 中间态,收起态的信息挪到棋盘右缘浮动小条(见 board-wrap 内)。
          R3-A5(#68):抽屉态改 overflow-y-auto——844×390 这类矮视口四区总高可超抽屉,
          旧 overflow-hidden 会把按 flex 分到 0 高的诸侯区静默裁切,改整抽屉滚动保底;
          桌面并排仍 overflow-hidden,布局不变。 */}
      <aside
        data-testid={sidebarOpen || isNarrow ? TESTIDS.sidebarPanel : TESTIDS.sidebarCollapsed}
        className={
          isNarrow
            ? "absolute inset-y-0 right-0 z-20 flex w-[min(320px,85vw)] shrink-0 flex-col overflow-y-auto border-l-2 border-gold/60 bg-panel shadow-2xl transition-transform duration-200 " +
              (sidebarOpen ? "translate-x-0" : "translate-x-full")
            : "flex shrink-0 flex-col overflow-hidden border-l-2 border-gold/60 bg-panel transition-[width] duration-300 " +
              (sidebarOpen ? "w-[min(288px,45vw)] md:w-72" : "w-12")
        }
      >
        {sidebarOpen || isNarrow ? (
          <>
            {/* R3-B9(#81):横幅分相位——对局中(Playing)压为单行(约 65px→36px,
                矮视口抽屉不再被常驻横幅占 1/6 高);Setup/GameOver 保留大横幅。 */}
            <h1
              className={
                "border-b border-gold/40 bg-panel-hi px-3 text-center font-brush tracking-widest " +
                (snapshot.phase === "Playing" ? "py-1.5 text-base" : "py-2 text-2xl")
              }
            >
              群雄逐鹿
              <small
                className={
                  snapshot.phase === "Playing"
                    ? "inline text-[10px] text-ink-dim"
                    : "block text-xs text-ink-dim"
                }
              >
                · 三国大富翁 ·
              </small>
            </h1>
            <StatusBar snapshot={snapshot} />
            <HandPanel
              snapshot={snapshot}
              player={localPlayer}
              controller={controller}
              interactive={interactive}
            />
            {/* L48 空间重排:战报区移除,腾出的弹性纵向空间给珍宝·名士常驻展示区;
                诸侯紧凑条独立成节钉在其后(自己资产优先占屏,他人信息紧凑收尾)。
                R3-A5(#68):isNarrow 同源下发抽屉态(IS_NARROW_QUERY 含横屏矮视口分支,
                勿用 max-md 纯宽度断点另抄)——珍宝·名士区在抽屉里放开 flex 保底。 */}
            <TreasuryPanel player={localPlayer} onCardDetailOpen={closeDetail} narrow={isNarrow} />
            {/* X13(#32):viewSeat 透传——诸侯列表自己行挂「你」印(口径同 WaitingBar) */}
            <OthersPanel snapshot={snapshot} viewSeat={viewSeat} />
            {/* 收起按钮钉底(不与四区抢纵向空间),W5 触达 ≥40px */}
            <button
              type="button"
              data-testid={TESTIDS.sidebarToggle}
              title="收起侧栏(全屏看棋)"
              onClick={toggleSidebar}
              className="flex min-h-10 items-center justify-center border-t border-gold/40 bg-panel-hi font-brush text-ink-dim hover:text-ink"
            >
              »
            </button>
          </>
        ) : (
          /* 折叠窄条:展开按钮置顶 + 活跃玩家国号竖排 + 我的现金,信息不归零 */
          <>
            <button
              type="button"
              data-testid={TESTIDS.sidebarToggle}
              title="展开侧栏"
              onClick={toggleSidebar}
              className="flex h-12 w-12 shrink-0 items-center justify-center border-b border-gold/40 bg-panel-hi font-brush text-ink-dim hover:text-ink"
            >
              «
            </button>
            {/* P0-3 折叠窄条「轮到我」:轮到本地人类且非托管时整条金色微底 + 内描边,
                一眼可辨不错过回合;底部挂竖排「行军」热钮(与主按钮同发 rollAndMove)。 */}
            <div
              className={
                "flex min-h-0 flex-1 flex-col items-center gap-4 overflow-hidden py-4 " +
                (interactive && !autopilotOn && snapshot.phase === "Playing" && snapshot.turnPhase === "Roll"
                  ? "bg-gold/10 ring-1 ring-gold/60 ring-inset"
                  : "")
              }
            >
              {/* G-8:托管中窄条常驻金色「托」印(竖排小方块),折叠后仍可见 */}
              {autopilotOn && (
                <span
                  title="托管中,展开侧栏可收回"
                  className="shrink-0 rounded border border-gold bg-gold/20 px-1 py-1 font-brush text-sm text-gold"
                  style={{ writingMode: "vertical-rl" }}
                >
                  托
                </span>
              )}
              <span
                title={`当前回合:${activeGuohao}`}
                className="font-brush text-xl text-ink"
                style={{ writingMode: "vertical-rl" }}
              >
                {activeGuohao}之回合
              </span>
              {localPlayer && (
                <span
                  title={`我的现金 ${formatMoney(localPlayer.cash)}`}
                  className="font-brush text-sm text-money"
                  style={{ writingMode: "vertical-rl" }}
                >
                  {/* G-2:与各面板同口径 formatMoney,不再手工换算丢精度 */}
                  {formatMoney(localPlayer.cash)}
                </span>
              )}
              {/* P0-3 行军热钮:命令与 HandPanel 主按钮一致(dispatchCommand 唯一入口),
                  pending(联机已发未回)时禁用防连点 */}
              {interactive && !autopilotOn && snapshot.phase === "Playing" && snapshot.turnPhase === "Roll" && (
                <button
                  type="button"
                  title="行军"
                  disabled={net.pending}
                  onClick={() => controller?.dispatchCommand({ type: "rollAndMove" })}
                  className="min-h-0 min-w-12 flex-1 rounded border border-gold bg-gold/80 px-1 font-brush text-ink hover:bg-gold disabled:opacity-40"
                  style={{ writingMode: "vertical-rl" }}
                >
                  {net.pending ? "行军中…" : "行军"}
                </button>
              )}
            </div>
          </>
        )}
      </aside>
      </div>
    </AudioProvider>
  );
}
