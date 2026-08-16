// Game 屏(阶段 5a):棋盘区 + 右侧栏四区,布局对照旧 createLayout 的结构比例。
//   棋盘占主体,侧栏固定宽(旧 .sidebar 同角色):回合状态 / 手牌+动作 / 诸侯·战报。
// 数据流:gameStore.snapshot → 声明式渲染;交互统一经 registry 取 controller 下发。
import { useEffect, useMemo, useRef, useState } from "react";
import { BoardView, type BoardViewHandle } from "@app/components/board/BoardView";
import { useGameStore, useLocalPlayer } from "@app/store/gameStore";
import { getController, getControllerMap } from "@app/controllers/registry";
import { AudioProvider, useAudio } from "@app/fx/AudioProvider";
import { DiceOverlay } from "@app/fx/DiceOverlay";
import { FxLayer } from "@app/fx/FxLayer";
import { useFxStore } from "@app/fx/fxStore";
import { HandPanel } from "./HandPanel";
import { StatusBar } from "./StatusBar";
import { WarlogPanel } from "./WarlogPanel";
import { DecisionScrollLayer } from "./scroll/DecisionScrollLayer";
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
      className="absolute top-2 right-2 z-10 rounded border border-gold/50 bg-panel/90 px-2 py-0.5 font-brush text-sm text-ink-dim hover:text-ink"
    >
      {audio.muted ? "♪" : "♫"}
    </button>
  );
}

export function GameScreen() {
  // 城池详情(Playing 相位点城查看,本地 UI 态;Setup 相位点城是选都,走 controller)
  const [detailTileIndex, setDetailTileIndex] = useState<number | null>(null);
  // 模块级取控制器(不在 React 状态里:实例含方法/WS,非渲染数据,见 registry.ts 注释)
  const controller = getController();
  // 棋盘 pan/zoom 复位句柄(BoardView forwardRef 暴露 reset;总览复位按钮用)
  const boardRef = useRef<BoardViewHandle>(null);
  const map = getControllerMap();
  const snapshot = useGameStore((s) => s.snapshot);
  const interactive = useGameStore((s) => s.interactive);
  const viewSeat = useGameStore((s) => s.viewSeat);
  const hint = useGameStore((s) => s.hint);
  const thinking = useGameStore((s) => s.thinking);
  const pushHint = useGameStore((s) => s.pushHint);
  const localPlayer = useLocalPlayer();
  // 行军接管的棋子(阶段 6):fxStore.marching → BoardView.skipTokenIds,
  // 行军期间 React 声明式定位让位给 useMarch 的逐段命令式动画。
  const marching = useFxStore((s) => s.marching);

  // hint 自动过期:store 只存文案不持定时器(见 gameStore.pushHint 注释),由本屏负责清
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => pushHint(null), 1500); // 旧 flashHint 的 1.5s 口径
    return () => clearTimeout(t);
  }, [hint, pushHint]);

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
    // 理论上 setScreen("game") 前必有 controller+map;防御一下,便于排查路由错误
    return <div className="flex h-full items-center justify-center text-ink-dim">未开局</div>;
  }

  // 快照玩家是 BoardPlayer 的结构超集(heroes/treasures 等展示字段棋盘不消费):
  // BoardView 的 props 已按真实消费面声明为最小接口,直接透传即可,无需断言。
  const players = snapshot.players;

  // 选都阶段的引导文案(对照旧 showPickHint:「X」择一空城建都)
  const setupHint =
    snapshot.phase === "Setup" && snapshot.setupPhase === "PickCapital"
      ? `「${snapshot.players[snapshot.currentSetupPlayerIndex]?.guohao ?? "?"}」择一空城建都`
      : null;

  return (
    <AudioProvider>
      {/* 3D 骰子(自建全屏 overlay,不渲染内容)——与 AudioProvider 同挂在 Game 屏,
          生命周期=一局;行军按钮点击后控制器 busy 锁 interactive,骰子播放期间防连点。 */}
      <DiceOverlay />
      <div className="flex h-full w-full bg-bg text-ink">
      {/* 棋盘区(相对定位承载 hint/thinking/fx 覆盖层,同旧 board-wrap)。
          id="board-wrap":FxLayer 的逻辑坐标→容器像素换算锚点。 */}
      <div id="board-wrap" className="relative min-w-0 flex-1">
        <BoardView
          ref={boardRef}
          map={map}
          players={players}
          onTileClick={(i) => {
            // 相位路由收口于此(Wave3 候选2,原 controller.tileClick 的职责上移):
            // Playing=查看详情(本地 UI 态);Setup 选都期=落子(setupPickCapital,
            // 单机实推进、联机默认 no-op,对屏幕两种模式无感)。testid 链路不变。
            if (snapshot.phase === "Playing") setDetailTileIndex(i);
            else controller?.setupPickCapital(i);
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
        {hint && (
          <div
            data-testid={TESTIDS.hint}
            className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded bg-panel/90 px-4 py-1 text-danger shadow"
          >
            {hint}
          </div>
        )}
        {(thinking || (snapshot.phase !== "GameOver" && snapshot.players[snapshot.activeIndex]?.isBot)) && (
          // "运筹中…":bot 行动时(旧 setThinking;本阶段 bot 同步驱动,一闪而过,保留展示位)
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
        {/* 总览复位(对照旧版 reset-view):置于左上,与右上的静音按钮错开 */}
        <button
          type="button"
          data-testid={TESTIDS.resetView}
          title="总览复位"
          onClick={() => boardRef.current?.reset()}
          className="absolute top-2 left-2 z-10 rounded border border-gold/50 bg-panel/90 px-2 py-0.5 font-brush text-sm text-ink-dim hover:text-ink"
        >
          ⌖
        </button>
        {/* 静音开关(对照旧 board-wrap 顶栏;须在 AudioProvider 内层,故抽小组件) */}
        <MuteButton />
        {/* 版本角标(对照旧 main.ts 右下角,构建排查用) */}
        <span className="pointer-events-none absolute right-1 bottom-0.5 font-body text-[10px] text-ink-dim/70">
          {VERSION}
        </span>
      </div>
      {/* 右侧栏(四区:状态 / 手牌+动作 / 诸侯·战报,标题横幅置顶) */}
      <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-l-2 border-gold/60 bg-panel">
        <h1 className="border-b border-gold/40 bg-panel-hi px-3 py-2 text-center font-brush text-2xl tracking-widest">
          群雄逐鹿
          <small className="block text-xs text-ink-dim">· 三国大富翁 ·</small>
        </h1>
        <StatusBar snapshot={snapshot} />
        <HandPanel snapshot={snapshot} player={localPlayer} controller={controller} interactive={interactive} />
        <WarlogPanel snapshot={snapshot} />
      </aside>
      </div>
    </AudioProvider>
  );
}
