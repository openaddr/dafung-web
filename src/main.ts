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

const root = document.getElementById("app")!;

// 角落版本号:每次代码改动递增(见 src/version.ts),便于确认打开的是最新构建
const verTag = document.createElement("div");
verTag.className = "version-tag";
verTag.textContent = VERSION;
verTag.style.cssText =
  "position:fixed;right:10px;bottom:6px;font-size:11px;color:var(--ink-dim,#9c6b3f);" +
  "opacity:.6;font-family:var(--font-deco,serif);pointer-events:none;z-index:9999;letter-spacing:1px;";
document.body.appendChild(verTag);

/** 运行时 Fetch 地图 JSON:改 public/maps/*.json 后刷新页面即生效,无需 rebuild。 */
async function loadDefaultMap() {
  // 优先用编辑器保存的自定义地图;没有才用内置 sanguo.json
  const saved = localStorage.getItem("dafung-custom-map");
  if (saved) {
    try {
      return loadMap(JSON.parse(saved));
    } catch (err) {
      // 自定义地图校验失败(如旧版存档城池重叠、版本不符)——清掉坏档,回退内置地图,
      // 避免一张坏图卡死整个游戏。
      console.warn("自定义地图加载失败,回退内置地图:", (err as Error).message);
      localStorage.removeItem("dafung-custom-map");
    }
  }
  const res = await fetch("/maps/sanguo.json");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return loadMap(await res.json());
}

function mapLoadError(err: unknown) {
  root.innerHTML = `<div style="padding:40px;color:#b23a2e;font-family:serif">地图加载失败:${(err as Error).message}</div>`;
}

/** 进入联机:加载地图 → network-client(它自带 connect/lobby 屏)。 */
async function enterOnline() {
  try {
    const map = await loadDefaultMap();
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
      try {
        const map = await loadDefaultMap();
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
    // 「编辑地图」入口:加载内置地图 JSON 进入编辑器
    async () => {
      try {
        const saved = localStorage.getItem("dafung-custom-map");
        const data = saved ? JSON.parse(saved) : await (await fetch("/maps/sanguo.json")).json();
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
  );
}

bootstrap();
