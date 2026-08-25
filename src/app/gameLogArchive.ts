// 单机对局日志落盘(ADR-0014 双轨落盘 · 浏览器侧):LocalController 每次 sync 后把
// engine.log 增量归档进 IndexedDB(db: dafung-logs / store: games / key: gameId /
// value: {gameId, header, lines, updatedAt})。终局行由引擎写入 engine.log,随末次
// sync 自然入库,无需单独收口。新局首写时顺手清理 updatedAt > 30 天的旧局(无定时器)。
// 联机不走本文件(服务器 logs/<gameId>.jsonl 是唯一事实源)——OnlineController 不调用。
import type { GameEngine } from "@core/game";
import type { LogEvent } from "@core/types";

const DB_NAME = "dafung-logs";
const DB_VERSION = 1;
const STORE = "games";
/** 保底清理 TTL(天):不追求精确到天,写入时顺手扫。 */
const LOG_TTL_DAYS = 30;

/** 一局日志的归档记录(IndexedDB value;key = gameId)。header 缺失如实为 null,不造。 */
export interface ArchivedGame {
  gameId: string;
  header: LogEvent | null;
  lines: LogEvent[];
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function writeRecord(rec: ArchivedGame): Promise<void> {
  const db = await openDb();
  await reqAsPromise(db.transaction(STORE, "readwrite").objectStore(STORE).put(rec, rec.gameId));
}

/** 读一局归档(无记录返回 null,导出层据此回退内存 log)。 */
export async function loadArchive(gameId: string): Promise<ArchivedGame | null> {
  const db = await openDb();
  const rec = await reqAsPromise(db.transaction(STORE).objectStore(STORE).get(gameId));
  return (rec as ArchivedGame | undefined) ?? null;
}

/** 新局顺手清理:删除 updatedAt 超过 30 天的局(ADR-0014 保底清理,单机侧)。 */
async function cleanExpired(): Promise<void> {
  const db = await openDb();
  const cutoff = Date.now() - LOG_TTL_DAYS * 86400_000;
  const cursorReq = db.transaction(STORE, "readwrite").objectStore(STORE).openCursor();
  await new Promise<void>((resolve, reject) => {
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        resolve();
        return;
      }
      if ((cursor.value as ArchivedGame).updatedAt < cutoff) void cursor.delete();
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

// ── 增量归档(同步入口 + 串行异步写队列)────────────────────────────
// lastGameId/lastLen = 当前局的入库基线:换局重置并触发清理;log 未增长直接跳过。
// 写队列串行化保证 IndexedDB 事务按捕获顺序落库(终值 = 最长的那次捕获)。
let lastGameId: string | null = null;
let lastLen = 0;
let queue: Promise<void> = Promise.resolve();

function logErr(err: unknown): void {
  console.error("[logArchive] 单机日志归档失败:", err); // 显式报错,不静默吞
}

export function archiveEngineLog(engine: GameEngine): void {
  if (engine.gameId !== lastGameId) {
    lastGameId = engine.gameId;
    lastLen = 0;
    queue = queue.then(cleanExpired).catch(logErr);
  }
  const lines = engine.log;
  if (lines.length <= lastLen) return;
  const gameId = engine.gameId;
  const captured = [...lines];
  lastLen = captured.length;
  queue = queue
    .then(() =>
      writeRecord({
        gameId,
        header: captured.find((l) => l.category === "header") ?? null,
        lines: captured,
        updatedAt: Date.now(),
      }),
    )
    .catch(logErr);
}
