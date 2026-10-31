// board-loader 兜底快照锁(2026-10-19 retro):零兜底是 AGENTS.md 散文红线,而
// `?? 0` / `?? "z"` 这类无害长相的兜底连过经济 v2、多轮 retro 与 #619 评审,直到
// #630 才清偿五处——本测试把地图 schema 解释器这个事故重灾区从「评审自觉」变
// 「可执行检查」:文件里每个 `??` 都必须在白名单挂号,新增兜底当场红,入白名单
// 必须写明口径。按行文本比对(行号必漂移;同 check-core-purity 的指纹风格)。
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(resolve(import.meta.dir, "../src/core/board-loader.ts"), "utf8");

/** 白名单 = 既有兜底的名目(片段 → 口径);新增兜底必须在此登记。 */
const ALLOWED: [fragment: string, reason: string][] = [
  [
    'const type = (t.type ?? "Property") as TileDef["type"]',
    "schema 默认:格 type 缺省按 Property(schema 注释明示)",
  ],
  ["const arr = m.get(p.group) ?? []", "catalog 构建:分组挂链的查表习惯"],
  ["return id ? (byId.get(id) ?? null) : null;", "catalog.get 契约:查无返回 null(UI 空态消费)"],
  ["return byGroup.get(group) ?? [];", "catalog 构建:空分组返回空表的查表习惯"],
];

describe("board-loader 兜底快照锁(零兜底 × 地图 schema 解释器)", () => {
  it("文件内每个 ?? 都在白名单挂号(新增兜底 = 先给口径再入表)", () => {
    const offenders = SOURCE.split("\n")
      .map((line, no) => ({ line: line.trim(), no: no + 1 }))
      .filter(({ line }) => line.includes("?? "))
      .filter(({ line }) => !ALLOWED.some(([frag]) => line.includes(frag)))
      .map(({ no, line }) => `${no}: ${line}`);
    expect(offenders).toEqual([]);
  });

  it("白名单无死条目(代码删了兜底必须同步摘表,防白名单腐化)", () => {
    const unmatched = ALLOWED.filter(([frag]) => !SOURCE.includes(frag)).map(
      ([, reason]) => reason,
    );
    expect(unmatched).toEqual([]);
  });
});
