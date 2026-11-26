import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAX_SEAT_COUNT, MIN_SEAT_COUNT, STANDARD_SEAT_COUNT } from "@dafung/core/engine/constants";
import { JINNANG_CARDS, JINNANG_DECK_LIST } from "@dafung/core/engine/jinnang";

const args = process.argv.slice(2);
const write = args.length === 1 && args[0] === "--write";
if (args.length > 0 && !write) throw new Error("用法:bun scripts/rule-docs.ts [--write]");

const rulesDir = resolve(import.meta.dir, "../docs/reference/rules");
const sections = [
  {
    file: "02-开局.md",
    key: "seat-count",
    body: `单机准备与联机建房默认 ${STANDARD_SEAT_COUNT} 位诸侯，可在 ${MIN_SEAT_COUNT}–${MAX_SEAT_COUNT} 人之间调整。`,
  },
  {
    file: "06-锦囊.md",
    key: "jinnang-catalog",
    body: [
      `牌库共 ${JINNANG_CARDS.length} 种、${JINNANG_DECK_LIST.length} 张。`,
      "",
      ...JINNANG_CARDS.map(
        ({ id, tags, copies, text }) =>
          `- **${id}**（${tags.join("、")}，${copies} 张）。${text.replace(/\r?\n/g, " ")}`,
      ),
    ].join("\n"),
  },
];

const outdated = sections.flatMap(({ file, key, body }) => {
  const path = resolve(rulesDir, file);
  const current = readFileSync(path, "utf8");
  const begin = `<!-- BEGIN GENERATED: ${key} -->`;
  const end = `<!-- END GENERATED: ${key} -->`;
  const startIndex = current.indexOf(begin);
  const endIndex = current.indexOf(end);
  if (
    startIndex < 0 ||
    endIndex < startIndex + begin.length ||
    startIndex !== current.lastIndexOf(begin) ||
    endIndex !== current.lastIndexOf(end)
  ) {
    throw new Error(`${file}:生成区 ${key} 缺失、错序或重复`);
  }
  const expected = `${current.slice(0, startIndex + begin.length)}\n\n${body}\n\n${current.slice(endIndex)}`;
  return current === expected ? [] : [{ file, path, expected }];
});

if (outdated.length === 0) {
  console.log("[rule-docs] 规则生成区与源码一致");
} else if (write) {
  for (const { path, expected } of outdated) writeFileSync(path, expected, "utf8");
  console.log(`[rule-docs] 已更新 ${outdated.map(({ file }) => file).join("、")}`);
} else {
  console.error(
    `[rule-docs] ${outdated.map(({ file }) => file).join("、")} 与源码不同步，请运行 bun run gen:rule-docs`,
  );
  process.exitCode = 1;
}
