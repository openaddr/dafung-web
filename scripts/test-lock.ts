// 全量测试锁(L3,测试管线提速批):全量级跑(全量单测 / 全量 e2e)同机一次只许一个。
// 动机:重尾整局类用例对负载敏感(负载敏感 flake 家族多次实锤,口径见
// docs/how-to/开发与测试.md「全量放行判据」),两个全量并行 = 互相放大假挂 + 墙钟互翻倍;
// 锁把「撞上了」从静默劣化变成一声响亮的报错。
// 机制同「隔离即构建锁」配方(shot.mjs 头注 `flock tmp/build.lock bun run build` 同族):
// 锁文件 + 非阻塞抢占,撞锁即报错退出——不等待、不重试、不偷锁(撞锁是信息,不是错误状态)。
// 锁文件 = OS 临时目录下 dafung-web-test.lock:跨 workspace 同机共享(并行会话各在各
// workspace,仓库内路径拦不住真正的互踩),且天然不进 git。锁内容 = 持锁者四元组
// (PID / 命令 / 起始时刻 / 工作目录),被拦者按此核实处置——持锁进程确实已死(硬杀
// 残留)就删锁文件重跑,还在跑就等它跑完再来,脚本不代判。
// 接线:只包全量级入口(package.json 的 test / test:slow / test:e2e);定向跑
// (裸 `bun test <文件>`、test:e2e:one)不经此包装,永不受拦。
// 用法:bun scripts/test-lock.ts <命令...>;命令退出码原样透传,锁随本进程退出释放。
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCK_PATH = join(tmpdir(), "dafung-web-test.lock");

const cmd = process.argv.slice(2);
if (cmd.length === 0) {
  console.error("用法:bun scripts/test-lock.ts <命令...>(抢全量测试锁后执行命令,退出释放)");
  process.exit(2);
}

function holderInfo(): string {
  try {
    return readFileSync(LOCK_PATH, "utf8").trim();
  } catch {
    // EEXIST 后读不到 = 持锁者恰在两步之间跑完释放(竞态窗口),锁文件已不在
    return "(锁内容已读不到——持锁者恰在本报错间隙释放,重跑即可)";
  }
}

function acquire(): void {
  let fd: number;
  try {
    fd = openSync(LOCK_PATH, "wx"); // 独占创建:已存在即抛 EEXIST,无检查-再建竞态窗口
  } catch (e) {
    if ((e as { code?: string }).code !== "EEXIST") throw e;
    console.error(
      `[test-lock] 已有全量测试在跑,本跑不启动(不等待——撞锁是信息,不是要兜过去的错误)。\n` +
        `  锁文件:${LOCK_PATH}\n` +
        `  持锁者:${holderInfo()}\n` +
        `  处置:持锁进程还在跑就等它跑完再来;核实已死(硬杀残留)删锁文件后重跑。`,
    );
    process.exit(1);
  }
  writeSync(
    fd,
    JSON.stringify({
      pid: process.pid,
      command: cmd.join(" "),
      startedAt: new Date().toISOString(),
      cwd: process.cwd(),
    }),
  );
  closeSync(fd);
}

function release(): void {
  rmSync(LOCK_PATH, { force: true });
}

process.on("SIGINT", () => {
  release();
  process.exit(130);
});
process.on("SIGTERM", () => {
  release();
  process.exit(143);
});

acquire();
const proc = Bun.spawn(cmd, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
let code: number;
try {
  code = await proc.exited;
} finally {
  release();
}
process.exit(code);
