// 校验地图清单的派生字段，以及现行规则文档所引用的地图格数。
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadMap } from "@dafung/core/engine/board-loader";
import { readPackagedMaps } from "./packaged-maps";

const root = resolve(import.meta.dir, "..");
const mapsDir = join(root, "packages/core/maps");
const { catalog } = readPackagedMaps(mapsDir);
const errors: string[] = [];
const mapSizes = new Set<number>();

for (const entry of catalog) {
  const map = loadMap(JSON.parse(readFileSync(join(mapsDir, entry.file), "utf8")));
  mapSizes.add(map.tiles.length);
  if (entry.tileCount !== map.tiles.length) {
    errors.push(`地图「${entry.id}」清单 tileCount=${entry.tileCount}，实际为 ${map.tiles.length}`);
  }
  if (entry.targetNetWorth !== map.targetNetWorth) {
    errors.push(
      `地图「${entry.id}」清单 targetNetWorth=${entry.targetNetWorth}，图内为 ${map.targetNetWorth}`,
    );
  }
}

const rulesDir = "docs/reference/rules";
const docs = [
  "GLOSSARY.md",
  ...readdirSync(join(root, rulesDir))
    .filter((file) => file.endsWith(".md"))
    .map((file) => join(rulesDir, file)),
];
// 只匹配多位数地图规模，区分「1 格」之类日常行军距离。
for (const file of docs) {
  for (const match of readFileSync(join(root, file), "utf8").matchAll(
    /(?<![#\d])(\d{2,})\s*(格|城)/g,
  )) {
    if (!mapSizes.has(Number(match[1]))) {
      errors.push(`${file}：「${match[0]}」没有对应的现行地图格数`);
    }
  }
}

if (errors.length > 0) {
  console.error(`[map-docs] 地图对账失败\n${errors.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`[map-docs] ${catalog.length} 张图的清单和规模对账通过`);
}
