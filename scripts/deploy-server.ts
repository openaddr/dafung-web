import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { installedBunVersion, RELEASE_TAG, stageServerRelease } from "./server-release-archive";
import {
  localSystemd,
  SERVICE_HOST,
  serverUnit,
  type RunningServer,
  type ServerSystemd,
} from "./server-systemd";

const DEFAULT_PORT = 3000;
const USAGE = `用法:
  bun deploy-server.js install --tag v<CalVer> --archive <发布包> --sha256 <SHA-256> [--port <端口>]
  bun deploy-server.js rollback
  bun deploy-server.js uninstall`;

export interface DeploymentHost {
  installDir: string;
  configDir: string;
  stateDir: string;
  unitPath: string;
  systemd: ServerSystemd;
}

const vps: DeploymentHost = {
  installDir: "/opt/dafung",
  configDir: "/etc/dafung",
  stateDir: "/var/lib/dafung",
  unitPath: "/etc/systemd/system/dafung.service",
  systemd: localSystemd,
};

interface ReleaseState {
  tag: string;
  dataId: string;
  port: number;
}

interface Selection {
  active: ReleaseState;
  previous: ReleaseState | null;
}

type Command =
  | { type: "install"; tag: string; archive: string; sha256: string; port?: number }
  | { type: "rollback" }
  | { type: "uninstall" };

function parseCommand([command, ...args]: string[]): Command {
  if ((command === "rollback" || command === "uninstall") && args.length === 0) {
    return { type: command };
  }
  if (command !== "install") throw new Error(USAGE);
  const { values } = parseArgs({
    args,
    options: {
      tag: { type: "string" },
      archive: { type: "string" },
      sha256: { type: "string" },
      port: { type: "string" },
    },
  });
  if (!values.tag || !values.archive || !values.sha256) throw new Error(USAGE);
  if (values.port === undefined) {
    return { type: command, tag: values.tag, archive: values.archive, sha256: values.sha256 };
  }
  const port = Number(values.port);
  if (!/^[1-9]\d{0,4}$/.test(values.port) || port > 65535) {
    throw new Error(`非法监听端口:${values.port}`);
  }
  return { type: command, tag: values.tag, archive: values.archive, sha256: values.sha256, port };
}

function currentSelection(current: string, activations: string) {
  const status = lstatSync(current, { throwIfNoEntry: false });
  if (!status) return null;
  if (!status.isSymbolicLink()) throw new Error(`部署指针必须是符号链接:${current}`);
  const target = readlinkSync(current);
  if (dirname(target) !== activations) throw new Error(`非法部署指针:${target}`);
  const selection = JSON.parse(readFileSync(join(target, "selection.json"), "utf8")) as Selection;
  for (const release of [selection.active, selection.previous]) {
    if (
      release !== null &&
      (!RELEASE_TAG.test(release.tag) ||
        !/^rooms-[a-zA-Z0-9]{6}$/.test(release.dataId) ||
        !Number.isInteger(release.port) ||
        release.port < 1 ||
        release.port > 65535)
    ) {
      throw new Error(`非法部署状态:${target}`);
    }
  }
  return { target, selection };
}

function select(current: string, target: string) {
  const staging = mkdtempSync(join(dirname(current), ".switch-"));
  const next = join(staging, "current");
  try {
    symlinkSync(target, next);
    renameSync(next, current);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function runtimePath(installDir: string, version: string): string {
  return join(installDir, "runtimes", version, "bun");
}

function retainRunningBun(installDir: string, version: string) {
  const bun = runtimePath(installDir, version);
  if (existsSync(bun)) return;
  const runtimes = dirname(dirname(bun));
  mkdirSync(runtimes, { recursive: true, mode: 0o750 });
  const staging = mkdtempSync(join(runtimes, ".incoming-"));
  try {
    copyFileSync(process.execPath, join(staging, "bun"), constants.COPYFILE_FICLONE);
    renameSync(staging, dirname(bun));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function runningServer(host: DeploymentHost, release: ReleaseState): RunningServer {
  const data = join(host.stateDir, "data", release.dataId);
  const payload = join(host.installDir, "releases", release.tag);
  return {
    port: release.port,
    roomsDir: join(data, "rooms"),
    logsDir: join(data, "logs"),
    mapsDir: join(payload, "maps"),
    extensionsDir: join(payload, "extensions"),
  };
}

function newData(stateDir: string): string {
  const parent = join(stateDir, "data");
  mkdirSync(parent, { recursive: true, mode: 0o750 });
  const data = mkdtempSync(join(parent, "rooms-"));
  mkdirSync(join(data, "rooms"), { mode: 0o750 });
  mkdirSync(join(data, "logs"), { mode: 0o750 });
  return basename(data);
}

function prepareSelection(host: DeploymentHost, activations: string, selection: Selection): string {
  const deployed = selection.active;
  const releaseDir = join(host.installDir, "releases", deployed.tag);
  const bunVersion = installedBunVersion(releaseDir, deployed.tag);
  const bun = runtimePath(host.installDir, bunVersion);
  const version = Bun.spawnSync([bun, "--version"]);
  if (version.exitCode !== 0 || version.stdout.toString().trim() !== bunVersion) {
    throw new Error(`部署保留的 Bun 运行时需要 bun@${bunVersion}:${bun}`);
  }

  const { port, roomsDir, logsDir, mapsDir, extensionsDir } = runningServer(host, deployed);
  if (!lstatSync(roomsDir).isDirectory() || !lstatSync(logsDir).isDirectory()) {
    throw new Error(`部署状态目录损坏:${deployed.dataId}`);
  }
  mkdirSync(activations, { recursive: true, mode: 0o750 });
  const target = mkdtempSync(join(activations, "activation-"));
  symlinkSync(releaseDir, join(target, "release"));
  symlinkSync(bun, join(target, "bun"));
  writeFileSync(join(target, "selection.json"), JSON.stringify(selection) + "\n");
  writeFileSync(
    join(target, "service.env"),
    [
      `HOST=${SERVICE_HOST}`,
      `PORT=${port}`,
      `ROOMS_DIR=${roomsDir}`,
      `LOGS_DIR=${logsDir}`,
      `MAPS_DIR=${mapsDir}`,
      `EXTENSIONS_DIR=${extensionsDir}`,
    ].join("\n") + "\n",
  );
  return target;
}

function ensureConfig(config: string) {
  mkdirSync(dirname(config), { recursive: true, mode: 0o750 });
  if (!existsSync(config)) {
    writeFileSync(config, "# Dafung: LOG_TTL_DAYS, DECISION_TIMEOUT_MS\n", {
      flag: "wx",
      mode: 0o600,
    });
  }
}

function managedUnitExists(unitPath: string, unit: string): boolean {
  const status = lstatSync(unitPath, { throwIfNoEntry: false });
  if (status && (!status.isFile() || readFileSync(unitPath, "utf8") !== unit)) {
    throw new Error(`已有其他 systemd 单元，需先处理:${unitPath}`);
  }
  return Boolean(status);
}

function installUnit(unitPath: string, unit: string) {
  const staging = mkdtempSync(join(dirname(unitPath), ".dafung-unit-"));
  const stagedUnit = join(staging, basename(unitPath));
  try {
    writeFileSync(stagedUnit, unit, { flag: "wx", mode: 0o644 });
    linkSync(stagedUnit, unitPath);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function assertPointer(current: string, expected: string | null) {
  const status = lstatSync(current, { throwIfNoEntry: false });
  if (status ? !status.isSymbolicLink() || readlinkSync(current) !== expected : expected !== null) {
    throw new Error(`部署指针已改变:${current}`);
  }
}

async function activate(
  host: DeploymentHost,
  current: string,
  before: ReturnType<typeof currentSelection>,
  target: string,
  active: ReleaseState,
  unitExists: boolean,
  unit: string,
) {
  const { systemd, unitPath } = host;
  if (managedUnitExists(unitPath, unit) !== unitExists) {
    throw new Error(`systemd 单元在准备期间改变:${unitPath}`);
  }
  systemd.run("daemon-reload");
  systemd.assertUnitSource(unitExists ? unitPath : null);
  const oldRunning = systemd.isActive();
  if (!unitExists && oldRunning) throw new Error(`systemd 仍在运行其他服务:${unitPath}`);
  let switched = false;
  let installed = false;
  let attemptedStart = false;
  let attemptedEnable = false;
  try {
    assertPointer(current, before ? before.target : null);
    if (unitExists) systemd.run("stop");
    assertPointer(current, before ? before.target : null);
    select(current, target);
    switched = true;
    if (!unitExists) {
      installUnit(unitPath, unit);
      installed = true;
      systemd.run("daemon-reload");
      systemd.assertUnitSource(unitPath);
    }
    attemptedStart = true;
    systemd.run("start");
    await systemd.waitUntilReady(runningServer(host, active));
    attemptedEnable = true;
    systemd.run("enable");
  } catch (error) {
    const failures: Error[] = [];
    const record = (step: string, cause: unknown) => {
      failures.push(
        new Error(`${step}:${cause instanceof Error ? cause.message : String(cause)}`, { cause }),
      );
    };
    const recover = (step: string, action: () => void): boolean => {
      try {
        action();
        return true;
      } catch (cause) {
        record(step, cause);
        return false;
      }
    };

    let candidateStopped = !attemptedStart;
    if (
      attemptedStart &&
      recover("确认候选服务归属失败", () => {
        assertPointer(current, target);
        systemd.assertUnitSource(unitPath);
      })
    ) {
      recover("停止候选服务失败", () => systemd.run("stop"));
      candidateStopped = recover("确认候选服务已停止失败", () => {
        if (systemd.isActive()) throw new Error("候选服务仍在运行");
      });
    }
    const restored = recover("恢复部署指针失败", () => {
      assertPointer(current, switched ? target : before ? before.target : null);
      if (switched) {
        if (before) select(current, before.target);
        else unlinkSync(current);
      }
    });
    if (installed && candidateStopped && restored) {
      recover("撤除新建 systemd 单元失败", () => {
        if (!managedUnitExists(unitPath, unit)) throw new Error(`新建单元已移除:${unitPath}`);
        if (attemptedEnable) {
          systemd.assertUnitSource(unitPath);
          systemd.run("disable");
        }
        unlinkSync(unitPath);
        systemd.run("daemon-reload");
      });
    }
    if (oldRunning && before && restored && candidateStopped) {
      try {
        assertPointer(current, before.target);
        systemd.assertUnitSource(unitPath);
        systemd.run("start");
        await systemd.waitUntilReady(runningServer(host, before.selection.active));
      } catch (cause) {
        record("原服务未恢复就绪", cause);
      }
    }
    if (failures.length) {
      throw new AggregateError(
        [error, ...failures],
        `部署切换失败，恢复步骤报错:\n${failures.map((failure) => failure.message).join("\n")}`,
      );
    }
    throw new Error("部署切换失败，已恢复切换前状态", { cause: error });
  }
}

export async function deployServer(args: string[], host: DeploymentHost = vps): Promise<string> {
  const command = parseCommand(args);
  const { installDir, stateDir, unitPath, configDir, systemd } = host;
  const current = join(installDir, "current");
  const config = join(configDir, "app.env");
  const activations = join(stateDir, "activations");
  const releases = join(installDir, "releases");
  const unit = serverUnit(current, config);
  mkdirSync(stateDir, { recursive: true, mode: 0o750 });
  const lock = join(stateDir, ".deploy-lock");
  try {
    mkdirSync(lock);
  } catch (cause) {
    throw new Error(`无法获取部署锁:${lock}`, { cause });
  }

  try {
    const unitExists = managedUnitExists(unitPath, unit);
    if (command.type === "uninstall") {
      systemd.run("daemon-reload");
      systemd.assertUnitSource(unitExists ? unitPath : null);
      if (unitExists) {
        systemd.run("stop");
        systemd.run("disable");
        unlinkSync(unitPath);
        systemd.run("daemon-reload");
      }
      return "已卸载 dafung.service，应用文件、配置和数据已保留";
    }

    const before = currentSelection(current, activations);
    if (unitExists && !before) throw new Error(`systemd 服务缺少部署指针:${current}`);
    const prior = before ? before.selection.active : null;
    let selection: Selection;
    if (command.type === "rollback") {
      if (!before || !before.selection.previous) throw new Error("没有可回滚的部署");
      selection = { active: before.selection.previous, previous: before.selection.active };
    } else {
      const bunVersion = await stageServerRelease(releases, command);
      retainRunningBun(installDir, bunVersion);
      const sameRelease = prior !== null && prior.tag === command.tag;
      selection = {
        active: {
          tag: command.tag,
          dataId: sameRelease ? prior.dataId : newData(stateDir),
          port: command.port === undefined ? (prior ? prior.port : DEFAULT_PORT) : command.port,
        },
        previous: sameRelease && before ? before.selection.previous : prior,
      };
    }
    ensureConfig(config);
    const target = prepareSelection(host, activations, selection);
    await activate(host, current, before, target, selection.active, unitExists, unit);
    return `已启用 ${selection.active.tag}，监听 ${SERVICE_HOST}:${selection.active.port}`;
  } finally {
    rmdirSync(lock);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(USAGE);
  } else {
    try {
      if (process.platform !== "linux" || process.getuid?.() !== 0) {
        throw new Error("请在 Linux systemd 主机以 root 运行部署工具");
      }
      console.log(await deployServer(args));
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
}
