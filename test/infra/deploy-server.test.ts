import { expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deployServer, type DeploymentHost } from "../../scripts/deploy-server";

const OLD = "v2026.11.80";
const NEW = "v2026.11.81";
const CORE = resolve(import.meta.dir, "../../packages/core");

function sandbox() {
  const directory = mkdtempSync(join(tmpdir(), "dafung-deploy-"));
  const unitPath = join(directory, "systemd/dafung.service");
  const installDir = join(directory, "opt");
  const configDir = join(directory, "etc");
  const stateDir = join(directory, "state");
  mkdirSync(join(directory, "systemd"));
  const commands: string[] = [];
  let active = false;
  let managerLoaded = false;
  let failure: { command: string; skip: number; stopped: boolean } | undefined;
  let readinessChecks = 0;
  let rejectNextStart = false;
  let ready: { port: number; roomsDir: string; logsDir: string } | undefined;
  const host: DeploymentHost = {
    installDir,
    configDir,
    stateDir,
    unitPath,
    systemd: {
      assertUnitSource(path) {
        if (path !== (managerLoaded ? unitPath : null)) throw new Error("unit source mismatch");
      },
      isActive: () => active,
      run(command) {
        commands.push(command);
        if (failure?.command === command && failure.skip-- === 0) {
          if (failure.stopped) active = false;
          failure = undefined;
          throw new Error(`systemctl ${command} simulated failure`);
        }
        if (command === "daemon-reload") managerLoaded = existsSync(unitPath);
        if (command === "start") {
          if (!managerLoaded) throw new Error("systemd manager does not know the unit");
          active = true;
        }
        if (command === "stop" || command === "disable") active = false;
      },
      async waitUntilReady(expected) {
        readinessChecks++;
        if (!active) throw new Error("test service is stopped");
        if (rejectNextStart) {
          rejectNextStart = false;
          writeFileSync(join(expected.roomsDir, "failed-room.json"), "saved before unhealthy");
          throw new Error("health check failure");
        }
        ready = expected;
      },
    },
  };
  const install = async (
    tag: string,
    options?: { bunVersion?: string; port?: string; unsafe?: boolean },
  ) => {
    const input = mkdtempSync(join(directory, "input-"));
    const payload = join(input, "payload");
    mkdirSync(join(payload, "maps/boards"), { recursive: true });
    mkdirSync(join(payload, "extensions"));
    writeFileSync(join(payload, "server.js"), "console.log('server');");
    writeFileSync(
      join(payload, "release.json"),
      JSON.stringify({ version: tag.slice(1), bunVersion: options?.bunVersion ?? Bun.version }),
    );
    const maps = JSON.parse(readFileSync(join(CORE, "maps/index.json"), "utf8")) as {
      file: string;
    }[];
    for (const map of maps) {
      copyFileSync(join(CORE, "maps", map.file), join(payload, "maps/boards", map.file));
      map.file = `boards/${map.file}`;
    }
    writeFileSync(join(payload, "maps/index.json"), JSON.stringify(maps));
    if (options?.unsafe) symlinkSync("../../../etc/passwd", join(payload, "extensions/unsafe.js"));
    const archive = join(input, `dafung-server-${tag}.tar.gz`);
    const tar = Bun.spawnSync(["tar", "-czf", archive, "-C", payload, "."]);
    if (tar.exitCode !== 0) throw new Error(tar.stderr.toString());
    const sha256 = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(archive).arrayBuffer())
      .digest("hex");
    const args = ["install", "--tag", tag, "--archive", archive, "--sha256", sha256];
    if (options?.port) args.push("--port", options.port);
    return args;
  };
  return {
    installDir,
    unitPath,
    failCommand: (command: string, skip = 0, stopped = false) => {
      failure = { command, skip, stopped };
    },
    forgetUnit: () => {
      active = false;
      managerLoaded = false;
    },
    managerLoaded: () => managerLoaded,
    readinessChecks: () => readinessChecks,
    configDir,
    stateDir,
    commands,
    failHealthCheck: () => {
      rejectNextStart = true;
    },
    install,
    run: (args: string[]) => deployServer(args, host),
    service: () => readFileSync(unitPath, "utf8"),
    current: () => readFileSync(join(installDir, "current/release/release.json"), "utf8"),
    env: () => readFileSync(join(installDir, "current/service.env"), "utf8"),
    ready: () => {
      if (!ready) throw new Error("expected a ready test service");
      return ready;
    },
    clean: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("安装已核验的指定版本，systemd 以 root 运行且只监听本机端口", async () => {
  const host = sandbox();
  try {
    await host.run(await host.install(OLD, { port: "3120" }));
    expect(host.service()).toContain("User=root");
    expect(host.service()).toContain("/current/release/server.js");
    expect(host.env()).toContain("HOST=127.0.0.1\nPORT=3120\n");
    expect(JSON.parse(host.current())).toMatchObject({ version: "2026.11.80" });
    expect(host.ready().port).toBe(3120);
    const mapsDir = join(host.installDir, "releases", OLD, "maps");
    const extensionsDir = join(host.installDir, "releases", OLD, "extensions");
    expect(host.env()).toContain(`MAPS_DIR=${mapsDir}\nEXTENSIONS_DIR=${extensionsDir}\n`);
    expect(host.ready()).toMatchObject({ mapsDir, extensionsDir });
    expect(host.commands).toEqual(["daemon-reload", "daemon-reload", "start", "enable"]);
  } finally {
    host.clean();
  }
});

test("同版重启沿用房间，跨版从空房启动，回滚恢复旧版数据", async () => {
  const host = sandbox();
  try {
    const first = await host.install(OLD);
    await host.run(first);
    const oldData = host.ready();
    expect(oldData.port).toBe(3000);
    writeFileSync(join(oldData.roomsDir, "old-room.json"), "old room");
    writeFileSync(join(oldData.logsDir, "old-game.jsonl"), "old log");

    await host.run(first);
    expect(host.ready()).toEqual(oldData);
    expect(readFileSync(join(host.ready().roomsDir, "old-room.json"), "utf8")).toBe("old room");

    const next = await host.install(NEW);
    await host.run([...next, "--port", "3125"]);
    const newData = host.ready();
    expect(newData.roomsDir).not.toBe(oldData.roomsDir);
    expect(readdirSync(newData.roomsDir)).toEqual([]);
    expect(newData.port).toBe(3125);
    writeFileSync(join(newData.roomsDir, "new-room.json"), "new room");

    await host.run(["rollback"]);
    expect(JSON.parse(host.current()).version).toBe("2026.11.80");
    expect(host.ready()).toEqual(oldData);
    expect(readFileSync(join(host.ready().logsDir, "old-game.jsonl"), "utf8")).toBe("old log");
    expect(readFileSync(join(newData.roomsDir, "new-room.json"), "utf8")).toBe("new room");

    await host.run(next);
    expect(host.ready().roomsDir).not.toBe(newData.roomsDir);
    expect(readdirSync(host.ready().roomsDir)).toEqual([]);
  } finally {
    host.clean();
  }
});

test("新版未就绪时恢复在运行的旧版，普通卸载保留配置和各版数据", async () => {
  const host = sandbox();
  try {
    const first = await host.install(OLD);
    await host.run(first);
    const before = host.ready();
    writeFileSync(join(before.roomsDir, "room.json"), "keep");
    const config = join(host.configDir, "app.env");
    writeFileSync(config, "LOG_TTL_DAYS=60\n");

    host.commands.length = 0;
    host.failHealthCheck();
    await expect(host.run(await host.install(NEW))).rejects.toThrow("已恢复切换前状态");
    expect(host.commands).toEqual(["daemon-reload", "stop", "start", "stop", "start"]);
    expect(JSON.parse(host.current()).version).toBe("2026.11.80");
    expect(host.ready()).toEqual(before);
    const dataRoot = join(host.stateDir, "data");
    const failedData = readdirSync(dataRoot).find(
      (id) => !before.roomsDir.startsWith(join(dataRoot, id) + "/"),
    );
    if (!failedData) throw new Error("expected the failed activation's saved data");
    const failed = join(dataRoot, failedData, "rooms", "failed-room.json");
    expect(readFileSync(failed, "utf8")).toBe("saved before unhealthy");

    host.commands.length = 0;
    await host.run(["uninstall"]);
    expect(host.commands).toEqual(["daemon-reload", "stop", "disable", "daemon-reload"]);
    expect(existsSync(host.unitPath)).toBe(false);
    expect(readFileSync(config, "utf8")).toBe("LOG_TTL_DAYS=60\n");
    expect(readFileSync(join(before.roomsDir, "room.json"), "utf8")).toBe("keep");
    expect(existsSync(failed)).toBe(true);

    await host.run(first);
    expect(host.ready()).toEqual(before);
  } finally {
    host.clean();
  }
});

test("摘要、Bun 版本或归档路径不符时保留在运行的服务", async () => {
  const host = sandbox();
  try {
    await host.run(await host.install(OLD));
    const before = host.ready();
    host.commands.length = 0;

    const wrongDigest = await host.install(NEW);
    wrongDigest[wrongDigest.length - 1] = "a".repeat(64);
    await expect(host.run(wrongDigest)).rejects.toThrow("SHA-256 不匹配");
    await expect(host.run(await host.install(NEW, { bunVersion: "9.9.9" }))).rejects.toThrow(
      "发布包需要 bun@9.9.9",
    );
    await expect(host.run(await host.install(NEW, { unsafe: true }))).rejects.toThrow(
      "发布包含非普通文件或非法路径",
    );
    expect(host.commands).toEqual([]);
    expect(JSON.parse(host.current()).version).toBe("2026.11.80");
    expect(host.ready()).toEqual(before);
  } finally {
    host.clean();
  }
});

test("停候选服务失败仍恢复部署指针，并明确报告进程恢复失败", async () => {
  const host = sandbox();
  try {
    await host.run(await host.install(OLD));
    const previous = host.ready();
    host.failHealthCheck();
    host.failCommand("stop", 1);
    await expect(host.run(await host.install(NEW))).rejects.toThrow("停止候选服务失败");
    expect(JSON.parse(host.current()).version).toBe("2026.11.80");
    expect(host.ready()).toEqual(previous);
    expect(host.readinessChecks()).toBe(2);
  } finally {
    host.clean();
  }
});

test("停旧服务的命令报错后重启并检查原先运行的服务", async () => {
  const host = sandbox();
  try {
    await host.run(await host.install(OLD));
    const previous = host.ready();
    host.failCommand("stop", 0, true);
    await expect(host.run(await host.install(NEW))).rejects.toThrow("已恢复切换前状态");
    expect(host.ready()).toEqual(previous);
    expect(host.readinessChecks()).toBe(2);
    expect(JSON.parse(host.current()).version).toBe("2026.11.80");
  } finally {
    host.clean();
  }
});

test("停候选服务报错但进程已退出时重启并检查旧服务", async () => {
  const host = sandbox();
  try {
    await host.run(await host.install(OLD));
    const previous = host.ready();
    host.failHealthCheck();
    host.failCommand("stop", 1, true);
    await expect(host.run(await host.install(NEW))).rejects.toThrow("停止候选服务失败");
    expect(host.readinessChecks()).toBe(3);
    expect(host.ready()).toEqual(previous);
    expect(JSON.parse(host.current()).version).toBe("2026.11.80");
  } finally {
    host.clean();
  }
});

test("重试会同步磁盘与 systemd 管理器，包括写入后和删除后中断", async () => {
  const host = sandbox();
  try {
    const first = await host.install(OLD);
    await host.run(first);
    host.forgetUnit();
    await host.run(first);
    expect(host.managerLoaded()).toBe(true);

    host.failCommand("daemon-reload", 1);
    await expect(host.run(["uninstall"])).rejects.toThrow("daemon-reload simulated failure");
    expect(existsSync(host.unitPath)).toBe(false);
    expect(host.managerLoaded()).toBe(true);
    await host.run(["uninstall"]);
    expect(host.managerLoaded()).toBe(false);
  } finally {
    host.clean();
  }
});

test("同标签保留文件被改动时，在停止现有服务前报出受损路径", async () => {
  const host = sandbox();
  try {
    const first = await host.install(OLD);
    await host.run(first);
    const previous = host.ready();
    const map = join(host.installDir, "releases", OLD, "maps/boards/zhongyuan.json");
    writeFileSync(map, "{}");
    host.commands.length = 0;
    await expect(host.run(first)).rejects.toThrow("maps/boards/zhongyuan.json");
    expect(host.commands).toEqual([]);
    expect(host.ready()).toEqual(previous);
    expect(readFileSync(map, "utf8")).toBe("{}");
  } finally {
    host.clean();
  }
});

test("旧版本地图内容损坏时回滚保留在运行的服务", async () => {
  const host = sandbox();
  try {
    await host.run(await host.install(OLD));
    await host.run(await host.install(NEW));
    const running = host.ready();
    writeFileSync(join(host.installDir, "releases", OLD, "maps/boards/zhongyuan.json"), "{}");
    host.commands.length = 0;
    await expect(host.run(["rollback"])).rejects.toThrow("maps/boards/zhongyuan.json");
    expect(host.commands).toEqual([]);
    expect(host.ready()).toEqual(running);
    expect(JSON.parse(host.current()).version).toBe("2026.11.81");
  } finally {
    host.clean();
  }
});
