// 根组件:按 store.screen 路由(setup / lobby / game)。
// 正式开局流程:SetupScreen.onStart → loadMapById → LocalController → GameScreen。
// 联机流程(阶段 8):SetupScreen.onOnline 或 ?online=1 → 占位图 + OnlineController
// → LobbyScreen(建房/加入);?room=CODE 直连自动加入;开局由服务器首帧 snapshot
// 驱动 online.ts 切 GameScreen(对照旧 main.ts enterOnline)。
import { useCallback, useEffect, useRef, useState } from "react";
import { loadMapById } from "@core/map-source";
import type { MapData } from "@core/types";
import { FetchMapSource, getDefaultMapId, getMapSource } from "@app/map-sources";
import { LocalController } from "@app/controllers/local";
import { OnlineController } from "@app/controllers/online";
import { setController } from "@app/controllers/registry";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { GameScreen } from "@app/screens/game/GameScreen";
import { LobbyScreen } from "@app/screens/lobby/LobbyScreen";
import { SetupScreen, type SetupConfig } from "@app/screens/setup/SetupScreen";
import { EditorScreen } from "@app/screens/editor/EditorScreen";

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
  const hint = useGameStore((s) => s.hint);

  // 正式开局:加载地图 → 构造单机控制器(引擎 setup 自动步进至轮到人类)→ 进 Game 屏。
  // 单机热座:guohao 全在 seats 里,doDraftRoll 定序后 bot 选都步进,轮到人类停。
  const handleStart = useCallback(
    async (config: SetupConfig) => {
      try {
        // 组合源:custom- 前缀走自建图库,内置图走 fetch(单用 FetchMapSource 会抛
        // 「内置图清单中无此 id」——e2e react-editor 巡检发现)
        const source = getMapSource();
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

  // ── 编辑器(阶段 9):SetupScreen「编辑地图」→ EditorScreen。
  // 起编地图:旧实现忽略传入 id 固定加载默认图,此处从选中图起编更直观(行为增强,注释存档)。
  const [editorMap, setEditorMap] = useState<MapData | null>(null);
  const handleEdit = useCallback(
    async (mapId?: string) => {
      try {
        const source = new FetchMapSource();
        const id = mapId ?? (await getDefaultMapId());
        setEditorMap(await source.loadMapData(id));
        setScreen("editor");
      } catch (err) {
        pushHint(`进入编辑器失败:${(err as Error).message}`);
      }
    },
    [pushHint, setScreen],
  );

  // 保存:写入自建图库(localStorage 渠道,与旧编辑器一致);另存新图由 EditorScreen 自理
  const handleEditorSave = useCallback(
    (data: MapData) => {
      // MapData 无名字段,用首格名兜底命名(图库列表展示用,允许重名)
      getMapSource().saveCustomMap(data.tiles[0]?.name ?? "未命名地图", data);
      pushHint("已存入自建图库");
    },
    [pushHint],
  );

  // 试玩:直接以编辑中的数据开局(不经图库,对照旧「试玩」语义)
  const handleEditorStart = useCallback(
    async (data: MapData) => {
      try {
        const { loadMap } = await import("@core/board-loader");
        const map = loadMap(data);
        const controller = new LocalController(map, {
          seats: [
            { name: "玩家一", isBot: false, guohao: "魏" },
            { name: "bot二", isBot: true },
            { name: "bot三", isBot: true },
            { name: "bot四", isBot: true },
          ],
          seed: urlSeed(),
        });
        setController(controller, data);
        const e = controller.engine;
        e.doDraftRoll();
        while (e.aiSetupStep()) { /* bot 选都步进 */ }
        useGameStore.getState().syncFromEngine(e);
        setScreen("game");
        controller.onEnterGame();
      } catch (err) {
        pushHint(`试玩开局失败:${(err as Error).message}`);
      }
    },
    [pushHint, setScreen],
  );

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
  if (screen === "editor" && editorMap) {
    return (
      <EditorScreen
        initialMap={editorMap}
        onSave={handleEditorSave}
        onExit={() => setScreen("setup")}
        onStart={(data) => void handleEditorStart(data)}
      />
    );
  }
  return (
    <div className="relative h-full">
      <SetupScreen
        onStart={handleStart}
        onEdit={handleEdit}
        onOnline={() => void handleOnline()}
        initialMapId={initialMapId}
        onMapChange={handleMapChange}
        mapSource={getMapSource()}
      />
      {/* 设置屏也可见的错误提示:gameStore.hint 原本只在 Game 屏渲染,
          起兵/进联机失败在 setup 屏静默(e2e react-resilience 巡检发现)。
          Game 屏有自己的 hint 层,这里仅 setup 屏兜底。 */}
      {hint && (
        <div
          data-testid="hint"
          className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded bg-panel/95 px-4 py-1 text-danger shadow"
        >
          {hint}
        </div>
      )}
    </div>
  );
}
