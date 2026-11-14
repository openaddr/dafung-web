// 无浏览器完整测试池的同机互斥锁,定向测试不占锁。
// 使用系统临时目录在 workspace 间共享;活持锁者不接管。
// 持锁者已死时仍检查实际 bun test 子进程,避免偷走孤儿尚在执行的锁。
// DAFUNG_TEST_LOCK_WAIT 可显式设置等待预算;缺省撞锁立即报告。
// DAFUNG_TEST_LOCK_PATH 供临时夹具使用,不接触其他会话的实际锁。
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCK_PATH = process.env.DAFUNG_TEST_LOCK_PATH ?? join(tmpdir(), "dafung-web-test.lock");
const POLL_MS = 2000;

// --entry <名> 记录外层 package 入口,区分完整默认池与显式慢池。
const argv = process.argv.slice(2);
const entryFlag = argv.indexOf("--entry");
const entry = entryFlag >= 0 ? argv[entryFlag + 1] : undefined;
const cmd = entryFlag >= 0 ? argv.filter((_, i) => i !== entryFlag && i !== entryFlag + 1) : argv;
// package 放行入口不接收追加参数,防止 --only/-t/--grep/--list/路径把全套缩成子集。
// 裸 bun test 的定向诊断不经过本包装。
const releaseCommands: Record<string, string[]> = {
  test: ["bun", "scripts/bun-release.ts"],
  "test:slow": ["bun", "scripts/bun-release.ts"],
};
if (entry !== undefined && Object.hasOwn(releaseCommands, entry)) {
  const full = releaseCommands[entry]!;
  if (cmd.length !== full.length || cmd.some((arg, index) => arg !== full[index])) {
    console.error(`[test-lock] ${entry} 完整放行不接受追加参数;定向诊断请用裸 bun test <文件>。`);
    process.exit(2);
  }
}
if (cmd.length === 0) {
  console.error(
    "用法:bun scripts/test-lock.ts [--entry <入口名>] <命令...>(抢全量测试锁后执行命令,退出释放)",
  );
  process.exit(2);
}

/** 锁文件四元组。 */
interface LockBody {
  pid: number;
  command: string;
  /** 外层 package.json 入口名(--entry 传入;直调=“(直调)”),消歧内层命令串。 */
  entry?: string;
  startedAt: string;
  cwd: string;
}

function readLock(): LockBody | null {
  try {
    return JSON.parse(readFileSync(LOCK_PATH, "utf8")) as LockBody;
  } catch {
    // EEXIST 后读不到 = 持锁者恰在两步之间跑完释放(竞态窗口),锁文件已不在
    return null;
  }
}

/** 持锁 pid 活性(kill 0 空信号探测:EPERM=在但无权限,也算活;ESRCH=真死)。 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === "EPERM";
  }
}

/** 本机是否仍有 bun test 进程(整池孤儿签名)。
 *  返回 null = 探针本身没跑成(fail-closed:当孤儿处理,绝不据此偷锁)。 */
function testProcsAlive(): boolean | null {
  const probe =
    process.platform === "win32"
      ? Bun.spawnSync([
          "powershell",
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "name='bun.exe'" | ` +
            `Where-Object { $_.CommandLine -match 'bun(?:\\.exe)?[" ]+test(?: |$)' }).Count`,
        ])
      : Bun.spawnSync(["sh", "-c", "pgrep -f '[b]un(\\.exe)? test' | wc -l"]);
  const n = Number(probe.stdout.toString().trim());
  return Number.isFinite(n) && probe.exitCode === 0 ? n > 0 : null;
}

function tryAcquire(): boolean {
  let fd: number;
  try {
    fd = openSync(LOCK_PATH, "wx"); // 独占创建:已存在即抛 EEXIST,无检查-再建竞态窗口
  } catch (e) {
    if ((e as { code?: string }).code === "EEXIST") return false;
    throw e;
  }
  writeSync(
    fd,
    JSON.stringify({
      pid: process.pid,
      command: cmd.join(" "),
      entry: entry ?? "(直调)",
      startedAt: new Date().toISOString(),
      cwd: process.cwd(),
    }),
  );
  closeSync(fd);
  return true;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** 撞锁处置:验活三态(alive→等或报错 / orphan→报错带取证 / dead→接管重抢)。 */
async function acquireOrWait(): Promise<void> {
  const waitArg = process.env.DAFUNG_TEST_LOCK_WAIT;
  const waitS = waitArg == null ? 0 : Number(waitArg);
  if (!Number.isFinite(waitS) || waitS < 0) {
    console.error(`[test-lock] DAFUNG_TEST_LOCK_WAIT 非法:${waitArg}(须为非负秒数)`);
    process.exit(2);
  }
  const deadline = Date.now() + waitS * 1000;
  let waitingAnnounced = false;
  for (;;) {
    if (tryAcquire()) return;
    const body = readLock();
    if (body == null) continue; // 锁在读取间隙被释放,直接重抢
    if (pidAlive(body.pid)) {
      const leftS = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      if (leftS === 0) {
        console.error(
          `[test-lock] 已有全量测试在跑,本跑不启动(撞锁是信息;要代等设 DAFUNG_TEST_LOCK_WAIT=<秒>)。\n` +
            `  锁文件:${LOCK_PATH}\n` +
            `  持锁者:${JSON.stringify(body)}\n` +
            `  处置:等它跑完再来${waitS > 0 ? `(已按 DAFUNG_TEST_LOCK_WAIT=${waitS} 等满,持锁者仍在)` : ""}。`,
        );
        process.exit(1);
      }
      if (!waitingAnnounced) {
        waitingAnnounced = true;
        console.error(
          `[test-lock] 持锁者存活(pid ${body.pid},cwd ${body.cwd}),按 DAFUNG_TEST_LOCK_WAIT=${waitS} 代等` +
            `(剩 ${leftS}s,每 ${POLL_MS / 1000}s 重探)…`,
        );
      }
      await sleep(POLL_MS);
      continue;
    }
    // pid 死:验孤儿。探针没跑成(null)= 未知,按孤儿处理——宁可人审,不冒险偷锁
    if (testProcsAlive() !== false) {
      console.error(
        `[test-lock] 持锁进程已死(pid ${body.pid})但本机仍有 bun test 进程——疑似孤儿仍在跑,不自动偷锁。\n` +
          `  锁文件:${LOCK_PATH}\n` +
          `  持锁者:${JSON.stringify(body)}\n` +
          `  核对持锁命令的输出与实际 bun test 进程;确认命令和子进程都已结束再处理锁。`,
      );
      process.exit(1);
    }
    console.error(`[test-lock] 持锁者已死且无孤儿(pid ${body.pid}),自动接管:删锁重抢。`);
    rmSync(LOCK_PATH, { force: true });
    // 立即重抢;竞态窗口(别人同时接管)下一轮 EEXIST 重新验活自愈
  }
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

await acquireOrWait();
const proc = Bun.spawn(cmd, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
let code: number;
try {
  code = await proc.exited;
} finally {
  release();
}
process.exit(code);
