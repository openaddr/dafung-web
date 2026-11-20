// 收口检查的影响域与命令单源;不持久化计划或结果。
import { existsSync, readFileSync } from "node:fs";
import { classifyChange } from "./change-classification";

type Check = { name: string; command: string[]; env?: Record<string, string> };
type Jj = (...args: string[]) => string;

const slow: Record<string, string[]> = {
  "test:protocol": ["test/online/protocol-online.test.ts", "test/online/server-cmd-error.test.ts"],
  "test:recovery": ["test/online/room-recovery.test.ts"],
  "test:build": ["test/infra/build-dist.test.ts"],
  "test:release-guard": ["test/infra/test-release.test.ts"],
  "test:merge": ["test/infra/pr-merge.test.ts"],
};

const rules: Array<[RegExp, string[]]> = [
  [
    /^(?:docs\/|.*\.md$|.*\/\.gitignore$|\.(?:gitignore|gitattributes|oxlintrc\.json|oxfmtrc\.json)$|test\/|src-tauri\/|proto\/|(?:package\.json|bun\.lock|bunfig\.toml|tsconfig[^/]*\.json|knip\.json|components\.json)$)/,
    [],
  ],
  [/^scripts\/.+\.(?:ts|mjs)$/, ["typecheck:scripts"]],
  [/^scripts\/build-sound-clips\.ts$/, []],
  [/^scripts\/reaction-deadline\.ts$/, []],
  [
    /^(?:src\/core\/|extensions\/(?!.*\.md$)|public\/(?:maps|config)\/|scripts\/(?:whole-game|state-digest|test-corpus|bot-driver|engine-helpers)\.ts$)/,
    ["check:core"],
  ],
  [
    /^(?:src\/core\/(?!timings\.ts$)|extensions\/(?!.*\.md$)|public\/(?:maps|config)\/|scripts\/(?:whole-game|state-digest|test-corpus|bot-driver|engine-helpers)\.ts$)/,
    ["check:goldens"],
  ],
  [
    /^(?:src\/core\/(?!(?:theme|geometry|timings|planter|testing|game-events|event-tiers|guohao|model|snapshot|extension-contract)\.ts$)|extensions\/(?!.*\.md$)|public\/(?:maps|config)\/|scripts\/(?:whole-game|bot-driver|engine-helpers|sim-bench)\.ts$)/,
    ["check:sim-bench"],
  ],
  [
    /^(?:scripts\/(?:wire|server|room|seat-projection|event-batch|room-record|room-persistence|watchdogs|bot-driver|online-client|fault-proxy)\.ts$|src\/core\/(?:authority|model|snapshot|game-events|event-tiers)\.ts$)/,
    ["test:protocol"],
  ],
  [
    /^(?:scripts\/(?:room|room-record|room-persistence)\.ts$|src\/core\/snapshot\.ts$)/,
    ["test:recovery"],
  ],
  [/^(?:src\/app\/components\/board\/|src\/core\/(?:geometry|theme)\.ts$)|\.css$/, ["check:board"]],
  [/^(?:src\/app\/|src\/styles\/|public\/|index\.html$)/, []],
  [/^AGENTS\.md$/, ["check:agents-budget"]],
  [/^(?:scripts\/(?:build-dist|dist-freshness)\.ts$|vite\.config\.[cm]?[jt]s$)/, ["test:build"]],
  [/^scripts\/(?:bun-release|test-lock)\.ts$/, ["test:release-guard"]],
  [/^scripts\/(?:pr-merge(?:-cleanup|-checks)?|change-classification)\.ts$/, ["test:merge"]],
];

const behavior = new Set(["check:goldens", "check:sim-bench", ...Object.keys(slow)]);
const packageCheck = (name: string): Check => ({
  name,
  command: [process.execPath, "run", name],
  ...(name === "test" ? { env: { DAFUNG_SLOW: "" } } : {}),
});
const slowCheck = (name: string, files: string[]): Check => ({
  name,
  command: [process.execPath, "scripts/bun-release.ts", "--files", ...files],
  env: { DAFUNG_SLOW: "1" },
});

export function checksFor(base: string, target: string, paths: string[], jj: Jj): Check[] {
  const selected = new Set(["lint", "check:fmt", "build", "test"]);
  const baseFiles = new Set(jj("file", "list", "-r", base).split("\n"));
  const targetFiles = new Set(jj("file", "list", "-r", target).split("\n"));
  const changedSlow: string[] = [];
  for (const file of paths) {
    const matches = rules.filter(([pattern]) => pattern.test(file));
    const newUnregisteredScript =
      /^scripts\/.+\.(?:ts|mjs)$/.test(file) &&
      !baseFiles.has(file) &&
      matches.every(([, ids]) => ids.length === 1 && ids[0] === "typecheck:scripts");
    if ((matches.length === 0 && existsSync(file)) || newUnregisteredScript)
      throw new Error(`未知影响域:${file},请补充收口检查规则`);
    const isSlow =
      /^test\/.+\.test\.tsx?$/.test(file) &&
      existsSync(file) &&
      readFileSync(file, "utf8").includes("DAFUNG_SLOW");
    const needsClassification =
      isSlow || matches.some(([, ids]) => ids.some((id) => behavior.has(id)));
    const commentOnly =
      needsClassification &&
      /\.[cm]?[jt]sx?$/.test(file) &&
      baseFiles.has(file) &&
      targetFiles.has(file) &&
      classifyChange(
        file,
        jj("file", "show", "-r", base, file),
        jj("file", "show", "-r", target, file),
      ) === "comment-only";
    for (const [, ids] of matches)
      for (const id of ids) if (!commentOnly || !behavior.has(id)) selected.add(id);
    if (isSlow && !commentOnly) changedSlow.push(file);
  }
  const covered = new Set([...selected].flatMap((id) => slow[id] ?? []));
  const remaining = changedSlow.filter((file) => !covered.has(file));
  const checks = [...selected].map((id) =>
    slow[id] ? slowCheck(id, slow[id]!) : packageCheck(id),
  );
  for (const file of remaining) checks.push(slowCheck(`慢例:${file}`, [file]));
  return checks;
}
