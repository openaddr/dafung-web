// 长命令输出限额(#1465):直接执行 argv,双流原样写系统临时文件,失败才展示有界尾部。
import { appendFileSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TAIL_BYTES = 2000;
const HELP = `用法:
  bun scripts/command-log.ts -- <命令> [参数...]
  bun scripts/command-log.ts --help

命令按 argv 直接执行,含空格路径按当前 shell 加引号。
完整 stdout/stderr 写系统临时目录;成功只显示日志路径、退出码和耗时。
失败附两路各最多 ${TAIL_BYTES} 字节的尾部,子命令非零退出码原样返回;启动错误明确报告。
交互服务继续直接运行。

示例:
  bun scripts/command-log.ts -- bun run build
  bun scripts/command-log.ts -- bun run test`;

async function main(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    console.log(HELP);
    return 0;
  }
  // Bun 消耗脚本路径后的首个 --;process.argv 中已是后续命令及参数。
  if (args.length === 0) throw new Error("用法:bun scripts/command-log.ts -- <命令> [参数...]");
  const logDir = mkdtempSync(join(tmpdir(), "dafung-command-"));
  const stdout = join(logDir, "stdout.log");
  const stderr = join(logDir, "stderr.log");
  console.log(`[command-log] stdout: ${stdout}`);
  console.log(`[command-log] stderr: ${stderr}`);
  const started = performance.now();
  let code: number;
  try {
    const child = Bun.spawn(args, {
      stdin: "inherit",
      stdout: Bun.file(stdout),
      stderr: Bun.file(stderr),
    });
    code = await child.exited;
  } catch (error) {
    appendFileSync(stdout, "");
    appendFileSync(stderr, `${String(error)}\n`);
    console.error(`[command-log] 执行失败,完整错误见 ${stderr}`);
    code = 1;
  }
  console.log(`[command-log] exit ${code}; elapsed ${Math.round(performance.now() - started)}ms`);
  if (code !== 0) {
    for (const [stream, path] of [
      ["stdout", stdout],
      ["stderr", stderr],
    ]) {
      console.log(`[command-log] ${stream} tail (last <=${TAIL_BYTES} bytes):`);
      const size = statSync(path!).size;
      console.log(
        await Bun.file(path!)
          .slice(Math.max(0, size - TAIL_BYTES), size)
          .text(),
      );
    }
  }
  return code;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`[command-log] ${String(error)}`);
  process.exitCode = 1;
}
