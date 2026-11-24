// 根组件:按 store.screen 路由(setup 首页 / solo-setup 单机配置 / lobby / game)。
// 正式开局流程:首页「单机模式」→ SoloSetupScreen.onStart → loadMapById → LocalController → GameScreen。
// 联机流程(阶段 8):首页「联机模式」→ 占位图 + OnlineController
// → LobbyScreen(建房/加入);开局由服务器首帧 snapshot
// 驱动 online.ts 切 GameScreen(对照旧 main.ts enterOnline)。
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { loadMapById } from "@dafung/core/engine/map-source";
import { getDefaultMapId, getMapSource } from "@app/map-sources";
import { LocalController } from "@app/controllers/local";
import { OnlineController } from "@app/controllers/online";
import { setController } from "@app/controllers/registry";
import { returnHome } from "@app/screens/shared/return-home";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { LobbyScreen } from "@app/screens/lobby/LobbyScreen";
import { HomeScreen } from "@app/screens/home/HomeScreen";
import { SoloSetupScreen, type SetupConfig } from "@app/screens/setup/SoloSetupScreen";
import { SoundBoard } from "@app/screens/dev/SoundBoard";
import { HintBar } from "@app/screens/shared/HintBar";
// R3-C2(#89) 屏间转场(#771 墨韵化:墨晕盖入+内容浮现):keyed 外壳动画与对局屏棋盘缓推的 keyframes 集中于此
import "./styles/screen-transition.css";

// 主页首次绘制后，主页预热同一个懒加载模块。
const GameScreen = lazy(() =>
  import("@app/screens/game/GameScreen").then((m) => ({ default: m.GameScreen })),
);

/** 旧 main.ts 记忆的 localStorage 键(选中地图)。 */
const MAP_PREF_KEY = "dafung.mapId";

/** ?seed= 复现参数(与旧 main.ts 同口径;设置屏不感知 URL,由接线方解析注入)。 */
function urlSeed(): number | undefined {
  const raw = new URLSearchParams(location.search).get("seed");
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function App() {
  const screen = useGameStore((s) => s.screen);
  const setScreen = useGameStore((s) => s.setScreen);
  const gameId = useGameStore((s) => (s.screen === "game" ? s.snapshot?.gameId : undefined));
  const roomMapId = useNetStore((s) => s.mapId);
  const [previousScreen, setPreviousScreen] = useState<Exclude<typeof screen, "game">>("setup");
  if (screen !== "game" && screen !== previousScreen) setPreviousScreen(screen);

  const [firstPaint, setFirstPaint] = useState<{ gameId: string; error?: string } | null>(null);
  const reportFirstPaint = useCallback(
    (error?: string) => {
      if (gameId !== undefined) setFirstPaint({ gameId, error });
    },
    [gameId],
  );
  const startError = firstPaint?.gameId === gameId ? firstPaint?.error : undefined;
  const preparing =
    gameId !== undefined && (firstPaint?.gameId !== gameId || startError !== undefined);
  const shownScreen = preparing ? previousScreen : screen;
  const pushHint = useGameStore((s) => s.pushHint);
  const hint = useGameStore((s) => s.hint);
  const hintLevel = useGameStore((s) => s.hintLevel);

  // R3-B15(#87):当前屏显式挂到 body[data-screen],app.css 的宣纸纹理据此分场景取浓度
  // (菜单屏 0.45 纸感主角 / 对局屏 0.36 纹理退后让格线清晰)。
  // 五屏逐一写入、无缺省分支;首帧前 body 无该属性,CSS 基准值即菜单屏浓度,
  // 与 store 初始屏 setup 一致,无闪变。
  useEffect(() => {
    document.body.dataset.screen = shownScreen;
  }, [shownScreen]);

  // 正式开局:加载地图 → 构造单机控制器(进程内房间编排,#398:引擎在房间 startGame
  // 同步段建好并驱动 bot 选都到轮到人类,不再有本地 doDraftRoll/aiSetupStep 直驱)→
  // 进 Game 屏。单机:guohao 预设在座位表首项,bot 国号由开局编排分配。
  const handleStart = useCallback(
    async (config: SetupConfig) => {
      try {
        const source = getMapSource();
        const map = await loadMapById(source, config.mapId);
        const controller = new LocalController(map, {
          seats: config.seats,
          targetNetWorth: config.targetNetWorth,
          seed: config.seed ?? urlSeed(),
          // ADR-0014 对局日志局头要素
          mapId: config.mapId,
        });
        // registry 的 MapData 取同图原始数据(#1273 单源缓存:命中进程内 memo,
        // 同图不再第二次 fetch+parse)
        setController(controller, await source.loadMapData(config.mapId));
        // 开局首帧直灌(此后由房间下行拍驱动 sync;#398 起选都/行军全走房间编排)
        useGameStore.getState().syncFromEngine(controller.engine);
        setScreen("game");
        return true;
      } catch (err) {
        pushHint(`起兵失败:${(err as Error).message}`);
        return false;
      }
    },
    [pushHint, setScreen],
  );

  // ── 联机入口(对照旧 enterOnline):加载默认内置图为占位 → OnlineController → 大厅屏。
  const handleOnline = useCallback(async () => {
    try {
      // 图源走进程级单例(#1273 归位):绕开单例的那只私有实例退役,清单/地图缓存
      // 与单机路径共用一份(同图双取双析在此一并消失)
      const source = getMapSource();
      const mapId = await getDefaultMapId();
      const map = await loadMapById(source, mapId);
      // registry 的 MapData 取同图原始数据(单源缓存命中,不再二次 fetch):
      // BoardView 在换图前先有东西可画
      // LobbyApi 每次调用都从 server-base 取当前服务器地址，大厅可修改。
      const controller = new OnlineController(map, mapId);
      setController(controller, await source.loadMapData(mapId));
      setScreen("lobby");
    } catch (err) {
      pushHint(`进入联机失败:${(err as Error).message}`);
    }
  }, [pushHint, setScreen]);

  // 退出联机回设置屏:销毁 controller(关 WS)+ 清房间态,避免残留泄漏到单机局
  const handleExitLobby = returnHome;

  const handleMapChange = useCallback((mapId: string) => {
    localStorage.setItem(MAP_PREF_KEY, mapId);
    // state 与 localStorage 同步(后续渲染读 state;两处永远一致)
    setInitialMapId(mapId);
  }, []);

  // 零兜底原则:默认地图唯一事实源 = 清单首项(getDefaultMapId,清单空即抛)。
  // 无 localStorage 记忆时异步解析;失败显式报错,不静默回退任何硬编码 id。
  const [initialMapId, setInitialMapId] = useState(() => localStorage.getItem(MAP_PREF_KEY));
  useEffect(() => {
    if (initialMapId) return;
    let alive = true;
    getDefaultMapId().then(
      (id) => alive && setInitialMapId(id),
      (err: Error) => pushHint(`地图清单加载失败:${err.message}`),
    );
    return () => {
      alive = false;
    };
  }, [initialMapId, pushHint]);

  const selectedMapId = screen === "lobby" ? roomMapId : initialMapId;
  useEffect(() => {
    if (selectedMapId === null || (screen !== "solo-setup" && screen !== "lobby")) return;
    void getMapSource()
      .loadMapData(selectedMapId)
      .catch((error: Error) => {
        console.warn("地图预热失败", error);
      });
  }, [screen, selectedMapId]);

  // ?dev=sound 音效试听台:dev 工具直达,压过一切 store 路由(不进 screen 状态机);
  // SPA 内 URL 不变,挂载时读一次即可。
  const [devSound] = useState(() => new URLSearchParams(location.search).get("dev") === "sound");
  let content: ReactNode = null;
  if (devSound) return <SoundBoard />;

  if (shownScreen === "lobby") {
    content = <LobbyScreen onExit={handleExitLobby} />;
  } else if ((shownScreen === "setup" || shownScreen === "solo-setup") && !initialMapId) {
    // 地图 id 未解析出(localStorage 无记忆且清单未回/失败)时不进依赖地图的屏:
    // 首页/配置页的地图名都以它为入参,无值比给假默认更诚实。
    content = (
      <div className="relative h-full">
        <p className="p-8 font-deco text-paper-dim">地图清单加载中…</p>
        <HintBar hint={hint} level={hintLevel} />
      </div>
    );
  } else if (shownScreen === "solo-setup" && initialMapId) {
    // 单机配置页:首页「单机模式」进入;起兵走原 handleStart;地图由首页选定后传入
    content = (
      <div className="relative h-full">
        <SoloSetupScreen
          onStart={handleStart}
          onBack={() => setScreen("setup")}
          mapId={initialMapId}
          mapSource={getMapSource()}
          onMapChange={handleMapChange}
        />
        {/* F4:统一 HintBar(起兵失败等);过期口径由 gameStore 统一 1.8s */}
        <HintBar hint={hint} level={hintLevel} />
      </div>
    );
  } else if (shownScreen === "setup" && initialMapId) {
    // 首页:三个模式入口(单机 / 联机 / 选图),对局配置在 solo-setup 次级页
    content = (
      <div className="relative h-full">
        <HomeScreen
          onSolo={() => setScreen("solo-setup")}
          onOnline={() => void handleOnline()}
          initialMapId={initialMapId}
          onMapChange={handleMapChange}
          mapSource={getMapSource()}
        />
        {/* 设置屏也可见的错误提示:gameStore.hint 原本只在 Game 屏渲染,
            起兵/进联机失败在 setup 屏静默(e2e react-resilience 巡检发现)。 */}
        <HintBar hint={hint} level={hintLevel} />
      </div>
    );
  }
  return (
    <div className="relative h-full w-full">
      {content !== null && (
        <div key={shownScreen} className="screen-in relative h-full w-full" inert={preparing}>
          <div className="screen-ink" aria-hidden="true" />
          {content}
        </div>
      )}
      {screen === "game" && (
        <div
          key="game"
          className={preparing ? "invisible absolute inset-0" : "absolute inset-0"}
          inert={preparing}
        >
          <Suspense fallback={null}>
            <GameScreen preparing={preparing} onFirstPaint={reportFirstPaint} />
          </Suspense>
        </div>
      )}
      {preparing && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-bg-deep/55">
          <div className="max-w-[80vw] rounded border border-gold/30 bg-panel px-6 py-4 text-center">
            {startError === undefined ? (
              <p role="status">正在绘制棋盘…</p>
            ) : (
              <>
                <p role="alert">棋盘绘制失败。{startError}</p>
                <button type="button" className="ink-btn mt-2 min-h-11 px-4" onClick={returnHome}>
                  回到首页
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
