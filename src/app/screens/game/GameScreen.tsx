// Game 屏(阶段 5a):棋盘区 + 右侧栏四区,布局对照旧 createLayout 的结构比例。
//   棋盘占主体,侧栏固定宽(旧 .sidebar 同角色):回合状态 / 手牌+动作 / 珍宝·名将 / 诸侯
//   (L48:战报区移除,日志走胜利屏「导出日志」落 jsonl 文件,ADR-0014)。
// 数据流:gameStore.snapshot → 声明式渲染;交互统一经 registry 取 controller 下发。
// spec #107 批次 5(C5 减负):选都/详情流程状态机下沉 useCapitalPick(单文件持有);
// 折叠窄条/窄屏浮动条收口 CollapsedRail(单组件双形态);托管取值收口 useAutopilotOn
// (netStore,补观战守卫)。本屏只做接线与布局。
import { useRef, useState } from "react";
import { BoardView, type BoardViewHandle } from "@app/components/board/BoardView";
import { useGameStore, useLocalPlayer, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore, useAutopilotOn } from "@app/store/netStore";
import { getController, getControllerMap } from "@app/controllers/registry";
import type { MapData } from "@core/types";
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
import { CollapsedRail } from "./CollapsedRail";
import { useCapitalPick } from "./useCapitalPick";
import { HintBar } from "@app/screens/shared/HintBar";
import { ConnectionBanner } from "@app/screens/shared/ConnectionBanner";
import { Sym } from "@app/screens/shared/Sym";
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
      // #175:icon-only 钮可达名——Sym 是 aria-hidden SVG,仅有 title(弱可及名),
      // 补 aria-label 对齐缩放钮口径
      aria-label={audio.muted ? "开音" : "静音"}
      onClick={audio.toggleMuted}
      // W5:点击目标 ≥40px——py-2 + min-h/w-10 扩触达区,视觉字号不变;
      // 视觉重做 v2:控制钮统一「笺钮方章」制式(发丝墨边 + Sym SVG 符号,
      // ♪ 字符在离线字体下是豆腐块风险,一并根除)
      className="absolute top-[calc(var(--safe-top)+8px)] right-[calc(var(--safe-right)+8px)] z-10 flex min-h-10 min-w-10 items-center justify-center rounded-[3px] border border-[rgba(43,35,23,0.3)] bg-panel/90 px-2 py-2 text-ink-dim transition-colors hover:text-ink"
    >
      {/* S6 符号表统一:有声 ♪ / 静音 ♪̶(音符+删除线),Sym SVG 渲染 */}
      <Sym name={audio.muted ? "muted" : "sound"} size={15} />
    </button>
  );
}

export function GameScreen() {
  const snapshot = useGameStore((s) => s.snapshot);
  const map = getControllerMap();
  if (!snapshot || !map) {
    // S9 未开局兜底页:此前只是一行灰字,玩家会卡死在空屏。
    // 理论上 setScreen("game") 前必有 controller+map(刷新丢快照/路由错误会到这里),
    // 给「回到首页」逃生口而不是让玩家面对空棋盘干瞪眼。
    // 主体拆到 GameScreenLive:snapshot/map 就位才挂载,空态分支与对局分支不共享 hooks。
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
            className="ink-btn mt-6 rounded-[5px] px-8 py-3 font-brush text-xl tracking-[0.3em] cursor-pointer"
          >
            回到首页
          </button>
        </div>
      </div>
    );
  }
  return <GameScreenLive snapshot={snapshot} map={map} />;
}

/** 已开局主体:棋盘区 + 右侧栏四区(hooks 全在此;snapshot/map 由 GameScreen 门卫)。 */
function GameScreenLive({ snapshot, map }: { snapshot: GameSnapshot; map: MapData }) {
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
  const interactive = useGameStore((s) => s.interactive);
  const viewSeat = useGameStore((s) => s.viewSeat);
  const hint = useGameStore((s) => s.hint);
  const hintLevel = useGameStore((s) => s.hintLevel);
  const localPlayer = useLocalPlayer();
  // 联机 pending / online(G-8 托管可见性 / P0-3 窄条热钮防连点):与 HandPanel 同一回读口径
  const net = useNetStore();
  // 托管态单源取值收口 useAutopilotOn(netStore):联机已入座=座位广播,单机=控制器本地
  // 标记,观战(mySeat=-1)恒 false——观战无托管。C5 前此处内联取值无 mySeat 守卫,
  // 联机观战态进对局屏即 seats[-1] TypeError(评审 #3,随收口一并修掉)。
  const autopilotOn = useAutopilotOn(controller);
  // P0-7 窄屏判定(<768px):决定侧栏走覆盖式抽屉还是桌面并排布局
  const isNarrow = useIsNarrow();
  // 行军接管的棋子(阶段 6):fxStore.marching → BoardView.skipTokenIds,
  // 行军期间 React 声明式定位让位给 useMarch 的逐段命令式动画。
  const marching = useFxStore((s) => s.marching);
  // F4:hint 过期已下沉 gameStore.pushHint(1.8s 统一口径),本屏不再挂定时器。
  // 选都/详情流程状态机(useCapitalPick 单文件持有):选都候选派生 + flyTo 镜头 +
  // onTileClick 相位路由 + 详情/定都确认时序,GameScreen 只把返回值接进 BoardView /
  // DecisionScrollLayer / TreasuryPanel。
  const { offeredCapitals, selectableTiles, onTileClick, closeDetail, tileDetail } = useCapitalPick({
    snapshot,
    map,
    boardRef,
  });

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
          /* 点格相位路由(Playing 详情 / Setup 选都 / 灰城 hint)在 useCapitalPick */
          onTileClick={onTileClick}
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
            className="pointer-events-none absolute top-[calc(var(--safe-top)+48px)] left-1/2 -translate-x-1/2 rounded-[3px] border border-[rgba(43,35,23,0.25)] bg-panel/95 px-4 py-1 font-brush text-lg shadow-sm"
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
            容器 pointer-events-none:无弹层时不挡棋盘;各弹层自带遮罩(z-30)接管交互。
            选都/详情流程只下发一个窄 props(tileDetail,状态机在 useCapitalPick)。 */}
        <div id="scroll-layer" className="pointer-events-none absolute inset-0">
          <DecisionScrollLayer
            snapshot={snapshot}
            viewSeat={viewSeat}
            interactive={interactive}
            tileDetail={tileDetail}
          />
        </div>
        {/* G-5 常驻回合 chip:左上悬浮钮下方(避开复位钮),国号色圆徽 +「X之回合」;
            只读不拦交互。W2-包D(审计 A1):bot「运筹中」微标已删——WaitingBar 文案
            已承担同一反馈,双份重复;thinking testid 契约在 WaitingBar,不受影响。 */}
        {snapshot.phase === "Playing" &&
          (() => {
            const active = snapshot.players[snapshot.activeIndex];
            if (!active) return null;
            return (
              <div className="pointer-events-none absolute top-[calc(var(--safe-top)+56px)] left-[calc(var(--safe-left)+8px)] z-10 flex items-center gap-1.5 rounded-[3px] border border-[rgba(43,35,23,0.25)] bg-panel/90 px-2 py-1 shadow-sm">
                <span
                  className="flex h-5 w-5 rotate-[-4deg] items-center justify-center rounded-[2px] font-brush text-xs text-[#f6ead6]"
                  style={{ backgroundColor: rgba(playerColor(active.colorIndex)) }}
                >
                  {active.guohao.charAt(0)}
                </span>
                <span className="font-brush text-sm text-ink">{active.guohao}之回合</span>
              </div>
            );
          })()}
        {/* 总览复位(对照旧版 reset-view):置于左上,与右上的静音按钮错开 */}
        <button
          type="button"
          data-testid={TESTIDS.resetView}
          title="总览复位"
          aria-label="总览复位"
          onClick={() => boardRef.current?.reset()}
          // W5:同静音按钮——min-h/w-10 触达区,符号视觉大小不变;笺钮方章制式
          className="absolute top-[calc(var(--safe-top)+8px)] left-[calc(var(--safe-left)+8px)] z-10 flex min-h-10 min-w-10 items-center justify-center rounded-[3px] border border-[rgba(43,35,23,0.3)] bg-panel/90 px-2 py-2 text-ink-dim transition-colors hover:text-ink"
        >
          {/* S6 符号表统一:复位统一 ◎(Sym SVG 渲染,圆心居中古印感) */}
          <Sym name="reset" size={15} />
        </button>
        {/* #98 缩放 +/− 钮:触屏/触板无滚轮/双指发现性差,给显式入口。竖排挂复位钮同列
            (制式照抄 ◎ 钮:min-h/w-10 = 40×40 圆角 + bg-panel/90 发丝墨边);
            top +92 避开 G-5 回合 chip 槽(+56,高度 ~28px),zoomBy 以视口中心为锚,
            与滚轮/双指同一条 setView 管线(见 usePanZoom)。 */}
        <div className="absolute top-[calc(var(--safe-top)+92px)] left-[calc(var(--safe-left)+8px)] z-10 flex flex-col gap-2">
          <button
            type="button"
            title="放大棋盘"
            aria-label="放大棋盘"
            onClick={() => boardRef.current?.zoomBy(1.25)}
            className="flex min-h-10 min-w-10 items-center justify-center rounded-[3px] border border-[rgba(43,35,23,0.3)] bg-panel/90 px-2 py-2 font-brush text-sm text-ink-dim transition-colors hover:text-ink"
          >
            +
          </button>
          <button
            type="button"
            title="缩小棋盘"
            aria-label="缩小棋盘"
            onClick={() => boardRef.current?.zoomBy(0.8)}
            className="flex min-h-10 min-w-10 items-center justify-center rounded-[3px] border border-[rgba(43,35,23,0.3)] bg-panel/90 px-2 py-2 font-brush text-sm text-ink-dim transition-colors hover:text-ink"
          >
            −
          </button>
        </div>
        {/* 静音开关(对照旧 board-wrap 顶栏;须在 AudioProvider 内层,故抽小组件) */}
        <MuteButton />
        {/* 版本角标(对照旧 main.ts 右下角,构建排查用;R3-A9 随 Noto Serif 移除改挂文楷) */}
        <span className="pointer-events-none absolute right-1 bottom-0.5 font-wenkai text-[10px] text-ink-dim/70">
          {VERSION}
        </span>
        {/* P0-7 窄屏浮动小条(侧栏抽屉收起时):CollapsedRail float 形态(与桌面折叠窄条
            同一组件,把手 + 「轮到我」金框 + 行军热钮 + 「托」印只此一份实现)。 */}
        {isNarrow && !sidebarOpen && (
          <CollapsedRail
            variant="float"
            myTurnToRoll={myTurnToRoll}
            autopilotOn={autopilotOn}
            activeGuohao={activeGuohao}
            cash={localPlayer?.cash ?? null}
            pending={net.pending}
            onToggle={toggleSidebar}
            onRoll={() => controller?.dispatchCommand({ type: "rollAndMove" })}
          />
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
      {/* 右侧栏(四区:状态 / 手牌+动作 / 珍宝·名将 / 诸侯,标题横幅置顶)。
          L48:战报区已移除(日志保留在引擎快照,胜利屏「导出日志」落 jsonl 文件);
          珍宝·名将区接管原战报的弹性纵向空间,诸侯条独立成节钉底。
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
            ? "absolute inset-y-0 right-0 z-20 flex w-[min(320px,85vw)] shrink-0 flex-col overflow-y-auto border-l border-[rgba(43,35,23,0.35)] bg-panel shadow-[var(--ink-shadow-lg)] transition-transform duration-[var(--dur-med)] " +
              (sidebarOpen ? "translate-x-0" : "translate-x-full")
            : "flex shrink-0 flex-col overflow-hidden border-l border-[rgba(43,35,23,0.35)] bg-panel shadow-[inset_6px_0_14px_-10px_rgba(43,35,23,0.3)] transition-[width] duration-[var(--dur-med)] " +
              (sidebarOpen ? "w-[min(288px,45vw)] md:w-72" : "w-12")
        }
      >
        {sidebarOpen || isNarrow ? (
          <>
            {/* R3-B9(#81):横幅分相位——对局中(Playing)压为单行(约 65px→36px,
                矮视口抽屉不再被常驻横幅占 1/6 高);Setup/GameOver 保留大横幅。
                视觉重做 v2:品牌行加「鹿」字朱印落款(全局印章语言的门面位),
                金饰线退役改发丝墨线。 */}
            <h1
              className={
                "flex items-center justify-center gap-2 border-b border-[rgba(43,35,23,0.2)] bg-panel-hi px-3 text-center font-brush tracking-widest " +
                (snapshot.phase === "Playing" ? "py-1.5 text-base" : "flex-col gap-1 py-2 text-2xl")
              }
            >
              <span className="flex items-center justify-center gap-2">
                <span
                  aria-hidden="true"
                  className={
                    "flex rotate-[-4deg] items-center justify-center rounded-[2px] bg-danger font-brush leading-none text-[#f6ead6] " +
                    (snapshot.phase === "Playing" ? "h-5 w-5 text-[13px]" : "h-7 w-7 text-lg")
                  }
                >
                  鹿
                </span>
                <span>群雄逐鹿</span>
              </span>
              <small
                className={
                  snapshot.phase === "Playing"
                    ? "text-[10px] text-ink-dim"
                    : "text-xs text-ink-dim"
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
            {/* L48 空间重排:战报区移除,腾出的弹性纵向空间给珍宝·名将常驻展示区;
                诸侯紧凑条独立成节钉在其后(自己资产优先占屏,他人信息紧凑收尾)。
                R3-A5(#68):isNarrow 同源下发抽屉态(IS_NARROW_QUERY 含横屏矮视口分支,
                勿用 max-md 纯宽度断点另抄)——珍宝·名将区在抽屉里放开 flex 保底。 */}
            <TreasuryPanel player={localPlayer} onCardDetailOpen={closeDetail} narrow={isNarrow} />
            {/* X13(#32):viewSeat 透传——诸侯列表自己行挂「你」印(口径同 WaitingBar) */}
            <OthersPanel snapshot={snapshot} viewSeat={viewSeat} />
            {/* 收起按钮钉底(不与四区抢纵向空间),W5 触达 ≥40px */}
            <button
              type="button"
              data-testid={TESTIDS.sidebarToggle}
              title="收起侧栏(全屏看棋)"
              // #175:可见内容是「»」符号,可达名补为动作语义(同 CollapsedRail 展开钮)
              aria-label="收起侧栏"
              onClick={toggleSidebar}
              className="flex min-h-10 items-center justify-center border-t border-[rgba(43,35,23,0.2)] bg-panel-hi font-brush text-lg text-ink-dim hover:text-ink"
            >
              »
            </button>
          </>
        ) : (
          /* 折叠窄条:CollapsedRail panel 形态(展开按钮置顶 + 活跃玩家国号竖排 +
              我的现金 + 行军热钮,信息不归零),与窄屏浮动条同一实现。 */
          <CollapsedRail
            variant="panel"
            myTurnToRoll={myTurnToRoll}
            autopilotOn={autopilotOn}
            activeGuohao={activeGuohao}
            cash={localPlayer?.cash ?? null}
            pending={net.pending}
            onToggle={toggleSidebar}
            onRoll={() => controller?.dispatchCommand({ type: "rollAndMove" })}
          />
        )}
      </aside>
      </div>
    </AudioProvider>
  );
}
