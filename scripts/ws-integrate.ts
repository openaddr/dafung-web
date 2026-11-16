// 将固定交付中的指定路径接进集成 workspace，输出可复用的短回执。
import { parseArgs } from "node:util";
import { realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const usage =
  "用法: bun scripts/ws-integrate.ts --base <冻结提交> --delivery <交付提交> --onto <集成提交> --expect <路径> [--expect <路径> ...]";

function run(args: string[]): string {
  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(
      `${args[0]} ${args[1]} 失败（${result.exitCode}）：${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout.toString();
}

function revision(revset: string): string {
  return run(["jj", "log", "-r", revset, "--no-graph", "-T", "commit_id"]).trim();
}

function changedPaths(from: string, to: string, paths: string[] = []): string[] {
  return run([
    "git",
    "--literal-pathspecs",
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    from,
    to,
    "--",
    ...paths,
  ])
    .split("\0")
    .filter(Boolean);
}

function checkPaths(actual: string[], expected: string[], label: string): void {
  const extra = actual.filter((path) => !expected.includes(path));
  const missing = expected.filter((path) => !actual.includes(path));
  if (extra.length > 0 || missing.length > 0) {
    throw new Error(
      `${label}文件集不符：多出 ${JSON.stringify(extra)}，缺少 ${JSON.stringify(missing)}`,
    );
  }
}

function checkConflicts(revset: string, label: string): void {
  if (
    run(["jj", "log", "-r", revset, "--no-graph", "-T", 'if(conflict, "yes", "no")']).trim() ===
    "yes"
  ) {
    throw new Error(`${label}存在未解冲突`);
  }
}

function integrate(base: string, delivery: string, onto: string, paths: string[]): void {
  if (run(["git", "merge-base", base, delivery]).trim() !== base) {
    throw new Error(`交付 ${delivery} 未基于冻结提交 ${base}`);
  }
  checkConflicts(delivery, "交付提交");
  checkPaths(changedPaths(base, delivery), paths, "交付");
  // 补项可以从上一份代理交付续作。只接入当前集成树仍等于冻结基线的路径。
  const overlap = changedPaths(base, onto, paths);
  if (overlap.length > 0) {
    throw new Error(`集成树已改动声明路径：${JSON.stringify(overlap)}`);
  }
  const description = run([
    "jj",
    "log",
    "-r",
    delivery,
    "--no-graph",
    "-T",
    "description",
  ]).trimEnd();
  if (description.trim() === "") throw new Error("交付提交缺少描述");

  let current = revision("@");
  checkConflicts("@", "集成工作区");
  // 接入成功后重试同一交付时，核对并复用那一层。
  if (current === onto) {
    run(["jj", "new", onto, `--message=${description}`]);
    run([
      "jj",
      "restore",
      "--from",
      delivery,
      "--",
      ...paths.map((path) => `root-file:${JSON.stringify(path)}`),
    ]);
    run(["jj", "st"]);
    current = revision("@");
  } else if (revision("@-") !== onto) {
    throw new Error(`集成工作区已变化：期望 ${onto}，当前 ${current}`);
  }

  checkPaths(changedPaths(onto, current), paths, "接入");
  const different = changedPaths(delivery, current, paths);
  if (different.length > 0) {
    throw new Error(`接入后与交付内容不一致：${JSON.stringify(different)}`);
  }
  console.log(JSON.stringify({ parent: onto, commit: current, pathCount: paths.length }));
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      base: { type: "string" },
      delivery: { type: "string" },
      onto: { type: "string" },
      expect: { type: "string", multiple: true },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const { base, delivery, onto, expect: paths } = values;
  if (
    !base ||
    !delivery ||
    !onto ||
    ![base, delivery, onto].every((id) => /^[0-9a-f]{40}$/.test(id)) ||
    !paths?.length ||
    new Set(paths).size !== paths.length ||
    paths.some((path) =>
      path.split("/").some((part) => part === "" || part === "." || part === ".."),
    )
  ) {
    throw new Error(usage);
  }

  const root = run(["jj", "workspace", "root"]).trimEnd();
  const mainRoot = run(["jj", "workspace", "root", "--name", "default"]).trimEnd();
  if (
    realpathSync(root) !== realpathSync(process.cwd()) ||
    realpathSync(root) === realpathSync(mainRoot)
  ) {
    throw new Error("请在集成 workspace 根目录执行，主树只读停靠");
  }
  const lock = join(root, ".jj", "ws-integrate.lock");
  writeFileSync(lock, `${process.pid}\n`, { flag: "wx" });
  try {
    integrate(base, delivery, onto, paths);
  } finally {
    unlinkSync(lock);
  }
}

try {
  main();
} catch (error) {
  console.error(`[ws-integrate] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
