// 服务器消息处理器 cmd 分支错误回报(#428,#426 波次):非法命令注入 → 该客户端
// 收到 error 下行、服务器进程存活。联机端 interactive 判定与服务端结算之间隔一个
// RTT,多人延迟下竞态非法命令必然出现(如反应窗已闭仍应答、过期快照上的操作);
// pickCapital/autoPilot 两分支均有 .catch→error 下行(显式向用户报错,零兜底例外①),
// cmd 分支同口径——引擎 submitCommand 抛错(零兜底契约)必须回报给发送者而非炸进程。
// 注入手法:respondReaction 携带越界 seat(座位号随命令过网,越界即 players[seat]
// 取 undefined 抛 TypeError)——与竞态同源:非法载荷服务端当场拒绝。
// 真 WS 真 HTTP(子进程起 scripts/server.ts,同 playwright.config webServer 口径)。
import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = "4280"; // 本票专用测试端口(避开 e2e 的 3021/4184 与默认 3000)
const BASE = `http://127.0.0.1:${PORT}`;
const ROOMS_DIR = mkdtempSync(join(tmpdir(), "dafung-428-"));

const proc = Bun.spawn(["bun", "scripts/server.ts"], {
  cwd: join(import.meta.dir, ".."), // 仓库根:地图清单 ./public/maps 相对 cwd 解析(缺失即抛)
  env: {
    ...process.env,
    PORT,
    HOST: "127.0.0.1",
    ROOMS_DIR,
    LOGS_DIR: ROOMS_DIR, // 对局日志一并落临时目录,不污染仓库 data/
    STATIC_DIR: ROOMS_DIR, // 无静态托管需求(静态只按请求读,目录缺失本就 404)
  },
  stdout: "pipe",
  stderr: "pipe",
});

afterAll(() => {
  proc.kill();
  rmSync(ROOMS_DIR, { recursive: true, force: true });
});

async function waitHealthy(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* 未起监听,继续轮询 */
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `服务器 ${timeoutMs}ms 内未就绪;stderr:${await new Response(proc.stderr).text()}`,
  );
}

function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<Record<string, unknown>>);
}

/** 收一条下行(文本帧),JSON 解出;超时抛错(区分「没有下行」与「下行形状错」)。 */
function nextMessage(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待下行超时")), timeoutMs);
    ws.addEventListener(
      "message",
      (ev) => {
        clearTimeout(timer);
        const data = typeof ev.data === "string" ? ev.data : "无法解析的下行帧";
        try {
          resolve(JSON.parse(data) as Record<string, unknown>);
        } catch {
          reject(new Error(`下行非 JSON:${data}`));
        }
      },
      { once: true },
    );
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      reject(new Error("连接被关闭(未收到下行)——疑似服务器进程已崩"));
    });
  });
}

/** 连收下行直至出现指定类型(开局期 bot 驱动的 events/snapshot 广播与错误回报交织,逐条滤过)。 */
async function nextMessageOfType(
  ws: WebSocket,
  type: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  for (;;) {
    const msg = await nextMessage(ws, timeoutMs);
    if (msg.type === type) return msg;
  }
}

function openWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error("WS 连接失败")), { once: true });
  });
}

describe("server cmd 分支错误回报(#428)", () => {
  it("非法命令注入:该客户端收到 error 下行,服务器进程存活且服务继续", async () => {
    await waitHealthy();

    // 建房(2 座,座位 1 bot)→ 选图 → 开局(停在选都三选一)
    const created = await post("/room/new", { seats: 2, bot: "1", seed: 42 });
    const roomId = created.roomId as string;
    const token = created.seatToken as string;
    expect(created.ok).toBe(true);
    await post("/room/map", { roomId, seatToken: token, mapId: "sanguo" });
    const started = await post("/room/start", { roomId, seatToken: token });
    expect(started.ok).toBe(true);

    // 座位 0 连接:首连摘要先行
    const ws = await openWs(`ws://127.0.0.1:${PORT}/ws?room=${roomId}&seat=0&token=${token}`);
    const first = await nextMessage(ws);
    expect(["snapshot", "lobby"]).toContain(first.type as string);

    // 注入非法命令:respondReaction 携带越界 seat(合法房间只有座位 0/1)
    ws.send(
      JSON.stringify({ type: "cmd", cmd: { type: "respondReaction", seat: 99, use: false } }),
    );

    // 该客户端收到 error 下行(与 pickCapital/autoPilot 分支同形状:{type:"error",error})
    const err = await nextMessageOfType(ws, "error");
    expect(err.type).toBe("error");
    expect(typeof err.error).toBe("string");
    expect(err.error as string).not.toBe("");

    // 进程存活:端口仍应答健康检查(未处理拒绝在 Bun 下默认按进程级错误崩——修复前此处先死于上一断言)
    await Bun.sleep(300); // 给潜在异步崩溃留出暴露时间
    const health = await fetch(`${BASE}/health`);
    expect(health.ok).toBe(true);
    expect(proc.exitCode).toBeNull();

    ws.close();
  });
});
