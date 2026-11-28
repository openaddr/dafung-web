import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OnlineClient } from "../../scripts/online-client";

const ROOT = resolve(import.meta.dir, "../..");

function run(args: string[], cwd: string): string {
  const child = Bun.spawnSync(args, { cwd });
  if (child.exitCode !== 0) {
    throw new Error(`${args.join(" ")} 退出 ${child.exitCode}\n${child.stderr.toString()}`);
  }
  return child.stdout.toString();
}

async function startServer(unpacked: string, cwd: string) {
  const child = Bun.spawn([process.execPath, join(unpacked, "server.js")], {
    cwd,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0",
      ROOMS_DIR: join(cwd, "rooms"),
      LOGS_DIR: join(cwd, "logs"),
      EXTENSIONS_DIR: undefined,
      MAPS_DIR: undefined,
      STATIC_DIR: unpacked,
      E2E_BOT_STEP_MS: "0",
      DECISION_TIMEOUT_MS: "0",
      RETENTION_WINDOW_MS: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = new Response(child.stderr).text();
  const output = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let stdout = "";
  const drained = (async () => {
    try {
      while (true) {
        const result = await output.read();
        if (result.done) break;
        stdout += result.value;
      }
    } finally {
      output.releaseLock();
    }
  })();
  const stop = async () => {
    if (child.exitCode === null) child.kill();
    await Promise.all([child.exited, drained, stderr]);
  };
  const deadline = Date.now() + 5000;
  while (child.exitCode === null && Date.now() < deadline) {
    const url = stdout.match(/已启动 → (http:\/\/127\.0\.0\.1:\d+)\r?\n/)?.[1];
    if (url) return { url, stdout, stop };
    await Bun.sleep(20);
  }
  await stop();
  throw new Error(`发布包服务未启动\n${stdout}\n${await stderr}`);
}

async function json<T>(base: string, path: string, body?: object): Promise<T> {
  const response = await fetch(
    base + path,
    body && {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new Error(`${path} 应答 ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

test("解包后独立运行 HTTP 大厅和 WebSocket，同版本重启后持原令牌继续选都", async () => {
  const work = mkdtempSync(join(tmpdir(), "dafung-server-artifact-"));
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let client: OnlineClient | undefined;
  try {
    const unpacked = join(work, "unpacked");
    const runtime = join(work, "runtime");
    mkdirSync(unpacked);
    mkdirSync(runtime);
    const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const archive = join(work, `dafung-server-v${version}.tar.gz`);
    run([process.execPath, join(ROOT, "scripts/build-server.ts"), "--out-dir", work], work);
    run(["tar", "-xzf", archive, "-C", unpacked], work);

    const files = [...new Bun.Glob("**/*").scanSync(unpacked)].map((path) =>
      path.replaceAll("\\", "/"),
    );
    const maps = JSON.parse(readFileSync(join(unpacked, "maps/index.json"), "utf8")) as {
      file: string;
    }[];
    expect(files.sort()).toEqual(
      [
        "server.js",
        "release.json",
        "maps/index.json",
        ...maps.map((map) => `maps/${map.file}`),
        "extensions/hero-taishici/manifest.json",
        "extensions/hero-taishici/index.js",
      ].sort(),
    );
    expect(JSON.parse(readFileSync(join(unpacked, "release.json"), "utf8"))).toEqual({
      version,
      bunVersion: Bun.version,
    });

    server = await startServer(unpacked, runtime);
    expect(server.stdout).toContain("hero-taishici@");
    expect(await json(server.url, "/health")).toMatchObject({ rooms: 0 });
    expect(await json(server.url, "/help")).toMatchObject({
      env: {
        HOST: "127.0.0.1",
        MAPS_DIR: join(unpacked, "maps"),
        EXTENSIONS_DIR: join(unpacked, "extensions"),
        ROOMS_DIR: join(runtime, "rooms"),
        LOGS_DIR: join(runtime, "logs"),
      },
    });
    expect((await fetch(`${server.url}/server.js`)).status).toBe(404);
    const { roomId, seat, seatToken } = await json<{
      roomId: string;
      seat: number;
      seatToken: string;
    }>(server.url, "/room/new", { seats: 2, bot: "1", seed: 2 });
    const credentials = { roomId, seatToken };
    await json(server.url, "/room/map", { ...credentials, mapId: "zhongyuan" });
    await json(server.url, "/room/start", credentials);
    const wsPath = `/ws?room=${roomId}&seat=${seat}&token=${seatToken}`;
    client = await OnlineClient.connect(server.url.replace(/^http:/, "ws:") + wsPath);
    const before = await client.waitSnapshot(
      (snapshot) => snapshot.currentSetupPlayerIndex === seat,
      "房主选都",
      2000,
    );
    expect(before.offeredCapitals).toHaveLength(3);
    await server.stop();
    client.close();

    server = await startServer(unpacked, runtime);
    expect(await json(server.url, "/health")).toMatchObject({ rooms: 1 });
    client = await OnlineClient.connect(server.url.replace(/^http:/, "ws:") + wsPath);
    const restored = await client.waitSnapshot(null, "原座恢复摘要", 2000);
    expect(restored).toMatchObject({
      roomId,
      mapId: "zhongyuan",
      phase: "Setup",
      currentSetupPlayerIndex: seat,
      offeredCapitals: before.offeredCapitals,
    });
    expect(restored.decisionPoint).toBe(before.decisionPoint);
    expect(restored.decisionOptions).toEqual(before.decisionOptions);
    const option = restored.decisionOptions!.options.find((candidate) => candidate.available)!;
    client.sendSubmission({
      roomId,
      seat,
      submissionId: "confirm-capital",
      decisionPoint: restored.decisionPoint!,
      cmd: { type: "pickCapital", tileIndex: option.tileIndex },
    });
    await client.waitSnapshot((snapshot) => snapshot.phase === "Playing", "选都完成", 2000);
  } finally {
    client?.close();
    await server?.stop();
    rmSync(work, { recursive: true, force: true });
  }
}, 15000);
