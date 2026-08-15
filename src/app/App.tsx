// 根组件:按 store.screen 路由(setup / lobby / game)。
// 正式开局流程:SetupScreen.onStart → loadMapById → LocalController → GameScreen。
// 联机流程(阶段 8):SetupScreen.onOnline 或 ?online=1 → 占位图 + OnlineController
// → LobbyScreen(建房/加入);?room=CODE 直连自动加入;开局由服务器首帧 snapshot
// 驱动 online.ts 切 GameScreen(对照旧 main.ts enterOnline)。
import { useCallback, useEffect, useRef } from "react";
import { loadMapById } from "@core/map-source";
import { FetchMapSource, getDefaultMapId, getMapSource } from "@render/map-sources";
import { LocalController } from "@app/controllers/local";
import { OnlineController } from "@app/controllers/online";
import { setController } from "@app/controllers/registry";import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { GameScreen } from "@app/screens/game/GameScreen";
import { LobbyScreen } from "@app/screens/lobby/LobbyScreen";
import { SetupScreen, type SetupConfig } from "@app/screens/setup/SetupScreen";

/** 旧 main.ts 记忆的 localStorage 键(选中地图)。 */
const MAP_PREF_KEY = "dafung.mapId";

/** ?seed= 复现参数(与旧 main.ts 同口径;设置屏不感知 URL,由接线方解析注入)。 */
function urlSeed(): number | undefined {
  const raw = new URLSearchParams(location.search).get("seed");
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** ?room= 房间码(联机直链;?online=1 与之共同构成 enterOnline 的 URL 入口)。 */
function urlRoom(): string | null {
  const raw = new URLSearchParams(location.search).get("room");
  return raw ? raw.trim().toUpperCase() : null;
}

export function App() {
  const screen = useGameStore((s) => s.screen);
  const setScreen = useGameStore((s) => s.setScreen);
  const pushHint = useGameStore((s) => s.pushHint);

  // 正式开局:加载地图 → 构造单机控制器(引擎 setup 自动步进至轮到人类)→ 进 Game 屏。
  // 单机热座:guohao 全在 seats 里,doDraftRoll 定序后 bot 选都步进,轮到人类停。
  const handleStart = useCallback(
    async (config: SetupConfig) => {
      try {
        const source = new FetchMapSource();
        const map = await loadMapById(source, config.mapId);
        const controller = new LocalController(map, {
          seats: config.seats,
          targetNetWorth: config.targetNetWorth,
          startingCash: config.startingCash,
          difficulty: config.difficulty,
          seed: config.seed ?? urlSeed(),
        });
        setController(controller, await source.loadMapData(config.mapId));
        const e = controller.engine;
        e.doDraftRoll();
        while (e.aiSetupStep()) { /* bot 选都步进(轮到人类即停) */ }
        // setup 推进不走 dispatchCommand,需显式同步(等价 __dafung.sync)
        useGameStore.getState().syncFromEngine(e);
        setScreen("game");
        // 开局即轮到 bot(或 Setup 余下全是 bot)时接棒驱动 + 首回合横幅(阶段 6)
        controller.onEnterGame();
      } catch (err) {
        pushHint(`起兵失败:${(err as Error).message}`);
      }
    },
    [pushHint, setScreen],
  );

  // ── 联机入口(对照旧 enterOnline):加载默认内置图为占位 → OnlineController → 大厅屏。
  // roomParam 非空 = ?room= 直链,入座后自动加入该房(旧流程无此参数,React 版补齐 e2e/分享链接场景)。
  const handleOnline = useCallback(
    async (roomParam?: string | null) => {
      try {
        const source = new FetchMapSource();
        const mapId = await getDefaultMapId();
        const map = await loadMapById(source, mapId);
        // registry 的 MapData 用同图原始数据:BoardView 在换图前先有东西可画
        const controller = new OnlineController(map, location.origin, mapId);
        setController(controller, await source.loadMapData(mapId));
        setScreen("lobby");
        if (roomParam) {
          // 直链加入:失败提示但停留在大厅屏(手填房间码重试)
          await controller.joinRoom(roomParam).catch((err: Error) => {
            useNetStore.getState().pushHint(`加入失败:${err.message}`);
          });
        }
      } catch (err) {
        pushHint(`进入联机失败:${(err as Error).message}`);
      }
    },
    [pushHint, setScreen],
  );

  // URL 直达:?online=1 / ?room=CODE(只消费一次:StrictMode 双挂载 + 按钮入口都防重复)
  const urlConsumed = useRef(false);
  useEffect(() => {
    if (urlConsumed.current) return;
    const params = new URLSearchParams(location.search);
    const room = urlRoom();
    if (params.has("online") || room) {
      urlConsumed.current = true;
      void handleOnline(room);
    }
  }, [handleOnline]);

  // 退出联机回设置屏:销毁 controller(关 WS)+ 清房间态,避免残留泄漏到单机局
  const handleExitLobby = useCallback(() => {
    setController(null);
    useNetStore.getState().reset();
    setScreen("setup");
  }, [setScreen]);

  // 编辑器屏迁移前暂不可用:按钮隐藏(旧入口语义保留在 SetupScreen.onEdit)。
  const handleEdit = useCallback(() => pushHint("地图编辑器迁移中,暂未开放"), [pushHint]);

  const handleMapChange = useCallback((mapId: string) => {
    try {
      localStorage.setItem(MAP_PREF_KEY, mapId);
    } catch {
      /* 隐私模式等写入失败不阻塞换图 */
    }
  }, []);

  const initialMapId = (() => {
    try {
      return localStorage.getItem(MAP_PREF_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  })();

  if (screen === "game") return <GameScreen />;
  if (screen === "lobby") return <LobbyScreen onExit={handleExitLobby} />;
  return (
    <SetupScreen
      onStart={handleStart}
      onEdit={handleEdit}
      onOnline={() => void handleOnline()}
      initialMapId={initialMapId}
      onMapChange={handleMapChange}
      mapSource={getMapSource()}
    />
  );
}
