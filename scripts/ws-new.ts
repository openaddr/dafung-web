// 建仓先冻结唯一父提交，避免主树停靠位或移动中的集成书签成为隐含基线。
// 缺省 fetch 后选 master@origin；显式 --revision 选本地固定快照，不触发 fetch。
// 任一步失败即停，残场手动处置；建后命令派发走 ws-run.ts。
import * as fs from "node:fs";
import * as path from "node:path";

const usage = (): never => {
  console.error(
    "用法:bun scripts/ws-new.ts <代号> [--revision <唯一 revision>](建 ../dafung-web-ws-<代号>;代号不含路径符)",
  );
  process.exit(2);
};
const [name, ...options] = process.argv.slice(2);
if (!name || name.startsWith("-") || name.includes("/") || name.includes("\\")) {
  usage();
}
if (
  options.length > 0 &&
  (options.length !== 2 || options[0] !== "--revision" || !options[1] || options[1].startsWith("-"))
) {
  usage();
}
const revision = options[1];
const source = process.cwd();
const dir = path.resolve("..", `dafung-web-ws-${name}`);

const run = (label: string, cmd: string[], cwd: string) => {
  console.log(`[ws-new] ${label}…`);
  const p = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) {
    console.error(`[ws-new] ${label} 失败(exit ${p.exitCode})——红停,残场手动处置。`);
    process.exit(1);
  }
};

if (revision === undefined) run("fetch", ["jj", "--ignore-working-copy", "git", "fetch"], source);
const selected = revision === undefined ? "master@origin" : revision;
const resolved = Bun.spawnSync(
  ["jj", "--ignore-working-copy", "log", "-r", selected, "--no-graph", "-T", 'commit_id ++ "\\n"'],
  { cwd: source },
);
if (resolved.exitCode !== 0) {
  console.error(resolved.stderr.toString());
  console.error(`[ws-new] revision 解析失败:${selected}`);
  process.exit(1);
}
const commits = resolved.stdout.toString().trim().split(/\r?\n/).filter(Boolean);
if (commits.length !== 1) {
  console.error(`[ws-new] revision 必须唯一:${selected} 匹配 ${commits.length} 个提交。`);
  process.exit(1);
}
const parent = commits[0]!;
console.log(`[ws-new] 固定父提交:${parent}`);

// 用已解析的完整 commit 建仓，后续书签移动不会改变此工作区的父提交。
console.log(`[ws-new] jj workspace add ${path.basename(dir)}…`);
const add = Bun.spawnSync(["jj", "workspace", "add", "--revision", parent, dir], {
  cwd: source,
  stdout: "inherit",
  stderr: "inherit",
});
if (add.exitCode !== 0) {
  console.error("[ws-new] 建仓失败——同名目录已存在或 jj 报错,红停(勿静默复用旧场)。");
  process.exit(1);
}
run("bun install", ["bun", "install"], dir);
fs.mkdirSync(path.join(dir, "tmp"), { recursive: true });
console.log(`[ws-new] mkdir -p tmp 完成`);
console.log(`[ws-new] 就绪:${dir}`);
console.log(`[ws-new] 命令派发:bun scripts/ws-run.ts ${name} <命令…>(cwd 每命令重置,勿靠 cd 记性)`);
