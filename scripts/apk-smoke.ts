// #1440:只负责指定 APK/指定设备的安装启动取证;人工原生验收沿用 #215。
// 不选包/设备,不清 logcat/数据,不卸载 app,不管理 adb server 或模拟器生命周期。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

interface Options {
  apk: string;
  device: string;
  package: string;
  version: string;
  out: string;
}
interface Step {
  name: string;
  startedAt: string;
  finishedAt: string;
  status: "passed" | "failed";
  commands: { argv: string[]; exitCode: number | null; stdout: string; stderr: string }[];
  error?: string;
}

function options(): Options {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  const flags = ["apk", "device", "package", "version", "out"];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!.replace(/^--/, "");
    const value = args[i + 1];
    if (!flags.includes(key) || args[i] !== `--${key}` || !value || value.startsWith("--"))
      throw new Error(
        `无效参数:${args[i]};用法:test:apk --apk <绝对路径> --device <serial> --package <id> --version <versionName> --out <新目录>`,
      );
    if (values.has(key)) throw new Error(`重复参数:--${key}`);
    values.set(key, value);
  }
  for (const key of flags) {
    if (!values.has(key)) throw new Error(`必须显式提供 --${key}`);
  }
  const result = Object.fromEntries(values) as unknown as Options;
  if (!isAbsolute(result.apk)) throw new Error("--apk 必须是绝对路径");
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(result.package))
    throw new Error("--package 不是有效包名");
  result.out = resolve(result.out);
  return result;
}

function smoke(opts: Options): void {
  // 不覆盖既有证据。父目录可创建,本次目录必须由本次命令独占创建。
  if (existsSync(opts.out)) throw new Error(`证据目录已存在:${opts.out};请指定新目录`);
  mkdirSync(resolve(opts.out, ".."), { recursive: true });
  mkdirSync(opts.out);
  const report = {
    status: "running" as "running" | "passed" | "failed",
    scope: "指定 APK 安装、版本核对、启动与取证;不代表物理真机人工验收完成",
    startedAt: new Date().toISOString(),
    finishedAt: "",
    invocation: [process.execPath, ...process.argv.slice(1)],
    expected: opts,
    apk: {} as Record<string, unknown>,
    environment: {} as Record<string, unknown>,
    steps: [] as Step[],
    evidence: {} as Record<string, string>,
    manual: [
      "标准横屏 844×390 实绘与真实手势:待验",
      "系统返回:待验",
      "后台恢复:待验",
      "原生文件保存:待验",
      "#215 软键盘与 viewport:待验",
      "#215 Dialog 返回键与 input autoFocus:待验",
      "#215 关闭后首 tap 与滚动起手:待验",
      "#215 Select 层级与键盘:待验",
    ],
    handoff: "https://github.com/openaddr/dafung-web/issues/215",
  };
  let active: Step;
  const save = () =>
    writeFileSync(join(opts.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const step = <T>(name: string, run: () => T): T => {
    active = {
      name,
      startedAt: new Date().toISOString(),
      finishedAt: "",
      status: "passed",
      commands: [],
    };
    report.steps.push(active);
    console.log(`[apk-smoke] ${name}`);
    try {
      return run();
    } catch (error) {
      active.status = "failed";
      active.error = error instanceof Error ? error.message : String(error);
      throw new Error(`${name}: ${active.error}`, { cause: error });
    } finally {
      active.finishedAt = new Date().toISOString();
      save();
    }
  };
  const command = (argv: string[], binary = false): Buffer => {
    const result = spawnSync(argv[0]!, argv.slice(1), {
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 24 * 1024 * 1024,
    });
    const stdout = result.stdout === null ? Buffer.alloc(0) : result.stdout;
    const stderr = result.stderr === null ? "" : result.stderr.toString("utf8");
    active.commands.push({
      argv,
      exitCode: result.status,
      stdout: binary ? `[二进制:${stdout.length} bytes]` : stdout.toString("utf8"),
      stderr,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `命令退出 ${result.status}:${argv.join(" ")}\n${stderr}\n${binary ? "" : stdout.toString("utf8")}`,
      );
    return stdout;
  };
  try {
    const { adb, aapt } = step("SDK 前置", () => {
      const sdk = process.env.ANDROID_HOME;
      if (!sdk) throw new Error("ANDROID_HOME 未设置");
      const suffix = process.platform === "win32" ? ".exe" : "";
      const adb = join(sdk, "platform-tools", `adb${suffix}`);
      const tools = join(sdk, "build-tools");
      const versions = readdirSync(tools)
        .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
        .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
      if (versions.length === 0) throw new Error(`缺少正式 build-tools:${tools}`);
      const aapt = join(tools, versions[0]!, `aapt${suffix}`);
      if (!existsSync(adb) || !existsSync(aapt)) throw new Error(`SDK 工具缺失:${adb},${aapt}`);
      report.environment.sdk = sdk;
      report.environment.adb = command([adb, "version"]).toString("utf8").trim();
      return { adb, aapt };
    });
    const shell = (...args: string[]) =>
      command([adb, "-s", opts.device, ...args])
        .toString("utf8")
        .trim();
    const activity = step("APK 身份", () => {
      if (!statSync(opts.apk).isFile()) throw new Error(`APK 不是文件:${opts.apk}`);
      const bytes = readFileSync(opts.apk);
      report.apk = {
        path: opts.apk,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      const badging = command([aapt, "dump", "badging", opts.apk]).toString("utf8");
      const pkg = /^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m.exec(
        badging,
      );
      if (!pkg) throw new Error("aapt 未返回包名/版本");
      const [, packageName, versionCode, versionName] = pkg;
      report.apk = {
        ...report.apk,
        packageName,
        versionCode,
        versionName,
        nativeCode: /^native-code: (.+)$/m.exec(badging)?.[1],
      };
      if (packageName !== opts.package || versionName !== opts.version)
        throw new Error(
          `APK 身份不符:实得 ${packageName}@${versionName},期望 ${opts.package}@${opts.version}`,
        );
      const launch = /^launchable-activity: name='([^']+)'/m.exec(badging);
      if (!launch) throw new Error("APK 没有 launchable-activity");
      report.apk.activity = launch[1]!;
      return launch[1]!;
    });
    step("指定设备", () => {
      const devices = command([adb, "devices", "-l"]).toString("utf8");
      const row = devices
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .find((parts) => parts[0] === opts.device);
      if (!row) throw new Error(`没有指定设备:${opts.device}\n${devices}`);
      if (row[1] !== "device")
        throw new Error(`指定设备不可用:${opts.device},状态=${row[1]}\n${devices}`);
      report.environment.device = opts.device;
      report.environment.model = shell("shell", "getprop", "ro.product.model");
      report.environment.android = shell("shell", "getprop", "ro.build.version.release");
      report.environment.api = shell("shell", "getprop", "ro.build.version.sdk");
      report.environment.abi = shell("shell", "getprop", "ro.product.cpu.abilist");
      report.environment.emulator = shell("shell", "getprop", "ro.kernel.qemu") === "1";
      report.environment.webview = shell("shell", "dumpsys", "webviewupdate");
      report.environment.display = shell("shell", "wm", "size");
      report.environment.density = shell("shell", "wm", "density");
    });
    const since = step("记录设备起点", () => shell("shell", "date", "'+%m-%d %H:%M:%S.000'"));
    step("安装并核对版本", () => {
      const install = shell("install", "-r", opts.apk);
      if (!/^Success\s*$/m.test(install)) throw new Error(`安装未报告 Success:${install}`);
      const installed = shell("shell", "dumpsys", "package", opts.package);
      const version = /^\s*versionName=(.+)$/m.exec(installed);
      const code = /^\s*versionCode=(\d+)/m.exec(installed);
      if (
        !version ||
        version[1]!.trim() !== opts.version ||
        !code ||
        code[1] !== report.apk.versionCode
      )
        throw new Error(`安装后版本不符:${version?.[1]},code=${code?.[1]}`);
    });
    let pid = "";
    step("启动并核对前台", () => {
      const launch = shell("shell", "am", "start", "-W", "-n", `${opts.package}/${activity}`);
      if (!/^Status: ok\s*$/m.test(launch) || /Error:|Exception|Status: timeout/.test(launch))
        throw new Error(`启动失败:${launch}`);
      pid = shell("shell", "pidof", opts.package);
      if (!/^\d+( \d+)*$/.test(pid)) throw new Error(`启动后没有包进程:${pid}`);
      const resumed = shell("shell", "dumpsys", "activity", "activities");
      const foreground = resumed
        .split(/\r?\n/)
        .filter((line) => /(?:mResumedActivity|topResumedActivity)/.test(line));
      if (!foreground.some((line) => line.includes(`${opts.package}/`)))
        throw new Error(`目标包不在前台:${foreground.join("\n")}`);
      report.environment.pid = pid;
      report.environment.foreground = foreground;
      report.environment.logcatSince = since;
    });
    step("日志与截图", () => {
      // am start -W 只等 Activity 首帧;给 WebView 一段明确的取证观察期,不宣称页面已验收。
      shell("shell", "sleep", "3");
      const log = command([
        adb,
        "-s",
        opts.device,
        "logcat",
        "-d",
        "-T",
        since,
        `--pid=${pid.split(" ")[0]}`,
        "-v",
        "threadtime",
      ]);
      writeFileSync(join(opts.out, "logcat.txt"), log);
      report.evidence.logcat = "logcat.txt";
      const png = command([adb, "-s", opts.device, "exec-out", "screencap", "-p"], true);
      if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new Error("screencap 未返回 PNG");
      writeFileSync(join(opts.out, "screenshot.png"), png);
      report.evidence.screenshot = "screenshot.png";
      if (!shell("shell", "pidof", opts.package)) throw new Error("截图后 app 进程已退出");
      if (/FATAL EXCEPTION|Fatal signal \d+/.test(log.toString("utf8")))
        throw new Error("本包日志出现原生崩溃,见 logcat.txt");
    });
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    save();
    console.log(`[apk-smoke] ${report.status}: ${join(opts.out, "report.json")}`);
  }
}

try {
  smoke(options());
} catch (error) {
  console.error(`[apk-smoke] 失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
