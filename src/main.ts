// 入口:加载样式 → 显示开局设置屏 → 创建 App 进入对局。
// 联机:设置屏「联机对战」按钮,或 URL ?online=1(便于 e2e / 直链)。
import "./render/style.css";
import { createSetupScreen } from "./render/ui";
import { createEditor } from "./render/editor";
import type { SetupResult } from "./render/ui";
import { App } from "./render/state";
import { NetworkClient } from "./render/network-client";
import { VERSION } from "./version";
import { loadMap } from "./core/board-loader";
import { loadMapById } from "./core/map-source";
import { getMapSource, DEFAULT_MAP_ID } from "./render/map-sources";

const root = document.getElementById("app")!;

/** localStorage key:记住上次选择的地图 id(刷新页面恢复)。 */
const SELECTED_MAP_KEY = "dafung-selected-map";

/** 读取上次选中的地图 id;无记录或失效则回退默认(DEFAULT_MAP_ID = sanguo)。 */
function readSelectedMap(): string {
  const saved = localStorage.getItem(SELECTED_MAP_KEY);
  return saved || DEFAULT_MAP_ID;
}

// 角落版本号:每次代码改动递增(见 src/version.ts),便于确认打开的是最新构建
const verTag = document.createElement("div");
verTag.className = "version-tag";
verTag.textContent = VERSION;
verTag.style.cssText =
  "position:fixed;right:10px;bottom:6px;font-size:11px;color:var(--ink-dim,#9c6b3f);" +
  "opacity:.6;font-family:var(--font-deco,serif);pointer-events:none;z-index:9999;letter-spacing:1px;";
document.body.appendChild(verTag);

/** 按 mapId 从统一入口加载地图(取代硬编码 fetch sanguo.json)。
 *  01 阶段:默认 id = sanguo,行为与改前一致。选图菜单在 ticket 02 接入后传入用户选的 id。 */
async function loadSelectedMap(mapId: string = DEFAULT_MAP_ID) {
  return loadMapById(getMapSource(), mapId);
}

function mapLoadError(err: unknown) {
  root.innerHTML = `<div style="padding:40px;color:#b23a2e;font-family:serif">地图加载失败:${(err as Error).message}</div>`;
}

/** 进入联机:加载地图 → network-client(它自带 connect/lobby 屏)。 */
async function enterOnline() {
  try {
    const map = await loadSelectedMap();
    root.innerHTML = "";
    new NetworkClient(map, location.origin);
  } catch (err) {
    mapLoadError(err);
  }
}

function bootstrap() {
  root.innerHTML = "";
  // 直链 / e2e:?online=1 跳过设置屏直接联机
  if (new URLSearchParams(location.search).has("online")) {
    void enterOnline();
    return;
  }
  createSetupScreen(
    root,
    async (r: SetupResult) => {
      root.innerHTML = "";
      const seedParam = new URLSearchParams(location.search).get("seed");
      const seed = seedParam ? parseInt(seedParam, 10) : undefined;
      // 起兵时:持久化选中的地图 id + 用它加载地图(延迟加载)
      const mapId = r.mapId || DEFAULT_MAP_ID;
      try {
        localStorage.setItem(SELECTED_MAP_KEY, mapId);
      } catch { /* localStorage 不可用(隐私模式)时静默忽略 */ }
      try {
        const map = await loadSelectedMap(mapId);
        new App({
          seats: r.seats,
          targetNetWorth: r.targetNetWorth,
          startingCash: r.startingCash,
          difficulty: r.difficulty,
          seed,
          map,
        });
      } catch (err) {
        mapLoadError(err);
      }
    },
    // 「编辑地图」入口:加载地图原始 JSON 进入编辑器
    async () => {
      try {
        // 注:localStorage 单图(dafung-custom-map)是旧的编辑器存档,ticket 03 会升级为多图库。
        // 此处保留旧行为,03 改造后编辑器从图库加载/保存。
        const saved = localStorage.getItem("dafung-custom-map");
        const data = saved ? JSON.parse(saved) : await getMapSource().loadMapData(DEFAULT_MAP_ID);
        createEditor(root, data, () => bootstrap(), async (mapData) => {
          try {
            root.innerHTML = "";
            new App({
              seats: [
                { name: "诸侯1", isBot: false, guohao: "魏" },
                { name: "诸侯2", isBot: true },
              ],
              targetNetWorth: mapData.targetNetWorth,
              startingCash: mapData.startingCash,
              difficulty: "Normal",
              map: loadMap(mapData),
            });
          } catch (err) {
            mapLoadError(err);
          }
        });
      } catch (err) {
        mapLoadError(err);
      }
    },
    // 「联机对战」按钮
    () => void enterOnline(),
    // 初始选中地图 id(localStorage 记忆,默认 sanguo)
    readSelectedMap(),
    // 地图源(传入后设置屏显示「选择地图」按钮 + 二级屏)
    getMapSource(),
    // 选中地图变更:持久化到 localStorage(刷新页面恢复)
    (mapId: string) => {
      try { localStorage.setItem(SELECTED_MAP_KEY, mapId); } catch { /* 忽略 */ }
    },
  );
}

bootstrap();
