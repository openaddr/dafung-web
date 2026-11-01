// 生成「关中图」内置地图(public/maps/guanzhong.json)——#938 28 城 4×7 满格螺旋。
//
// 背景与拍板(#938 拷问,2026-11-01):玩家侧反馈 844×390 总览下城池偏小、匾字难读。
// 两杠杆:①9×4=36 格缩域为 4×7=28 格——列数 9→7,fit 缩放系数自动 +29%(渲染层
// 无 hardcode,viewBox 按图包围盒推导);②城池相对格子放大 TILE_SCALE 2.2→2.6
// (Tile.tsx 单源,三图统一生效)。城名沿用环游图 36 城取 28 座(拍板:沿用子集,
// 不另起地名);关中图入库即设默认(index.json 首项),环游图降为可选。
//
// 主环 28 格 = 7×4 **满格**螺旋环(零空洞、步距全统一 380×320,与环游图同构):
// 长安 P0 踞顶中,先沿外环 17 格环游一周,再螺旋收入腹地 10 格,
// 洛阳 P27 在腹地收尾——与蛇头长安上下相邻,闭环边纯正交可见闭合。
// 28 为偶数,纯正交哈密顿闭环存在(二部图偶环):全图 28 条边全部一格正交步,
// 零对角边。
//
// 走法(见 RING 表):北境东行(晋幽辽→北境互市)→ 青徐(临淄→下邳)
// → 江东南下(吴郡→会稽)→ 岭南西行(泸水→长沙)
// → 巴蜀(成都→剑阁→汉中)→ 西凉北上(街亭→咸阳→凉州→函谷关)
// → 腹地盘旋(子午谷折入,襄阳→卧龙岗→赤壁→合肥→南徐)
// → 中原收束(受禅台→邺城→许昌→洛阳闭环)。
//
// 品类配比(#938 拍板:事件城 9→8,锦囊保 2):8 特殊(珍宝×3=辽东/下邳/函谷关 +
// 锦囊×2=泸水/南徐、名将=卧龙岗、声望=受禅台、商市=襄平)+ 20 普通;
// 八区盘子 a5/b3/c2/d4/e4/f4/g4/h2 = 28,无单城区(最小盘 c2/h2 恰为下限)。
// 城档(#938 拍板:36 城盘子 16/11/5/4 按 7/9 等比缩 12/9/4/3,数值见 TIERS 表)
//
// 退役 8 城(36→28):建业(名)/华容道(奇)/江州·徐州(郡)/交州(县·珍宝)/
// 武昌·零陵·江夏(县)——东南侧压缩,北境/巴蜀/西凉全须保留。
//
// 数据源:huanyou.json(**借名再生**)——城名查环游图同名 id;几何/环序/分组/事件/
// 经济全部由本脚本声明表(RING + SPECIAL + TIER_OF)确定性产出,逐城经济 = 城档
// 标准档(口径由 test/map-economy-guard.test.ts 锁定)。
//
// 本脚本内置全部硬约束断言(满格无洞/全边一格正交/零对角边/边不过城/锚点环距/
// 最小间距/品类配比/八区盘子/城档盘子),违反直接抛错(零兜底)。
// 运行:bun scripts/make-guanzhong-map.ts(确定性输出,可随时重新生成)。

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMap } from "../src/core/board-loader";
import { MIN_TILE_DIST } from "../src/core/constants";
import type { MapData, MapTile } from "../src/core/board-loader";
import type { CityTier } from "../src/core/economy";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = JSON.parse(readFileSync(resolve(root, "public/maps/huanyou.json"), "utf8")) as MapData;

// ── 网格参数(4×7 满格螺旋,#938;步距与环游图同值=城距不变、只减列)──
const COLS = 7,
  ROWS = 4;
const COL_STEP = 380,
  ROW_STEP = 320;
const gx = (c: number) => (c - (COLS - 1) / 2) * COL_STEP; // 列 0..6 → x -1140..1140(全域居中)
const gy = (r: number) => (r - (ROWS - 1) / 2) * ROW_STEP; // 行 0..3 → y -480..480(与环游图同值)

// ── 主环走位表:数组顺序 = 主环顺序(P0 蛇头长安 → P27 洛阳收尾)──
// group 一并声明。城名不在此表:查 huanyou.json 同名 id(byId),派生城见 DERIVED。
const RING: Array<{ id: string; c: number; r: number; group: string }> = [
  // 北境东行(r0 东段):出关并幽辽,北境互市(晋阳居首接长安)
  { id: "prop-changan", c: 2, r: 0, group: "a" }, // P0  长安:蛇头/出生位锚
  { id: "prop-jinyang", c: 3, r: 0, group: "f" }, // P1  晋阳
  { id: "prop-youzhou", c: 4, r: 0, group: "f" }, // P2  幽州
  { id: "prop-liaodong", c: 5, r: 0, group: "f" }, // P3  辽东(珍宝城:貂裘名马)
  { id: "prop-shangshi", c: 6, r: 0, group: "f" }, // P4  襄平:北境互市
  // 青徐(c6 南段):临淄→下邳(徐州退役)
  { id: "prop-linzi", c: 6, r: 1, group: "g" }, // P5  临淄
  { id: "prop-xiapi", c: 6, r: 2, group: "g" }, // P6  下邳(珍宝城)
  // 江东南下(c6 底→r3 西行):吴郡→会稽(建业退役)
  { id: "prop-wujun", c: 6, r: 3, group: "h" }, // P7  吴郡
  { id: "prop-kuiji", c: 5, r: 3, group: "h" }, // P8  会稽
  // 岭南西行(r3):泸水→长沙(零陵/交州退役)
  { id: "prop-jinnang-1", c: 4, r: 3, group: "c" }, // P9  泸水(南海商埠位)
  { id: "prop-changsha", c: 3, r: 3, group: "c" }, // P10 长沙
  // 巴蜀(r3 西段→c0 北上):成都→剑阁→汉中(江州退役)
  { id: "prop-chengdu", c: 2, r: 3, group: "d" }, // P11 成都
  { id: "prop-jiange", c: 1, r: 3, group: "d" }, // P12 剑阁:西南角
  { id: "prop-hanzhong", c: 0, r: 3, group: "d" }, // P13 汉中
  // 西凉北上(c0):街亭→咸阳→凉州→函谷关
  { id: "prop-jieting", c: 0, r: 2, group: "e" }, // P14 街亭:汉中北伐线上
  { id: "prop-xianyang", c: 0, r: 1, group: "e" }, // P15 咸阳
  { id: "prop-liangzhou", c: 0, r: 0, group: "e" }, // P16 凉州:西北角
  { id: "prop-hangu", c: 1, r: 0, group: "e" }, // P17 函谷关(珍宝城):顶缘东大门
  // 腹地盘旋:函谷关折入,荆楚东行(子午谷/襄阳/卧龙岗/赤壁;华容道退役)
  { id: "prop-ziwu", c: 1, r: 1, group: "d" }, // P18 子午谷:咸阳东南秦岭道
  { id: "prop-xiangyang", c: 1, r: 2, group: "b" }, // P19 襄阳:子午谷折入
  { id: "prop-wolong", c: 2, r: 2, group: "b" }, // P20 卧龙岗:躬耕南阳位
  { id: "prop-chibi", c: 3, r: 2, group: "b" }, // P21 赤壁
  // 淮南折北:合肥→南徐(江夏/武昌退役)
  { id: "prop-hefei", c: 4, r: 2, group: "g" }, // P22 合肥
  { id: "prop-jinnang-2", c: 5, r: 2, group: "g" }, // P23 南徐:三道锦囊招亲地
  // 中原收束:受禅台→邺城→许昌→洛阳闭环
  { id: "prop-tianming", c: 5, r: 1, group: "a" }, // P24 受禅台:中原逐鹿
  { id: "prop-ye", c: 4, r: 1, group: "a" }, // P25 邺城
  { id: "prop-xuchang", c: 3, r: 1, group: "a" }, // P26 许昌
  { id: "prop-luoyang", c: 2, r: 1, group: "a" }, // P27 洛阳:蛇尾,与长安相邻闭环
];

// ── 四向锚点(环距均匀性自检;引擎选都候选全员可选,不读此表)──
const ANCHORS = ["prop-changan", "prop-wujun", "prop-jieting", "prop-chibi"];

// ── 特殊城池 event 表(#823 五类;锦囊保 2(#938),珍宝 4→3;其余城一律无 event)──
const SPECIAL: Record<string, string> = {
  "prop-liaodong": "treasure",
  "prop-xiapi": "treasure",
  "prop-hangu": "treasure",
  "prop-jinnang-1": "jinnang",
  "prop-jinnang-2": "jinnang",
  "prop-wolong": "hero",
  "prop-tianming": "fate",
  "prop-shangshi": "market",
};

// ── 逐城城档(#938 拍板盘子:名3/奇4/郡9/县12;tier 显式入 JSON,ADR-0042)──
const TIER_OF: Record<string, CityTier> = {
  // 名城(汉室西京 + 巴蜀·中原都城;建业退役)
  "prop-changan": "名",
  "prop-luoyang": "名",
  "prop-chengdu": "名",
  // 奇城(华容道退役)
  "prop-jieting": "奇",
  "prop-ziwu": "奇",
  "prop-hefei": "奇",
  "prop-chibi": "奇",
  // 郡城(江州/徐州退役)
  "prop-wujun": "郡",
  "prop-kuiji": "郡",
  "prop-xianyang": "郡",
  "prop-xiangyang": "郡",
  "prop-xuchang": "郡",
  "prop-ye": "郡",
  "prop-hanzhong": "郡",
  "prop-xiapi": "郡",
  "prop-liangzhou": "郡",
  // 县城(交州/武昌/零陵/江夏退役)
  "prop-jiange": "县",
  "prop-jinyang": "县",
  "prop-linzi": "县",
  "prop-youzhou": "县",
  "prop-changsha": "县",
  "prop-hangu": "县",
  "prop-liaodong": "县",
  "prop-shangshi": "县",
  "prop-jinnang-1": "县",
  "prop-jinnang-2": "县",
  "prop-wolong": "县",
  "prop-tianming": "县",
};

// ── 专名改定(三国典故,拷问拍板;环游图同名五座不在本批)──
const DERIVED: Record<string, { name: string }> = {
  "prop-shangshi": { name: "襄平" }, // 公孙氏辽东郡治,胡汉互市、名马貂皮集散
  "prop-jinnang-1": { name: "泸水" }, // 五月渡泸,攻心为上——南征锦囊策
  "prop-jinnang-2": { name: "南徐" }, // 三道锦囊护主南徐招亲(演义 55 回)——锦囊妙计正典地
  "prop-wolong": { name: "卧龙岗" }, // 卧龙躬耕三顾出山;紧邻襄阳=躬耕地之争彩蛋
  "prop-tianming": { name: "受禅台" }, // 曹丕受禅代汉天命更易,故地近许昌
};

// ── 随 #938 退役的环游图城 id(36→28 = 退役 8)──
const DROPPED = [
  "prop-jianye", // 建业(名)
  "prop-huarong", // 华容道(奇)
  "prop-jiangzhou", // 江州(郡)
  "prop-xuzhou", // 徐州(郡)
  "prop-jiaozhou", // 交州(县·珍宝城退役:珍宝 4→3)
  "prop-wuchang", // 武昌(县)
  "prop-lingling", // 零陵(县)
  "prop-jiangxia", // 江夏(县)
];

// ── 城档标准档(与环游图/中原图同表统一;ADR-0041 单表,口径由守卫测试锁定)──
const TIERS: Record<
  CityTier,
  {
    price: number;
    buildCost: number;
    tradeMult: number[];
    tradeAdd: number[];
    valueByLevel: number[];
  }
> = {
  县: {
    price: 1800,
    buildCost: 900,
    tradeMult: [1, 1, 1, 1],
    tradeAdd: [100, 200, 400, 800],
    valueByLevel: [1080, 1620, 2160, 2700],
  },
  郡: {
    price: 3000,
    buildCost: 1500,
    tradeMult: [1, 1, 1, 1],
    tradeAdd: [200, 400, 800, 1600],
    valueByLevel: [1800, 2700, 3600, 4500],
  },
  奇: {
    price: 3000,
    buildCost: 1500,
    tradeMult: [2, 3, 4, 7],
    tradeAdd: [0, 0, 0, 0],
    valueByLevel: [1800, 2700, 3600, 4500],
  },
  名: {
    price: 4800,
    buildCost: 2400,
    tradeMult: [2, 3, 4, 5],
    tradeAdd: [200, 400, 600, 1200],
    valueByLevel: [2880, 4320, 5760, 7200],
  },
};

// ── 组装:按 RING 顺序确定性产出(城名/几何/分组/事件/经济全走声明表)──
const byId = new Map(src.tiles.map((t) => [t.id, t]));
const tiles: MapTile[] = RING.map(({ id, c, r, group }) => {
  const derived = DERIVED[id];
  const name = derived ? derived.name : byId.get(id)?.name;
  if (!name) throw new Error(`huanyou.json 缺少 tile 且非派生城:${id}`);
  const tier = TIER_OF[id];
  if (!tier) throw new Error(`城档表缺城:${id}`);
  const std = TIERS[tier];
  // event 键置尾:键序恒定,幂等重跑字节相同
  const base = {
    id,
    name,
    pos: [gx(c), gy(r)],
    group,
    tier, // ADR-0042:城池档位随声明表显式入 JSON
    price: std.price,
    buildCost: std.buildCost,
    tradeMult: [...std.tradeMult],
    valueByLevel: [...std.valueByLevel],
    tradeAdd: [...std.tradeAdd],
  };
  const special = SPECIAL[id];
  return special ? { ...base, event: special } : base;
});
// id 全集恰好用尽:多一格少一格都是走位表错;退役城只许是声明过的名单
const used = new Set(RING.map((x) => x.id));
if (used.size !== RING.length) throw new Error("RING 存在重复 tile id");
const retired = src.tiles.filter((t) => !used.has(t.id)).map((t) => t.id);
for (const id of retired)
  if (!DROPPED.includes(id)) throw new Error(`走位表遗漏 tile:${id}(不在 #938 退役名单)`);
if (tiles.length !== COLS * ROWS)
  throw new Error(`主环 ${tiles.length} 格 ≠ ${COLS}×${ROWS} 满格(#938)`);

const out: MapData = {
  ...src,
  tiles,
};

const N = tiles.length;
const posOf = (i: number): [number, number] => [tiles[i].pos[0], tiles[i].pos[1]];
const idxOf = (id: string) => RING.findIndex((x) => x.id === id);
const ringDist = (a: number, b: number) => (((b - a) % N) + N) % N;

// ── 断言 1:满格无洞 —— 28 个格位恰好铺满 7×4,无一重复、无一遗漏 ──
const cells = new Set(RING.map(({ c, r }) => `${c},${r}`));
if (cells.size !== N) throw new Error("存在重复格位");
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++)
    if (!cells.has(`${c},${r}`)) throw new Error(`满格破洞:格位 (${c},${r}) 无人落位`);

// ── 断言 2:全边一格正交,零对角边(#938:28 偶格,纯正交闭环存在)──
for (let i = 0; i < N; i++) {
  const [x1, y1] = posOf(i);
  const [x2, y2] = posOf((i + 1) % N);
  const dx = Math.abs(x1 - x2),
    dy = Math.abs(y1 - y2);
  const orthogonal = (dx === COL_STEP && dy === 0) || (dx === 0 && dy === ROW_STEP);
  if (!orthogonal)
    throw new Error(
      `${label(i)} → ${label((i + 1) % N)} 步距 (${dx},${dy}) 非一格正交(对角/长边均不允许)`,
    );
}
// 闭环边:蛇尾洛阳与蛇头长安上下相邻,纯正交可见闭合
{
  const [x1, y1] = posOf(0);
  const [x2, y2] = posOf(N - 1);
  const dx = Math.abs(x1 - x2),
    dy = Math.abs(y1 - y2);
  const orthogonal = (dx === COL_STEP && dy === 0) || (dx === 0 && dy === ROW_STEP);
  if (!orthogonal)
    throw new Error(`首尾 ${label(0)} ↔ ${label(N - 1)} 非一格正交邻位,闭环边不可读`);
}

// ── 断言 3:边不过城 —— 任何一条边线段不得贴过第三方格心 ──
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

// ── 断言 4:四向锚点环距均匀(max − min ≤ 2)──
const anchorIdx = ANCHORS.map((id) => {
  const i = idxOf(id);
  if (i < 0) throw new Error(`锚点不在环上:${id}`);
  return i;
}).sort((a, b) => a - b);
const gaps = anchorIdx.map((a, i) => ringDist(a, anchorIdx[(i + 1) % anchorIdx.length]));
const spread = Math.max(...gaps) - Math.min(...gaps);
if (spread > 2) throw new Error(`锚点环距差 ${spread} > 2(环距 ${gaps.join("/")})`);

// ── 断言 5:主环全格最小间距 ≥ MIN_TILE_DIST ──
const allPts = tiles.map((t) => t.pos);
for (let i = 0; i < allPts.length; i++)
  for (let j = i + 1; j < allPts.length; j++) {
    const d = Math.hypot(allPts[i][0] - allPts[j][0], allPts[i][1] - allPts[j][1]);
    if (d < MIN_TILE_DIST) throw new Error(`格 ${i}/${j} 距离 ${d.toFixed(0)} < ${MIN_TILE_DIST}`);
  }

// ── 断言 6:品类与盘子(#938 拍板;逐城城档数值由守卫测试锁定)──
// 六类特殊城计数(珍宝 4→3,锦囊保 2)
const eventCount: Record<string, number> = {};
for (const t of tiles) if (t.event) eventCount[t.event] = (eventCount[t.event] ?? 0) + 1;
expectEqual(eventCount, { treasure: 3, jinnang: 2, hero: 1, fate: 1, market: 1 }, "特殊城配比");
// 八区城数盘子(#938:28 城八区压缩,无单城区)
const groupCount: Record<string, number> = {};
for (const { group } of RING) groupCount[group] = (groupCount[group] ?? 0) + 1;
expectEqual(groupCount, { a: 5, b: 3, c: 2, d: 4, e: 4, f: 4, g: 4, h: 2 }, "八区城数盘子");
// 城档盘子(#938:16/11/5/4 按 7/9 等比缩)
const tierCount: Record<CityTier, number> = { 县: 0, 郡: 0, 奇: 0, 名: 0 };
for (const t of tiles) tierCount[t.tier] += 1;
expectEqual(tierCount, { 县: 12, 郡: 9, 奇: 4, 名: 3 }, "城档盘子");

// ── loadMap 严格校验(与运行时同一代码路径)──
const loaded = loadMap(JSON.parse(JSON.stringify(out)));
const propCount = loaded.properties.length;
if (propCount !== N) throw new Error(`城池数 ${propCount} ≠ 格数 ${N}(全城池制)`);
console.log(`loadMap 校验通过:${loaded.tiles.length} 格 / ${propCount} 座城`);

// ── 写 guanzhong.json ──
// oxfmt 按项目配置忽略 public/**,纯数字数组(JSON.stringify 会逐项换行)手动收紧凑,
// 与环游图产物同风格。
const compactJson = (s: string) =>
  s.replace(
    /\[\s+(-?\d+(?:,\s+-?\d+)*)\s+\]/g,
    (_m, inner: string) => `[${inner.replace(/\s+/g, " ")}]`,
  );
writeFileSync(
  resolve(root, "public/maps/guanzhong.json"),
  compactJson(JSON.stringify(out, null, 2)) + "\n",
);

// ── index.json 前置条目(幂等:已存在则原位更新,新则插首项成默认图,#938 拍板)──
const idxPath = resolve(root, "public/maps/index.json");
const index = JSON.parse(readFileSync(idxPath, "utf8")) as Array<Record<string, unknown>>;
const entry = {
  id: "guanzhong",
  name: "关中图",
  file: "guanzhong.json",
  desc: "4×7 满格螺旋小盘:28 城缩域快局,城距疏朗城池更大,长安洛阳相邻闭环、全环纯正交零对角",
  // tileCount 口径 = 城池数(与既有条目/选图面板「N 城」一致),非格数
  tileCount: propCount,
  targetNetWorth: src.targetNetWorth,
};
const at = index.findIndex((e) => e.id === "guanzhong");
if (at >= 0) index[at] = entry;
else index.unshift(entry);
writeFileSync(idxPath, JSON.stringify(index, null, 2) + "\n");

// ── 报告:分配表 + 锚点环距 + 类型序列 ──
console.log("\n主环分配表(P# 城名 格位):");
const zoneOf = (i: number) =>
  i <= 4
    ? "北境东行"
    : i <= 6
      ? "青徐"
      : i <= 8
        ? "江东南下"
        : i <= 10
          ? "岭南西行"
          : i <= 13
            ? "巴蜀"
            : i <= 17
              ? "西凉北上"
              : i <= 23
                ? "腹地盘旋"
                : "中原收束";
for (let i = 0; i < N; i++) {
  const { c, r } = RING[i];
  console.log(
    `P${String(i).padStart(2, " ")} ${tiles[i].name} (${c},${r}) [${kindOf(tiles[i])}] ${i === 0 ? "蛇头·" : ""}${zoneOf(i)}`,
  );
}
console.log(
  `\n四向锚点:${ANCHORS.map((id) => `${tiles[idxOf(id)].name}@P${idxOf(id)}`).join(" · ")} 环距 ${gaps.join("/")}(max−min=${spread})`,
);
console.log(`\n全环类型序列:\n${tiles.map(kindOf).join(" ")}`);
console.log("\n已写入 public/maps/guanzhong.json 并更新 index.json 首项");

function label(i: number) {
  return `P${i} ${tiles[i].name}`;
}
function kindOf(t: MapTile): string {
  if (t.event) return String(t.event);
  return t.tradeAdd.every((v) => v === 0) ? "乘法城" : "加法城";
}
function expectEqual(got: unknown, want: unknown, what: string): void {
  const norm = (v: unknown) => JSON.stringify(v, Object.keys(v as object).sort());
  if (norm(got) !== norm(want))
    throw new Error(`${what}不符:got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
