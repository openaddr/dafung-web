// 权威引擎服务器(联机化第 2 步)—— 瘦传输层(ADR-0007)。
// 运行:bun run serve  (env: PORT / HOST / ROOMS_DIR / LOGS_DIR)
//
// 本文件只管 HTTP 路由、WS 生命周期、广播和落盘目录。
// 房间编排由 @dafung/core 的 RoomRegistry 提供，落盘由 FileRoomPersistence 适配。
//
// 生命周期(ADR-0004 大厅 + ADR-0005 seatToken + ADR-0002 掉线):
//   POST /room/new {seats?,bot?,seed?...}  → Lobby,建房者=Seat0(host),领 token
//   POST /room/join {roomId}               → 凭码占第一个空 human Seat,领 token
//   POST /room/start {roomId,seatToken}    → host 开局:构造引擎(beginCapitalSelection 自动国号),
//                                            停在 Setup·PickCapital(从当前至多三个候选中选都)
//   POST /room/dismiss {roomId,seatToken}  → host 解散房间(广播 dismissed,断开所有连接)
//   WS   /ws?room=&seat=&token=            → 入座连接;发 {type:"cmd",cmd:...} 或
//                                            {type:"submit",submission:...}，
//                                            上行一律以本连接座位名义(#454:cmd 校验
//                                            提交者=决策归属,非归属 403 回执 error),
//                                            收 snapshot(首连摘要/校准,#381 起按接收
//                                            座位投影)/events(#390 唯一状态通路,#381 起
//                                            逐座位过滤)/gameLog(诊断日志尾段)/lobby(元数据)/dismissed
//                                            (#388 折叠切换⑥:正常对局零逐步快照,
//                                            全量下行=摘要/校准/生命周期三类)
// 掉线:WS close → 该 Seat 冻结(不自动代打,只在其轮到时才卡);保留窗(默认 10
//      分钟,#380)到期看门狗代开托管、重连不清托管(原 token 重连归座,点「收回」
//      拿回控制,ADR-0028);host 可解散(ADR-0028 后唯一出口);host 自己掉线 →
//      身份移交在场最久真人;重连(持 token)归座。
// 设计见 docs/explanation/联机架构.md + docs/adr/0001..0007。
//
// 运行时:Bun 原生(Bun.serve + 内置 WebSocket,2026-08 自 node:http+ws 迁移,行为语义不变)。
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameEngine, TurnPhase } from "@dafung/core/engine/authority";
import { STANDARD_SEAT_COUNT } from "@dafung/core/engine/constants";
import { BOT_STEP_MS } from "@dafung/core/engine/timings";
import { EventBatchChannel } from "@dafung/core/room/event-batch";
// wire 协议编解码单源(#429):上行 parse+dispatch、下行构造全部收口 wire.ts
import {
  dismissedMsg,
  dispatchInbound,
  encodeDownlink,
  errorMsg,
} from "@dafung/core/protocol/wire";
import { RoomRegistry, RoomError, type RoomEvent, type RoomSession } from "@dafung/core/room/room";
// 纯视图已拆 seat-projection.ts(模块治理 10/11 #327):投影函数直引,编排仍在 ./room。
// #431 起逐座位下行只经 assembleDownlinkShot 装配单口(redaction 必经步),校准触发
// 登记(CALIBRATION_*)同居该模块;eventsMsg 随 events 直发退役出本文件。
import {
  assembleDownlinkShot,
  assembleGameLogDelta,
  CALIBRATION_BACKED_KINDS,
  CALIBRATION_EVENT_KINDS,
  CALIBRATION_WINDOWS,
  INITIAL_GAME_LOG_CURSOR,
  isPrivateJinnangStepBatch,
  lobbyView,
  seatMeta,
  type GameLogCursor,
  type SeatDecisionCursor,
} from "@dafung/core/room/seat-projection";
import type { HostConfig } from "@dafung/core/room/room-record";
import { loadExtensionPackages } from "./extension-loader";
import { createBuiltinMapLoader, readMapCatalog } from "./map-files";
import { FileRoomPersistence } from "./room-persistence";

// 构建时标记发布包，发布包的地图和扩展与入口同目录。
declare const DAFUNG_SERVER_ARTIFACT: true | undefined;
const CONTENT_DIR =
  typeof DAFUNG_SERVER_ARTIFACT === "undefined"
    ? dirname(fileURLToPath(import.meta.resolve("@dafung/core/package.json")))
    : import.meta.dir;

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0"; // 默认监听所有网卡:局域网设备(手机)可访问
const ROOMS_DIR = resolve(process.env.ROOMS_DIR ?? "./data/rooms");
const MAPS_DIR = resolve(process.env.MAPS_DIR ?? join(CONTENT_DIR, "maps"));
const startedAt = Date.now();

// 决策停摆看门狗(#118):等待某真人座位决策超过该毫秒 → 看门狗代开托管(ADR-0028,
// 重连不清,本人点「收回」拿回)。0 = 关闭。默认 120s:正常思考远够用,真停摆(页面
// 卡死/断连)不再永久拖死全局。
const DECISION_TIMEOUT_MS = Math.max(
  0,
  parseInt(process.env.DECISION_TIMEOUT_MS ?? "120000", 10) || 0,
);

// 反应窗时长覆盖(#284):env E2E_REACTION_MS 注入定长窗(e2e 与产品默认窗长解耦;
// 两端同长自动成立——时长随快照 view.windowMs 下发)。0 = 不覆盖,走 core
// REACTION_WINDOW_MS 常量表(缺省查表,数值以常量表为准);缺省走常量表是配置不是兜底。
const REACTION_WINDOW_MS_OVERRIDE = Math.max(
  0,
  parseInt(process.env.E2E_REACTION_MS ?? "0", 10) || 0,
);

// bot 步进配速(#730,ADR-0061):bot 座位产出端配速,bot 连锁逐拍下行,与客户端
// 实速串行的演出队列同量级,普通对局不再积压进追帧/吸附档。未注入 = core BOT_STEP_MS
// (生产缺省,单机/联机同值);显式 "0" = 关配速(联机 e2e 提速通道)。
const BOT_STEP_MS_OVERRIDE: number | null =
  process.env.E2E_BOT_STEP_MS == null
    ? null
    : Math.max(0, parseInt(process.env.E2E_BOT_STEP_MS, 10) || 0);
const BOT_STEP_MS_EFFECTIVE = BOT_STEP_MS_OVERRIDE ?? BOT_STEP_MS;

// 掉线座位保留窗口(#380):对局中断线的座位保留该毫秒——窗口内持 seatToken 重连无缝
// 归座;到期看门狗代开托管(ADR-0028,重连不清托管,原玩家点「收回」拿回)。0 = 关闭
// (恢复纯冻结 + #118 停摆看门狗的旧语义)。默认 600000(10 分钟):手机闪断/电梯断网
// 远够用,真离场不再永久拖死全局。token 是座位归属唯一凭证(ADR-0005),有效期=房间
// 生命周期,不因保留窗到期失效。
const RETENTION_WINDOW_MS = Math.max(
  0,
  parseInt(process.env.RETENTION_WINDOW_MS ?? "600000", 10) || 0,
);

// ──────────────────────────── 扩展包装载(#378,ADR-0022 权威侧)────────────────────────────
// 启动时扫描 extensions/ 目录装载已安装包:名将/效果注册进引擎注册面(全房间生效,
// 与单机本地引擎装同一份包、语义一致)。零兜底:目录缺失/包格式坏/入口加载失败 =
// 服务启动当场失败(不静默跳过坏包);目录为空 = 合法零包环境,行为与无扩展一致。
// 独立小节纪律:本段只做装载与打印,不触碰 broadcast/flush/重连任何逻辑。
const EXTENSIONS_DIR = resolve(process.env.EXTENSIONS_DIR ?? join(CONTENT_DIR, "extensions"));
const EXTENSION_PACKAGES = await loadExtensionPackages(EXTENSIONS_DIR);
console.log(
  `[server] 扩展包(#378):${EXTENSION_PACKAGES.length > 0 ? EXTENSION_PACKAGES.map((m) => `${m.id}@${m.version}`).join(", ") : "无"}(目录:${EXTENSIONS_DIR})`,
);

// ──────────────────────────── 内置地图(共享层加载,ADR-0007:fs 只在传输层)────────────────────────────
const CATALOG_ENTRIES = readMapCatalog(MAPS_DIR);
const loadBuiltinMapById = createBuiltinMapLoader(MAPS_DIR);
/** 合法 mapId 集合(供 registry.setMap 校验)。 */
const VALID_MAP_IDS = new Set(CATALOG_ENTRIES.map((e) => e.id));

// ──────────────────────────── 启动:注入持久化 + 恢复房间 ────────────────────────────
const persistence = new FileRoomPersistence(ROOMS_DIR);

// ──────────────────────────── 对局日志落盘(ADR-0014:data/logs/<gameId>.jsonl)────────────────────────────
// 增量追加:RoomRegistry 每次 persist(每手快照)后经 logSink 通知,把 engine.log 新增行
// 追加写文件。终局行(final)由引擎在胜负判定时写入 engine.log,随最后一次 flush 自然落盘。
const LOGS_DIR = resolve(process.env.LOGS_DIR ?? "./data/logs");
const LOG_TTL_DAYS = parseInt(process.env.LOG_TTL_DAYS ?? "30", 10);
const logCutoffAtStartup = Date.now() - LOG_TTL_DAYS * 86_400_000;
mkdirSync(LOGS_DIR, { recursive: true });

/** 已写行数。发现归档与权威记录分歧时标记为 null，保留现有文件供排查。 */
const logWritten = new Map<string, number | null>();

function gameLogPath(gameId: string): string {
  return join(LOGS_DIR, `${gameId}.jsonl`);
}

function flushGameLog(room: RoomSession): void {
  const e = room.engine;
  if (!e) return;
  let written = logWritten.get(e.gameId);
  if (written === null) return;
  if (written === undefined) {
    written = 0;
    logWritten.set(e.gameId, 0);
  }
  if (e.log.length <= written) return;
  const fresh =
    e.log
      .slice(written)
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n";
  appendFileSync(gameLogPath(e.gameId), fresh, "utf-8");
  logWritten.set(e.gameId, e.log.length);
}

/** 存档可能已提交但日志尚未追加。按归档实际完成的行数补写。 */
function restoreGameLog(room: RoomSession): void {
  const e = room.engine;
  if (!e) return;
  logWritten.set(e.gameId, null);
  try {
    let archive: string;
    try {
      archive = readFileSync(gameLogPath(e.gameId), "utf-8");
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const last = e.log.at(-1);
      if (last === undefined) throw new Error("已保存的对局缺少日志");
      // 清扫已移除旧归档，房间可在下一次活动时重新归档。
      if (last.ts < logCutoffAtStartup) {
        logWritten.delete(e.gameId);
        return;
      }
      archive = "";
    }
    const lines = archive.split("\n");
    if (lines.pop() !== "" || lines.some((line, index) => line !== JSON.stringify(e.log[index])))
      throw new Error("归档内容与已提交的对局日志前缀分歧");
    logWritten.set(e.gameId, lines.length);
    flushGameLog(room);
  } catch (error) {
    console.error(`[server] 对局 ${e.gameId} 的日志归档恢复失败`, error);
  }
}

/** 启动清扫(ADR-0014 30 天保底清理):删 mtime 超过 LOG_TTL_DAYS 天的日志文件。 */
function cleanOldLogs(): number {
  let removed = 0;
  for (const f of readdirSync(LOGS_DIR)) {
    if (!f.endsWith(".jsonl")) continue;
    const p = join(LOGS_DIR, f);
    if (statSync(p).mtimeMs < logCutoffAtStartup) {
      unlinkSync(p);
      removed++;
    }
  }
  return removed;
}
const removedOldLogs = cleanOldLogs();

// ──────────────────────────── 可观测性:房间事件流水(JSONL)────────────────────────────
// 目标:联机卡死类问题可事后归因。每房间两个落点:
//   data/rooms/<code>.events.jsonl  —— 全量事件流(命令/bot 步进/停因/ws 连断,带时间戳)
//   内存尾巴(每房最近 100 条) —— 供 GET /room/debug 免读盘快速返回
// room.ts 的引擎侧事件经 RoomObserver 注入;传输层事件(cmd/ws-open/…)在此直接记录。
const eventTail = new Map<string, unknown[]>();
const TAIL_MAX = 100;
function recordEvent(roomId: string, ev: Record<string, unknown>, includeInDebug = true): void {
  const line = { t: new Date().toISOString(), ...ev };
  try {
    appendFileSync(join(ROOMS_DIR, `${roomId}.events.jsonl`), JSON.stringify(line) + "\n", "utf-8");
  } catch (err) {
    console.warn(`[server] 事件落盘失败(${roomId}):`, (err as Error).message);
  }
  // 调试端点按房间码公开。原始操作、尚未确认的选都和反应席位只记服务器流水。
  if (!includeInDebug || ev.ev === "cmd" || ev.ev === "reaction-decline") return;
  const tail = eventTail.get(roomId) ?? [];
  tail.push(line);
  if (tail.length > TAIL_MAX) tail.shift();
  eventTail.set(roomId, tail);
}
// ──────────────────────────── 全量下行三类状态(#388 折叠切换⑥,ADR-0020 终局形态)────────────────────────────
// 同步模型切换落定:正常对局不再按转移广播逐步快照,事件批消息(#390)是唯一对局状态
// 通路。全量下行只剩三类(ADR-0020 决策 2/3/6),#381 起全部按接收座位投影(保密后补,
// #431 起逐座位下行只经 seat-projection 的 assembleDownlinkShot 装配单口,redaction
// 是装配必经步):
//   ① 首连/重连整房摘要 —— WS open 时按接收座位取该座位的
//      redactSnapshotForSeat 投影(他人锦囊手牌/牌库序/反应窗询问集不出网);
//   ② 关键节点校准 —— flush 时按引擎公开结算态判定(触发登记=CALIBRATION_*,
//      seat-projection),每座位各发
//      各的 per-seat 投影(同 ①):开局(Setup 三段式全程 + finishSetup 批:开局发牌/
//      牌库洗序/Setup 字段只发生在此)、破产清算批(playerBankrupt:现金清零/债主收款/
//      珍宝转债主不折)、决策窗(出牌、招贤和破产清算)的进入、停留和退出。
//      招贤候选及出牌目标草稿等字段由校准摘要补齐。
//   ③ 房间生命周期消息 —— lobby 形状的房间元数据(座位在线/房主/托管),指纹变化
//      才发(对局中掉线/托管开关等不再搭逐步快照车);dismissed 不变(元数据全公开,
//      无 per-seat 面)。
// 判定全部读引擎 phase/turnPhase/当前批事件 kind,零启发式;检测不到即不校准(漂移纯
// 信任,ADR-0020 决策 5),不静默兜底。
// 事件批累积/去重/排空/合并拍归共享通道单源(#411,scripts/event-batch.ts):
// 单机传输面(room.ts transportBroadcast)用同一份批语义,双端行为零变化。
const eventBatches = new EventBatchChannel();
// 校准触发登记(#388 判定口径,#431 归口):CALIBRATION_WINDOWS/CALIBRATION_EVENT_KINDS
// 类型化单源迁居 seat-projection(与装配口同居;phase/kind 改名=编译红,覆盖对账见
// 同模块 CALIBRATION_COVERAGE),本文件只保留 flush 侧的相位基线记录。
/** 上次下发的房间元数据指纹(lobby 形状 JSON):变化才发 ③,防元数据变更无车可搭。 */
const lastRoomMeta = new Map<string, string>();
/** 上次 flush/open 时引擎结算 turnPhase:决策窗退出检测(退出批无相位事件,如「今不用」)。 */
const settledTurnPhase = new Map<string, TurnPhase | null>();

function recordObservedRoomEvent(roomId: string, event: RoomEvent): void {
  const engine = registry.get(roomId)?.engine;
  const privateStep =
    event.ev === "bot-stop" &&
    event.reason === "human-turn" &&
    engine != null &&
    isPrivateJinnangStepBatch(engine.turnPhase, engine.turnPhase, engine.gameEvents);
  recordEvent(roomId, event, !privateStep);
}

const registry = new RoomRegistry(persistence, recordObservedRoomEvent, flushGameLog, {
  decisionTimeoutMs: DECISION_TIMEOUT_MS,
  reactionWindowMs: REACTION_WINDOW_MS_OVERRIDE,
  retentionWindowMs: RETENTION_WINDOW_MS,
  botStepMs: BOT_STEP_MS_EFFECTIVE,
});
// ──────────────────────────── WS 句柄归传输层(ADR-0007 关键不变量 1)────────────────────────────
// 房间 → 座位 → 当前 WebSocket。Room 模块不持有 WS,只有这里持有。
// Bun 的 ServerWebSocket 以 data 携带座位标识和该连接的诊断日志游标。
export interface WsSeat {
  roomId: string;
  seat: number;
  logCursor: GameLogCursor;
  decisions: SeatDecisionCursor;
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

function sendSeatSummary(room: RoomSession, online: Set<number>, ws: SeatSocket): void {
  const shot = assembleDownlinkShot(room, online, ws.data.seat, [], true);
  // Bun.send 的 0 表示丢弃，-1 表示已排队。游标随已接受的下行推进。
  if (ws.send(shot.snapshot) !== 0) {
    ws.data.logCursor = shot.logCursor;
    ws.data.decisions = shot.decisionCursor;
  }
}

function sendGameLog(ws: SeatSocket, engine: GameEngine, capturedAt: number): void {
  const { message, next } = assembleGameLogDelta(engine, ws.data.logCursor, capturedAt);
  if (message === null || ws.send(encodeDownlink(message)) !== 0) ws.data.logCursor = next;
}

// ──────────────────────────── 事件批下行通道(#390,#388 起为唯一对局状态通路)────────────────────────────
// 每次编排转移(submitCommand/botAct/开局驱动)后 onUpdate→broadcast;引擎当前批
// (engine.gameEvents,#375)以「数组引用换新」为界——beginGameEventBatch 弃批建新数组,
// 同一转移的重复通知(托管开关/终态推送等不触碰引擎的广播)引用不变,不重收。
// 节奏口径:挂进 flush 节奏——本 tick 内各转移的批按发生序拼接,flush 时每座位各发
// 一份 redactEvents 过滤批(#381,ADR-0020 决策 2 保密后补)后清空;不逐转移直发,
// 理由同旧快照合并:托管 bot 链单 tick 多转移,逐转移直发重蹈 WS 背压覆辙。
// 断线即丢(无排队无补发,ADR-0020 决策 4;重连=整房摘要,见 open 处理器)。
// 批语义本体(累积/去重/拼接/幂等排空/合并拍)在共享通道 scripts/event-batch.ts(#411)。
/** 广播(#388 折叠切换⑥):读 Room 当前状态 + 算 onlineSeats,flush 时按序发——
 *  1. 事件批消息(#390):本 tick 每座位各一份过滤批，本席决策权变化时也可单独下发；
 *  2. 关键节点校准快照(②):判定口径见顶部「全量下行三类」——每座位各发各的 per-seat
 *     投影,自带房间字段(元数据随车,指纹同步更新);
 *  3. 房间元数据消息(③):非校准 flush 且元数据指纹变化时补发 lobby 形状一条
 *     (对局中掉线/托管开关等不再搭快照车)。
 *  非校准拍另发已连接座位尚未获得的日志尾段(诊断归档)。日志可独立于事件批增长。
 *  「最新者胜」合并:本 tick 内只标记脏座位,setTimeout(0) 统一 flush——bot 局
 *  的零延迟连锁落在一个同步 tick 里,合并后每 tick 至多一批事件+至多一份校准快照。
 *  人类节奏的流程(每次命令一个 tick)行为不变;托管的步间 await 天然分 tick,
 *  事件逐批直播保留。 */
const dirtySeats = new Map<string, Set<number>>();
function broadcast(roomId: string): void {
  const room = registry.get(roomId);
  if (!room) return;
  eventBatches.accumulate(roomId, room.engine?.gameEvents); // #390:转移事件批入累积器,随本 tick flush 下发
  let seats = dirtySeats.get(roomId);
  if (!seats) {
    seats = new Set();
    dirtySeats.set(roomId, seats);
  }
  for (const seat of socketsOf(roomId).keys()) seats.add(seat);
  eventBatches.schedule(roomId, () => flushRoom(roomId));
}

/** flush 单体(#388):定时器到点与首连/重连摘要前的强制排空共用。幂等——事件批
 *  累积器排空后,重复调用不产 events 消息(pending 为空直接返回)。 */
function flushRoom(roomId: string): void {
  const pending = dirtySeats.get(roomId);
  dirtySeats.delete(roomId);
  const batch = eventBatches.drain(roomId) ?? []; // #411:幂等排空归共享通道
  const r = registry.get(roomId);
  if (!pending || !r) return;
  const online = onlineSeatsOf(roomId);
  // 校准判定(#388):读引擎公开结算态,零启发式;prev=上次 flush/open 的结算相位
  // (决策窗退出批无相位事件,如锦囊「今不用」,靠前后沿夹出)。先于装配求值:它
  // 决定每拍是否随发 ②(快照含全量 log,非校准拍不白付 O(log) 序列化)。
  // #529 闭沿限流:每个窗闭沿都是独立 flush(托管步进让闭沿彼此错拍),闭沿校准只在批为空批
  // (纯收尾拍)或含校准兜底 kind(窃玉偷香等折叠面不精确折、状态靠校准覆盖的结算)
  // 时落全量——普通 kind 结算批折叠精确,事件批即事实,快照不再随车;否则全量快照
  // 会随每次出牌闭沿跟发,退化成逐步广播(ADR-0020「快照不再作为逐步同步单元」)。
  const e = r.engine;
  const settled = e?.turnPhase ?? null;
  const prev = settledTurnPhase.get(roomId) ?? null;
  settledTurnPhase.set(roomId, settled);
  const closeEdgeBatch =
    batch.length === 0 || batch.some((ev) => CALIBRATION_BACKED_KINDS.has(ev.kind));
  const calibrate =
    e != null &&
    (e.phase === "Setup" ||
      batch.some((ev) => CALIBRATION_EVENT_KINDS.has(ev.kind)) ||
      (settled != null &&
        CALIBRATION_WINDOWS.has(settled) &&
        !isPrivateJinnangStepBatch(prev, settled, batch)) ||
      (prev != null && CALIBRATION_WINDOWS.has(prev) && closeEdgeBatch));
  // 逐座位单拍下行(#431 装配单口):事件批消息(#390)因果在前、状态在后;校准拍
  // 摘要随车(每座位各发各的 redactSnapshotForSeat 投影,#381:god-view 退役)。
  // redaction 在装配内必经(#381 保密后补,未知 kind 当场炸),本文件不再直呼
  // redactEvents/clientView。摘要半边只在校准
  // 拍构造(快照含全量 log,非校准拍不白付 O(log) 序列化)。序列化成本×座位数可接受
  // ——六人局事件批远小于全量快照。
  if (batch.length > 0 || !calibrate) {
    for (const ws of socketsOf(roomId).values()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const previousDecision = calibrate ? undefined : ws.data.decisions;
      const shot = assembleDownlinkShot(r, online, ws.data.seat, batch, false, previousDecision);
      if (shot.events !== null && ws.send(shot.events) !== 0) {
        ws.data.decisions = shot.decisionCursor;
      }
    }
  }
  const metaJson = encodeDownlink(lobbyView(r, online));
  if (calibrate) {
    // 关键节点校准(②):每座位一份纯摘要拍,自带房间字段,元数据指纹随车更新
    for (const ws of socketsOf(roomId).values()) {
      if (ws.readyState === WebSocket.OPEN) sendSeatSummary(r, online, ws);
    }
    lastRoomMeta.set(roomId, metaJson);
    return;
  }
  if (lastRoomMeta.get(roomId) !== metaJson) {
    // 房间元数据消息(③):lobby 形状,指纹变化才发
    lastRoomMeta.set(roomId, metaJson);
    for (const ws of socketsOf(roomId).values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(metaJson);
    }
  }
  if (e) {
    const capturedAt = Date.now();
    for (const ws of socketsOf(roomId).values()) {
      if (ws.readyState === WebSocket.OPEN) sendGameLog(ws, e, capturedAt);
    }
  }
}

// ──────────────────────────── HTTP 工具 ────────────────────────────
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
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

// ──────────────────────────── HTTP 路由 ────────────────────────────
const HELP = {
  ok: true,
  endpoints: {
    "GET /health": "存活 + 运行时长 + 房间数",
    "GET /help": "本接口列表",
    "POST /room/new": `建房 body:{seats?,bot?,seed?,target?,guohao?} → {seat:0,seatToken,...lobby}(seats 默认 ${STANDARD_SEAT_COUNT};mapId=null;guohao=host 预设国号)`,
    "POST /room/join":
      "入座 body:{roomId,guohao?} → {seat,seatToken,...lobby}(guohao=预设国号,重名开局时加方位前缀)",
    "POST /room/map": "host 选图 body:{roomId,seatToken,mapId} → {...lobby}(仅 host,开局前)",
    "POST /room/start":
      "开局 body:{roomId,seatToken}(仅 host,需已选图;从本席候选中通过 WS submit 选都)",
    "POST /room/dismiss": "host 解散房间 body:{roomId,seatToken}",
    "GET  /room/debug?room=": "调试:实时房间状态(相位/座位/托管)+ 最近 50 条事件尾巴",
    "WS  /ws?room=&seat=&token=":
      "入座连接；协议化操作（含托管与收回）发 {type:'submit',submission}，收 submissionResult；其余操作发 cmd",
  },
  retention:
    "掉线座位保留窗口(#380):对局中断线的座位保留 RETENTION_WINDOW_MS(env 可调,默认 600000=10 分钟,0=关);" +
    "窗口内持 seatToken 重连无缝归座;到期看门狗代开托管(ADR-0028,重连不清托管,原玩家点「收回」拿回);" +
    "token 是座位归属唯一凭证(ADR-0005),有效期=房间生命周期,不因保留窗到期失效",
  maps: CATALOG_ENTRIES.map((e) => ({
    id: e.id,
    name: e.name,
    tileCount: e.tileCount,
    targetNetWorth: e.targetNetWorth,
  })),
  env: {
    PORT,
    HOST,
    ROOMS_DIR,
    LOGS_DIR,
    MAPS_DIR,
    EXTENSIONS_DIR,
    LOG_TTL_DAYS,
    DECISION_TIMEOUT_MS,
    E2E_REACTION_MS: REACTION_WINDOW_MS_OVERRIDE,
    E2E_BOT_STEP_MS: BOT_STEP_MS_EFFECTIVE,
    RETENTION_WINDOW_MS,
  },
};

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (method === "OPTIONS") return sendJson(204, {});
  if (method === "GET") {
    if (path === "/health") {
      return sendJson(200, {
        ok: true,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        rooms: registry.size(),
      });
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
          autoPilot: [...room.autoPilot],
          seats: seatMeta(room, onlineSeatsOf(roomId)),
        },
        events: (eventTail.get(roomId) ?? []).slice(-50),
      });
    }
    throw httpError(404, `未知路由:${path}`);
  }
  if (method !== "POST") throw httpError(405, `不支持的方法:${method}`);

  const obj = asObject(await readBody(req));

  if (path === "/room/new") {
    const seatCount = Object.hasOwn(obj, "seats") ? obj.seats : STANDARD_SEAT_COUNT;
    if (typeof seatCount !== "number") throw httpError(400, "seats 不是整数");
    const botIdx = new Set(
      String(obj.bot ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < seatCount),
    );
    const hostConfig: HostConfig = {
      seed: obj.seed != null ? intField(obj, "seed", 0) : undefined,
      target: obj.target != null ? intField(obj, "target", 0) : undefined,
    };
    // 国号可选(R3-D1 #99):带上则作为 host(seat0)预设,开局时与房间内其它座位去重(对照 /room/join)
    const guohao = obj.guohao == null ? undefined : String(obj.guohao);
    const { room, seat, token } = registry.createRoom({ seatCount, botIdx, hostConfig, guohao });
    recordEvent(room.roomId, {
      ev: "room-new",
      seatCount,
      bot: [...botIdx],
      guohao: guohao ?? null,
    });
    // 建房时不设图(房间无地图);Host 须在大厅选图后再开局。startGame 会校验"已选图"。
    return sendJson(200, {
      ok: true,
      seat,
      seatToken: token,
      ...lobbyView(room, onlineSeatsOf(room.roomId)),
    });
  }

  if (path === "/room/join") {
    const roomId = String(obj.roomId ?? "");
    // 国号可选:带上则作为预设,开局时与房间内其它座位去重(重名加方位前缀)
    const guohao = obj.guohao == null ? undefined : String(obj.guohao);
    const { room, seat, token } = registry.joinSeat(roomId, guohao);
    recordEvent(roomId, { ev: "room-join", seat, guohao: guohao ?? null });
    broadcast(room.roomId); // 通知其它人:有人加入
    return sendJson(200, {
      ok: true,
      seat,
      seatToken: token,
      ...lobbyView(room, onlineSeatsOf(room.roomId)),
    });
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
    await registry.startGame(
      roomId,
      String(obj.seatToken ?? ""),
      () => broadcast(roomId),
      loadBuiltinMapById,
    );
    return sendJson(200, { ok: true });
  }

  if (path === "/room/dismiss") {
    const roomId = String(obj.roomId ?? "");
    const game = registry.get(roomId)?.engine;
    const id = registry.dismissRoom(roomId, String(obj.seatToken ?? ""));
    // dismissRoom 追加了解散行。先从各连接的游标交付余下日志，再通知解散。
    const capturedAt = Date.now();
    const msg = dismissedMsg(id);
    for (const ws of socketsOf(id).values()) {
      if (ws.readyState === WebSocket.OPEN) {
        if (game) sendGameLog(ws, game, capturedAt);
        ws.send(msg);
        ws.close();
      }
    }
    roomSockets.delete(id);
    eventBatches.forget(id); // #390/#388/#411:房间已散,累积状态一并清(在途拍不撤,迟到回调空转即清残表)
    lastRoomMeta.delete(id);
    settledTurnPhase.delete(id);
    return sendJson(200, { ok: true, dismissed: id });
  }

  throw httpError(404, `未知路由:${path}`);
}

const restored = registry.restoreAll(
  loadBuiltinMapById,
  (room) => {
    restoreGameLog(room);
    // 恢复的当前批视作已交付。后续超时或托管推进从恢复的日志与结算相位继续。
    const e = room.engine;
    if (e) {
      eventBatches.seedSeen(room.roomId, e.gameEvents);
      settledTurnPhase.set(room.roomId, e.turnPhase);
    }
  },
  (room) => broadcast(room.roomId),
);

// ──────────────────────────── WebSocket(升级在 fetch 里做,生命周期在 handlers)────────────────────────────
// 编程内起缝(#1283 双端对跑层):导出 Bun.serve 句柄本身,不另设装配函数。判词:本文件
// 的全部装配(registry/事件批通道/socket 表/落盘目录)是**进程单例长驻设计**——模块作用域
// 状态被 broadcast/flushRoom/handle/WS 处理器闭包共享,改成「可多次调用的装配函数」要整体
// 重排数百行闭包链,而双端对跑层同进程一实例即够(多实例零需求);故缝取最小=把已存在的
// serve 结果导出成句柄。端口与路径复用既有 env 面:PORT=0 即随机临时端口(句柄 .port 取
// 实际口),ROOMS_DIR/LOGS_DIR/MAPS_DIR/EXTENSIONS_DIR 本就可注入——测试在
// import 前设 env 即完成隔离,生产启动路径(`bun run serve`)零变化。约定:import 本模块即
// 起服(单例,进程内重复 import 走模块缓存;不要在未设 env 时于测试内 import)。
export const engineServer = Bun.serve<WsSeat>({
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
    if (
      !srv.upgrade(req, {
        data: {
          roomId,
          seat,
          logCursor: INITIAL_GAME_LOG_CURSOR,
          decisions: { decisionPoint: null, autopilotDecisionPoint: null },
        },
      })
    ) {
      return new Response("WebSocket upgrade failed", { status: 500 });
    }
    return undefined; // upgrade 成功后由 handlers 接管
  },
  websocket: {
    open(ws) {
      // 重连归座(ADR-0002/0005):token 是 Seat 归属唯一凭证。托管开关不动(ADR-0028:
      // 重连不清托管,回来的人点「收回」拿回控制)。
      const { roomId, seat } = ws.data;
      const room = registry.attachSeat(roomId, seat, () => broadcast(roomId));
      if (!room) {
        ws.close();
        return;
      }
      // 强制排空(#388 摘要/累积器竞态封口):此刻累积器里未 flush 的转移批若晚于摘要
      // 到达,重连端会「摘要(已含该批状态)+ 事件批(同批)」各收一次——事件折叠非幂等
      // (现金/入册双计),必须先排空给旧连接、再发摘要。排空时新 socket 尚未注册,
      // 天然收不到这份事件;之后注册、发摘要(保证 ⊇ 累积器全部内容)。
      eventBatches.cancelScheduled(roomId); // 已排定的定时 flush 由本次同步 flush 接手
      flushRoom(roomId);
      socketsOf(roomId).set(seat, ws);
      recordEvent(roomId, { ev: "ws-open", seat });
      // 首连/重连整房摘要(①,#388/ADR-0020 决策 4):经装配单口取该座位的
      // redactSnapshotForSeat 投影(#381 保密后补,他人锦囊手牌/牌库序/反应窗询问集
      // 不出网);重连语义=整房摘要水合,断线期间事件不补发(无 seq/ack,决策 4)。
      // 批已强制排空(上方 flushRoom),此处纯摘要拍:batch=[],withSnapshot 恒真。
      sendSeatSummary(room, onlineSeatsOf(roomId), ws);
      settledTurnPhase.set(roomId, room.engine?.turnPhase ?? null);
      // 在线集变化通知他人:flush 按元数据指纹差异补发 lobby(③);结算相位基线已登记
      broadcast(roomId);
    },
    message(ws, raw) {
      const { roomId, seat } = ws.data;
      // 上行解析+分发收口 wire.dispatchInbound(#429):错误回报是
      // 返回值的一部分——传输面只负责把失败送到 WS 通道(error 消息下行,#428 口径
      // 全分支同款,漏 catch 无处藏身);观测流水在 ops 闭包内记(仅已识别形状,同旧)。
      void dispatchInbound(
        typeof raw === "string" ? raw : Buffer.from(raw).toString(),
        {
          submit: (submission) => {
            recordEvent(roomId, {
              ev: "cmd",
              seat,
              cmd: submission.cmd.type,
              submissionId: submission.submissionId,
            });
            return registry.submitFromSeat(roomId, seat, submission, () => broadcast(roomId));
          },
          cmd: (cmd, report) => {
            recordEvent(roomId, { ev: "cmd", seat, cmd: cmd.type });
            // #454:cmd 面座位鉴权——连接只能以本连接座位(seat)提交命令,非决策
            // 归属(非活跃玩家/非反应窗被询问者)403 拒绝并回执 error;校验在 room 层
            // applyCommandFromSeat。
            return registry.applyCommandFromSeat(
              roomId,
              seat,
              cmd,
              () => broadcast(roomId),
              report,
            );
          },
        },
        {
          sendCommandResult: (frame) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(frame);
          },
          // 未知形状引导文案按房间状态给(对局未开始不给期望形状,给状态说明;原 else 分支同款)
          unknownShapeText: registry.get(roomId)?.engine
            ? "expected {type:'cmd',cmd:...}"
            : "对局未开始",
        },
      ).then((result) => {
        if (!result.ok)
          ws.send(
            errorMsg(result.message, result.reason === "rejected" ? result.requestId : undefined),
          );
      });
    },
    close(ws) {
      const { roomId, seat } = ws.data;
      recordEvent(roomId, { ev: "ws-close", seat });
      // 旧连接关掉时，重连后的当前座位仍然在线。
      const sockets = roomSockets.get(roomId);
      if (sockets?.get(seat) !== ws) return;
      sockets.delete(seat);
      // 算"还在线的座位"(不含刚断开的本 seat),交给 Room 做 host 移交 + 托管代开判断
      const stillOnline = onlineSeatsOf(roomId);
      void registry.markSeatOffline(roomId, seat, stillOnline, () => broadcast(roomId));
    },
  },
} satisfies import("bun").ServeOptions<WsSeat> | undefined);

// 0.0.0.0 是监听地址(所有网卡),不是可访问 URL——打印时换成本机可点的形式
console.log(
  `[server] 群雄逐鹿引擎服务已启动 → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${engineServer.port}`,
);
console.log(`[server] 房间目录:${ROOMS_DIR}(已恢复 ${restored} 局)`);
console.log(
  `[server] 对局日志:${LOGS_DIR}(TTL ${LOG_TTL_DAYS} 天,启动清扫删除 ${removedOldLogs} 个过期文件)`,
);
console.log(
  `[server] 停摆看门狗(#118):${DECISION_TIMEOUT_MS > 0 ? `${DECISION_TIMEOUT_MS}ms` : "关"};反应窗(#284):${REACTION_WINDOW_MS_OVERRIDE > 0 ? `覆盖 ${REACTION_WINDOW_MS_OVERRIDE}ms` : "常量表默认"};掉线保留窗(#380):${RETENTION_WINDOW_MS > 0 ? `${RETENTION_WINDOW_MS / 1000} 秒` : "关"};bot 配速(#730):${BOT_STEP_MS_EFFECTIVE > 0 ? `${BOT_STEP_MS_EFFECTIVE}ms/步` : "关"}`,
);
console.log(
  "[server] 大厅 /room/new|join|start|dismiss;掉线冻结+房主解散出口(ADR-0002/0028);WS /ws",
);
