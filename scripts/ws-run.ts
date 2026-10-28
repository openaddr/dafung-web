// workspace 执行助手(2026-10-19 retro,#620 施工实锤):凡该跑在 jj workspace 的
// 命令(门槛四件套/typecheck、jj 写操作)经由本脚本执行——脚本内部 chdir 到目标
// workspace 再 spawn,把「必须记得 cd」从记性题变结构保证。
// 为什么机械化:AI 会话的 shell cwd 每条命令后重置回主目录(工具说明未必写真话),
// #620 会话五连漏 cd——四轮门槛对未改动的主树白绿(false pass),更糟的是
// describe/bookmark 误盖主树空 @,违反主树只读红线。「workspace 内干活」规则早已
// 写进 AGENTS 版本协作,纯记性规则被执行环境击败;判据 = 机械违规配确定性工具。
// 用法:bun scripts/ws-run.ts <代号> <命令...>(也可 `--` 显式分隔命令,或直接传
//   workspace 目录全名——两处宽容都为省一次重跑,2026-10-29 retro:全名与 `--` 各实测踩一次)
//   bun scripts/ws-run.ts retro4 bun test
//   bun scripts/ws-run.ts retro4 jj describe -m "fix: ..."
// 代号 → ../dafung-web-ws-<代号>(相对仓库根,与 jj workspace add 建址约定一致);
// 在主树或任意 workspace 里调用皆可(脚本按自身位置反推仓库根)。
// 零兜底:目录不存在 / 不是 jj workspace(无 .jj)当场报错退出——静默回退主树执行
// 正是本脚本要消灭的事故。

import { existsSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
// `--` 是命令分隔符不是参数:摘掉首个,其余原样(放到命令位置上是调用者的错,usage 兜底)
const sep = argv.indexOf("--");
const [codeRaw, ...cmd] = sep >= 0 ? [...argv.slice(0, sep), ...argv.slice(sep + 1)] : argv;
// 代号宽容全名:jj workspace list / 目录浏览里复制出来的就是全名,直接可用
const code = codeRaw?.startsWith("dafung-web-ws-")
  ? codeRaw.slice("dafung-web-ws-".length)
  : codeRaw;
if (!code || code.startsWith("-") || cmd.length === 0) {
  console.error(
    "用法:bun scripts/ws-run.ts <代号|目录全名> [--] <命令...>(命令在 ../dafung-web-ws-<代号> 内执行)",
  );
  process.exit(2);
}
const wsDir = join(import.meta.dir, "..", "..", `dafung-web-ws-${code}`);
if (!existsSync(wsDir)) {
  console.error(`[ws-run] workspace 不存在:${wsDir}(先 jj workspace add ../dafung-web-ws-${code})`);
  process.exit(2);
}
if (!existsSync(join(wsDir, ".jj"))) {
  console.error(
    `[ws-run] ${wsDir} 无 .jj,不是 jj workspace——拒绝执行(静默回退主树正是本脚本要消灭的事故)`,
  );
  process.exit(2);
}
process.chdir(wsDir);
console.error(`[ws-run] ${wsDir}`);
const proc = Bun.spawnSync(cmd, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
process.exit(proc.exitCode ?? 1);
