// 生成「环游图」内置地图(public/maps/huanyou.json)——ADR-0027 满格螺旋重排。
//
// 主环 45 格 = 9×5 **满格**螺旋环(零凸出列、零空洞、步距全统一 380×320):
// 长安 P0 踞北境,先沿外环 24 格(= 2×(9+5)−4,恰为整圈边界)环游边境一周,
// 再螺旋收入中原腹地,会稽 P44 在腹地收尾——闭环边是全图唯一非正交边:
// 会稽 (3,1) ⇗ 长安 (2,0) 一格对角线,左上角可见收环。
//
// 为什么必须有一条对角边:纯上下左右一格邻接的网格图是二部图,环必须偶数格;
// 45 为奇数,数学上不存在纯正交闭环。对角连接同色格,恰一条对角边即凑出奇环,
// 是最小代价(旧图 ADR-0024 用三条例外长边凑环,行进「凸出再折返」即乱跳根源)。
// 环序取自满格最少转向哈密顿路径(16 转向):外环先周、内旋收束,长直道最多。
//
// 走法(见 RING 表):北境东行(两京→并幽辽→北境互市)→ 东境南下(青徐过税关
// 入江东)→ 南境西行(吴郡→岭南→巴蜀)→ 西境北上(剑阁→凉陇线,函谷关守
// 洛阳西门)→ 蜀道内环南下(虎牢折入,咸阳-子午谷-汉中秦岭道)→ 荆楚东行
// (襄阳→江夏)→ 腹地盘旋收束(临淄→淮南→中原核心,新野/卧龙守荆襄北门)
// → 会稽收尾闭环。
//
// 经济数据源:huanyou.json 自身(**自再生**:经济字段原样保留,只重算几何与
// 环序)——逐 tile 按 id 取数换 pos 并按 RING 序重排数组,其余字段(id/name/
// type/group/region/价格/租金/补给)原样保留,经济守卫测试同 HUANYOU_TIER 表。
//
// 本脚本内置 ADR-0027 全部硬约束断言(满格无洞/全边一格邻接/唯对角闭环边/
// 边不过城/锚点环距/最小间距),违反直接抛错(零兜底)。
// 运行:bun scripts/make-huanyou-map.ts(确定性输出,可随时重新生成)。

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMap } from "../src/core/board-loader";
import { MIN_TILE_DIST } from "../src/core/constants";
import type { MapData, MapTile } from "../src/core/board-loader";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = JSON.parse(readFileSync(resolve(root, "public/maps/huanyou.json"), "utf8")) as MapData;

// ── 网格参数(9×5 满格螺旋,ADR-0027)──
const COLS = 9,
  ROWS = 5;
const COL_STEP = 380,
  ROW_STEP = 320;
const gx = (c: number) => (c - (COLS - 1) / 2) * COL_STEP; // 列 0..8 → x -1520..1520(全域居中)
const gy = (r: number) => (r - (ROWS - 1) / 2) * ROW_STEP; // 行 0..4 → y -640..640

// ── 主环走位表:数组顺序 = 主环顺序(P0 蛇头长安 → P44 会稽收尾)──
// 表按**环序**排列(非按行);城池落位按地理带:边地环游于外环,中原逐鹿于腹地。
const RING: Array<{ id: string; c: number; r: number }> = [
  // 北境东行(r0 东段):两京并肩,出关并幽辽,北境互市
  { id: "prop-changan", c: 2, r: 0 }, // P0  长安:蛇头/都城锚
  { id: "prop-jinyang", c: 3, r: 0 }, // P1  晋阳
  { id: "prop-youzhou", c: 4, r: 0 }, // P2  幽州
  { id: "prop-liaodong", c: 5, r: 0 }, // P3  辽东
  { id: "prop-wan", c: 6, r: 0 }, // P4  宛城(珍宝城)
  { id: "prop-ye", c: 7, r: 0 }, // P5  邺城
  { id: "tile-stock-1", c: 8, r: 0 }, // P6  商市:北境互市
  // 东境南下(c8):青徐过税关入江东
  { id: "prop-xuzhou", c: 8, r: 1 }, // P7  徐州
  { id: "tile-tax-1", c: 8, r: 2 }, // P8  税关:南下江东设卡
  { id: "prop-jianye", c: 8, r: 3 }, // P9  建业
  { id: "prop-wujun", c: 8, r: 4 }, // P10 吴郡:东南角
  // 南境西行(r4):吴郡→岭南→巴蜀
  { id: "prop-changsha", c: 7, r: 4 }, // P11 长沙:都城锚
  { id: "prop-lingling", c: 6, r: 4 }, // P12 零陵
  { id: "prop-jiaozhou", c: 5, r: 4 }, // P13 交州
  { id: "prop-huarong", c: 4, r: 4 }, // P14 华容道(乘法城)
  { id: "tile-ferry-fuling", c: 3, r: 4 }, // P15 涪陵渡(渡口)
  { id: "prop-jiangzhou", c: 2, r: 4 }, // P16 江州
  { id: "prop-chengdu", c: 1, r: 4 }, // P17 成都(乘法城)
  { id: "prop-jiange", c: 0, r: 4 }, // P18 剑阁(乘法城):西南角
  // 西境北上(c0):剑阁→凉陇线,函谷关守洛阳西门
  { id: "prop-liangzhou", c: 0, r: 3 }, // P19 凉州
  { id: "prop-jieting", c: 0, r: 2 }, // P20 街亭(乘法城)
  { id: "prop-hangu", c: 0, r: 1 }, // P21 函谷关(珍宝城)
  { id: "prop-luoyang", c: 0, r: 0 }, // P22 洛阳:都城锚,西北角
  // 蜀道内环南下(c1):虎牢折入,咸阳-子午谷-汉中秦岭道
  { id: "prop-hulao", c: 1, r: 0 }, // P23 虎牢关(珍宝城):洛阳东门
  { id: "prop-xianyang", c: 1, r: 1 }, // P24 咸阳(珍宝城)
  { id: "prop-ziwu", c: 1, r: 2 }, // P25 子午谷
  { id: "prop-hanzhong", c: 1, r: 3 }, // P26 汉中
  // 荆楚东行(r3 中段):襄阳→江夏
  { id: "prop-xiangyang", c: 2, r: 3 }, // P27 襄阳
  { id: "prop-shangyong", c: 3, r: 3 }, // P28 上庸(珍宝城)
  { id: "prop-jiangling", c: 4, r: 3 }, // P29 江陵
  { id: "prop-chibi", c: 5, r: 3 }, // P30 赤壁
  { id: "prop-wuchang", c: 6, r: 3 }, // P31 武昌
  { id: "prop-jiangxia", c: 7, r: 3 }, // P32 江夏
  // 腹地盘旋收束:临淄折北,淮南双城,中原核心,新野/卧龙守荆襄北门
  { id: "prop-linzi", c: 7, r: 2 }, // P33 临淄:都城锚
  { id: "prop-xiapi", c: 7, r: 1 }, // P34 下邳(珍宝城):贴邻徐州
  { id: "prop-hefei", c: 6, r: 1 }, // P35 合肥(乘法城)
  { id: "prop-shouchun", c: 6, r: 2 }, // P36 寿春
  { id: "tile-fate-1", c: 5, r: 2 }, // P37 天命:中原逐鹿,天命所归
  { id: "prop-hongnong", c: 5, r: 1 }, // P38 弘农(珍宝城)
  { id: "prop-xuchang", c: 4, r: 1 }, // P39 许昌
  { id: "prop-yongzhou", c: 4, r: 2 }, // P40 雍州
  { id: "tile-chance-1", c: 3, r: 2 }, // P41 锦囊
  { id: "tile-ferry-xinye", c: 2, r: 2 }, // P42 新野驿站(渡口)
  { id: "tile-wolong", c: 2, r: 1 }, // P43 卧龙岗(招贤)
  { id: "prop-kuiji", c: 3, r: 1 }, // P44 会稽:蛇尾,对角闭环
];

// ── 四个自然都城锚点(环距均匀性断言用)──
const ANCHORS = ["prop-changan", "prop-changsha", "prop-luoyang", "prop-linzi"];

// ── 组装:按 RING 顺序从源图逐 tile 取数、只换 pos ──
const byId = new Map(src.tiles.map((t) => [t.id, t]));
const tiles: MapTile[] = RING.map(({ id, c, r }) => {
  const t = byId.get(id);
  if (!t) throw new Error(`huanyou.json 缺少 tile:${id}`);
  return { ...t, pos: [gx(c), gy(r)] };
});
// id 全集恰好用尽:多一格少一格都是走位表错
const used = new Set(RING.map((x) => x.id));
if (used.size !== RING.length) throw new Error("RING 存在重复 tile id");
for (const t of src.tiles)
  if (!used.has(t.id)) throw new Error(`走位表遗漏 tile:${t.id}(${t.name})`);
if (tiles.length !== COLS * ROWS)
  throw new Error(`主环 ${tiles.length} 格 ≠ ${COLS}×${ROWS} 满格(ADR-0027)`);

const out: MapData = {
  ...src,
  tiles,
};

const N = tiles.length;
const posOf = (i: number): [number, number] => [tiles[i].pos[0], tiles[i].pos[1]];
const idxOf = (id: string) => RING.findIndex((x) => x.id === id);
const ringDist = (a: number, b: number) => (((b - a) % N) + N) % N;

// ── 断言 1:满格无洞 —— 45 个格位恰好铺满 9×5,无一重复、无一遗漏 ──
const cells = new Set(RING.map(({ c, r }) => `${c},${r}`));
if (cells.size !== N) throw new Error("存在重复格位");
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++)
    if (!cells.has(`${c},${r}`)) throw new Error(`满格破洞:格位 (${c},${r}) 无人落位`);

// ── 断言 2:全边一格邻接,唯一例外 = 闭环对角边(ADR-0027 核心)──
// 45 奇格 ⇒ 纯正交闭环不存在(二部图奇偶性);闭环边 会稽⇗长安 是全图唯一对角边,
// 其余 44 条边全部是列距/行距的正交一格步——「凸出再折返」长边至此绝迹。
const CLOSE = "prop-kuiji>prop-changan";
let diagonals = 0;
for (let i = 0; i < N; i++) {
  const [x1, y1] = posOf(i);
  const [x2, y2] = posOf((i + 1) % N);
  const dx = Math.abs(x1 - x2),
    dy = Math.abs(y1 - y2);
  const edge = `${tiles[i].id}>${tiles[(i + 1) % N].id}`;
  const orthogonal = (dx === COL_STEP && dy === 0) || (dx === 0 && dy === ROW_STEP);
  const diagonal = dx === COL_STEP && dy === ROW_STEP;
  if (diagonal) {
    diagonals++;
    if (edge !== CLOSE) throw new Error(`${edge} 是对角边:唯一对角边必须是闭环边 ${CLOSE}`);
  } else if (!orthogonal)
    throw new Error(`${label(i)} → ${label((i + 1) % N)} 步距 (${dx},${dy}) 非一格邻接`);
}
if (diagonals !== 1) throw new Error(`对角边恰 1 条,实际 ${diagonals} 条`);
// 闭环边确实对角(首尾不同行不同列、同为对角邻位)
{
  const [x1, y1] = posOf(0);
  const [x2, y2] = posOf(N - 1);
  if (Math.abs(x1 - x2) !== COL_STEP || Math.abs(y1 - y2) !== ROW_STEP)
    throw new Error(`首尾 ${label(0)} ↔ ${label(N - 1)} 非对角邻位,闭环边不可读`);
}

// ── 断言 3:边不过城 —— 任何一条边线段不得贴过第三方格心(旧图 650 长边跨城之忌)──
const distToSeg = (p: [number, number], a: [number, number], b: [number, number]): number => {
  const vx = b[0] - a[0],
    vy = b[1] - a[1];
  const wx = p[0] - a[0],
    wy = p[1] - a[1];
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
};
for (let i = 0; i < N; i++) {
  const a = posOf(i),
    b = posOf((i + 1) % N);
  for (let j = 0; j < N; j++) {
    if (j === i || j === (i + 1) % N) continue;
    const d = distToSeg(posOf(j), a, b);
    if (d < MIN_TILE_DIST)
      throw new Error(
        `边 ${label(i)}→${label((i + 1) % N)} 距 ${label(j)} 格心仅 ${d.toFixed(0)} < ${MIN_TILE_DIST}`,
      );
  }
}

// ── 断言 4:都城锚点环距均匀(max − min ≤ 2)──
const anchorIdx = ANCHORS.map((id) => {
  const i = idxOf(id);
  if (i < 0) throw new Error(`锚点不在环上:${id}`);
  return i;
}).sort((a, b) => a - b);
const gaps = anchorIdx.map((a, i) => ringDist(a, anchorIdx[(i + 1) % anchorIdx.length]));
const spread = Math.max(...gaps) - Math.min(...gaps);
if (spread > 2) throw new Error(`都城锚点环距差 ${spread} > 2(环距 ${gaps.join("/")})`);

// ── 断言 5:主环全格最小间距 ≥ MIN_TILE_DIST ──
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
// 保持既有产物风格。
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
  desc: "9×5 满格螺旋环:先环边境一周再盘旋入中原,会稽与长安对角相邻、一格闭环边可见闭合",
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
  i <= 6
    ? "北境东行"
    : i <= 10
      ? "东境南下"
      : i <= 18
        ? "南境西行"
        : i <= 22
          ? "西境北上"
          : i <= 26
            ? "蜀道内环"
            : i <= 32
              ? "荆楚东行"
              : "腹地收束";
for (let i = 0; i < N; i++) {
  const { c, r } = RING[i];
  console.log(
    `P${String(i).padStart(2, " ")} ${tiles[i].name} (${c},${r}) [${kindOf(tiles[i])}] ${i === 0 ? "蛇头·" : ""}${zoneOf(i)}`,
  );
}
console.log(
  `\n都城锚点:${ANCHORS.map((id) => `${tiles[idxOf(id)].name}@P${idxOf(id)}`).join(" · ")} 环距 ${gaps.join("/")}(max−min=${spread})`,
);
console.log(`\n全环类型序列:\n${tiles.map(kindOf).join(" ")}`);
console.log("\n已写入 public/maps/huanyou.json 并前置 index.json 首项");

function label(i: number) {
  return `P${i} ${tiles[i].name}`;
}
function kindOf(t: MapTile): string {
  if ((t.type ?? "Property") !== "Property") return String(t.type);
  return (t.tradeAdd ?? []).length > 0 && t.tradeAdd!.every((v) => v === 0) ? "乘法城" : "加法城";
}
