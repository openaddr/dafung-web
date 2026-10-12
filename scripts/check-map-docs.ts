// 地图数值的文档对账门禁(#480 收官 retro):改地图(删辅路/+宝物城/移除整图)
// 后,docs 里残留的「N 格 / N 城」旧数值是历史性漏网——code-review 抓过一次
// (rules/03「42 格 30 城」、GLOSSARY「主环 42 格」),本检查把它机器化。
//
// 规则:
// 1. index.json 每张图的 tileCount 必须等于实际城池数(Property/TreasureCity)。
// 2. GLOSSARY.md 与 docs/reference/rules/*.md 中出现的「N 格」「N 城」数值
//    (两位数以上,过滤「一格」类噪声)必须与某张现存地图的实际值一致——
//    改了图没改文档,这里红。
// 口径:index.json 的 tileCount = 城池数(#476 起,宝物城并入城池)。
// 已知局限:一位数(如中原图「8 城」)不在扫描范围;新地图加位数后此处同步。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const index = JSON.parse(readFileSync(join(root, "public/maps/index.json"), "utf8")) as {
  id: string;
  file: string;
  tileCount: number;
  desc: string;
}[];

const errors: string[] = [];
const actualGrids = new Set<number>();
const actualCities = new Set<number>();

for (const entry of index) {
  const data = JSON.parse(readFileSync(join(root, "public/maps", entry.file), "utf8")) as {
    tiles: { type?: string }[];
  };
  const grid = data.tiles.length;
  const cities = data.tiles.filter(
    (t) => !t.type || t.type === "Property" || t.type === "TreasureCity",
  ).length;
  actualGrids.add(grid);
  actualCities.add(cities);
  if (entry.tileCount !== cities) {
    errors.push(
      `index.json「${entry.id}」tileCount=${entry.tileCount} ≠ 实际城池数 ${cities}(共 ${grid} 格)`,
    );
  }
}

const scan = (file: string, text: string) => {
  for (const m of text.matchAll(/(\d{2,})\s*(格|城)/g)) {
    const n = Number(m[1]);
    if (!actualGrids.has(n) && !actualCities.has(n)) {
      errors.push(
        `${file}:「${m[0]}」与现存地图的实际格数/城数(#[${[...actualGrids]}] 格 / #[${[...actualCities]}] 城)对不上`,
      );
    }
  }
};

scan("GLOSSARY.md", readFileSync(join(root, "GLOSSARY.md"), "utf8"));
const rulesDir = join(root, "docs/reference/rules");
for (const f of readdirSync(rulesDir)) {
  if (f.endsWith(".md")) scan(`docs/reference/rules/${f}`, readFileSync(join(rulesDir, f), "utf8"));
}

if (errors.length > 0) {
  console.error("[map-docs] 地图数值对账失败:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`[map-docs] OK:${index.length} 张图 tileCount/城池数一致,docs 数值无残留旧值。`);
