// 生成"棋盘天下"内置地图(蛇形全网格版,public/maps/chessboard.json)。
//
// #58 用户看图直报:旧回字形布局(外环 + 中央横排)中央留白浪费、城池挤且小。
// 本版废除回字形,把主环 42 格按 S 形蛇形铺满 7 列 × 6 行全网格:
//   - 偶数行自左向右、奇数行自右向左,行末在边缘列 U 弯(上下相邻格转折);
//   - 蛇形收尾与会稽(41)→ 长安(0) 的闭环边自然落在西边缘列,长边由
//     board.sideArc 自动绕弧(edgeWaypoints 阈值 300),不横穿棋盘;
//   - 行末 U 弯格(宛城→卧龙岗/长沙→天命/江州→成都/凉州→邺城/临淄→徐州)
//     与闭环边一样是上下邻接,主环拓扑 = tiles 数组顺序,零改动。
//
// 为什么 7 列而不是工单字面的 8 列:主环恰 42 格,7×6=42 精确铺满(全网格、
// 零空洞);8×6=48 会剩 6 个空格集中落在蛇形末行,形成整段连续空白带,直接
// 违背 #58 验收标准 1(全画布无明显连续空白带)。列距取 400(工单 ≈390、
// issue ≈400),7 列总跨距 2400,与 8×390 的 2800 同量级,FIT_VIEW 按包围盒
// 收紧后画布两侧富余画纸不出视口。
//
// 网格几何:逻辑画布 3220×1932 不变(StaticLayers VB {-1510,-936,3220,1932}),
// 网格中心对齐画布中心 (100, 30):7 列 × 400(x -1100..1300)、6 行 × 310
// (y -745..805),画布上下各留 191、左右各留 410 画纸(总览视口按城池包围盒
// 收紧,富余画纸不进视口)。最小间距 310 ≥ MIN_TILE_DIST(80);城池铭牌外缘
// ~104×2.2≈229 < 行距 310 < 列距 400,无压盖。
//
// 辅路(branch):许昌 → 襄阳,start/end 引用的主环格与 cells 的 kind 节奏
// (treasure×2 → event → treasure → penalty)零改动,只重摆 cells 坐标:
// 五格沿第 0/1 行之间的行间走廊(y=-590,距上下城池铭牌各 ≥ 155)横向排开,
// 首尾自然斜接许昌/襄阳,不与主路交叉。
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

// ── 网格参数(#58:7×6 蛇形全网格,间距暴增)──
const COLS = 7, ROWS = 6;
const COL_STEP = 400, ROW_STEP = 310;
// 网格居中于画布中心 (x=-1510+3220/2=100, y=-936+1932/2=30)
const gx = (c: number) => 100 + (c - 3) * COL_STEP; // 列 0..6 → x -1100..1300
const gy = (r: number) => 30 + (r - 2.5) * ROW_STEP; // 行 0..5 → y -745..805

// ── 蛇形布局表:id → [col, row] ──
// 主环走向(tiles 数组顺序 = 原 sanguo 顺序,未重排,只换坐标):
//   行 0 自左向右(中原:长安→宛城)→ U 弯 ↓
//   行 1 自右向左(卧龙岗/新野驿站过渡,荆楚:襄阳→长沙)→ U 弯 ↓
//   行 2 自左向右(凶/荆楚南段/涪陵渡/巴蜀东端)→ U 弯 ↓
//   行 3 自右向左(巴蜀→西凉)→ U 弯 ↓
//   行 4 自左向右(邺城/幽燕/税关/锦囊/青徐)→ U 弯 ↓
//   行 5 自右向左(徐州→会稽),会稽落在西下角,与长安同列,闭环边沿西缘。
const LAYOUT: Record<string, [number, number]> = {
  // 行 0(自左向右):中原
  "prop-changan": [0, 0], // 长安:蛇头,与蛇尾会稽同列(闭环边沿西缘)
  "prop-xianyang": [1, 0], // 咸阳
  "prop-hangu": [2, 0], // 函谷关
  "prop-luoyang": [3, 0], // 洛阳
  "prop-hulao": [4, 0], // 虎牢关
  "prop-xuchang": [5, 0], // 许昌:辅路入口
  "prop-wan": [6, 0], // 宛城:行 0 末,东缘 U 弯下行
  // 行 1(自右向左):卧龙岗/新野驿站 + 荆楚北段
  "tile-wolong": [6, 1], // 卧龙岗:U 弯后第一格
  // (tile-ferry-xinye 新野驿站 插在卧龙岗之后,占 (5,1),见 FERRY_TILES)
  "prop-xiangyang": [4, 1], // 襄阳:辅路终点
  "prop-jiangxia": [3, 1],
  "prop-wuchang": [2, 1],
  "prop-chibi": [1, 1],
  "prop-changsha": [0, 1], // 行 1 末,西缘 U 弯下行
  // 行 2(自左向右):荆楚南段 + 巴蜀东端
  "tile-fate-1": [0, 2], // 天命
  "prop-jiangling": [1, 2],
  "prop-huarong": [2, 2],
  "prop-lingling": [3, 2],
  "prop-jiaozhou": [4, 2],
  // (tile-ferry-fuling 涪陵渡 插在交州之后,占 (5,2),见 FERRY_TILES)
  "prop-jiangzhou": [6, 2], // 江州:行 2 末,东缘 U 弯下行
  // 行 3(自右向左):巴蜀 → 西凉
  "prop-chengdu": [6, 3],
  "prop-jiange": [5, 3],
  "prop-hanzhong": [4, 3],
  "prop-ziwu": [3, 3],
  "prop-jieting": [2, 3],
  "prop-yongzhou": [1, 3],
  "prop-liangzhou": [0, 3], // 行 3 末,西缘 U 弯下行
  // 行 4(自左向右):邺城/幽燕/青徐
  "prop-ye": [0, 4],
  "prop-jinyang": [1, 4],
  "prop-youzhou": [2, 4],
  "tile-tax-1": [3, 4], // 税关
  "prop-liaodong": [4, 4],
  "tile-chance-1": [5, 4], // 锦囊
  "prop-linzi": [6, 4], // 行 4 末,东缘 U 弯下行
  // 行 5(自右向左):青徐南段 → 江东
  "prop-xuzhou": [6, 5],
  "prop-shouchun": [5, 5],
  "prop-hefei": [4, 5],
  "prop-jianye": [3, 5],
  "tile-stock-1": [2, 5], // 商市
  "prop-wujun": [1, 5],
  "prop-kuiji": [0, 5], // 会稽:蛇尾,与蛇头长安同列,闭环边沿西缘向上
};

// ── A1 过渡格:渡口/驿站中性格(非地产)──
// 沿用旧版两只过渡格与插入点(卧龙岗后/交州后),坐标换成蛇形对应空位:
// 新野驿站 (5,1) 补行 1 缺口,涪陵渡 (5,2) 补行 2 缺口。
// 类型用 Chance(锦囊/际遇语义,主路已有 tile-chance-1 先例):非地产、
// 无购买/都城语义,落格抽锦囊,最贴近"渡口/驿站"的中性表达。
const FERRY_TILES: Array<{ after: string; tile: { id: string; name: string; type: "Chance" } & Record<string, unknown>; c: number; r: number }> = [
  { after: "tile-wolong", tile: { id: "tile-ferry-xinye", name: "新野驿站", type: "Chance" }, c: 5, r: 1 },
  { after: "prop-jiaozhou", tile: { id: "tile-ferry-fuling", name: "涪陵渡", type: "Chance" }, c: 5, r: 2 },
];

// ── 辅路:许昌 → 襄阳,cells 走行 0/1 之间的行间走廊 ──
// kind 节奏沿用 sanguo 原 branch:treasure×2 → event → treasure → penalty(零改动)。
// 走廊 y=-590(行距中点):距上行/下行城池铭牌边缘各 ≥ 155-114≈40(圆点 r18
// 实际与铭牌无碰),格间距 85 ≥ MIN_TILE_DIST(80);首尾斜接许昌 (900,-745)
// / 襄阳 (500,-435),整条辅路不与主路交叉。
const BRANCH_CELLS: Array<{ kind: "treasure" | "event" | "penalty"; x: number; y: number }> = [
  { kind: "treasure", x: 820, y: -590 },
  { kind: "treasure", x: 735, y: -590 },
  { kind: "event", x: 650, y: -590 },
  { kind: "treasure", x: 565, y: -590 },
  { kind: "penalty", x: 480, y: -590 },
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
    cells: BRANCH_CELLS.map(({ kind, x, y }) => ({ kind, pos: [x, y] })),
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
  desc: "蛇形全网格版:7×6 主环 42 格 S 形铺满,行末 U 弯衔接;许昌—襄阳辅路沿北走廊",
  tileCount: propCount,
  targetNetWorth: src.targetNetWorth,
};
const at = index.findIndex((e) => e.id === "chessboard");
if (at >= 0) index[at] = entry;
else index.push(entry);
writeFileSync(idxPath, JSON.stringify(index, null, 2) + "\n");

// ── 蛇形段分配表(报告用)──
const seg = (label: string, ids: string[]) =>
  console.log(`${label}: ${ids.map((id) => tiles.find((t) => t.id === id)!.name).join("→")}`);
console.log("\n蛇形段分配:");
seg("行0 西→东", ["prop-changan", "prop-xianyang", "prop-hangu", "prop-luoyang", "prop-hulao", "prop-xuchang", "prop-wan"]);
seg("行1 东→西", ["tile-wolong", "tile-ferry-xinye", "prop-xiangyang", "prop-jiangxia", "prop-wuchang", "prop-chibi", "prop-changsha"]);
seg("行2 西→东", ["tile-fate-1", "prop-jiangling", "prop-huarong", "prop-lingling", "prop-jiaozhou", "tile-ferry-fuling", "prop-jiangzhou"]);
seg("行3 东→西", ["prop-chengdu", "prop-jiange", "prop-hanzhong", "prop-ziwu", "prop-jieting", "prop-yongzhou", "prop-liangzhou"]);
seg("行4 西→东", ["prop-ye", "prop-jinyang", "prop-youzhou", "tile-tax-1", "prop-liaodong", "tile-chance-1", "prop-linzi"]);
seg("行5 东→西", ["prop-xuzhou", "prop-shouchun", "prop-hefei", "prop-jianye", "tile-stock-1", "prop-wujun", "prop-kuiji"]);
console.log("\n已写入 public/maps/chessboard.json 并更新 index.json");
