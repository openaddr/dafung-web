import { join } from "node:path";

export const SERVICE_HOST = "127.0.0.1";
const SERVICE_NAME = "dafung.service";

export interface RunningServer {
  port: number;
  roomsDir: string;
  logsDir: string;
  mapsDir: string;
  extensionsDir: string;
}

export interface ServerSystemd {
  assertUnitSource(unitPath: string | null): void;
  isActive(): boolean;
  run(command: "daemon-reload" | "start" | "stop" | "enable" | "disable"): void;
  waitUntilReady(server: RunningServer): Promise<void>;
}

export function serverUnit(current: string, config: string): string {
  return `[Unit]
Description=dafung-web multiplayer engine
After=network.target

[Service]
Type=exec
User=root
WorkingDirectory=${join(current, "release")}
EnvironmentFile=${config}
EnvironmentFile=${join(current, "service.env")}
ExecStart=${join(current, "bun")} --no-env-file ${join(current, "release/server.js")}
Restart=on-failure
TimeoutStartSec=15s
TimeoutStopSec=15s

[Install]
WantedBy=multi-user.target
`;
}

function systemctl(command: string) {
  return Bun.spawnSync(
    command === "daemon-reload" ? ["systemctl", command] : ["systemctl", command, SERVICE_NAME],
  );
}

export const localSystemd: ServerSystemd = {
  assertUnitSource(unitPath) {
    const result = Bun.spawnSync([
      "systemctl",
      "show",
      "--all",
      "--property=FragmentPath,DropInPaths",
      SERVICE_NAME,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`systemctl show 失败:\n${result.stderr.toString()}`);
    }
    const lines = result.stdout.toString().trimEnd().split("\n");
    if (!lines.includes(`FragmentPath=${unitPath ?? ""}`) || !lines.includes("DropInPaths=")) {
      throw new Error(`systemd 管理器加载了其他单元或覆盖配置:${lines.join(" ")}`);
    }
  },
  isActive() {
    const result = systemctl("is-active");
    if (result.exitCode === 0) return true;
    if (result.exitCode === 3 || result.exitCode === 4) return false;
    throw new Error(`systemctl is-active 失败:\n${result.stderr.toString()}`);
  },
  run(command) {
    const result = systemctl(command);
    if (result.exitCode !== 0)
      throw new Error(`systemctl ${command} 失败:\n${result.stderr.toString()}`);
  },
  async waitUntilReady({ port, roomsDir, logsDir, mapsDir, extensionsDir }) {
    const base = `http://${SERVICE_HOST}:${port}`;
    const deadline = Date.now() + 10_000;
    let failure: unknown;
    while (Date.now() < deadline) {
      try {
        const options = { signal: AbortSignal.timeout(500), redirect: "error" } as const;
        const health = await fetch(base + "/health", options);
        if (!health.ok || (await health.json()).ok !== true) throw new Error("/health 未就绪");
        const info = await fetch(base + "/help", options);
        const { env } = await info.json();
        if (
          info.ok &&
          env.HOST === SERVICE_HOST &&
          env.PORT === port &&
          env.ROOMS_DIR === roomsDir &&
          env.LOGS_DIR === logsDir &&
          env.MAPS_DIR === mapsDir &&
          env.EXTENSIONS_DIR === extensionsDir &&
          this.isActive()
        ) {
          return;
        }
        throw new Error("systemd 服务或实际监听配置与预期不符");
      } catch (error) {
        failure = error;
      }
      await Bun.sleep(200);
    }
    throw new Error(`服务未通过本机健康检查:${base}/health`, { cause: failure });
  },
};
