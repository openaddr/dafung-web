import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import type { LogEvent } from "@core/model";
import type {
  ArchivedGameSummary,
  GameArchiveIdentity,
  GameDiagnosticCapture,
} from "@app/game-diagnostic-record";

type Archive = typeof import("@app/gameLogArchive");

let archive: Archive;
let session = 0;
let indexedDb: IDBFactory;
let originalIndexedDb: PropertyDescriptor | undefined;

function openArchiveSession(): Promise<Archive> {
  const path = `../../src/app/gameLogArchive.ts?session=${++session}`;
  return import(path);
}

beforeEach(async () => {
  indexedDb = new IDBFactory();
  originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: indexedDb,
  });
  archive = await openArchiveSession();
});

afterEach(() => {
  mock.restore();
  if (originalIndexedDb) Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
  else Reflect.deleteProperty(globalThis, "indexedDB");
});

function logLine(brief: string, ts: number): LogEvent {
  return { ts, brief, round: 1, turn: 1, player: null, category: "system", detail: "" };
}

function diagnosticCapture(capturedAt: number): GameDiagnosticCapture {
  return {
    appVersion: "2026.11.42",
    capturedAt,
    device: { ua: "archive-test", dpr: 2, viewport: { w: 844, h: 390 } },
    client: {
      phase: "Playing",
      setupPhase: "Done",
      turnPhase: "Roll",
      round: 1,
      turnNumber: 2,
      activeIndex: 0,
      decisionOwner: 0,
      pendingLand: null,
      lastLandOutcomeKind: null,
      lastLandOutcomeProperty: null,
      choices: [],
      capitalChoices: null,
      reaction: null,
      seat: 0,
      interactive: true,
      selfPresenting: false,
      pending: false,
      fxBusy: false,
      autopilotOn: false,
    },
    connection: null,
    errors: [],
    perf: null,
  };
}

function seedV1(
  records: { gameId: string; header: LogEvent | null; lines: LogEvent[]; updatedAt: number }[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open("dafung-logs", 1);
    request.onupgradeneeded = () => {
      const games = request.result.createObjectStore("games");
      for (const record of records) games.put(record, record.gameId);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
}

test("等待当前写入后按游玩顺序列局，点读仅取指定局", async () => {
  const now = Date.now();
  spyOn(Date, "now").mockReturnValue(now);
  const older: GameArchiveIdentity = { gameId: "z", mode: "solo", mapId: "central-plains" };
  const recent: GameArchiveIdentity = { gameId: "a", mode: "online", mapId: "central-plains" };
  const opening = logLine("本局开局", now - 100);
  const recentLines = [opening];

  const writes = [
    archive.archiveGameLog(older, [logLine("历史局开局", now - 100)], now - 100),
    archive.archiveGameLog(recent, recentLines, now - 100),
  ];
  recentLines.push(logLine("采集后的追加", now));
  const [summary, selected] = await Promise.all([
    archive.listArchivedGames(),
    archive.loadArchivedGame(recent.gameId),
    ...writes,
  ] as const);

  expect(summary.map(({ gameId }) => gameId)).toEqual(["a", "z"]);
  expect(selected?.log).toEqual({ capturedAt: now - 100, lines: [opening] });
  await archive.loadArchivedGame(older.gameId);
  expect(await archive.listArchivedGames()).toEqual(summary);

  await archive.archiveGameLog(older, [logLine("历史局接着玩", now - 100)], now - 100);
  expect((await archive.listArchivedGames()).map(({ gameId }) => gameId)).toEqual(["z", "a"]);
});

test("同一局的日志与现场分别更新并保留各自的采集时间", async () => {
  const now = Date.now();
  const identity: GameArchiveIdentity = { gameId: "solo", mode: "solo", mapId: "central-plains" };
  const line = logLine("第一手操作", now - 200);
  const capture = diagnosticCapture(now - 100);
  const logWrite = archive.archiveGameLog(identity, [line], now - 180);
  const sceneWrite = archive.archiveGameCapture({ ...identity, mapId: null }, capture);
  capture.errors.push({ at: now, message: "现场采样后出现" });

  const [first] = await Promise.all([
    archive.loadArchivedGame(identity.gameId),
    logWrite,
    sceneWrite,
  ]);
  expect(first?.mapId).toBe(identity.mapId);
  expect(first?.log).toEqual({ capturedAt: now - 180, lines: [line] });
  expect(first?.capture).toEqual(diagnosticCapture(now - 100));

  const final = logLine("对局收口", now - 50);
  await archive.archiveGameLog(identity, [line, final], now - 40);
  const last = await archive.loadArchivedGame(identity.gameId);
  expect(last?.log).toEqual({ capturedAt: now - 40, lines: [line, final] });
  expect(last?.capture?.capturedAt).toBe(now - 100);
  expect((await archive.listArchivedGames())[0]).toMatchObject({
    appVersion: "2026.11.42",
    logCount: 2,
  });
});

test("迁移旧单机日志并保留已知时间、地图和未知现场，重开后可读", async () => {
  const now = Date.now();
  const header = {
    ...logLine("旧局开局", now - 300),
    category: "header",
    detail: JSON.stringify({ type: "header", gameId: "z-legacy", mapId: "central-plains" }),
  } satisfies LogEvent;
  await seedV1([
    {
      gameId: "a-legacy",
      header: null,
      lines: [logLine("局头缺失", now - 250)],
      updatedAt: now - 200,
    },
    { gameId: "z-legacy", header, lines: [header], updatedAt: now - 100 },
  ]);
  const legacySummary = {
    gameId: "z-legacy",
    mode: "solo",
    mapId: "central-plains",
    appVersion: null,
    lastPlayedAt: now - 100,
    logCount: 1,
  } satisfies ArchivedGameSummary;
  expect(await archive.listArchivedGames()).toEqual([
    legacySummary,
    {
      gameId: "a-legacy",
      mode: "solo",
      mapId: null,
      appVersion: null,
      lastPlayedAt: now - 200,
      logCount: 1,
    },
  ]);
  const current: GameArchiveIdentity = { gameId: "current", mode: "online", mapId: null };
  const scene = diagnosticCapture(now);
  await archive.archiveGameCapture(current, scene);

  const reopened = await openArchiveSession();
  expect((await reopened.listArchivedGames()).map(({ gameId }) => gameId)).toEqual([
    "current",
    "z-legacy",
    "a-legacy",
  ]);
  expect(await reopened.loadArchivedGame("z-legacy")).toEqual({
    ...legacySummary,
    log: { capturedAt: now - 100, lines: [header] },
    capture: null,
    archiveFailures: [],
  });
  expect(await reopened.loadArchivedGame(current.gameId)).toMatchObject({
    log: null,
    capture: scene,
  });
});

test("30 天清理同时删除日志和现场，联机日志时钟不参与留存", async () => {
  const now = Date.now();
  const expiredTime = now - 35 * 86_400_000;
  const clock = spyOn(Date, "now").mockReturnValue(expiredTime);
  const expired: GameArchiveIdentity = { gameId: "expired", mode: "online", mapId: null };
  const otherExpired: GameArchiveIdentity = { ...expired, gameId: "other-expired" };
  const line = logLine("远端日志", expiredTime);
  const tail = logLine("后续收到的日志", expiredTime + 1);
  for (const game of [expired, otherExpired]) {
    await archive.archiveGameLog(game, [line], expiredTime);
    await archive.archiveGameLogTail(game, 1, [tail], expiredTime + 1);
    await archive.archiveGameCapture(game, diagnosticCapture(expiredTime));
  }
  expect((await archive.loadArchivedGame(expired.gameId))?.log).toEqual({
    capturedAt: expiredTime + 1,
    lines: [line, tail],
  });

  clock.mockReturnValue(now);
  const online: GameArchiveIdentity = { ...expired, gameId: "online" };
  const recent: GameArchiveIdentity = { gameId: "new-solo", mode: "solo", mapId: null };
  await archive.archiveGameLog(online, [line], expiredTime);
  await archive.archiveGameCapture(recent, diagnosticCapture(now));

  expect((await archive.listArchivedGames()).map(({ gameId }) => gameId)).toEqual([
    "new-solo",
    "online",
  ]);
  expect(await archive.loadArchivedGame(online.gameId)).toMatchObject({
    lastPlayedAt: now,
    log: { capturedAt: expiredTime, lines: [line] },
  });

  await archive.archiveGameCapture(expired, diagnosticCapture(now));
  await archive.archiveGameLog(otherExpired, [line], expiredTime);
  expect((await archive.loadArchivedGame(expired.gameId))?.log).toBeNull();
  expect((await archive.loadArchivedGame(otherExpired.gameId))?.capture).toBeNull();
});

test("日志写入中止时可读同局旧前缀及另一局，成功的现场写入独立提交", async () => {
  const now = Date.now();
  const identity: GameArchiveIdentity = { gameId: "retry", mode: "online", mapId: null };
  const other = { ...identity, gameId: "independent" };
  const line = logLine("已收到的日志", now);
  const next = logLine("尚未写入的日志", now + 1);
  const scene = diagnosticCapture(now);
  await archive.archiveGameLog(identity, [line], now);
  const put = IDBObjectStore.prototype.put;
  spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (
    this: globalThis.IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    const request = put.call(this, value, key);
    request.addEventListener("success", () => this.transaction.abort());
    return request;
  });

  const logWrite = archive.archiveGameLogTail(identity, 1, [next], now + 1);
  const sceneWrite = archive.archiveGameCapture(identity, scene);
  const otherWrite = archive.archiveGameCapture(other, scene);
  const read = archive.loadArchivedGame(identity.gameId);
  const readOther = archive.loadArchivedGame(other.gameId);
  await Promise.all([
    expect(logWrite).rejects.toMatchObject({ name: "AbortError" }),
    expect(read).resolves.toMatchObject({
      log: { capturedAt: now, lines: [line] },
      capture: scene,
      logCount: 1,
      archiveFailures: [{ kind: "log", message: "对局归档事务已中止" }],
    }),
    expect(readOther).resolves.toMatchObject({ capture: scene, archiveFailures: [] }),
    sceneWrite,
    otherWrite,
  ]);

  const third = logLine("不能跳过失败的尾段", now + 2);
  await expect(archive.archiveGameLogTail(identity, 2, [third], now + 2)).rejects.toThrow(
    "已归档 1 行，收到偏移 2",
  );
  expect(await archive.loadArchivedGame(identity.gameId)).toMatchObject({
    log: { capturedAt: now, lines: [line] },
    archiveFailures: [{ kind: "log", message: "对局归档事务已中止" }],
  });

  await archive.archiveGameLog(identity, [line, next], now + 1);
  expect(await archive.waitForGameArchive(identity.gameId)).toEqual([]);
  expect((await archive.loadArchivedGame(identity.gameId))?.log).toEqual({
    capturedAt: now + 1,
    lines: [line, next],
  });
});
