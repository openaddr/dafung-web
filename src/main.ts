// 入口:加载样式 → 模式选择(热座 / 联机)→ 进入对局。
import "./render/style.css";
import { createSetupScreen } from "./render/ui";
import { createEditor } from "./render/editor";
import type { SetupResult } from "./render/ui";
import { App } from "./render/state";
import { NetworkClient } from "./render/network-client";
import { el } from "./render/dom";
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

/** 运行时 fetch 地图 JSON:改 public/maps/*.json 后刷新页面即生效,无需 rebuild。 */
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

function bootstrap() {
  root.innerHTML = "";
  // 模式选择:热座(单设备轮流) / 联机(每人一设备,经服务器)
  const hotseatBtn = el("button", { class: "btn btn-primary" }, ["热座(本地)"]) as HTMLButtonElement;
  const onlineBtn = el("button", { class: "btn" }, ["联机(在线)"]) as HTMLButtonElement;
  const overlay = el("div", { class: "scroll-overlay" }, [
    el("div", { class: "scroll", style: "max-width:340px;text-align:center;" }, [
      el("h2", { class: "scroll-title" }, ["群雄逐鹿"]),
      el("p", { style: "color:var(--ink-dim,#9c6b3f);" }, ["选择对局模式"]),
      el("div", { class: "choices", style: "flex-direction:column;gap:10px;" }, [hotseatBtn, onlineBtn]),
    ]),
  ]);
  hotseatBtn.addEventListener("click", () => {
    overlay.remove();
    showHotseatSetup();
  });
  onlineBtn.addEventListener("click", async () => {
    overlay.remove();
    try {
      const map = await loadDefaultMap();
      root.innerHTML = "";
      new NetworkClient(map, location.origin);
    } catch (err) {
      root.innerHTML = `<div style="padding:40px;color:#b23a2e;font-family:serif">地图加载失败:${(err as Error).message}</div>`;
    }
  });
  root.appendChild(overlay);
}

function showHotseatSetup() {
  root.innerHTML = "";
  createSetupScreen(root, async (r: SetupResult) => {
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
      root.innerHTML = `<div style="padding:40px;color:#b23a2e;font-family:serif">地图加载失败:${(err as Error).message}</div>`;
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
          root.innerHTML = `<div style="padding:40px;color:#b23a2e;font-family:serif">地图加载失败:${(err as Error).message}</div>`;
        }
      });
    } catch (err) {
      root.innerHTML = `<div style="padding:40px;color:#b23a2e;font-family:serif">地图加载失败:${(err as Error).message}</div>`;
    }
  });
}

bootstrap();
