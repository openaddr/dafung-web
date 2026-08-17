// Game 屏(阶段 5a):棋盘区 + 右侧栏四区,布局对照旧 createLayout 的结构比例。
//   棋盘占主体,侧栏固定宽(旧 .sidebar 同角色):回合状态 / 手牌+动作 / 诸侯·战报。
// 数据流:gameStore.snapshot → 声明式渲染;交互统一经 registry 取 controller 下发。
import { useMemo, useRef, useState } from "react";
import { BoardView, type BoardViewHandle } from "@app/components/board/BoardView";
import { useGameStore, useLocalPlayer } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { getController, getControllerContext, getControllerMap } from "@app/controllers/registry";
import { formatMoney } from "@core/money";
import { Theme } from "@core/theme";
import { AudioProvider, useAudio } from "@app/fx/AudioProvider";
import { DiceOverlay } from "@app/fx/DiceOverlay";
import { FxLayer } from "@app/fx/FxLayer";
import { useFxStore } from "@app/fx/fxStore";
import { HandPanel } from "./HandPanel";
import { WaitingBar } from "./WaitingBar";
import { StatusBar } from "./StatusBar";
import { WarlogPanel } from "./WarlogPanel";
import { ConfirmDialog } from "./scroll/ConfirmDialog";
import { DecisionScrollLayer } from "./scroll/DecisionScrollLayer";
import { HintBar } from "@app/screens/shared/HintBar";
import { ConnectionBanner } from "@app/screens/shared/ConnectionBanner";
import { TESTIDS } from "./testids";
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
      className="absolute top-2 right-2 z-10 flex min-h-10 min-w-10 items-center justify-center rounded border border-gold/50 bg-panel/90 px-2 py-2 font-brush text-sm text-ink-dim hover:text-ink"
    >
      {/* S6 符号表统一:有声 ♪ / 静音 ♪̶(音符+删除线组合字符),不再 ♪/♫ 混用
          两种音符表达"有无声"(语义弱);同一符号加删除线直观表"关闭"。 */}
      {audio.muted ? "♪\u0336" : "♪"}
    </button>
  );
}

export function GameScreen() {
  // 城池详情(Playing 相位点城查看,本地 UI 态;Setup 相位点城是选都,走 controller)
  const [detailTileIndex, setDetailTileIndex] = useState<number | null>(null);
  // 选都二次确认的目标城(需求1):React 化时把旧版「确认筑城/另择他城」框弄丢了,
  // 此处找回——点城只暂存目标,确认才落子;点其它可选城直接切换目标(弹窗内容跟随)。
  const [pendingCapital, setPendingCapital] = useState<number | null>(null);
  // S5 遗留补全:侧栏抽屉折叠——收起成窄条(棋盘全屏看戏),状态记忆到 localStorage。
  // 默认展开;收起态只留「展开」按钮 + 当前活跃玩家国号 + 我的现金竖排摘要。
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem("dafung.sidebar") !== "collapsed";
    } catch {
      return true;
    }
  });
  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem("dafung.sidebar", next ? "open" : "collapsed");
      } catch {
        /* 隐私模式写失败不阻塞 */
      }
      return next;
    });
  };
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
  const thinking = useGameStore((s) => s.thinking);
  const localPlayer = useLocalPlayer();
  // 托管标记与联机 pending(G-8 托管可见性 / P0-3 窄条热钮防连点):与 HandPanel 同一回读口径
  const net = useNetStore();
  const autopilotOn = net.seats[net.mySeat]?.autoPilot ?? controller?.autoPilotOn ?? false;
  // 行军接管的棋子(阶段 6):fxStore.marching → BoardView.skipTokenIds,
  // 行军期间 React 声明式定位让位给 useMarch 的逐段命令式动画。
  const marching = useFxStore((s) => s.marching);
  // F4:hint 过期已下沉 gameStore.pushHint(1.8s 统一口径),本屏不再挂定时器。

  // 选都阶段的可点城池:可建都(Property)且未被据(对照旧版 selectable 计算)
  const selectableTiles = useMemo(() => {
    if (!map || !snapshot || snapshot.phase !== "Setup" || snapshot.setupPhase !== "PickCapital") return undefined;
    const taken = new Set(snapshot.takenCapitalIndices);
    const s = new Set<number>();
    map.tiles.forEach((t, i) => {
      // board-loader:isCapitalEligible ⇔ type 为 Property(缺省即 Property)
      if ((!t.type || t.type === "Property") && !taken.has(i)) s.add(i);
    });
    return s;
  }, [map, snapshot]);

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

  // 选都阶段的引导文案(对照旧 showPickHint:「X」择一空城建都)
  const setupHint =
    snapshot.phase === "Setup" && snapshot.setupPhase === "PickCapital"
      ? `「${snapshot.players[snapshot.currentSetupPlayerIndex]?.guohao ?? "?"}」择一空城建都`
      : null;

  // 待确认城的信息(城名/筑城价/区域名):catalog 是静态查询上下文,渲染期直取即可
  const pendingCapitalInfo = useMemo(() => {
    if (pendingCapital == null) return null;
    const ctx = getControllerContext();
    const tile = ctx?.board.tiles[pendingCapital];
    const def = tile?.propertyId ? ctx?.catalog.get(tile.propertyId) : undefined;
    if (!tile || !def) return null;
    return {
      name: tile.name,
      price: formatMoney(def.purchasePrice),
      region: Theme.groupNames[def.group] ?? "未知",
    };
  }, [pendingCapital]);

  return (
    <AudioProvider>
      {/* 3D 骰子(自建全屏 overlay,不渲染内容)——与 AudioProvider 同挂在 Game 屏,
          生命周期=一局;行军按钮点击后控制器 busy 锁 interactive,骰子播放期间防连点。 */}
      <DiceOverlay />
      <div className="flex h-full w-full bg-bg text-ink">
      {/* 棋盘区(相对定位承载 hint/thinking/fx 覆盖层,同旧 board-wrap)。
          id="board-wrap":FxLayer 的逻辑坐标→容器像素换算锚点。 */}
      <div id="board-wrap" className="relative min-w-0 flex-1 overflow-hidden">
        {/* F2 断线横幅:z-20 压过 hint,断线是对局中优先级最高的状态反馈 */}
        <ConnectionBanner />
        <BoardView
          ref={boardRef}
          map={map}
          players={players}
          onTileClick={(i) => {
            // 相位路由收口于此(Wave3 候选2,原 controller.tileClick 的职责上移):
            // Playing=查看详情(本地 UI 态);Setup 选都期=弹「定都于此?」确认框
            // (需求1:点城不再直接落子,确认后才 setupPickCapital)。
            if (snapshot.phase === "Playing") setDetailTileIndex(i);
            else if (selectableTiles?.has(i)) setPendingCapital(i);
          }}
          selectableTiles={selectableTiles}
          activeTileIndex={snapshot.phase === "Playing" ? players[snapshot.activeIndex].position : null}
          isSetupPhase={snapshot.phase === "Setup"}
          skipTokenIds={marching}
        />
        {/* 阶段 6:浮字/铜钱雨/回合横幅/印章(store 驱动的瞬时表现) */}
        <FxLayer />
        {setupHint && (
          <div
            data-testid={TESTIDS.hint}
            className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded bg-panel/90 px-4 py-1 font-brush text-lg shadow"
          >
            {setupHint}
          </div>
        )}
        {/* F4:统一 hint 组件(样式与过期口径与 lobby/App 一致) */}
        <HintBar hint={hint} level={hintLevel} />
        {/* G-3/16/21 统一等待状态条:bot 运筹 / 远端人类落子 / 对方抉择 / 变卖抵债,
            替代旧「运筹中…」单一角标(文案按等待对象细分;thinking testid 保留在此) */}
        <WaitingBar
          snapshot={snapshot}
          interactive={interactive}
          viewSeat={viewSeat}
          online={net.roomId !== ""}
        />
        {(thinking || (snapshot.phase !== "GameOver" && snapshot.players[snapshot.activeIndex]?.isBot)) && (
          // "运筹中…":bot 行动时(旧 setThinking;本阶段 bot 同步驱动,一闪而过,保留展示位;
          // e2e react-solo 依赖此 testid)
          <div
            data-testid={TESTIDS.thinking}
            className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-ink/80 px-3 py-1 font-brush text-panel"
          >
            运筹中…
          </div>
        )}
        {/* 决策卷轴路由(阶段 6 接线):按相位弹招贤/珍宝/破产/胜利/城池详情。
            容器 pointer-events-none:无弹层时不挡棋盘;各弹层自带遮罩(z-30)接管交互。 */}
        <div id="scroll-layer" className="pointer-events-none absolute inset-0">
          <DecisionScrollLayer
            snapshot={snapshot}
            viewSeat={viewSeat}
            interactive={interactive}
            detailTileIndex={detailTileIndex}
            onDetailClose={() => setDetailTileIndex(null)}
          />
        </div>
        {/* 选都二次确认(需求1):遮罩不拦棋盘——弹窗开着仍可点其它可选城换目标。
            相位离开 Setup(确认落子推进)时 pendingCapital 立即清空,弹窗随快照切换消失。 */}
        {pendingCapitalInfo ? (
          <ConfirmDialog
            testid={TESTIDS.confirmCapital}
            backdropBlocks={false}
            title="定都于此?"
            confirmLabel="确认筑城"
            cancelLabel="另择他城"
            onConfirm={() => {
              const i = pendingCapital;
              setPendingCapital(null);
              if (i != null) controller?.setupPickCapital(i);
            }}
            onCancel={() => setPendingCapital(null)}
          >
            <p className="m-0 leading-7">
              于 <b className="font-brush text-ink">{pendingCapitalInfo.name}</b> 筑城立都
              <br />
              筑城之资:<span className="text-money">{pendingCapitalInfo.price}</span>
              <br />
              所属区域:{pendingCapitalInfo.region}
            </p>
          </ConfirmDialog>
        ) : null}
        {/* 总览复位(对照旧版 reset-view):置于左上,与右上的静音按钮错开 */}
        <button
          type="button"
          data-testid={TESTIDS.resetView}
          title="总览复位"
          onClick={() => boardRef.current?.reset()}
          // W5:同静音按钮——min-h/w-10 触达区,符号视觉大小不变
          className="absolute top-2 left-2 z-10 flex min-h-10 min-w-10 items-center justify-center rounded border border-gold/50 bg-panel/90 px-2 py-2 font-brush text-sm text-ink-dim hover:text-ink"
        >
          {/* S6 符号表统一:复位统一 ◎(圆心居中,古印感),不再用光学校准符号 ⌖ */}
          ◎
        </button>
        {/* 静音开关(对照旧 board-wrap 顶栏;须在 AudioProvider 内层,故抽小组件) */}
        <MuteButton />
        {/* 版本角标(对照旧 main.ts 右下角,构建排查用) */}
        <span className="pointer-events-none absolute right-1 bottom-0.5 font-body text-[10px] text-ink-dim/70">
          {VERSION}
        </span>
      </div>
      {/* 右侧栏(四区:状态 / 手牌+动作 / 诸侯·战报,标题横幅置顶)。
          S5 窄屏棋盘优先 + 抽屉折叠:宽屏 288px(w-72),md 以下 min(288px,45vw) 可压;
          收起时折叠为窄条(棋盘拿满),折叠/展开状态记忆 localStorage。四区 flex-col
          自适应,压缩宽度下靠现有 overflow-hidden/内滚不破版。 */}
      <aside
        data-testid={sidebarOpen ? TESTIDS.sidebarPanel : TESTIDS.sidebarCollapsed}
        className={
          "flex shrink-0 flex-col overflow-hidden border-l-2 border-gold/60 bg-panel transition-[width] duration-300 " +
          (sidebarOpen ? "w-[min(288px,45vw)] md:w-72" : "w-12")
        }
      >
        {sidebarOpen ? (
          <>
            <h1 className="border-b border-gold/40 bg-panel-hi px-3 py-2 text-center font-brush text-2xl tracking-widest">
              群雄逐鹿
              <small className="block text-xs text-ink-dim">· 三国大富翁 ·</small>
            </h1>
            <StatusBar snapshot={snapshot} />
            <HandPanel snapshot={snapshot} player={localPlayer} controller={controller} interactive={interactive} />
            <WarlogPanel snapshot={snapshot} />
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
                title={`当前回合:${snapshot.players[snapshot.activeIndex]?.guohao ?? "?"}`}
                className="font-brush text-xl text-ink"
                style={{ writingMode: "vertical-rl" }}
              >
                {snapshot.players[snapshot.activeIndex]?.guohao ?? "?"}之回合
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
