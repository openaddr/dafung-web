// 生成"棋盘天下"内置地图(网格对齐版,public/maps/chessboard.json)。
//
// 为什么:现有 sanguo 图尊重历史真实地理,但城池坐标自由散布,视觉上道路交叉、
// 城池错落,难以一眼看懂全局。本脚本把同一套城池(数量/id/名称/类型/价格/分组
// 全部不动,只改 pos)重新排布到 13 列 × 9 行的规则网格上,形成"外环 + 中央辅路"
// 的棋盘骨架:
//   - 主环 = 原主路 40 格 + 2 渡口/驿站过渡格(见 FERRY_TILES),沿矩形外圈 + 中央横排行进,横纵对齐;
//   - 八方位分段:上=幽燕/青徐,右=江东,下=荆楚→岭南,左=巴蜀→西凉,中原居中;
//   - 中央辅路(branch):许昌 → 襄阳,穿越东南腹地空网格,保留 sanguo 的辅路玩法
//     (拼点探宝/锦囊/中伏,与原版 kind 节奏一致)。
//
// 为什么中央不是"辅路上的城":loadMap 的 branch cells 只允许 treasure/event/penalty
// (MapBranchCell 无城市语义),且主环必须是全部 tiles 的闭合环——因此中原城市群
// 放在主环的中央横排(第 4 行)上,辅路作为环外捷径从许昌斜穿到襄阳,效果等同
// "骨架 = 外环 + 中央通路"。
//
// 网格几何:viewBox {-1050,-660,2300,1380};13 列(列距 170)x 9 行(行距 140),
// 网格中心对齐 viewBox 中心 (100, 30),四周留边距,最小间距 140 ≥ MIN_TILE_DIST(80)。
//
// 运行:bun scripts/make-chessboard-map.ts(确定性输出,可随时重新生成)。

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMap } from "../src/core/board-loader";
import { MIN_TILE_DIST } from "../src/core/constants";
import type { MapData, MapTile } from "../src/core/types";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = JSON.parse(readFileSync(resolve(root, "public/maps/sanguo.json"), "utf8")) as MapData;

// ── 网格参数 ──
// 列距 170 / 行距 140:与原 sanguo 的城池平均间距相当,13x9 恰好覆盖 viewBox。
const COLS = 13, ROWS = 9;
const COL_STEP = 170, ROW_STEP = 140;
// 网格居中于 viewBox 中心 (x=-1050+2300/2=100, y=-660+1380/2=30)
const gx = (c: number) => -920 + c * COL_STEP; // 列 0..12 → x -920..1120
const gy = (r: number) => -530 + r * ROW_STEP; // 行 0..8 → y -530..590

// ── 布局表:id → [col, row] ──
// 主环走向(tiles 数组顺序 = 原 sanguo 顺序,未重排,只换坐标):
//   中原横排(行4,自右向左)→ 下边(行8,自右向左:荆楚→岭南)→ 左边(列0,自下而上:巴蜀→西凉)
//   → 上边(行0,自左向右:幽燕→青徐)→ 右边(列12,自上而下:江东)→ 闭合 会稽→长安。
// 段间衔接边全部横纵对齐(或 1-2 格短斜线);卧龙→襄阳 长弧由"新野驿站"
// (9,7) 分为两段,底部 交州→江州 空档由"涪陵渡"(1,8) 衔接(见 FERRY_TILES)。
// 卧龙(5,6) 单独下坠一格:宛城→卧龙→襄阳 的"出中原入荆楚"姿态,也还原
// 卧龙岗在宛、襄之间的史实方位。
const LAYOUT: Record<string, [number, number]> = {
  // 中原居中(行 4 自右向左;许昌/宛城/卧龙构成通向南方的出口)
  "prop-changan": [10, 4], // 长安:中原西端(近西凉/巴蜀一侧,史实方位)
  "prop-xianyang": [9, 4], // 咸阳
  "prop-hangu": [8, 4], // 函谷关
  "prop-luoyang": [7, 4], // 洛阳
  "prop-hulao": [6, 4], // 虎牢关
  "prop-xuchang": [5, 4], // 许昌:辅路入口
  "prop-wan": [4, 4], // 宛城
  "tile-wolong": [5, 6], // 卧龙岗:下沉一格,衔接荆楚
  // 下边(行 8 自右向左):荆楚 → 岭南
  "prop-xiangyang": [12, 8], // 襄阳:东南角,辅路终点
  "prop-jiangxia": [11, 8],
  "prop-wuchang": [10, 8],
  "prop-chibi": [9, 8],
  "prop-changsha": [8, 8],
  "tile-fate-1": [7, 8], // 天命
  "prop-jiangling": [6, 8],
  "prop-huarong": [5, 8],
  "prop-lingling": [4, 8],
  "prop-jiaozhou": [3, 8], // 交州:西南角近巴蜀
  // 左边(列 0 自下而上):巴蜀 → 西凉
  "prop-jiangzhou": [0, 8], // 江州:左下角
  "prop-chengdu": [0, 7],
  "prop-jiange": [0, 6],
  "prop-hanzhong": [0, 5],
  "prop-ziwu": [0, 4],
  "prop-jieting": [0, 3],
  "prop-yongzhou": [0, 2],
  "prop-liangzhou": [0, 1], // 凉州:左上角
  // 上边(行 0 自左向右):邺城(中原北门)→ 幽燕 → 青徐
  "prop-ye": [0, 0], // 邺城:左上角,与凉州纵向衔接闭合左上
  "prop-jinyang": [1, 0],
  "prop-youzhou": [2, 0],
  "tile-tax-1": [3, 0], // 税关
  "prop-liaodong": [4, 0],
  "tile-chance-1": [5, 0], // 锦囊
  "prop-linzi": [6, 0],
  "prop-xuzhou": [7, 0],
  "prop-shouchun": [8, 0],
  "prop-hefei": [9, 0],
  // 右边(列 12 自上而下):江东
  "prop-jianye": [12, 0], // 建业:右上角,与合肥横向衔接闭合右上
  "tile-stock-1": [12, 1], // 商市
  "prop-wujun": [12, 2],
  "prop-kuiji": [12, 3], // 会稽:闭合边 会稽→长安(短斜线)回到中原
};

// ── A1 过渡格:渡口/驿站中性格(非地产)──
// 卧龙岗(5,6)→襄阳(12,8) 原为 ~1200px 跨图对角线;补 1 格"新野驿站"
// (新野在宛、襄之间,史实方位吻合)于 (9,7),两侧边各 ~530-690px。
// 交州(3,8)→江州(0,8) 原 510px 底部空档;补 1 格"涪陵渡"(涪陵在江州
// 东侧、荆湘入蜀水路要冲)于 (1,8),贴近江州一侧。
// 类型用 Chance(锦囊/际遇语义,主路已有 tile-chance-1 先例):非地产、
// 无购买/都城语义,落格抽锦囊,最贴近"渡口/驿站"的中性表达。
const FERRY_TILES: Array<{ after: string; tile: { id: string; name: string; type: "Chance" } & Record<string, unknown>; c: number; r: number }> = [
  { after: "tile-wolong", tile: { id: "tile-ferry-xinye", name: "新野驿站", type: "Chance" }, c: 9, r: 7 },
  { after: "prop-jiaozhou", tile: { id: "tile-ferry-fuling", name: "涪陵渡", type: "Chance" }, c: 1, r: 8 },
];

// ── 中央辅路:许昌 → 襄阳,穿越东南腹地空网格(阶梯状网格点)──
// kind 节奏沿用 sanguo 原 branch:treasure×2 → event → treasure → penalty。
// 网格点 (6,5)(7,5)(8,6)(9,6)(10,7) 均为主环之外的空位,与相邻主城距离 ≥ 140。
const BRANCH_CELLS: Array<{ kind: "treasure" | "event" | "penalty"; c: number; r: number }> = [
  { kind: "treasure", c: 6, r: 5 },
  { kind: "treasure", c: 7, r: 5 },
  { kind: "event", c: 8, r: 6 },
  { kind: "treasure", c: 9, r: 6 },
  { kind: "penalty", c: 10, r: 7 },
];

// ── 组装:逐 tile 只替换 pos,其余字段(id/name/type/group/价格/租金)原样保留 ──
const tiles: MapTile[] = src.tiles.map((t) => {
  const cell = LAYOUT[t.id];
  if (!cell) throw new Error(`布局表缺少 tile:${t.id}`);
  return { ...t, pos: [gx(cell[0]), gy(cell[1])] };
});
// 在主路顺序中插入渡口/驿站过渡格(after = 插入点 tile id 的紧后面)
for (const { after, tile, c, r } of FERRY_TILES) {
  const at = tiles.findIndex((t) => t.id === after);
  if (at < 0) throw new Error(`过渡格插入点不存在:${after}`);
  tiles.splice(at + 1, 0, { ...tile, pos: [gx(c), gy(r)] } as MapTile);
}

const out: MapData = {
  ...src,
  tiles,
  branch: {
    id: "zhongyuan-side",
    start: "prop-xuchang",
    end: "prop-xiangyang",
    cells: BRANCH_CELLS.map(({ kind, c, r }) => ({ kind, pos: [gx(c), gy(r)] })),
  },
};

// ── 内置断言:网格对齐 + 间距 ──
const colSet = new Set(tiles.map((t) => t.pos[0]));
const rowSet = new Set(tiles.map((t) => t.pos[1]));
if (colSet.size !== COLS) throw new Error(`列坐标聚类数 ${colSet.size} ≠ ${COLS}`);
if (rowSet.size !== ROWS) throw new Error(`行坐标聚类数 ${rowSet.size} ≠ ${ROWS}`);
for (const t of tiles) {
  const onGrid = [...colSet].some((x) => x === t.pos[0]) && [...rowSet].some((y) => y === t.pos[1]);
  if (!onGrid) throw new Error(`${t.name} 不在网格点上`);
}
const allPts = [...tiles.map((t) => t.pos), ...out.branch!.cells.map((c) => c.pos)];
for (let i = 0; i < allPts.length; i++)
  for (let j = i + 1; j < allPts.length; j++) {
    const d = Math.hypot(allPts[i][0] - allPts[j][0], allPts[i][1] - allPts[j][1]);
    if (d < MIN_TILE_DIST) throw new Error(`格 ${i}/${j} 距离 ${d.toFixed(0)} < ${MIN_TILE_DIST}`);
  }

// ── loadMap 严格校验(与运行时同一代码路径)──
const loaded = loadMap(JSON.parse(JSON.stringify(out)));
const propCount = loaded.properties.length;
console.log(`loadMap 校验通过:${loaded.tiles.length} 格 / ${propCount} 座城 / 辅路 ${out.branch!.cells.length} 格`);

// ── 写 chessboard.json ──
writeFileSync(resolve(root, "public/maps/chessboard.json"), JSON.stringify(out, null, 2) + "\n");

// ── index.json 加条目(幂等:已存在则原位更新)──
const idxPath = resolve(root, "public/maps/index.json");
const index = JSON.parse(readFileSync(idxPath, "utf8")) as Array<Record<string, unknown>>;
const entry = {
  id: "chessboard",
  name: "棋盘天下",
  file: "chessboard.json",
  desc: "网格对齐版,大致方位:外环八区、中原居中;31 城主环 42 格,新野驿站/涪陵渡过渡,许昌—襄阳辅路穿腹地",
  tileCount: propCount,
  targetNetWorth: src.targetNetWorth,
};
const at = index.findIndex((e) => e.id === "chessboard");
if (at >= 0) index[at] = entry;
else index.push(entry);
writeFileSync(idxPath, JSON.stringify(index, null, 2) + "\n");

// ── 八方位段分配表(报告用)──
const seg = (label: string, ids: string[]) =>
  console.log(`${label}: ${ids.map((id) => tiles.find((t) => t.id === id)!.name).join("→")}`);
console.log("\n八方位段分配:");
seg("上(行0 自西向东)", ["prop-ye", "prop-jinyang", "prop-youzhou", "tile-tax-1", "prop-liaodong", "tile-chance-1", "prop-linzi", "prop-xuzhou", "prop-shouchun", "prop-hefei"]);
seg("右(列12 自北向南)", ["prop-jianye", "tile-stock-1", "prop-wujun", "prop-kuiji"]);
seg("中(行4 自东向西)", ["prop-changan", "prop-xianyang", "prop-hangu", "prop-luoyang", "prop-hulao", "prop-xuchang", "prop-wan", "tile-wolong", "tile-ferry-xinye"]);
seg("下(行8 自东向西)", ["prop-xiangyang", "prop-jiangxia", "prop-wuchang", "prop-chibi", "prop-changsha", "tile-fate-1", "prop-jiangling", "prop-huarong", "prop-lingling", "prop-jiaozhou", "tile-ferry-fuling"]);
seg("左(列0 自南向北)", ["prop-jiangzhou", "prop-chengdu", "prop-jiange", "prop-hanzhong", "prop-ziwu", "prop-jieting", "prop-yongzhou", "prop-liangzhou"]);
console.log("\n已写入 public/maps/chessboard.json 并更新 index.json");
