// 权威引擎服务器(联机化第 2 步):多房间 + WebSocket + 静态托管 + 落盘恢复。
// 运行:npm run serve  (env: PORT / HOST / ROOMS_DIR / STATIC_DIR)
//
// 模型:Map<roomId, RoomSession> 内存挂多局,每局一条 GameEngine;每次变更落
// rooms/<roomId>.json(含 seatToken,重启可恢复 + 重连凭据不丢)。
// 客户端:WS 连 /ws?room=&seat=&token= → 发 {type:"cmd",cmd:GameCommand},
//        收 {type:"snapshot", roomId, ...engineSnapshot}。
// 设计见 docs/multiplayer.md + docs/adr/0001..0005。
//
// 本文件 = 任务 6(骨架)。seatToken/大厅细化(任务 7)、掉线冻结/房主出口(任务 8)
// 在此之上叠加;客户端网络层(任务 9)、大厅 UI(任务 10)在 src/render 侧。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { randomBytes, randomInt } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { GameEngine } from "../src/core/game";
import type { SeatConfig } from "../src/core/game";
import type { AiDifficulty, GameCommand } from "../src/core/types";
import { autoResolveBots, autoSetup, createEngine, statusOf, type GameConfig } from "./engine-helpers";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "127.0.0.1";
const ROOMS_DIR = resolve(process.env.ROOMS_DIR ?? "./rooms");
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? "./dist");
// 去掉易混的 I/L/O,降低口传房间码出错率
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LEN = 4;

// ──────────────────────────── 房间(Room)────────────────────────────
interface RoomSession {
  roomId: string;
  engine: GameEngine;
  config: GameConfig;
  seatTokens: string[]; // seat 索引 → 不可猜 token(Seat 归属凭证,ADR-0005;持久化以便重启后重连)
  conns: Map<number, WebSocket>; // seat → 当前连接(掉线处理见任务 8)
}
interface RoomRecord {
  roomId: string;
  snapshot: ReturnType<GameEngine["snapshot"]>;
  config: GameConfig;
  seatTokens: string[];
}

const rooms = new Map<string, RoomSession>();
const startedAt = Date.now();

function roomPath(roomId: string): string {
  return join(ROOMS_DIR, `${roomId}.json`);
}
function persistRoom(r: RoomSession): void {
  const rec: RoomRecord = {
    roomId: r.roomId,
    snapshot: r.engine.snapshot(),
    config: r.config,
    seatTokens: r.seatTokens,
  };
  writeFileSync(roomPath(r.roomId), JSON.stringify(rec, null, 2), "utf-8");
}
function hydrate(rec: RoomRecord): RoomSession {
  const engine = createEngine(rec.config, false);
  engine.restoreFromSnapshot(rec.snapshot);
  return { roomId: rec.roomId, engine, config: rec.config, seatTokens: rec.seatTokens, conns: new Map() };
}

// 启动:确保目录 + 扫描恢复所有进行中的房间
mkdirSync(ROOMS_DIR, { recursive: true });
for (const f of readdirSync(ROOMS_DIR)) {
  if (!f.endsWith(".json")) continue;
  try {
    const rec = JSON.parse(readFileSync(join(ROOMS_DIR, f), "utf-8")) as RoomRecord;
    const s = hydrate(rec);
    rooms.set(s.roomId, s);
  } catch (e) {
    console.warn(`[server] 跳过损坏的房间文件 ${f}:${e instanceof Error ? e.message : e}`);
  }
}

// ──────────────────────────── HTTP 工具 ────────────────────────────
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
function httpError(status: number, message: string): HttpError {
  return new HttpError(status, message);
}
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(json);
}
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf-8");
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(400, "请求体不是合法 JSON");
  }
}
function asObject(body: unknown): Record<string, unknown> {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "请求体应为 JSON 对象");
  }
  return body as Record<string, unknown>;
}
function intField(body: Record<string, unknown>, key: string, fallback: number): number {
  const v = body[key];
  if (v == null) return fallback;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n)) throw httpError(400, `${key} 不是整数`);
  return n;
}
function parseSeatConfig(body: Record<string, unknown>): GameConfig {
  const seatsNum = intField(body, "seats", 2);
  if (!(seatsNum >= 2 && seatsNum <= 4)) throw httpError(400, "seats 必须 2-4");
  const botIdx = new Set(
    String(body.bot ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const n = parseInt(s, 10);
        if (!Number.isFinite(n)) throw httpError(400, `bot 索引非法:${s}`);
        return n;
      }),
  );
  const seats: SeatConfig[] = [];
  for (let i = 0; i < seatsNum; i++) seats.push({ name: `座 ${i + 1}`, isBot: botIdx.has(i) });
  const difficulty = body.difficulty as AiDifficulty | undefined;
  if (difficulty != null && difficulty !== "Simple" && difficulty !== "Normal") {
    throw httpError(400, "difficulty 只能是 Simple | Normal");
  }
  return {
    seats,
    targetNetWorth: body.target != null ? intField(body, "target", 0) : undefined,
    startingCash: body.startingCash != null ? intField(body, "startingCash", 0) : undefined,
    difficulty,
    seed: body.seed != null ? intField(body, "seed", 0) : undefined,
  };
}
function newRoomId(): string {
  for (let i = 0; i < 100; i++) {
    let s = "";
    for (let j = 0; j < CODE_LEN; j++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(s) && !existsSync(roomPath(s))) return s;
  }
  throw httpError(500, "房间码生成失败(冲突过多)");
}
function newToken(): string {
  return randomBytes(18).toString("base64url");
}

// ──────────────────────────── 广播 ────────────────────────────
function clientView(r: RoomSession) {
  return { type: "snapshot" as const, roomId: r.roomId, ...r.engine.snapshot() };
}
function broadcast(r: RoomSession): void {
  const msg = JSON.stringify(clientView(r));
  for (const ws of r.conns.values()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// ──────────────────────────── 静态托管 dist/ ────────────────────────────
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webp": "image/webp",
};
function serveStatic(res: ServerResponse, urlPath: string): void {
  if (!existsSync(STATIC_DIR)) {
    sendJson(res, 404, { ok: false, error: `静态目录不存在:${STATIC_DIR}(先 npm run build)` });
    return;
  }
  let rel = decodeURIComponent(urlPath);
  if (rel === "/" || rel === "") rel = "/index.html";
  const filePath = resolve(join(STATIC_DIR, rel));
  if (!filePath.startsWith(STATIC_DIR)) {
    sendJson(res, 403, { ok: false, error: "forbidden" });
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    sendJson(res, 404, { ok: false, error: `not found: ${urlPath}` });
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": "public, max-age=60",
  });
  createReadStream(filePath).pipe(res);
}

// ──────────────────────────── HTTP 路由 ────────────────────────────
const HELP = {
  ok: true,
  endpoints: {
    "GET /health": "存活 + 运行时长 + 房间数",
    "GET /help": "本接口列表",
    "POST /room/new": "建房 body:{seats?,bot?,seed?,autoSetup?} → {roomId, seatTokens[], ...status}",
    "WS  /ws?room=&seat=&token=": "加入房间 Seat;发 {type:'cmd',cmd:GameCommand},收 {type:'snapshot',...}",
    "GET /、/assets/*...": "静态托管 dist/(网页同源)",
  },
  env: { PORT, HOST, ROOMS_DIR, STATIC_DIR },
};

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "OPTIONS") return sendJson(res, 204, {});
  if (method === "GET") {
    if (path === "/health") {
      return sendJson(res, 200, { ok: true, uptime: Math.floor((Date.now() - startedAt) / 1000), rooms: rooms.size });
    }
    if (path === "/help") return sendJson(res, 200, HELP);
    return serveStatic(res, path);
  }
  if (method !== "POST") throw httpError(405, `不支持的方法:${method}`);

  const body = await readBody(req);
  const obj = asObject(body);
  if (path === "/room/new") {
    const config = parseSeatConfig(obj);
    const engine = createEngine(config);
    if (obj.autoSetup) autoSetup(engine);
    autoResolveBots(engine); // 开局若已有 bot 座位,先驱动到人类/待输入
    const roomId = newRoomId();
    const seatTokens = engine.players.map(() => newToken());
    const room: RoomSession = { roomId, engine, config, seatTokens, conns: new Map() };
    rooms.set(roomId, room);
    persistRoom(room);
    return sendJson(res, 200, { ok: true, roomId, seatTokens, ...statusOf(engine) });
  }
  throw httpError(404, `未知路由:${path}`);
}

// ──────────────────────────── WebSocket ────────────────────────────
function authorizeUpgrade(url: URL): { room: RoomSession; seat: number } | null {
  const roomId = url.searchParams.get("room");
  const seat = parseInt(url.searchParams.get("seat") ?? "", 10);
  const token = url.searchParams.get("token");
  const room = roomId ? rooms.get(roomId) : undefined;
  if (!room) return null;
  if (!Number.isInteger(seat) || seat < 0 || seat >= room.seatTokens.length) return null;
  if (!token || token !== room.seatTokens[seat]) return null; // ADR-0005:token = Seat 归属
  return { room, seat };
}

function applyCommand(room: RoomSession, cmd: GameCommand): void {
  room.engine.submitCommand(cmd);
  autoResolveBots(room.engine); // bot 座位 / bot 城主自动驱动到人类/待输入
  persistRoom(room);
  broadcast(room);
}

function attachWs(room: RoomSession, seat: number, ws: WebSocket): void {
  room.conns.set(seat, ws);
  ws.send(JSON.stringify(clientView(room))); // 连上即推当前快照
  ws.on("message", (data) => {
    let msg: { type?: string; cmd?: GameCommand };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", error: "bad json" }));
      return;
    }
    if (msg?.type === "cmd" && msg.cmd) applyCommand(room, msg.cmd);
    else ws.send(JSON.stringify({ type: "error", error: "expected {type:'cmd',cmd:...}" }));
  });
  ws.on("close", () => {
    room.conns.delete(seat); // 任务 8 在此加冻结/房主出口
  });
  ws.on("error", () => room.conns.delete(seat));
}

// ──────────────────────────── 启动 ────────────────────────────
const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { ok: false, error: err.message });
    } else {
      console.error("[server] 内部错误:", err);
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const auth = authorizeUpgrade(url);
  if (!auth) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => attachWs(auth.room, auth.seat, ws));
});

server.listen(PORT, HOST, () => {
  console.log(`[server] 群雄逐鹿引擎服务已启动 → http://${HOST}:${PORT}`);
  console.log(`[server] 房间目录:${ROOMS_DIR}(已恢复 ${rooms.size} 局)  静态:${STATIC_DIR}`);
  console.log("[server] GET /help 查看接口;WS /ws?room=&seat=&token=");
});
