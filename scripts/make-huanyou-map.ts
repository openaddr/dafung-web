// 生成「环游图」内置地图(public/maps/huanyou.json)——#827 36 城 9×4 满格螺旋重排。
//
// 主环 36 格 = 9×4 **满格**螺旋环(零凸出列、零空洞、步距全统一 380×320):
// 长安 P0 踞北境,先沿外环 21 格环游边境一周,再螺旋收入中原腹地,
// 洛阳 P35 在腹地收尾——与蛇头长安上下相邻,闭环边纯正交可见闭合。
// 36 为偶数,纯正交哈密顿闭环存在(二部图偶环):全图 36 条边全部一格正交步,
// 零对角边(旧 9×5 的 45 奇格对角闭环边随 #827 退役)。
//
// 走法(见 RING 表):北境东行(两京→并幽辽→北境互市)→ 青徐(临淄→下邳)
// → 江东南下(吴郡→建业→会稽)→ 岭南西行(锦囊城→长沙→零陵→交州)
// → 巴蜀(江州→成都→剑阁→汉中)→ 西凉北上(街亭→凉州→咸阳→函谷关)
// → 腹地盘旋(子午谷折入,襄阳→卧龙城→华容道→赤壁→江夏→武昌)
// → 淮南折北(合肥→锦囊城)→ 中原收束(天命城→邺城→许昌→洛阳闭环)。
//
// 品类配比(#823 拍板):9 特殊(珍宝×4=辽东/下邳/交州/函谷关 + 锦囊城×2 +
// 卧龙城 + 天命城 + 商市城)+ 27 普通;八区 a–h 各 4–5 城
// (中原5/荆楚5/岭南4/巴蜀5/西凉4/幽燕4/青徐5/江东4),无单城区。
// 城档(#827 第二棒再平衡定档:名4/奇5/郡11/县16,数值见 TIERS 表头注)
//
// 数据源:huanyou.json 自身(**自再生**)——几何/环序/分组/事件/经济全部由本脚本
// 的声明表(RING + SPECIAL + TIER_OF)确定性产出,逐城经济 = 城档标准档
// (生成器是地图经济的唯一写入方;口径由 test/map-economy-guard.test.ts 锁定,
// 手改地图数值重跑即归位、守卫测试在测试期抓漂移)。
//
// 本脚本内置全部硬约束断言(满格无洞/全边一格正交/零对角边/边不过城/
// 锚点环距/最小间距/品类配比/八区盘子/城档盘子),违反直接抛错(零兜底)。
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

// ── 网格参数(9×4 满格螺旋,#827)──
const COLS = 9,
  ROWS = 4;
const COL_STEP = 380,
  ROW_STEP = 320;
const gx = (c: number) => (c - (COLS - 1) / 2) * COL_STEP; // 列 0..8 → x -1520..1520(全域居中)
const gy = (r: number) => (r - (ROWS - 1) / 2) * ROW_STEP; // 行 0..3 → y -480..480(同比收窄)

// ── 主环走位表:数组顺序 = 主环顺序(P0 蛇头长安 → P35 洛阳收尾)──
// group 一并声明(八区带状分布随走位表走)。region 字段已随 #828 区域单源化退役:区名唯一源 = groupNames。
const RING: Array<{ id: string; c: number; r: number; group: string }> = [
  // 北境东行(r0 东段):两京并肩,出关并幽辽,北境互市
  { id: "prop-changan", c: 2, r: 0, group: "a" }, // P0  长安:蛇头/出生位锚
  { id: "prop-jinyang", c: 3, r: 0, group: "f" }, // P1  晋阳
  { id: "prop-youzhou", c: 4, r: 0, group: "f" }, // P2  幽州
  { id: "prop-liaodong", c: 5, r: 0, group: "f" }, // P3  辽东(珍宝城:貂裘名马)
  { id: "prop-shangshi", c: 6, r: 0, group: "f" }, // P4  商市城:北境互市
  // 青徐(P5-P7):临淄→徐州→下邳
  { id: "prop-linzi", c: 7, r: 0, group: "g" }, // P5  临淄
  { id: "prop-xuzhou", c: 8, r: 0, group: "g" }, // P6  徐州
  { id: "prop-xiapi", c: 8, r: 1, group: "g" }, // P7  下邳(珍宝城)
  // 江东南下(c8):吴郡→建业→会稽
  { id: "prop-wujun", c: 8, r: 2, group: "h" }, // P8  吴郡
  { id: "prop-jianye", c: 8, r: 3, group: "h" }, // P9  建业:东南角
  { id: "prop-kuiji", c: 7, r: 3, group: "h" }, // P10 会稽
  // 岭南西行(r3):锦囊城→长沙→零陵→交州
  { id: "prop-jinnang-1", c: 6, r: 3, group: "c" }, // P11 锦囊城(南海商埠位)
  { id: "prop-changsha", c: 5, r: 3, group: "c" }, // P12 长沙
  { id: "prop-lingling", c: 4, r: 3, group: "c" }, // P13 零陵
  { id: "prop-jiaozhou", c: 3, r: 3, group: "c" }, // P14 交州(珍宝城:合浦珠还)
  // 巴蜀(P15-P18):江州→成都→剑阁→汉中
  { id: "prop-jiangzhou", c: 2, r: 3, group: "d" }, // P15 江州
  { id: "prop-chengdu", c: 1, r: 3, group: "d" }, // P16 成都
  { id: "prop-jiange", c: 0, r: 3, group: "d" }, // P17 剑阁:西南角
  { id: "prop-hanzhong", c: 0, r: 2, group: "d" }, // P18 汉中
  // 西凉北上(c0):街亭→凉州→咸阳→函谷关
  { id: "prop-jieting", c: 0, r: 1, group: "e" }, // P19 街亭:汉中北伐线上
  { id: "prop-liangzhou", c: 0, r: 0, group: "e" }, // P20 凉州:西北角
  { id: "prop-xianyang", c: 1, r: 0, group: "e" }, // P21 咸阳
  { id: "prop-hangu", c: 1, r: 1, group: "e" }, // P22 函谷关(珍宝城):贴邻洛阳
  // 腹地盘旋:子午谷折入,荆楚东行
  { id: "prop-ziwu", c: 1, r: 2, group: "d" }, // P23 子午谷:汉中东侧秦岭道
  { id: "prop-xiangyang", c: 2, r: 2, group: "b" }, // P24 襄阳
  { id: "prop-wolong", c: 3, r: 2, group: "b" }, // P25 卧龙城:躬耕南阳位
  { id: "prop-huarong", c: 4, r: 2, group: "b" }, // P26 华容道
  { id: "prop-chibi", c: 5, r: 2, group: "b" }, // P27 赤壁
  { id: "prop-jiangxia", c: 6, r: 2, group: "b" }, // P28 江夏:贴邻武昌
  // 江东收边 + 淮南折北:武昌→合肥→锦囊城
  { id: "prop-wuchang", c: 7, r: 2, group: "h" }, // P29 武昌:孙吴故都
  { id: "prop-hefei", c: 7, r: 1, group: "g" }, // P30 合肥
  { id: "prop-jinnang-2", c: 6, r: 1, group: "g" }, // P31 锦囊城:圯上授书地望
  // 中原收束:天命城→邺城→许昌→洛阳闭环
  { id: "prop-tianming", c: 5, r: 1, group: "a" }, // P32 天命城:中原逐鹿
  { id: "prop-ye", c: 4, r: 1, group: "a" }, // P33 邺城
  { id: "prop-xuchang", c: 3, r: 1, group: "a" }, // P34 许昌
  { id: "prop-luoyang", c: 2, r: 1, group: "a" }, // P35 洛阳:蛇尾,与长安相邻闭环
];

// ── 四向锚点(环距均匀性自检;引擎选都候选全员可选,不读此表)──
const ANCHORS = ["prop-changan", "prop-jianye", "prop-hanzhong", "prop-chibi"];

// ── 特殊城池 event 表(#823 五类;其余城一律无 event = 普通城机遇必出)──
const SPECIAL: Record<string, string> = {
  "prop-liaodong": "treasure",
  "prop-xiapi": "treasure",
  "prop-jiaozhou": "treasure",
  "prop-hangu": "treasure",
  "prop-jinnang-1": "jinnang",
  "prop-jinnang-2": "jinnang",
  "prop-wolong": "hero",
  "prop-tianming": "fate",
  "prop-shangshi": "market",
};

// ── 逐城城档(#827 过渡档盘子:名4/奇5/郡11/县16;口径与守卫测试一致)──
const TIER_OF: Record<string, keyof typeof TIERS> = {
  // 名城(魏蜀吴都城 + 汉室西京)
  "prop-changan": "名城",
  "prop-luoyang": "名城",
  "prop-chengdu": "名城",
  "prop-jianye": "名城",
  // 奇城
  "prop-jieting": "奇城",
  "prop-ziwu": "奇城",
  "prop-huarong": "奇城",
  "prop-hefei": "奇城",
  "prop-chibi": "奇城",
  // 郡城(旧 12 城去虎牢关/江陵/弘农,升凉州[州治]/江州[巴郡治])
  "prop-wujun": "郡城",
  "prop-xianyang": "郡城",
  "prop-xiangyang": "郡城",
  "prop-xuchang": "郡城",
  "prop-kuiji": "郡城",
  "prop-ye": "郡城",
  "prop-xuzhou": "郡城",
  "prop-hanzhong": "郡城",
  "prop-xiapi": "郡城",
  "prop-liangzhou": "郡城",
  "prop-jiangzhou": "郡城",
  // 县城(11 座实名 + 5 座派生名城)
  "prop-jiange": "县城",
  "prop-jinyang": "县城",
  "prop-wuchang": "县城",
  "prop-linzi": "县城",
  "prop-jiangxia": "县城",
  "prop-youzhou": "县城",
  "prop-changsha": "县城",
  "prop-hangu": "县城",
  "prop-liaodong": "县城",
  "prop-lingling": "县城",
  "prop-jiaozhou": "县城",
  "prop-shangshi": "县城",
  "prop-jinnang-1": "县城",
  "prop-jinnang-2": "县城",
  "prop-wolong": "县城",
  "prop-tianming": "县城",
};

// ── 派生名新城(#827 城名派生自固定事件,现役 38 城名之外)──
const DERIVED: Record<string, { name: string }> = {
  "prop-shangshi": { name: "商市城" },
  "prop-jinnang-1": { name: "锦囊城" },
  "prop-jinnang-2": { name: "锦囊城" },
  "prop-wolong": { name: "卧龙城" },
  "prop-tianming": { name: "天命城" },
};

// ── 随 #827 退役的现役城 id(45→36 = 退役 14 + 派生新城 5)──
// 七座 #826 转城旧格:商市/天命/锦囊/卧龙岗由派生名城正典承载,税关机制不放,
// 涪陵渡/新野驿站并入锦囊城×2
const DROPPED = [
  "tile-stock-1", // 商市 → prop-shangshi 商市城
  "tile-tax-1", // 税关 → 机制退役(#823 拍板:新图不放)
  "tile-ferry-fuling", // 涪陵渡 → 锦囊城×2
  "tile-fate-1", // 天命 → prop-tianming 天命城
  "tile-chance-1", // 锦囊 → 锦囊城×2
  "tile-ferry-xinye", // 新野驿站 → 锦囊城×2
  "tile-wolong", // 卧龙岗 → prop-wolong 卧龙城
  // 七座现役实名城(城名退役,id 不再存在)
  "prop-wan", // 宛城
  "prop-hulao", // 虎牢关
  "prop-shangyong", // 上庸
  "prop-hongnong", // 弘农
  "prop-jiangling", // 江陵
  "prop-yongzhou", // 雍州
  "prop-shouchun", // 寿春
];

// ── 城档标准档(#827 第二棒再平衡,仅环游图;中原图仍守 ADR-0034 v3 原表)──
// 口径(模拟器 300 局×2 档实锤,tmp/sim-balance.ts 校准,45 格参照图对账 ADR-0034
// ±20% 漂移判据):圈长 45→36 后补给/委任状/事件吞吐 +25%,局长中位漂移 −39%(4 人)/
// −31%(8 人),超容差。回补两路:
// ①价格 ×1.5(圈长比 45/36=1.25 × 冻结节拍残差 1.2):城池购置是系统唯一真水槽
//   (租值是玩家间转移,调档实测局长零响应),价格抬升直接回补每圈水槽;
//   变卖价保持购价 ×[60%,90%,120%,150%]、建城费保持购价 50%(购价百两速记 27/45/72)。
// ②奇城 Lv2 倍率 5→4:双奇城租值移交项实锤——大单(≥10000)78% 出在奇城(其余名城),
//   驯化 Lv2 段后大单局均 −27%,满级 ×7(青囊书 600 分水岭同售 4200 与斩杀线 21000
//   两条文档口径全保,乘法纯度与「满级高于名城」不变)。
const TIERS = {
  县城: {
    price: 2700,
    buildCost: 1350,
    tradeMult: [1, 1, 1, 1],
    tradeAdd: [100, 200, 400, 800],
    valueByLevel: [1620, 2430, 3240, 4050],
  },
  郡城: {
    price: 4500,
    buildCost: 2250,
    tradeMult: [1, 1, 1, 1],
    tradeAdd: [200, 400, 800, 1600],
    valueByLevel: [2700, 4050, 5400, 6750],
  },
  奇城: {
    price: 4500,
    buildCost: 2250,
    tradeMult: [2, 3, 4, 7],
    tradeAdd: [0, 0, 0, 0],
    valueByLevel: [2700, 4050, 5400, 6750],
  },
  名城: {
    price: 7200,
    buildCost: 3600,
    tradeMult: [2, 3, 4, 5],
    tradeAdd: [200, 400, 600, 1200],
    valueByLevel: [4320, 6480, 8640, 10800],
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
  if (!DROPPED.includes(id)) throw new Error(`走位表遗漏 tile:${id}(不在 #827 退役名单)`);
if (tiles.length !== COLS * ROWS)
  throw new Error(`主环 ${tiles.length} 格 ≠ ${COLS}×${ROWS} 满格(#827)`);

const out: MapData = {
  ...src,
  tiles,
};

const N = tiles.length;
const posOf = (i: number): [number, number] => [tiles[i].pos[0], tiles[i].pos[1]];
const idxOf = (id: string) => RING.findIndex((x) => x.id === id);
const ringDist = (a: number, b: number) => (((b - a) % N) + N) % N;

// ── 断言 1:满格无洞 —— 36 个格位恰好铺满 9×4,无一重复、无一遗漏 ──
const cells = new Set(RING.map(({ c, r }) => `${c},${r}`));
if (cells.size !== N) throw new Error("存在重复格位");
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++)
    if (!cells.has(`${c},${r}`)) throw new Error(`满格破洞:格位 (${c},${r}) 无人落位`);

// ── 断言 2:全边一格正交,零对角边(#827:36 偶格,纯正交闭环存在)──
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

// ── 断言 6:品类与盘子(#823 拍板;逐城城档数值由守卫测试锁定)──
// 六类特殊城计数
const eventCount: Record<string, number> = {};
for (const t of tiles) if (t.event) eventCount[t.event] = (eventCount[t.event] ?? 0) + 1;
expectEqual(eventCount, { treasure: 4, jinnang: 2, hero: 1, fate: 1, market: 1 }, "特殊城配比");
// 八区各 4–5 城无单城区 + 拍板盘子(中原5/荆楚5/岭南4/巴蜀5/西凉4/幽燕4/青徐5/江东4)
const groupCount: Record<string, number> = {};
for (const { group } of RING) groupCount[group] = (groupCount[group] ?? 0) + 1;
expectEqual(groupCount, { a: 5, b: 5, c: 4, d: 5, e: 4, f: 4, g: 5, h: 4 }, "八区城数盘子");

// ── loadMap 严格校验(与运行时同一代码路径)──
const loaded = loadMap(JSON.parse(JSON.stringify(out)));
const propCount = loaded.properties.length;
if (propCount !== N) throw new Error(`城池数 ${propCount} ≠ 格数 ${N}(全城池制)`);
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
  desc: "9×4 满格螺旋环:先环边境一周再盘旋入中原,洛阳与长安相邻闭环、全环纯正交零对角",
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
  i <= 4
    ? "北境东行"
    : i <= 7
      ? "青徐"
      : i <= 10
        ? "江东南下"
        : i <= 14
          ? "岭南西行"
          : i <= 18
            ? "巴蜀"
            : i <= 22
              ? "西凉北上"
              : i <= 29
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
console.log("\n已写入 public/maps/huanyou.json 并更新 index.json 首项");

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
