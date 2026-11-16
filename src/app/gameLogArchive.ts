import type { GameEngine } from "@core/authority";
import type { LogEvent } from "@core/model";
import type {
  ArchivedGame,
  ArchivedGameSummary,
  GameArchiveFailure,
  GameArchiveIdentity,
  GameDiagnosticCapture,
} from "./game-diagnostic-record";

const DB_NAME = "dafung-logs";
const DB_VERSION = 2;
const LOGS = "games";
const LOG_TAILS = "logTails";
const SUMMARIES = "summaries";
const CAPTURES = "captures";
const GAME_ID = "gameId";
const PLAY_ORDER = "playOrder";
const LAST_PLAYED_AT = "lastPlayedAt";
const LOG_TTL_MS = 30 * 86_400_000; // ADR-0014

interface ArchivedLog {
  gameId: string;
  header: LogEvent | null;
  lines: LogEvent[];
  updatedAt: number;
}

interface SummaryRecord extends ArchivedGameSummary {
  playOrder: number;
  logCapturedAt: number | null;
}

interface ArchivedLogTail {
  gameId: string;
  lines: LogEvent[];
}

type GameActivity =
  | { kind: "log"; log: ArchivedLog }
  | { kind: "tail"; offset: number; capturedAt: number; tail: ArchivedLogTail }
  | { kind: "capture"; capture: GameDiagnosticCapture };

function legacyMapId(header: LogEvent | null): string | null {
  if (header === null) return null;
  const detail = JSON.parse(header.detail) as { mapId?: unknown } | null;
  const mapId = detail?.mapId;
  return typeof mapId === "string" && mapId !== "" ? mapId : null;
}

function migrateSoloSummaries(summaries: IDBObjectStore): void {
  const records: ArchivedGameSummary[] = [];
  const request = summaries.transaction.objectStore(LOGS).openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      const log = cursor.value as ArchivedLog;
      records.push({
        gameId: log.gameId,
        mode: "solo",
        mapId: legacyMapId(log.header),
        appVersion: null,
        lastPlayedAt: log.updatedAt,
        logCount: log.lines.length,
      });
      cursor.continue();
      return;
    }
    records.sort((a, b) => a.lastPlayedAt - b.lastPlayedAt);
    records.forEach((summary, index) => {
      summaries.put(
        {
          ...summary,
          playOrder: index + 1,
          logCapturedAt: summary.lastPlayedAt,
        } satisfies SummaryRecord,
        summary.gameId,
      );
    });
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = ({ oldVersion }) => {
      if (oldVersion === 0) req.result.createObjectStore(LOGS);
      const summaries = req.result.createObjectStore(SUMMARIES);
      summaries.createIndex(PLAY_ORDER, PLAY_ORDER, { unique: true });
      summaries.createIndex(LAST_PLAYED_AT, LAST_PLAYED_AT);
      req.result.createObjectStore(LOG_TAILS).createIndex(GAME_ID, GAME_ID);
      req.result.createObjectStore(CAPTURES);
      if (oldVersion === 1) migrateSoloSummaries(summaries);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      req.onsuccess = () => req.result.close();
      reject(new Error("其他连接阻塞了对局归档数据库升级"));
    };
  });
  dbPromise = opening;
  void opening.catch(() => {
    dbPromise = null;
  });
  return opening;
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function whenCommitted(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException("对局归档事务已中止", "AbortError"));
  });
}

let queue: Promise<void> = Promise.resolve();
const pendingWrites = new Map<string, Promise<void>>();
const writeFailures = new Map<string, GameArchiveFailure[]>();
let latestWriteGameId: string | null = null;

function enqueueWrite(
  gameId: string,
  kind: GameArchiveFailure["kind"],
  write: () => Promise<void>,
): Promise<void> {
  latestWriteGameId = gameId;
  const pending = queue.then(write);
  const settled = pending
    .then(
      () => {
        const remaining = writeFailures.get(gameId)?.filter((failure) => failure.kind !== kind);
        if (remaining?.length) writeFailures.set(gameId, remaining);
        else writeFailures.delete(gameId);
      },
      (error: unknown) => {
        const failures = writeFailures.get(gameId) ?? [];
        // 后续尾段也可能因缺失这拍而失败，保留最先发生的错误。
        if (failures.some((failure) => failure.kind === kind)) return;
        const message = error instanceof Error ? error.message : String(error);
        writeFailures.set(gameId, [...failures, { kind, message }]);
      },
    )
    .finally(() => {
      if (pendingWrites.get(gameId) === settled) pendingWrites.delete(gameId);
    });
  queue = settled;
  pendingWrites.set(gameId, settled);
  return pending;
}

async function waitForWrites(gameId?: string): Promise<void> {
  await (gameId === undefined ? queue : pendingWrites.get(gameId));
}

/** 等待本局已排队的写入并返回失败原因，即使尚无摘要可读。 */
export async function waitForGameArchive(gameId: string): Promise<readonly GameArchiveFailure[]> {
  await waitForWrites(gameId);
  return writeFailures.get(gameId) ?? [];
}

/** 首页离场后可报出最近一局的失败，即使整局尚无可选摘要。 */
export async function latestGameArchiveFailure(): Promise<{
  gameId: string;
  failures: readonly GameArchiveFailure[];
} | null> {
  const gameId = latestWriteGameId;
  if (gameId === null) return null;
  const failures = await waitForGameArchive(gameId);
  return failures.length > 0 ? { gameId, failures } : null;
}

function toSummary({
  playOrder: _playOrder,
  logCapturedAt: _logCapturedAt,
  ...summary
}: SummaryRecord): ArchivedGameSummary {
  return summary;
}

function clearLogTails(tails: IDBObjectStore, gameId: IDBValidKey): void {
  const request = tails.index(GAME_ID).openKeyCursor(gameId);
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    tails.delete(cursor.primaryKey);
    cursor.continue();
  };
}

function cleanExpired(summaries: IDBObjectStore, cutoff: number): void {
  const logs = summaries.transaction.objectStore(LOGS);
  const tails = summaries.transaction.objectStore(LOG_TAILS);
  const captures = summaries.transaction.objectStore(CAPTURES);
  const request = summaries.index(LAST_PLAYED_AT).openKeyCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor || (cursor.key as number) >= cutoff) return;
    const gameId = cursor.primaryKey;
    summaries.delete(gameId);
    logs.delete(gameId);
    clearLogTails(tails, gameId);
    captures.delete(gameId);
    cursor.continue();
  };
}

async function writeActivity(
  identity: GameArchiveIdentity,
  playedAt: number,
  activity: GameActivity,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([SUMMARIES, LOGS, LOG_TAILS, CAPTURES], "readwrite");
  const { gameId } = identity;
  const summaries = tx.objectStore(SUMMARIES);
  const tails = tx.objectStore(LOG_TAILS);
  let offsetError: Error | null = null;
  const newest = summaries.index(PLAY_ORDER).openKeyCursor(null, "prev");
  newest.onsuccess = () => {
    const playOrder = newest.result ? (newest.result.key as number) + 1 : 1;
    const previous = summaries.get(gameId);
    previous.onsuccess = () => {
      const current = previous.result as SummaryRecord | undefined;
      const summary: SummaryRecord = {
        ...identity,
        mapId: identity.mapId ?? current?.mapId ?? null,
        playOrder,
        lastPlayedAt: playedAt,
        logCount: current?.logCount ?? 0,
        logCapturedAt: current?.logCapturedAt ?? null,
        appVersion: current?.appVersion ?? null,
      };
      if (activity.kind === "log") {
        summary.logCount = activity.log.lines.length;
        summary.logCapturedAt = activity.log.updatedAt;
        tx.objectStore(LOGS).put(activity.log, gameId);
        clearLogTails(tails, gameId);
      } else if (activity.kind === "tail") {
        if (summary.logCapturedAt === null || activity.offset !== summary.logCount) {
          offsetError = new Error(
            `对局日志尾段无法衔接，已归档 ${summary.logCount} 行，收到偏移 ${activity.offset}`,
          );
          tx.abort();
          return;
        }
        summary.logCount += activity.tail.lines.length;
        summary.logCapturedAt = activity.capturedAt;
        tails.put(activity.tail, [gameId, activity.offset]);
      } else {
        summary.appVersion = activity.capture.appVersion;
        tx.objectStore(CAPTURES).put(activity.capture, gameId);
      }
      summaries.put(summary, gameId);
      if (!current) cleanExpired(summaries, playedAt - LOG_TTL_MS);
    };
  };
  try {
    await whenCommitted(tx);
  } catch (error: unknown) {
    throw offsetError ?? error;
  }
}

export function archiveGameLog(
  identity: GameArchiveIdentity,
  lines: readonly LogEvent[],
  capturedAt: number,
): Promise<void> {
  const playedAt = Date.now();
  const game = { ...identity };
  const captured = [...lines];
  const log: ArchivedLog = {
    gameId: game.gameId,
    header: captured.find((line) => line.category === "header") ?? null,
    lines: captured,
    updatedAt: capturedAt,
  };
  return enqueueWrite(game.gameId, "log", () =>
    writeActivity(game, playedAt, { kind: "log", log }),
  );
}

/** 已校准联机日志仅添连续的尾段，与摘要和日志截止同事务提交。 */
export function archiveGameLogTail(
  identity: GameArchiveIdentity,
  offset: number,
  lines: readonly LogEvent[],
  capturedAt: number,
): Promise<void> {
  const playedAt = Date.now();
  const game = { ...identity };
  const tail: ArchivedLogTail = { gameId: game.gameId, lines: [...lines] };
  return enqueueWrite(game.gameId, "log", () =>
    writeActivity(game, playedAt, { kind: "tail", offset, capturedAt, tail }),
  );
}

export async function archiveGameCapture(
  identity: GameArchiveIdentity,
  capture: GameDiagnosticCapture,
): Promise<void> {
  const playedAt = Date.now();
  const game = { ...identity };
  try {
    const captured = structuredClone(capture);
    return enqueueWrite(game.gameId, "capture", () =>
      writeActivity(game, playedAt, { kind: "capture", capture: captured }),
    );
  } catch (error: unknown) {
    return enqueueWrite(game.gameId, "capture", () => Promise.reject(error));
  }
}

export async function listArchivedGames(): Promise<ArchivedGameSummary[]> {
  await waitForWrites();
  const db = await openDb();
  const index = db.transaction(SUMMARIES).objectStore(SUMMARIES).index(PLAY_ORDER);
  const summaries = await reqAsPromise<SummaryRecord[]>(index.getAll());
  return summaries.reverse().map(toSummary);
}

export async function loadArchivedGame(gameId: string): Promise<ArchivedGame | null> {
  const archiveFailures = await waitForGameArchive(gameId);
  const db = await openDb();
  const tx = db.transaction([SUMMARIES, LOGS, LOG_TAILS, CAPTURES]);
  const [summary, anchor, tails, capture] = await Promise.all([
    reqAsPromise<SummaryRecord | undefined>(tx.objectStore(SUMMARIES).get(gameId)),
    reqAsPromise<ArchivedLog | undefined>(tx.objectStore(LOGS).get(gameId)),
    reqAsPromise<ArchivedLogTail[]>(tx.objectStore(LOG_TAILS).index(GAME_ID).getAll(gameId)),
    reqAsPromise<GameDiagnosticCapture | undefined>(tx.objectStore(CAPTURES).get(gameId)),
  ]);
  if (!summary) return null;
  const capturedAt = summary.logCapturedAt;
  let log: ArchivedGame["log"] = null;
  if (capturedAt !== null) {
    if (anchor === undefined) throw new Error(`对局 ${gameId} 缺少已归档的日志锚`);
    // 同一局在索引中的主键按 [gameId, offset] 排序。
    const { lines } = anchor;
    for (const tail of tails) for (const line of tail.lines) lines.push(line);
    log = { capturedAt, lines };
  }
  return {
    ...toSummary(summary),
    log,
    capture: capture ?? null,
    archiveFailures,
  };
}

const queuedEngineLogs = new WeakMap<GameEngine, { gameId: string; length: number }>();

/** 单机权威引擎的 logSink 适配。终局行随末次持久化归档。 */
export function archiveEngineLog(engine: GameEngine): void {
  const { gameId, mapId, log } = engine;
  const queued = queuedEngineLogs.get(engine);
  if (queued?.gameId === gameId && queued.length >= log.length) return;
  const watermark = { gameId, length: log.length };
  queuedEngineLogs.set(engine, watermark);
  void archiveGameLog(
    { gameId, mode: "solo", mapId: mapId === "" ? null : mapId },
    log,
    Date.now(),
  ).catch((error: unknown) => {
    if (queuedEngineLogs.get(engine) === watermark) queuedEngineLogs.delete(engine);
    console.error("[logArchive] 单机日志归档失败:", error);
  });
}
