// 权威引擎服务器(联机化第 2 步):多房间 + 大厅 + 掉线模型 + WebSocket + 静态托管 + 落盘恢复。
// 运行:npm run serve  (env: PORT / HOST / ROOMS_DIR / STATIC_DIR)
//
// 生命周期(ADR-0004 大厅 + ADR-0005 seatToken + ADR-0002 掉线):
//   POST /room/new {seats,bot?,seed?...}   → Lobby,建房者=Seat0(host),领 token
//   POST /room/join {roomId}               → 凭码占第一个空 human Seat,领 token
//   POST /room/start {roomId,seatToken}    → host 开局:构造引擎(doDraftRoll 自动国号)+ autoSetup
//   POST /room/dismiss {roomId,seatToken}  → host 解散房间(广播 dismissed,断开所有连接)
//   POST /room/takeover {roomId,seatToken,seat} → host 强令 bot 接管某掉线 Seat(ADR-0002)
//   WS   /ws?room=&seat=&token=            → 入座连接;发 {type:"cmd",cmd:...},收 lobby/snapshot
// 掉线:WS close → 该 Seat 冻结(不自动 bot,只在其轮到时才卡);host 可解散/接管;
//      host 自己掉线 → 身份移交在场最久真人;重连(持 token)夺回 Seat。
// 设计见 docs/multiplayer.md + docs/adr/0001..0005。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { randomBytes, randomInt } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { GameEngine } from "../src/core/game";
import type { SeatConfig } from "../src/core/game";
import type { AiDifficulty, GameCommand } from "../src/core/types";
import { botAct } from "../src/core/bot";
import { autoSetup, createEngine, statusOf } from "./engine-helpers";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "127.0.0.1";
const ROOMS_DIR = resolve(process.env.ROOMS_DIR ?? "./rooms");
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? "./dist");
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ"; // 去掉易混 I/L/O
const CODE_LEN = 4;
// botAct 能驱动的相位(其它相位是引擎内部过渡,无需外部驱动)
const INPUT_PHASES = new Set([
  "Roll",
  "AwaitingCapitalHalt",
  "AwaitingBranch",
  "AwaitingDecision",
  "AwaitingHeroPick",
  "AwaitingTreasureOwner",
  "AwaitingBankruptcySettle",
]);

// ──────────────────────────── 房间(Room)────────────────────────────
interface SeatState {
  kind: "human" | "bot"; // bot 座位:服务器驱动,人类不可领
  token: string | null; // human 座位:未领=null,领后=不可猜 token(ADR-0005)
  conn: WebSocket | null; // 当前连接;null=未连/掉线
}
interface HostConfig {
  seed?: number;
  target?: number;
  difficulty?: AiDifficulty;
}
interface RoomSession {
  roomId: string;
  seatCount: number;
  seats: SeatState[];
  hostSeat: number; // 当前 host 座位(开局=0;host 掉线则移交,ADR-0002)
  takeover: Set<number>; // 房主强令 bot 接管的人类座位(重连时移除=夺回)
  hostConfig: HostConfig;
  engine: GameEngine | null; // null = Lobby
}
interface RoomRecord {
  roomId: string;
  seatCount: number;
  seats: { kind: "human" | "bot"; token: string | null }[];
  hostSeat: number;
  takeover: number[];
  hostConfig: HostConfig;
  snapshot: ReturnType<GameEngine["snapshot"]> | null;
}

const rooms = new Map<string, RoomSession>();
const startedAt = Date.now();

function roomPath(roomId: string): string {
  return join(ROOMS_DIR, `${roomId}.json`);
}
function persistRoom(r: RoomSession): void {
  const rec: RoomRecord = {
    roomId: r.roomId,
    seatCount: r.seatCount,
    seats: r.seats.map((s) => ({ kind: s.kind, token: s.token })),
    hostSeat: r.hostSeat,
    takeover: [...r.takeover],
    hostConfig: r.hostConfig,
    snapshot: r.engine ? r.engine.snapshot() : null,
  };
  writeFileSync(roomPath(r.roomId), JSON.stringify(rec, null, 2), "utf-8");
}
function dummySeats(n: number): SeatConfig[] {
  return Array.from({ length: n }, (_, i) => ({ name: `座 ${i + 1}`, isBot: false }));
}
function hydrate(rec: RoomRecord): RoomSession {
  let engine: GameEngine | null = null;
  if (rec.snapshot) {
    engine = createEngine({ seats: dummySeats(rec.seatCount), ...rec.hostConfig }, false);
    engine.restoreFromSnapshot(rec.snapshot);
  }
  return {
    roomId: rec.roomId,
    seatCount: rec.seatCount,
    seats: rec.seats.map((s) => ({ ...s, conn: null })),
    hostSeat: rec.hostSeat ?? 0,
    takeover: new Set(rec.takeover ?? []),
    hostConfig: rec.hostConfig,
    engine,
  };
}

mkdirSync(ROOMS_DIR, { recursive: true });
for (const f of readdirSync(ROOMS_DIR)) {
  if (!f.endsWith(".json")) continue;
  try {
    const rec = JSON.parse(readFileSync(join(ROOMS_DIR, f), "utf-8")) as RoomRecord;
    rooms.set(rec.roomId, hydrate(rec));
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
function newToken(): string {
  return randomBytes(18).toString("base64url");
}
function newRoomId(): string {
  for (let i = 0; i < 100; i++) {
    let s = "";
    for (let j = 0; j < CODE_LEN; j++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(s) && !existsSync(roomPath(s))) return s;
  }
  throw httpError(500, "房间码生成失败(冲突过多)");
}

// ──────────────────────────── 视图 + 广播 ────────────────────────────
function seatMeta(r: RoomSession) {
  return r.seats.map((s, i) => ({
    seat: i,
    kind: s.kind,
    taken: s.token != null,
    online: s.conn != null && s.conn.readyState === WebSocket.OPEN,
    // 该座位当前是否由服务器驱动:开局前 bot 座位;开局后 bot 座位或被房主接管的座位
    controlled: r.engine ? r.engine.players[i].isBot || r.takeover.has(i) : s.kind === "bot",
  }));
}
function lobbyView(r: RoomSession) {
  return {
    type: "lobby" as const,
    roomId: r.roomId,
    seatCount: r.seatCount,
    host: r.hostSeat,
    started: r.engine != null,
    seats: seatMeta(r),
  };
}
function clientView(r: RoomSession) {
  return r.engine
    ? { type: "snapshot" as const, roomId: r.roomId, host: r.hostSeat, seats: seatMeta(r), ...r.engine.snapshot() }
    : lobbyView(r);
}
function broadcast(r: RoomSession): void {
  const msg = JSON.stringify(clientView(r));
  for (const s of r.seats) if (s.conn && s.conn.readyState === WebSocket.OPEN) s.conn.send(msg);
}

// ──────────────────────────── bot/接管驱动(ADR-0002 接管)────────────────────────────
/** 当前决策归属哪个座位:大部分相位=active;AwaitingTreasureOwner=城主(可能≠访客)。 */
function decisionOwnerSeat(e: GameEngine): number {
  return e.turnPhase === "AwaitingTreasureOwner" ? e.treasureVisitor?.ownerIdx ?? e.activeIndex : e.activeIndex;
}
/** 该座位当前是否由服务器驱动(原始 bot,或被房主接管的人类座位)。 */
function seatControlled(r: RoomSession, seat: number): boolean {
  return r.engine != null && (r.engine.players[seat]?.isBot || r.takeover.has(seat));
}
/** 廉价状态指纹:任何真实进展都会改变它(防 botAct 空转死循环)。 */
function fingerprint(e: GameEngine): string {
  return [
    e.phase,
    e.setupPhase,
    e.turnPhase,
    e.activeIndex,
    e.currentDraftIndex,
    e.players.map((p) => `${p.cash}:${p.treasures.length}:${p.properties.length}:${p.heroes.length}`).join(","),
  ].join("|");
}
/** 连续驱动服务器控制的决策点,直到轮到人类(在线或冻结)/ 游戏结束 / 无进展。
 *  关键:冻结的人类座位不被驱动(seatControlled=false)→ 游戏等其重连或房主接管。
 *  每步 persist+broadcast:客户端(联机模式)能逐步看到 bot/接管座位的动作,而非一次性跳到终态。 */
function driveBots(r: RoomSession): void {
  const e = r.engine;
  if (!e) return;
  let guard = 0;
  while (e.phase !== "GameOver" && guard++ < 500) {
    if (!INPUT_PHASES.has(e.turnPhase)) break;
    if (!seatControlled(r, decisionOwnerSeat(e))) break; // 人类拥有决策(在线或冻结)→ 停
    const before = fingerprint(e);
    botAct(e);
    persistRoom(r);
    broadcast(r);
    if (e.isOver) break;
    if (fingerprint(e) === before) break; // 无进展 → 停(防死循环)
  }
}

// ──────────────────────────── host 移交 + 解散(ADR-0002)────────────────────────────
function isOnline(s: SeatState): boolean {
  return s.conn != null && s.conn.readyState === WebSocket.OPEN;
}
/** host 离线 → 身份移交在场最久(最低索引)的在线真人;无在线真人则保持(等重连)。 */
function transferHostIfNeeded(r: RoomSession): void {
  const cur = r.seats[r.hostSeat];
  if (cur && cur.kind === "human" && isOnline(cur)) return;
  for (let i = 0; i < r.seats.length; i++) {
    if (r.seats[i].kind === "human" && isOnline(r.seats[i])) {
      r.hostSeat = i;
      return;
    }
  }
}
function dismissRoom(r: RoomSession): void {
  const msg = JSON.stringify({ type: "dismissed" as const, roomId: r.roomId });
  for (const s of r.seats) {
    if (s.conn && s.conn.readyState !== WebSocket.CLOSED) {
      try {
        s.conn.send(msg);
        s.conn.close();
      } catch {
        /* 忽略 */
      }
    }
  }
  rooms.delete(r.roomId);
  try {
    unlinkSync(roomPath(r.roomId));
  } catch {
    /* 忽略 */
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
    "POST /room/new": "建房 body:{seats,bot?,seed?,target?,difficulty?} → {seat:0,seatToken,...lobby}",
    "POST /room/join": "入座 body:{roomId} → {seat,seatToken,...lobby}",
    "POST /room/start": "开局 body:{roomId,seatToken}(仅 host)",
    "POST /room/takeover": "host 强令 bot 接管掉线 Seat body:{roomId,seatToken,seat}",
    "POST /room/dismiss": "host 解散房间 body:{roomId,seatToken}",
    "WS  /ws?room=&seat=&token=": "入座连接;发 {type:'cmd',cmd:...},收 lobby/snapshot/dismissed",
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

  const obj = asObject(await readBody(req));

  if (path === "/room/new") {
    const seatCount = intField(obj, "seats", 2);
    if (!(seatCount >= 2 && seatCount <= 4)) throw httpError(400, "seats 必须 2-4");
    const botIdx = new Set(
      String(obj.bot ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < seatCount),
    );
    if (botIdx.has(0)) throw httpError(400, "host(Seat 0)必须是真人");
    const difficulty = obj.difficulty as AiDifficulty | undefined;
    if (difficulty != null && difficulty !== "Simple" && difficulty !== "Normal") {
      throw httpError(400, "difficulty 只能是 Simple | Normal");
    }
    const hostConfig: HostConfig = {
      seed: obj.seed != null ? intField(obj, "seed", 0) : undefined,
      target: obj.target != null ? intField(obj, "target", 0) : undefined,
      difficulty,
    };
    const roomId = newRoomId();
    const seats: SeatState[] = Array.from({ length: seatCount }, (_, i) => ({
      kind: botIdx.has(i) ? "bot" : "human",
      token: null,
      conn: null,
    }));
    seats[0].token = newToken();
    const room: RoomSession = { roomId, seatCount, seats, hostSeat: 0, takeover: new Set(), hostConfig, engine: null };
    rooms.set(roomId, room);
    persistRoom(room);
    return sendJson(res, 200, { ok: true, seat: 0, seatToken: seats[0].token, ...lobbyView(room) });
  }

  if (path === "/room/join") {
    const room = rooms.get(String(obj.roomId ?? ""));
    if (!room) throw httpError(404, "房间不存在");
    if (room.engine) throw httpError(409, "对局已开始,不可加入");
    const idx = room.seats.findIndex((s) => s.kind === "human" && s.token == null);
    if (idx < 0) throw httpError(409, "房间已满(无空座位)");
    const token = newToken();
    room.seats[idx].token = token;
    persistRoom(room);
    broadcast(room);
    return sendJson(res, 200, { ok: true, seat: idx, seatToken: token, ...lobbyView(room) });
  }

  if (path === "/room/start") {
    const room = rooms.get(String(obj.roomId ?? ""));
    if (!room) throw httpError(404, "房间不存在");
    if (room.engine) throw httpError(409, "对局已开始");
    if (obj.seatToken !== room.seats[room.hostSeat].token) throw httpError(403, "仅 host 可开局");
    const seatsCfg: SeatConfig[] = room.seats.map((s, i) => ({
      name: `座 ${i + 1}`,
      isBot: s.kind === "bot" || s.token == null, // 未领的人类座位自动 bot 填充
    }));
    const engine = createEngine(
      { seats: seatsCfg, seed: room.hostConfig.seed, targetNetWorth: room.hostConfig.target, difficulty: room.hostConfig.difficulty },
      true,
    );
    autoSetup(engine);
    room.engine = engine;
    persistRoom(room);
    broadcast(room); // 开局首帧
    driveBots(room); // bot 座位先驱动到人类/待输入(逐步广播)
    return sendJson(res, 200, { ok: true, ...statusOf(engine) });
  }

  if (path === "/room/takeover") {
    const room = rooms.get(String(obj.roomId ?? ""));
    if (!room || !room.engine) throw httpError(404, "对局不存在");
    if (obj.seatToken !== room.seats[room.hostSeat].token) throw httpError(403, "仅 host 可接管");
    const seat = intField(obj, "seat", -1);
    if (!Number.isInteger(seat) || seat < 0 || seat >= room.seats.length) throw httpError(400, "seat 非法");
    if (room.seats[seat].kind === "bot") throw httpError(400, "该座位本就是 bot");
    room.takeover.add(seat);
    driveBots(room); // 若该 seat 正轮到,立即 bot 驱动解冻
    persistRoom(room);
    broadcast(room);
    return sendJson(res, 200, { ok: true, takeover: seat, ...statusOf(room.engine) });
  }

  if (path === "/room/dismiss") {
    const room = rooms.get(String(obj.roomId ?? ""));
    if (!room) throw httpError(404, "房间不存在");
    if (obj.seatToken !== room.seats[room.hostSeat].token) throw httpError(403, "仅 host 可解散");
    const id = room.roomId;
    dismissRoom(room);
    return sendJson(res, 200, { ok: true, dismissed: id });
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
  if (!Number.isInteger(seat) || seat < 0 || seat >= room.seats.length) return null;
  if (!token || token !== room.seats[seat].token) return null;
  return { room, seat };
}
function applyCommand(room: RoomSession, cmd: GameCommand): void {
  if (!room.engine) return;
  room.engine.submitCommand(cmd);
  persistRoom(room);
  broadcast(room); // 人类命令结果先推
  driveBots(room); // bot/接管座位的连锁决策,逐步 persist+broadcast
}
function attachWs(room: RoomSession, seat: number, ws: WebSocket): void {
  // 重连夺回(ADR-0002/0005):token 是 Seat 归属唯一凭证 → 连上即从接管集合移除
  room.takeover.delete(seat);
  room.seats[seat].conn = ws;
  ws.send(JSON.stringify(clientView(room)));
  ws.on("message", (data) => {
    let msg: { type?: string; cmd?: GameCommand };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", error: "bad json" }));
      return;
    }
    if (msg?.type === "cmd" && msg.cmd) applyCommand(room, msg.cmd);
    else ws.send(JSON.stringify({ type: "error", error: room.engine ? "expected {type:'cmd',cmd:...}" : "对局未开始" }));
  });
  const detach = () => {
    if (room.seats[seat].conn === ws) room.seats[seat].conn = null;
    transferHostIfNeeded(room); // host 掉线 → 移交
    persistRoom(room);
    broadcast(room); // 先推"该座离线"
    driveBots(room); // 接管中的座位若轮到,继续;冻结的人类座位不驱动(等重连/接管)
  };
  ws.on("close", detach);
  ws.on("error", detach);
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
  console.log("[server] 大厅 /room/new|join|start|takeover|dismiss;掉线冻结+房主出口(ADR-0002);WS /ws");
});
