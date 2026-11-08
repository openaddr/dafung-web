// workspace 一键建仓(2026-11-09 retro):how-to「jj workspace 通道」的建仓仪式有四步
// (add → 起基 → install → mkdir tmp),靠记必漏——retro 当晚主线手建 6 个 workspace,
// mkdir tmp 漏 2 次(PR 开到一半 tmp/pr.md 断)、「jj new master@origin 起基」漏 N 次
// (主树 @ 停靠位常落后,照 @ 建仓落旧基线,how-to 明文警告;当日全靠运气没炸)。
// 判据同 ws-run.ts:机械仪式配确定性工具,纯记性规则被执行环境击败。
// 用法:bun scripts/ws-new.ts <代号> → 建 ../dafung-web-ws-<代号> 并完成:
//   ① jj workspace add  ② fetch + jj new master@origin 起基  ③ bun install  ④ mkdir -p tmp
// 任一步失败即红停(残场手动处置,不静默半成品);建后命令派发走 ws-run.ts。
import * as fs from "node:fs";
import * as path from "node:path";

const name = process.argv[2];
if (!name || name.startsWith("-") || name.includes("/") || name.includes("\\")) {
  console.error("用法:bun scripts/ws-new.ts <代号>(建 ../dafung-web-ws-<代号>;代号不含路径符)");
  process.exit(2);
}
const dir = path.resolve("..", `dafung-web-ws-${name}`);

const run = (label: string, cmd: string[]) => {
  console.log(`[ws-new] ${label}…`);
  const p = Bun.spawnSync(cmd, { cwd: dir, stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) {
    console.error(`[ws-new] ${label} 失败(exit ${p.exitCode})——红停,残场手动处置。`);
    process.exit(1);
  }
};

// ① 建仓(jj workspace add 的目标目录必须不存在,已存在=响亮失败,不静默复用)
console.log(`[ws-new] ① jj workspace add ${path.basename(dir)}…`);
const add = Bun.spawnSync(["jj", "workspace", "add", dir], {
  stdout: "inherit",
  stderr: "inherit",
});
if (add.exitCode !== 0) {
  console.error("[ws-new] 建仓失败——同名目录已存在或 jj 报错,红停(勿静默复用旧场)。");
  process.exit(1);
}
// ② 起基(先 fetch 对齐远端,再 new master@origin——主树 @ 停靠位不作为基线)
run("② fetch", ["jj", "git", "fetch"]);
run("② jj new master@origin 起基", ["jj", "new", "master@origin"]);
// ③④ 依赖与运行时目录
run("③ bun install", ["bun", "install"]);
fs.mkdirSync(path.join(dir, "tmp"), { recursive: true });
console.log(`[ws-new] ④ mkdir -p tmp 完成`);
console.log(`[ws-new] 就绪:${dir}`);
console.log(`[ws-new] 命令派发:bun scripts/ws-run.ts ${name} <命令…>(cwd 每命令重置,勿靠 cd 记性)`);
