// 权威引擎服务器(联机化第 2 步)—— 瘦传输层(ADR-0007)。
// 运行:bun run serve  (env: PORT / HOST / ROOMS_DIR / STATIC_DIR)
//
// 本文件只管:HTTP 路由 + WS 生命周期 + broadcast + 静态托管 + 落盘目录注入。
// 房间游戏编排(座位/接管/bot 驱动/host 移交/纯视图)全在 scripts/room.ts 的 RoomRegistry。
// 持久化适配器(FileRoomPersistence)在 scripts/room-persistence.ts,可注入(测试用 InMemory)。
//
// 生命周期(ADR-0004 大厅 + ADR-0005 seatToken + ADR-0002 掉线):
//   POST /room/new {seats,bot?,seed?...}   → Lobby,建房者=Seat0(host),领 token
//   POST /room/join {roomId}               → 凭码占第一个空 human Seat,领 token
//   POST /room/start {roomId,seatToken}    → host 开局:构造引擎(doDraftRoll 自动国号),
//                                            停在 Setup·PickCapital(L41:真人各自三选一)
//   POST /room/dismiss {roomId,seatToken}  → host 解散房间(广播 dismissed,断开所有连接)
//   POST /room/takeover {roomId,seatToken,seat} → host 强令 bot 接管某掉线 Seat(ADR-0002)
//   WS   /ws?room=&seat=&token=            → 入座连接;发 {type:"cmd",cmd:...} /
//                                            {type:"pickCapital",tileIndex}(L41 选都),
//                                            收 lobby/snapshot
// 掉线:WS close → 该 Seat 冻结(不自动 bot,只在其轮到时才卡);host 可解散/接管;
//      host 自己掉线 → 身份移交在场最久真人;重连(持 token)夺回 Seat。
// 设计见 docs/multiplayer.md + docs/adr/0001..0007。
//
// 运行时:Bun 原生(Bun.serve + 内置 WebSocket,2026-08 自 node:http+ws 迁移,行为语义不变)。
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { AiDifficulty, GameCommand } from "../src/core/types";
import { loadMap, type LoadedMap } from "../src/core/board-loader";
import { parseCatalog, type CatalogFileEntry } from "../src/core/map-source";
import { statusOf } from "./engine-helpers";
import {
  RoomRegistry,
  RoomError,
  clientView,
  lobbyView,
  seatMeta,
  type RoomEvent,
} from "./room";
import { FileRoomPersistence, type HostConfig } from "./room-persistence";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0"; // 默认监听所有网卡:局域网设备(手机)可访问
const ROOMS_DIR = resolve(process.env.ROOMS_DIR ?? "./rooms");
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? "./dist");
const MAPS_DIR = resolve(process.env.MAPS_DIR ?? "./public/maps");
const startedAt = Date.now();

// ──────────────────────────── 内置地图加载(每房间各持自己的 LoadedMap)────────────────────────────
// 服务器可读 fs(ADR-0007:fs 只在传输层,不在 room.ts)。
// 读 public/maps/index.json 清单 + 对应 JSON,按 mapId 构建为 LoadedMap 并缓存。
function loadCatalogEntries(): CatalogFileEntry[] {
  const catalogPath = join(MAPS_DIR, "index.json");
  if (!existsSync(catalogPath)) {
    throw new Error(`地图清单不存在:${catalogPath}`);
  }
  const raw = JSON.parse(readFileSync(catalogPath, "utf-8"));
  return parseCatalog(raw);
}
const CATALOG_ENTRIES = loadCatalogEntries();
/** 合法 mapId 集合(供 registry.setMap 校验)。 */
const VALID_MAP_IDS = new Set(CATALOG_ENTRIES.map((e) => e.id));
/** id → CatalogFileEntry(用于查 file 名)。 */
const CATALOG_BY_ID = new Map(CATALOG_ENTRIES.map((e) => [e.id, e] as const));
/** LoadedMap 缓存:同一 mapId 只构建一次(地图只读,可安全跨房间共用构建结果)。 */
const loadedMapCache = new Map<string, LoadedMap>();
/** 按 mapId 加载内置图为 LoadedMap(带缓存)。找不到抛错。 */
function loadMapById(mapId: string): LoadedMap {
  const cached = loadedMapCache.get(mapId);
  if (cached) return cached;
  const entry = CATALOG_BY_ID.get(mapId);
  if (!entry) throw new Error(`未知地图 id:${mapId}`);
  const filePath = join(MAPS_DIR, entry.file);
  const data = JSON.parse(readFileSync(filePath, "utf-8"));
  const map = loadMap(data);
  loadedMapCache.set(mapId, map);
  return map;
}

// ──────────────────────────── 启动:注入持久化 + 恢复房间 ────────────────────────────
mkdirSync(ROOMS_DIR, { recursive: true });
const persistence = new FileRoomPersistence(ROOMS_DIR);

// ──────────────────────────── 可观测性:房间事件流水(JSONL)────────────────────────────
// 目标:联机卡死类问题可事后归因。每房间两个落点:
//   rooms/<code>.events.jsonl  —— 全量事件流(命令/bot 步进/停因/ws 连断,带时间戳)
//   内存尾巴(每房最近 100 条) —— 供 GET /room/debug 免读盘快速返回
// room.ts 的引擎侧事件经 RoomObserver 注入;传输层事件(cmd/ws-open/…)在此直接记录。
const eventTail = new Map<string, unknown[]>();
const TAIL_MAX = 100;
function recordEvent(roomId: string, ev: Record<string, unknown>): void {
  const line = { t: new Date().toISOString(), ...ev };
  try {
    appendFileSync(join(ROOMS_DIR, `${roomId}.events.jsonl`), JSON.stringify(line) + "\n", "utf-8");
  } catch (err) {
    console.warn(`[server] 事件落盘失败(${roomId}):`, (err as Error).message);
  }
  const tail = eventTail.get(roomId) ?? [];
  tail.push(line);
  if (tail.length > TAIL_MAX) tail.shift();
  eventTail.set(roomId, tail);
}
const registry = new RoomRegistry(persistence, (roomId, ev: RoomEvent) =>
  recordEvent(roomId, ev as Record<string, unknown>));
const restored = registry.restoreAll(loadMapById);

// ──────────────────────────── WS 句柄归传输层(ADR-0007 关键不变量 1)────────────────────────────
// 房间 → 座位 → 当前 WebSocket。Room 模块不持有 WS,只有这里持有。
// Bun 的 ServerWebSocket 以 data 携带 {roomId, seat}(upgrade 时注入,免反查)。
export interface WsSeat {
  roomId: string;
  seat: number;
}
type SeatSocket = import("bun").ServerWebSocket<WsSeat>;

const roomSockets = new Map<string, Map<number, SeatSocket>>();

function socketsOf(roomId: string): Map<number, SeatSocket> {
  let m = roomSockets.get(roomId);
  if (!m) {
    m = new Map();
    roomSockets.set(roomId, m);
  }
  return m;
}

/** 算出当前在线座位集合(只有传输层知道谁连着 WS;ADR-0007 关键不变量 2)。 */
function onlineSeatsOf(roomId: string): Set<number> {
  const set = new Set<number>();
  for (const [seat, ws] of socketsOf(roomId)) {
    if (ws.readyState === WebSocket.OPEN) set.add(seat);
  }
  return set;
}

/** 广播:读 Room 当前状态 + 算 onlineSeats + clientView + 遍历 WS 发。 */
function broadcast(roomId: string): void {
  const room = registry.get(roomId);
  if (!room) return;
  const online = onlineSeatsOf(roomId);
  const msg = JSON.stringify(clientView(room, online));
  for (const ws of socketsOf(roomId).values()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
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
/** Room 抛 RoomError → 这里映射到 HTTP;其它异常 → 500。 */
function toHttpError(err: unknown): { status: number; message: string } {
  if (err instanceof RoomError) return { status: err.status, message: err.message };
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  console.error("[server] 内部错误:", err);
  return { status: 500, message: err instanceof Error ? err.message : String(err) };
}
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
function sendJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}
async function readBody(req: Request): Promise<unknown> {
  const text = await req.text();
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
async function serveStatic(urlPath: string): Promise<Response> {
  if (!existsSync(STATIC_DIR)) {
    return sendJson(404, { ok: false, error: `静态目录不存在:${STATIC_DIR}(先 bun run build)` });
  }
  let rel = decodeURIComponent(urlPath);
  if (rel === "/" || rel === "") rel = "/index.html";
  const filePath = resolve(join(STATIC_DIR, rel));
  if (!filePath.startsWith(STATIC_DIR)) {
    return sendJson(403, { ok: false, error: "forbidden" });
  }
  if (!existsSync(filePath)) {
    return sendJson(404, { ok: false, error: `not found: ${urlPath}` });
  }
  const file = Bun.file(filePath);
  return new Response(file, {
    headers: {
      "Content-Type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=60",
    },
  });
}

// ──────────────────────────── HTTP 路由 ────────────────────────────
const HELP = {
  ok: true,
  endpoints: {
    "GET /health": "存活 + 运行时长 + 房间数",
    "GET /help": "本接口列表",
    "POST /room/new": "建房 body:{seats,bot?,seed?,target?,difficulty?} → {seat:0,seatToken,...lobby}(mapId=null)",
    "POST /room/join": "入座 body:{roomId,guohao?} → {seat,seatToken,...lobby}(guohao=预设国号,重名开局时加方位前缀)",
    "POST /room/map": "host 选图 body:{roomId,seatToken,mapId} → {...lobby}(仅 host,开局前)",
    "POST /room/start": "开局 body:{roomId,seatToken}(仅 host,需已选图;开局后进选都三选一,WS pickCapital 落子)",
    "POST /room/takeover": "host 强令 bot 接管掉线 Seat body:{roomId,seatToken,seat}",
    "POST /room/dismiss": "host 解散房间 body:{roomId,seatToken}",
    "GET  /room/debug?room=": "调试:实时房间状态(相位/座位/takeover)+ 最近 50 条事件尾巴",
    "WS  /ws?room=&seat=&token=": "入座连接;发 {type:'cmd',cmd:...} / {type:'pickCapital',tileIndex},收 lobby/snapshot/dismissed",
    "GET /、/assets/*...": "静态托管 dist/(网页同源)",
  },
  maps: CATALOG_ENTRIES.map((e) => ({ id: e.id, name: e.name, tileCount: e.tileCount, targetNetWorth: e.targetNetWorth })),
  env: { PORT, HOST, ROOMS_DIR, STATIC_DIR, MAPS_DIR },
};

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (method === "OPTIONS") return sendJson(204, {});
  if (method === "GET") {
    if (path === "/health") {
      return sendJson(200, { ok: true, uptime: Math.floor((Date.now() - startedAt) / 1000), rooms: registry.size() });
    }
    if (path === "/help") return sendJson(200, HELP);
    // 调试端点:实时房间状态 + 最近事件尾巴(排障用;手机端无法开 devtools 时的现场)
    if (path === "/room/debug") {
      const roomId = url.searchParams.get("room") ?? "";
      const room = registry.get(roomId);
      if (!room) return sendJson(404, { ok: false, error: `房间不存在:${roomId}` });
      const e = room.engine;
      return sendJson(200, {
        ok: true,
        room: {
          roomId,
          phase: e?.phase ?? "Lobby",
          turnPhase: e?.turnPhase ?? null,
          activeIndex: e?.activeIndex ?? null,
          hostSeat: room.hostSeat,
          mapId: room.mapId,
          takeover: [...room.takeover],
          seats: seatMeta(room, onlineSeatsOf(roomId)),
        },
        events: (eventTail.get(roomId) ?? []).slice(-50),
      });
    }
    return serveStatic(path);
  }
  if (method !== "POST") throw httpError(405, `不支持的方法:${method}`);

  const obj = asObject(await readBody(req));

  if (path === "/room/new") {
    const seatCount = intField(obj, "seats", 2);
    const botIdx = new Set(
      String(obj.bot ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < seatCount),
    );
    const difficulty = obj.difficulty as AiDifficulty | undefined;
    if (difficulty != null && difficulty !== "Simple" && difficulty !== "Normal") {
      throw httpError(400, "difficulty 只能是 Simple | Normal");
    }
    const hostConfig: HostConfig = {
      seed: obj.seed != null ? intField(obj, "seed", 0) : undefined,
      target: obj.target != null ? intField(obj, "target", 0) : undefined,
      difficulty,
    };
    const { room, seat, token } = registry.createRoom({ seatCount, botIdx, hostConfig });
    recordEvent(room.roomId, { ev: "room-new", seatCount, bot: [...botIdx] });
    // 建房时不设图(房间无地图);Host 须在大厅选图后再开局。startGame 会校验"已选图"。
    return sendJson(200, { ok: true, seat, seatToken: token, ...lobbyView(room, onlineSeatsOf(room.roomId)) });
  }

  if (path === "/room/join") {
    const roomId = String(obj.roomId ?? "");
    // 国号可选:带上则作为预设,开局时与房间内其它座位去重(重名加方位前缀)
    const guohao = obj.guohao == null ? undefined : String(obj.guohao);
    const { room, seat, token } = registry.joinSeat(roomId, guohao);
    recordEvent(roomId, { ev: "room-join", seat, guohao: guohao ?? null });
    broadcast(room.roomId); // 通知其它人:有人加入
    return sendJson(200, { ok: true, seat, seatToken: token, ...lobbyView(room, onlineSeatsOf(room.roomId)) });
  }

  if (path === "/room/map") {
    const roomId = String(obj.roomId ?? "");
    const mapId = String(obj.mapId ?? "");
    const room = registry.setMap(roomId, mapId, String(obj.seatToken ?? ""), VALID_MAP_IDS);
    broadcast(room.roomId); // 通知房间内其它人:地图已更新(map 事件由 observer 记流水)
    return sendJson(200, { ok: true, ...lobbyView(room, onlineSeatsOf(room.roomId)) });
  }

  if (path === "/room/start") {
    const roomId = String(obj.roomId ?? "");
    const room = await registry.startGame(roomId, String(obj.seatToken ?? ""), () => broadcast(roomId), loadMapById);
    return sendJson(200, { ok: true, ...statusOf(room.engine!) });
  }

  if (path === "/room/takeover") {
    const roomId = String(obj.roomId ?? "");
    const seat = intField(obj, "seat", -1);
    const room = await registry.takeoverSeat(roomId, String(obj.seatToken ?? ""), seat, () => broadcast(roomId));
    return sendJson(200, { ok: true, takeover: seat, ...statusOf(room.engine!) });
  }

  if (path === "/room/dismiss") {
    const roomId = String(obj.roomId ?? "");
    const id = registry.dismissRoom(roomId, String(obj.seatToken ?? ""));
    // 广播 dismissed 并断开所有连接
    const msg = JSON.stringify({ type: "dismissed" as const, roomId: id });
    for (const ws of socketsOf(id).values()) {
      if (ws.readyState !== WebSocket.CLOSED) {
        try {
          ws.send(msg);
          ws.close();
        } catch {
          /* 忽略 */
        }
      }
    }
    roomSockets.delete(id);
    return sendJson(200, { ok: true, dismissed: id });
  }

  throw httpError(404, `未知路由:${path}`);
}

// ──────────────────────────── WebSocket(升级在 fetch 里做,生命周期在 handlers)────────────────────────────
Bun.serve<WsSeat>({
  port: PORT,
  hostname: HOST,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname !== "/ws") {
      // 普通路由;错误统一映射为 JSON(语义同旧 handle().catch)
      return handle(req).catch((err) => {
        const { status, message } = toHttpError(err);
        return sendJson(status, { ok: false, error: message });
      });
    }
    // WS 升级:/ws?room=&seat=&token= 鉴权失败 → 401(同旧 upgrade 通道)
    const roomId = url.searchParams.get("room");
    const seat = parseInt(url.searchParams.get("seat") ?? "", 10);
    const token = url.searchParams.get("token");
    if (!roomId || !registry.validateSeat(roomId, seat, token)) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (!srv.upgrade(req, { data: { roomId, seat } })) {
      return new Response("WebSocket upgrade failed", { status: 500 });
    }
    return undefined; // upgrade 成功后由 handlers 接管
  },
  websocket: {
    open(ws) {
      // 重连夺回(ADR-0002/0005):token 是 Seat 归属唯一凭证 → 连上即从接管集合移除。
      const { roomId, seat } = ws.data;
      const room = registry.attachSeat(roomId, seat);
      if (!room) {
        ws.close();
        return;
      }
      socketsOf(roomId).set(seat, ws);
      recordEvent(roomId, { ev: "ws-open", seat });
      ws.send(JSON.stringify(clientView(room, onlineSeatsOf(roomId))));
    },
    message(ws, raw) {
      const { roomId, seat } = ws.data;
      let msg: { type?: string; cmd?: GameCommand; on?: boolean; speed?: string; tileIndex?: number };
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", error: "bad json" }));
        return;
      }
      if (msg?.type === "cmd" && msg.cmd) {
        recordEvent(roomId, { ev: "cmd", seat, cmd: msg.cmd.type });
        void registry.applyCommand(roomId, msg.cmd, () => broadcast(roomId));
      } else if (msg?.type === "pickCapital" && typeof msg.tileIndex === "number") {
        // L41 选都落子:只能以本连接座位名义(seat 即发送者);校验/落子/推进在 room 层
        recordEvent(roomId, { ev: "pick-capital", seat, tileIndex: msg.tileIndex });
        void registry
          .pickCapital(roomId, seat, msg.tileIndex, () => broadcast(roomId))
          .catch((err) => ws.send(JSON.stringify({ type: "error", error: (err as Error).message })));
      } else if (msg?.type === "autoPilot" && typeof msg.on === "boolean") {
        // 自助托管(spec: autopilot):只能作用于发送者自己的座位(seat 即本连接座位)
        const speed = msg.speed === "slow" ? "slow" : "fast";
        recordEvent(roomId, { ev: "ws-autopilot", seat, on: msg.on, speed });
        void registry
          .setAutoPilot(roomId, seat, msg.on, speed, () => broadcast(roomId))
          .catch((err) => ws.send(JSON.stringify({ type: "error", error: (err as Error).message })));
      } else {
        const r = registry.get(roomId);
        ws.send(JSON.stringify({ type: "error", error: r?.engine ? "expected {type:'cmd',cmd:...}" : "对局未开始" }));
      }
    },
    close(ws) {
      const { roomId, seat } = ws.data;
      // 仅当当前映射还指向本 ws 时才移除(若已重连到新 ws,新连接保留)
      const cur = socketsOf(roomId).get(seat);
      if (cur === ws) socketsOf(roomId).delete(seat);
      recordEvent(roomId, { ev: "ws-close", seat });
      // 算"还在线的座位"(不含刚断开的本 seat),交给 Room 做 host 移交 + bot 接管判断
      const stillOnline = onlineSeatsOf(roomId);
      void registry.markSeatOffline(roomId, seat, stillOnline, () => broadcast(roomId));
    },
  },
} satisfies import("bun").ServeOptions<WsSeat> | undefined);

console.log(`[server] 群雄逐鹿引擎服务已启动 → http://${HOST}:${PORT}`);
console.log(`[server] 房间目录:${ROOMS_DIR}(已恢复 ${restored} 局)  静态:${STATIC_DIR}`);
console.log("[server] 大厅 /room/new|join|start|takeover|dismiss;掉线冻结+房主出口(ADR-0002);WS /ws");
