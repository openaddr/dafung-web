// 全量测试锁(L3,测试管线提速批):全量级跑(全量单测 / 全量 e2e)同机一次只许一个。
// 动机:重尾整局类用例对负载敏感(负载敏感 flake 家族多次实锤,口径见
// docs/how-to/开发与测试.md「全量放行判据」),两个全量并行 = 互相放大假挂 + 墙钟互翻倍。
// 机制 = 锁文件 + 非阻塞抢占 + **拿锁时验活**(2026-11-01 retro 增)。锁文件 = OS 临时
// 目录下 dafung-web-test.lock:跨 workspace 同机共享(并行会话各在各 workspace,仓库内
// 路径拦不住真正的互踩),且天然不进 git。锁内容 = 持锁者四元组(PID/命令/起始/工作目录)。
//
// 2026-11-01 retro 实锤(三撞锁实录):旧版锁生命周期只绑父壳进程,而实际工作在孤儿
// playwright 子进程——父壳被杀/崩溃后锁变僵尸(工作活着,锁永不释放);而旧「核 pid 已死
// 即删锁」的人肉配方拿 holder pid 判死活,恰好是错的探针(pid 死 ≠ 活儿死),当日两度误判、
// 差点误偷活锁。故升级为拿锁时自动验活三态:
//   alive  持锁 pid 活着 = 真在跑:缺省 fail-fast 响亮报错(撞锁是信息),设
//          E2E_LOCK_WAIT=<秒> 则本脚本代等、预算内轮询重探;
//   orphan 持锁 pid 死但本机仍有 playwright node 进程 = 疑似孤儿仍在跑:绝不自动偷,
//          报错自带取证两招(持锁 cwd 的 tmp/e2e-one-last.log mtime 在涨=活 / 数进程);
//   dead   pid 死且探针确认无 playwright 进程 = 真死锁:自动删锁重抢(死锁无语义,
//          接管是锁的正确生命周期,不是容错)。
// 已知边界(有意收窄,非疏漏):孤儿探测只识 playwright 族——e2e 是主受害面;全量单测
// 的 bun 孤儿不在探测面,存在「单测孤儿被误判 dead」的残余风险,届时报错文本的两招人肉
// 复核由人接手。pid 复用致假 alive 同理:方向安全——假 alive 只会多等/多报,不会误删
// 别人的活锁。
// 接线:只包全量级入口(package.json 的 test / test:slow / test:e2e);定向跑
// (裸 `bun test <文件>`、test:e2e:one)不经此包装,永不受拦。
// 测试注缝:DAFUNG_TEST_LOCK_PATH 覆写锁路径——冒烟验三态时指去临时文件,永不上真锁
// (2026-11-01 第二次 retro:真锁路径上做冒烟恰逢并行会话全量在跑,假锁记录踩掉真持锁
// 者两分钟,险些给第三方开了无锁窗口)。
// 用法:bun scripts/test-lock.ts <命令...>;命令退出码原样透传,锁随本进程退出释放。
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCK_PATH = process.env.DAFUNG_TEST_LOCK_PATH ?? join(tmpdir(), "dafung-web-test.lock");
const POLL_MS = 2000;

const cmd = process.argv.slice(2);
if (cmd.length === 0) {
  console.error("用法:bun scripts/test-lock.ts <命令...>(抢全量测试锁后执行命令,退出释放)");
  process.exit(2);
}

/** 锁文件四元组。 */
interface LockBody {
  pid: number;
  command: string;
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

/** 本机是否仍有 playwright 族的 node 进程(e2e 孤儿签名)。
 *  返回 null = 探针本身没跑成(fail-closed:当孤儿处理,绝不据此偷锁)。 */
function playwrightProcsAlive(): boolean | null {
  const probe =
    process.platform === "win32"
      ? Bun.spawnSync([
          "powershell",
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "name='node.exe'" | ` +
            `Where-Object { $_.CommandLine -match 'playwright' }).Count`,
        ])
      : Bun.spawnSync(["sh", "-c", "pgrep -f playwright | wc -l"]);
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
  const waitArg = process.env.E2E_LOCK_WAIT;
  const waitS = waitArg == null ? 0 : Number(waitArg);
  if (!Number.isFinite(waitS) || waitS < 0) {
    console.error(`[test-lock] E2E_LOCK_WAIT 非法:${waitArg}(须为非负秒数)`);
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
          `[test-lock] 已有全量测试在跑,本跑不启动(撞锁是信息;要代等设 E2E_LOCK_WAIT=<秒>)。\n` +
            `  锁文件:${LOCK_PATH}\n` +
            `  持锁者:${JSON.stringify(body)}\n` +
            `  处置:等它跑完再来${waitS > 0 ? `(已按 E2E_LOCK_WAIT=${waitS} 等满,持锁者仍在)` : ""}。`,
        );
        process.exit(1);
      }
      if (!waitingAnnounced) {
        waitingAnnounced = true;
        console.error(
          `[test-lock] 持锁者存活(pid ${body.pid},cwd ${body.cwd}),按 E2E_LOCK_WAIT=${waitS} 代等` +
            `(剩 ${leftS}s,每 ${POLL_MS / 1000}s 重探)…`,
        );
      }
      await sleep(POLL_MS);
      continue;
    }
    // pid 死:验孤儿。探针没跑成(null)= 未知,按孤儿处理——宁可人审,不冒险偷锁
    if (playwrightProcsAlive() !== false) {
      console.error(
        `[test-lock] 持锁进程已死(pid ${body.pid})但本机仍有 playwright node 进程——疑似孤儿仍在跑,不自动偷锁。\n` +
          `  锁文件:${LOCK_PATH}\n` +
          `  持锁者:${JSON.stringify(body)}\n` +
          `  取证两招:①看持锁 cwd 的 tmp/e2e-one-last.log mtime 是否还在涨(涨=孤儿活着);` +
          `②数本机 playwright node 进程。\n` +
          `  确认全死(含孤儿子进程)后删锁文件重跑。`,
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
