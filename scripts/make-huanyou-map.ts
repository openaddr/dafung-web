// 生成「环游图」内置地图(public/maps/huanyou.json)——#249 地图环序重排。
//
// #249 病根:「棋盘天下」沿用 sanguo 主环顺序只换坐标,首格长安与尾格会稽同在
// 西列相隔 5 行,闭环边靠 board.sideArc 绕西缘画长弧,玩家看不出这是个环。
// 本图沿用 chessboard 的 7×6 蛇形网格几何(坐标/间距/画布完全一致,StaticLayers
// 兼容),但**重排主环顺序(tiles 数组顺序)**:长安 (0,0) 为蛇头沿西栈道南下,
// 蛇形盘完全图后会稽 (1,0) 与长安同排相邻——闭环边就是顶部一行一格横边,
// 环在画面上可读闭合。主环拓扑仍是 tiles 数组顺序闭合环,引擎零改动。
//
// 走法(见 RING 表):西栈道(蜀道线)南下 → 底行东行(南疆/荆南)→ 行4 西行
// (荆楚北)→ 行3 东行(西凉→中原→青徐)→ 行2 西行(青徐尾→关陇西)→
// 行1 东行(并青→江东)→ 行0 西行(江东尾→幽燕→中原西归)→ 会稽收尾。
//
// 经济数据源:chessboard.json(与 sanguo 经济同源,且含 #147 还原的子午谷与两只
// 渡口/驿站格,42 格 id 全集齐备)——逐 tile 只换 pos 并重排数组顺序,其余字段
// (id/name/type/group/region/价格/租金/补给)原样保留,经济守卫测试同 SANGUO_TIER 表。
//
// 本脚本内置 #249 全部硬约束断言(首尾相邻/网格相邻/锚点环距/节奏无三连同型),
// 违反直接抛错(零兜底)。运行:bun scripts/make-huanyou-map.ts
// (确定性输出,可随时重新生成)。

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMap } from "../src/core/board-loader";
import { MIN_TILE_DIST } from "../src/core/constants";
import type { MapData, MapTile } from "../src/core/board-loader";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = JSON.parse(
  readFileSync(resolve(root, "public/maps/chessboard.json"), "utf8"),
) as MapData;

// ── 网格参数(与 chessboard 完全一致)──
const COLS = 7,
  ROWS = 6;
const COL_STEP = 400,
  ROW_STEP = 310;
const gx = (c: number) => 100 + (c - 3) * COL_STEP; // 列 0..6 → x -1100..1300
const gy = (r: number) => 30 + (r - 2.5) * ROW_STEP; // 行 0..5 → y -745..805

// ── 主环走位表:数组顺序 = 主环顺序(P0 蛇头长安 → P41 会稽收尾)──
const RING: Array<{ id: string; c: number; r: number }> = [
  // 西栈道(0 列南下):蜀道线,咸阳贴长安起程(节奏断点),江州东出接底行
  { id: "prop-changan", c: 0, r: 0 }, // P0  长安:蛇头/都城锚
  { id: "prop-xianyang", c: 0, r: 1 }, // P1  咸阳(珍宝城)
  { id: "prop-hanzhong", c: 0, r: 2 }, // P2  汉中
  { id: "prop-jiange", c: 0, r: 3 }, // P3  剑阁(乘法城)
  { id: "prop-chengdu", c: 0, r: 4 }, // P4  成都(乘法城)
  { id: "prop-jiangzhou", c: 0, r: 5 }, // P5  江州
  // 底行(东行):南疆/荆南
  { id: "prop-jiaozhou", c: 1, r: 5 }, // P6  交州
  { id: "tile-ferry-fuling", c: 2, r: 5 }, // P7  涪陵渡(渡口)
  { id: "prop-lingling", c: 3, r: 5 }, // P8  零陵
  { id: "prop-changsha", c: 4, r: 5 }, // P9  长沙:都城锚
  { id: "prop-huarong", c: 5, r: 5 }, // P10 华容道(乘法城)
  { id: "prop-jiangling", c: 6, r: 5 }, // P11 江陵
  // 行4(西行):荆楚北,西端襄阳折上
  { id: "prop-jiangxia", c: 6, r: 4 }, // P12 江夏
  { id: "tile-ferry-xinye", c: 5, r: 4 }, // P13 新野驿站(渡口)
  { id: "prop-wuchang", c: 4, r: 4 }, // P14 武昌
  { id: "prop-chibi", c: 3, r: 4 }, // P15 赤壁
  { id: "tile-wolong", c: 2, r: 4 }, // P16 卧龙岗(招贤)
  { id: "prop-xiangyang", c: 1, r: 4 }, // P17 襄阳
  // 行3(东行):西凉 → 中原 → 青徐
  { id: "prop-liangzhou", c: 1, r: 3 }, // P18 凉州
  { id: "prop-hangu", c: 2, r: 3 }, // P19 函谷关(珍宝城)
  { id: "prop-luoyang", c: 3, r: 3 }, // P20 洛阳:都城锚
  { id: "prop-hulao", c: 4, r: 3 }, // P21 虎牢关(珍宝城)
  { id: "prop-xuchang", c: 5, r: 3 }, // P22 许昌
  { id: "prop-xuzhou", c: 6, r: 3 }, // P23 徐州
  // 行2(西行):商市贴江东、天命/锦囊散布中段、街亭收西端
  { id: "tile-stock-1", c: 6, r: 2 }, // P24 商市
  { id: "prop-ziwu", c: 5, r: 2 }, // P25 子午谷
  { id: "prop-yongzhou", c: 4, r: 2 }, // P26 雍州
  { id: "tile-chance-1", c: 3, r: 2 }, // P27 锦囊
  { id: "tile-fate-1", c: 2, r: 2 }, // P28 天命
  { id: "prop-jieting", c: 1, r: 2 }, // P29 街亭(乘法城)
  // 行1(东行):并青 → 淮南 → 江东
  { id: "prop-jinyang", c: 1, r: 1 }, // P30 晋阳
  { id: "prop-linzi", c: 2, r: 1 }, // P31 临淄:都城锚
  { id: "prop-hefei", c: 3, r: 1 }, // P32 合肥(乘法城)
  { id: "prop-shouchun", c: 4, r: 1 }, // P33 寿春
  { id: "tile-tax-1", c: 5, r: 1 }, // P34 税关:入江东设卡
  { id: "prop-jianye", c: 6, r: 1 }, // P35 建业
  // 行0(西行):江东尾 → 幽燕 → 中原西归,会稽与长安同排相邻闭环
  { id: "prop-wujun", c: 6, r: 0 }, // P36 吴郡
  { id: "prop-ye", c: 5, r: 0 }, // P37 邺城(乘法城)
  { id: "prop-liaodong", c: 4, r: 0 }, // P38 辽东
  { id: "prop-youzhou", c: 3, r: 0 }, // P39 幽州
  { id: "prop-wan", c: 2, r: 0 }, // P40 宛城(珍宝城)
  { id: "prop-kuiji", c: 1, r: 0 }, // P41 会稽:蛇尾,与长安一格横边闭环
];

// ── 四个自然都城锚点(环距均匀性断言用)──
const ANCHORS = ["prop-changan", "prop-changsha", "prop-luoyang", "prop-linzi"];

// ── 组装:按 RING 顺序从 chessboard 逐 tile 取数、只换 pos ──
const byId = new Map(src.tiles.map((t) => [t.id, t]));
const tiles: MapTile[] = RING.map(({ id, c, r }) => {
  const t = byId.get(id);
  if (!t) throw new Error(`chessboard 缺少 tile:${id}`);
  return { ...t, pos: [gx(c), gy(r)] };
});
// id 全集恰好用尽:多一格少一格都是走位表错
const used = new Set(RING.map((x) => x.id));
if (used.size !== RING.length) throw new Error("RING 存在重复 tile id");
for (const t of src.tiles)
  if (!used.has(t.id)) throw new Error(`走位表遗漏 tile:${t.id}(${t.name})`);
if (tiles.length !== COLS * ROWS) throw new Error(`主环 ${tiles.length} 格 ≠ ${COLS * ROWS}`);

const out: MapData = {
  ...src,
  tiles,
};

const N = tiles.length;
const posOf = (i: number): [number, number] => [tiles[i].pos[0], tiles[i].pos[1]];
const idxOf = (id: string) => RING.findIndex((x) => x.id === id);
const ringDist = (a: number, b: number) => (((b - a) % N) + N) % N;
const manh = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
const label = (i: number) => `P${i} ${tiles[i].name}`;

// ── 断言 1:首尾相邻(闭环边 = 顶部一行一格横边,曼哈顿恰 400)──
if (manh(posOf(0), posOf(N - 1)) !== COL_STEP)
  throw new Error(
    `首尾不相邻:${label(0)} ↔ ${label(N - 1)} 曼哈顿距离 ${manh(posOf(0), posOf(N - 1))} ≠ ${COL_STEP}`,
  );

// ── 断言 2:所有相邻走位(含 U 弯与闭环边)网格相邻(400 或 310)──
for (let i = 0; i < N; i++) {
  const d = manh(posOf(i), posOf((i + 1) % N));
  if (d !== COL_STEP && d !== ROW_STEP)
    throw new Error(`${label(i)} → ${label((i + 1) % N)} 曼哈顿距离 ${d} 非一格邻接`);
}

// ── 断言 3:42 格恰好铺满 7×6 全网格(格位唯一且在界内 = 无空洞)──
const cells = new Set(RING.map(({ c, r }) => `${c},${r}`));
if (cells.size !== N) throw new Error("存在重复格位");
for (const { c, r } of RING)
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) throw new Error(`格位越界:(${c},${r})`);

// ── 断言 4:都城锚点环距均匀(max − min ≤ 2)──
const anchorIdx = ANCHORS.map((id) => {
  const i = idxOf(id);
  if (i < 0) throw new Error(`锚点不在环上:${id}`);
  return i;
}).sort((a, b) => a - b);
const gaps = anchorIdx.map((a, i) => ringDist(a, anchorIdx[(i + 1) % anchorIdx.length]));
const spread = Math.max(...gaps) - Math.min(...gaps);
if (spread > 2) throw new Error(`都城锚点环距差 ${spread} > 2(环距 ${gaps.join("/")})`);

// ── 断言 5:节奏——全环无连续三格同「型」──
// 口径:非地产格按 TileDef type 分型;地产格 tradeAdd 全 0 判乘法城,否则加法城。
const kindOf = (t: MapTile): string => {
  if ((t.type ?? "Property") !== "Property") return String(t.type);
  return (t.tradeAdd ?? []).length > 0 && t.tradeAdd!.every((v) => v === 0) ? "乘法城" : "加法城";
};
const kinds = tiles.map(kindOf);
for (let i = 0; i < N; i++) {
  const a = kinds[i],
    b = kinds[(i + 1) % N],
    c = kinds[(i + 2) % N];
  if (a === b && b === c) throw new Error(`P${i}..P${(i + 2) % N} 连续三格同型「${a}」`);
}

// ── 断言 6:主环全格最小间距 ≥ MIN_TILE_DIST ──
const allPts = tiles.map((t) => t.pos);
for (let i = 0; i < allPts.length; i++)
  for (let j = i + 1; j < allPts.length; j++) {
    const d = Math.hypot(allPts[i][0] - allPts[j][0], allPts[i][1] - allPts[j][1]);
    if (d < MIN_TILE_DIST) throw new Error(`格 ${i}/${j} 距离 ${d.toFixed(0)} < ${MIN_TILE_DIST}`);
  }

// ── loadMap 严格校验(与运行时同一代码路径)──
const loaded = loadMap(JSON.parse(JSON.stringify(out)));
const propCount = loaded.properties.length;
console.log(`loadMap 校验通过:${loaded.tiles.length} 格 / ${propCount} 座城`);

// ── 写 huanyou.json ──
// oxfmt 按项目配置忽略 public/**,纯数字数组(JSON.stringify 会逐项换行)手动收紧凑,
// 与 chessboard.json 既有产物风格一致。
const compactJson = (s: string) =>
  s.replace(
    /\[\s+(-?\d+(?:,\s+-?\d+)*)\s+\]/g,
    (_m, inner: string) => `[${inner.replace(/\s+/g, " ")}]`,
  );
writeFileSync(
  resolve(root, "public/maps/huanyou.json"),
  compactJson(JSON.stringify(out, null, 2)) + "\n",
);

// ── index.json 前置条目(幂等:已存在则原位更新,新则插首项成默认图)──
const idxPath = resolve(root, "public/maps/index.json");
const index = JSON.parse(readFileSync(idxPath, "utf8")) as Array<Record<string, unknown>>;
const entry = {
  id: "huanyou",
  name: "环游图",
  file: "huanyou.json",
  desc: "首尾相连的蛇形环:会稽与长安同排相邻,一格闭环边可见闭合",
  // tileCount 口径 = 城池数(与既有条目/选图面板「N 城」一致),非格数
  tileCount: propCount,
  targetNetWorth: src.targetNetWorth,
};
const at = index.findIndex((e) => e.id === "huanyou");
if (at >= 0) index[at] = entry;
else index.unshift(entry);
writeFileSync(idxPath, JSON.stringify(index, null, 2) + "\n");

// ── 报告:分配表 + 锚点环距 + 类型序列 ──
console.log("\n主环分配表(P# 城名 格位):");
const zoneOf = (i: number) =>
  i === 0
    ? "蛇头"
    : i <= 5
      ? "西栈道"
      : i <= 11
        ? "底行东行"
        : i <= 17
          ? "行4西行"
          : i <= 23
            ? "行3东行"
            : i <= 29
              ? "行2西行"
              : i <= 35
                ? "行1东行"
                : "行0西行";
for (let i = 0; i < N; i++)
  console.log(
    `P${String(i).padStart(2, " ")} ${tiles[i].name} (${RING[i].c},${RING[i].r}) [${kindOf(tiles[i])}] ${zoneOf(i)}`,
  );
console.log(
  `\n都城锚点:${ANCHORS.map((id) => `${tiles[idxOf(id)].name}@P${idxOf(id)}`).join(" · ")} 环距 ${gaps.join("/")}(max−min=${spread})`,
);
console.log(`\n全环类型序列:\n${kinds.join(" ")}`);
console.log("\n已写入 public/maps/huanyou.json 并前置 index.json 首项");
