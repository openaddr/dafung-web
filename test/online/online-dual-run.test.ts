// 双端对跑范例(ADR-0062 层③,#1436/#1437):每端独立 Bun 子进程,各装配生产
// OnlineController + gameStore/netStore,经生产 ReconnectingSocket 的真 WebSocket
// 连进程内服务器。IPC 只承载具体测试意图与同拍读数,零 DOM/几何/像素/演出泵。
//
// 装配与收摊:PORT=0/专属临时目录/零扩展/关闭机遇与决策看门狗;固定 seed 经既有
// REST/adoptRoom 缝布场。每例先解散房间,再两端 destroy/reset/断 IPC/有界等退出;
// suite stop(true)、还原 env、清临时目录。失败同样清理,不以 reset 促成收敛。
// 健康/恢复的公开状态均读两端引擎与各自 store 四向对账,私密手牌和询问集逐端核对。
// 恢复仅在 guest 的公开 socketFactory/timer/random 边界控制真 WS 与退避回调,
// 不替换 socket 语义或全局时钟。稳定读数停在固定种子的注册真人门,零弃试重跑。
// 反应窗 seed2849/魏 的既有谱使用固定宽窗(长于本例总超时),每次有效手答/拒重复均
// 以真实下行事件或 error 历史立屏障,超时代答无法在本例预算内替代手答。
// #1297 的 outcomeKind 漂移豁免只留 Playing 恢复边界,其他例仍比较全字段。
//
// 分层:纯传输故障仍归 protocol-online,断线横幅与真实设备交互由用户在 APK 中验收。
// 快慢池按本体实测 >=3s 且真实恢复/进程类的现行判据;主线复验 Setup~0.44s、
// Playing~1.54s、反应窗~0.53s,均入默认池;退避由生产 timer 接缝推进,无墙钟等待。
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MovePath } from "@core/board";
import type { GameSnapshot } from "@core/snapshot";
import type { NetSeatMeta } from "@app/store/netStore";
import { DualClientProcess } from "./dual-client-process";
import type { DualClientObservation, DualClientRetryMode } from "./dual-client-observation";

type ServerModule = typeof import("../../scripts/server");
let serverMod: ServerModule | null = null;
let tmpDir: string | null = null;
let serverBase = "";
const savedEnv = new Map<string, string | undefined>();
function setEnv(key: string, value: string): void {
  savedEnv.set(key, process.env[key]);
  process.env[key] = value;
}
let roomId = "";
let hostToken = "";

// ─── 公开投影(收敛面):引擎 Player 与快照 SnapshotPlayer 的结构公共面白名单 ───
interface PlayerRowLike {
  id: string;
  name: string;
  guohao: string;
  isBot: boolean;
  cash: number;
  position: number;
  capitalIndex: number;
  stamina: number;
  reputation: number;
  skipTurns: number;
  isBankrupt: boolean;
  jinnangHandCount: number;
  properties: { propertyId: string; level: number }[];
  heroes: { heroId: string; skillIds: string[] }[];
  treasures: { id: string }[];
}
interface PublicPlayerRow {
  id: string;
  name: string;
  isBot: boolean;
  cash: number;
  position: number;
  capitalIndex: number;
  stamina: number;
  reputation: number;
  skipTurns: number;
  isBankrupt: boolean;
  jinnangHandCount: number;
  properties: { propertyId: string; level: number }[];
  heroes: { heroId: string; skillIds: string[] }[];
  treasures: string[];
}
interface PublicProjection {
  phase: string;
  turnPhase: string;
  round: number;
  turnNumber: number;
  activeIndex: number;
  roundAnchor: number;
  decisionOwner: number;
  isOver: boolean;
  jinnangDeckCount: number;
  lastRollDie: number | null;
  lastMove: MovePath | null;
  takenCapitals: number[];
  outcomeKind: string | null;
  pendingLandKind: string | null;
  players: PublicPlayerRow[];
}

function publicPlayerOf(p: PlayerRowLike): PublicPlayerRow {
  return {
    id: p.id,
    // 展示名与 serializeGame 同规则派生(guohao 优先,doDraftRoll 定国号后快照行即国号;
    // restore 不回写 live name——客户端引擎 live 名恒占位名,直接比 name 必假红)
    name: p.guohao !== "" ? p.guohao : p.name,
    isBot: p.isBot,
    cash: p.cash,
    position: p.position,
    capitalIndex: p.capitalIndex,
    stamina: p.stamina,
    reputation: p.reputation,
    skipTurns: p.skipTurns,
    isBankrupt: p.isBankrupt,
    jinnangHandCount: p.jinnangHandCount,
    properties: p.properties
      .map((h) => ({ propertyId: h.propertyId, level: h.level }))
      .sort((a, b) => (a.propertyId < b.propertyId ? -1 : a.propertyId > b.propertyId ? 1 : 0)),
    heroes: p.heroes
      .map((s) => ({ heroId: s.heroId, skillIds: [...s.skillIds].sort() }))
      .sort((a, b) => (a.heroId < b.heroId ? -1 : a.heroId > b.heroId ? 1 : 0)),
    treasures: p.treasures.map((t) => t.id).sort(),
  };
}

function snapshotProjection(s: GameSnapshot): PublicProjection {
  return {
    phase: s.phase,
    turnPhase: s.turnPhase,
    round: s.round,
    turnNumber: s.turnNumber,
    activeIndex: s.activeIndex,
    roundAnchor: s.roundAnchor,
    decisionOwner: s.decisionOwner,
    isOver: s.isOver,
    jinnangDeckCount: s.jinnangDeckCount,
    lastRollDie: s.lastRoll?.die ?? null,
    lastMove: s.lastMove ?? null,
    takenCapitals: [...s.takenCapitalIndices].sort((a, b) => a - b),
    outcomeKind: s.lastLandOutcomeKind ?? null,
    pendingLandKind: s.pendingLand?.kind ?? null,
    players: s.players.map(publicPlayerOf),
  };
}

const sameProjection = (x: PublicProjection | null, y: PublicProjection | null): boolean =>
  JSON.stringify(x) === JSON.stringify(y);

/** 核心投影同读(重连例专用):剥离 `outcomeKind` 后逐字段比对。判词(#1287 实测):
 *  `lastLandOutcome` 是引擎自注的纯表现态(authority.ts「决策命令/恢复重建一律改走
 *  pendingLand」,消费面=战报/卷轴字段),且本票对跑试跑实锤其在「挂起决策门」上
 *  存在**折叠面 vs 权威面漂移**——两端折叠副本同持 Noop 而服务器落盘记录持
 *  PropertyAvailable(服务器房间记录取证,run-88),重连整房摘要把权威值带回一端
 *  即现单字段分歧。该字段不承载决策语义,不入「对局不丢状态」核心等式;漂移本体
 *  另行上报(src/** 不在本票所有权内),修复后应收回此剥离恢复全字段等式。 */
const sameCoreProjection = (x: PublicProjection | null, y: PublicProjection | null): boolean =>
  JSON.stringify(x === null ? null : { ...x, outcomeKind: null }) ===
  JSON.stringify(y === null ? null : { ...y, outcomeKind: null });

async function dismissCurrentRoom(why: string): Promise<void> {
  if (roomId === "" || hostToken === "") return;
  const res = await fetch(`${serverBase}/room/dismiss`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId, seatToken: hostToken }),
  });
  expect(res.ok, `解散房间失败(${why};HTTP ${res.status}):${await res.text()}`).toBe(true);
  roomId = "";
  hostToken = "";
}

type ClientPair = [DualClientObservation, DualClientObservation];
interface IsolatedPair {
  clients: [DualClientProcess, DualClientProcess];
  read(): Promise<ClientPair>;
  wait(
    desc: string,
    condition: (pair: ClientPair) => boolean,
    timeoutMs?: number,
  ): Promise<ClientPair>;
}

/** 每例一房、两端完整隔离栈;解散权仍在在线 host 时先解散,失败也有界收进程。 */
async function withIsolatedPair(
  retryMode: DualClientRetryMode,
  body: (pair: IsolatedPair) => Promise<void>,
): Promise<void> {
  const clients: IsolatedPair["clients"] = [
    new DualClientProcess("host", serverBase),
    new DualClientProcess("guest", serverBase, retryMode),
  ];
  const read = (): Promise<ClientPair> =>
    Promise.all(clients.map((client) => client.observe())) as Promise<ClientPair>;
  const wait: IsolatedPair["wait"] = async (desc, condition, timeoutMs = 5_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const pair = await read();
      if (condition(pair)) return pair;
      if (Date.now() > deadline)
        throw new Error(`隔离双端等待超时:${desc}\n${JSON.stringify(pair)}`);
      await Bun.sleep(10);
    }
  };
  const closeClients = async (): Promise<void> => {
    const closed = await Promise.allSettled(clients.map((client) => client.close()));
    const errors = closed
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length > 0) throw new AggregateError(errors, "隔离双端收摊失败");
  };
  try {
    await body({ clients, read, wait });
  } finally {
    try {
      await dismissCurrentRoom("隔离恢复/应答例收摊");
    } finally {
      await closeClients();
    }
  }
}

async function startIsolatedPair(
  pair: IsolatedPair,
  seats: number,
  seed: number,
  guohao?: string,
): Promise<ClientPair> {
  const [host, guest] = pair.clients;
  const created = await host.request({
    kind: "createRoom",
    seats,
    seed,
    ...(guohao === undefined ? {} : { guohao }),
  });
  if (created.credentials === null) throw new Error("host 建房未返回凭证");
  roomId = created.credentials.roomId;
  hostToken = created.credentials.seatToken;
  await guest.request({ kind: "joinRoom", roomId });
  await pair.wait("两端各自大厅校准", (views) =>
    views.every(
      (view) =>
        view.sessionReady &&
        view.net.seats.length === seats &&
        view.net.seats.slice(0, 2).every((seat) => seat.online),
    ),
  );
  await host.request({ kind: "pickMap", mapId: "guanzhong" });
  await host.request({ kind: "startGame" });
  return pair.wait("双端 Setup 选都门", (views) =>
    views.every(
      (view) =>
        view.sessionReady &&
        view.hydrated &&
        view.engine!.phase === "Setup" &&
        view.engine!.setupPhase === "PickCapital",
    ),
  );
}

async function finishIsolatedSetup(pair: IsolatedPair): Promise<ClientPair> {
  for (let picked = 0; picked < 2; picked++) {
    const views = await pair.wait("轮到本端选都", (current) =>
      current.some(
        (view) =>
          view.engine!.phase === "Setup" &&
          view.engine!.setupPhase === "PickCapital" &&
          view.engine!.currentSetupPlayerIndex === view.net.mySeat,
      ),
    );
    const seat = views.findIndex(
      (view) => view.engine!.currentSetupPlayerIndex === view.net.mySeat,
    );
    const tileIndex = views[seat].engine!.offeredCapitals[0];
    if (tileIndex === undefined) throw new Error(`座位 ${seat} 没有选都候选`);
    await pair.clients[seat].request({ kind: "pickCapital", tileIndex });
    await pair.wait(`座位 ${seat} 选都落账`, (current) =>
      current.every(
        (view) => view.engine!.phase === "Playing" || view.engine!.currentSetupPlayerIndex !== seat,
      ),
    );
  }
  return pair.wait("双端进 Playing", (current) =>
    current.every(
      (view) => view.engine!.phase === "Playing" && view.game.snapshot!.phase === "Playing",
    ),
  );
}

/** 和健康范例同谱:只放首掷前的锦囊门,首掷后注册真人门就是冻结屏障。 */
async function firstPlayingDecision(pair: IsolatedPair): Promise<ClientPair> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const views = await pair.read();
    const projections = views.flatMap((view) => [
      snapshotProjection(view.engine!),
      snapshotProjection(view.game.snapshot!),
    ]);
    if (
      views.every(
        (view) =>
          view.engine!.lastRoll !== null &&
          view.engine!.lastMove !== null &&
          view.engine!.choices.length > 0,
      ) &&
      projections.every((view) => sameProjection(projections[0], view))
    )
      return views;
    if (Date.now() > deadline) throw new Error(`首掷后真人决策门未收敛\n${JSON.stringify(views)}`);
    for (const [seat, view] of views.entries()) {
      if (view.engine!.lastRoll === null || view.engine!.lastMove === null)
        await pair.clients[seat].request({ kind: "declineJinnang" });
    }
    await Bun.sleep(10);
  }
}

function assertLocalSeats(pair: ClientPair): void {
  for (const [seat, view] of pair.entries()) {
    expect(view.seat).toBe(seat);
    expect(view.net.mySeat).toBe(seat);
    expect(view.game.viewSeat).toBe(seat);
    expect(view.net.roomId).toBe(roomId);
  }
}

function assertPrivateHands(pair: ClientPair): void {
  for (const [seat, view] of pair.entries()) {
    const players = view.game.snapshot!.players;
    expect(players.map((player) => player.jinnangHand)).toEqual(
      view.engine!.players.map((player) => player.jinnangHand),
    );
    for (const [owner, player] of players.entries()) {
      if (owner === seat) {
        expect(player.jinnangHand).toHaveLength(player.jinnangHandCount);
        expect(player.jinnangHandCount).toBeGreaterThan(0);
      } else expect(player.jinnangHand).toEqual([]);
    }
  }
}

function assertFourProjections(pair: ClientPair): PublicProjection {
  const expected = snapshotProjection(pair[0].engine!);
  for (const view of pair) {
    expect(snapshotProjection(view.engine!)).toEqual(expected);
    expect(snapshotProjection(view.game.snapshot!)).toEqual(expected);
  }
  return expected;
}

describe("双端对跑(#1283):双客户端栈 × 真 WS × 进程内引擎服务器", () => {
  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dafung-dual-run-"));
    mkdirSync(join(tmpDir, "extensions"), { recursive: true });
    setEnv("PORT", "0");
    setEnv("HOST", "127.0.0.1");
    setEnv("ROOMS_DIR", join(tmpDir, "rooms"));
    setEnv("LOGS_DIR", join(tmpDir, "logs"));
    setEnv("STATIC_DIR", join(tmpDir, "static"));
    setEnv("EXTENSIONS_DIR", join(tmpDir, "extensions"));
    setEnv("JIYU_CONFIG", realpathSync(join(import.meta.dir, "..", "fixtures", "jiyu-off.json")));
    setEnv("E2E_BOT_STEP_MS", "0");
    setEnv("E2E_REACTION_MS", "30000");
    setEnv("DECISION_TIMEOUT_MS", "0");
    setEnv("RETENTION_WINDOW_MS", "0");
    serverMod = await import("../../scripts/server");
    serverBase = `http://127.0.0.1:${serverMod.engineServer.port}`;
  }, 15_000);

  afterAll(async () => {
    try {
      await dismissCurrentRoom("suite 收摊");
    } finally {
      serverMod?.engineServer.stop(true);
      for (const [key, value] of savedEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (tmpDir !== null) rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15_000);

  // 守住完整客户端隔离与事件折算;固定 seed,本体预算为首掷生产延迟加进程装配。
  // 红证明:原共享装配在 guest 入座后,host 的 netStore.mySeat 实测由 0 变成 1。
  it("双栈真 WS 对跑:建房→入座→选图→开局→双端选都→事件折算推进,每端 store 独立收敛", async () => {
    await withIsolatedPair("automatic", async (pair) => {
      const { clients, wait } = pair;
      const [a, b] = clients;
      const created = await a.request({ kind: "createRoom", seats: 2, seed: 1 });
      if (created.credentials === null) throw new Error("host 建房未返回凭证");
      roomId = created.credentials.roomId;
      hostToken = created.credentials.seatToken;
      await b.request({ kind: "joinRoom", roomId });
      const lobby = await wait("双方各自 store 入座并在线", (pair) =>
        pair.every(
          (v) =>
            v.net.roomId === roomId &&
            v.net.connection === "open" &&
            v.net.seats.length === 2 &&
            v.net.seats.every((seat) => seat.online),
        ),
      );
      for (const [seat, endpoint] of lobby.entries()) {
        expect(endpoint.net.mySeat, `端 ${seat} 的真实 netStore 座位`).toBe(seat);
        expect(endpoint.game.viewSeat, `端 ${seat} 的真实 gameStore 视角`).toBe(seat);
        expect(endpoint.net.connected).toBe(true);
        expect(endpoint.net.connection).toBe("open");
        expect(endpoint.net.connectionFailure).toBeNull();
      }

      await a.request({ kind: "pickMap", mapId: "guanzhong" });
      await a.request({ kind: "startGame" });
      await wait("两端首帧摘要水合进 Setup", (pair) =>
        pair.every((v) => v.hydrated && v.engine!.phase === "Setup"),
      );
      const playing = await finishIsolatedSetup(pair);
      // 私密内容只和本端引擎对账,另一端看到的是空手牌内容与公开手牌数。
      const assertPrivateView = (pair: ClientPair): void => {
        for (const [seat, endpoint] of pair.entries()) {
          const live = endpoint.engine!.players;
          const projected = endpoint.game.snapshot!.players;
          expect(
            projected.map((p) => p.jinnangHand),
            `端 ${seat} 引擎↔本端 store 私密投影`,
          ).toEqual(live.map((p) => p.jinnangHand));
          expect(projected[seat].jinnangHand.length).toBeGreaterThan(0);
          expect(projected[seat].jinnangHand).toHaveLength(projected[seat].jinnangHandCount);
          expect(projected[1 - seat].jinnangHand).toEqual([]);
          expect(projected[1 - seat].jinnangHandCount).toBeGreaterThan(0);
          expect(projected[seat].jinnangHand).not.toEqual(
            pair[1 - seat].game.snapshot!.players[seat].jinnangHand,
          );
        }
      };
      assertPrivateView(playing);

      const final = await firstPlayingDecision(pair);
      const view = snapshotProjection(final[0].engine!);
      // 四向等式含 outcomeKind,不扩大恢复旧例对 Noop 漂移的字段豁免。
      expect(snapshotProjection(final[0].game.snapshot!)).toEqual(view);
      expect(snapshotProjection(final[1].engine!)).toEqual(view);
      expect(snapshotProjection(final[1].game.snapshot!)).toEqual(view);
      expect(view.phase).toBe("Playing");
      expect(view.turnNumber).toBeGreaterThanOrEqual(1);
      expect(view.lastRollDie).not.toBeNull();
      expect(view.lastMove).not.toBeNull();
      expect(view.players.some((p) => p.position !== p.capitalIndex)).toBe(true);
      expect(view.takenCapitals).toHaveLength(2);
      assertPrivateView(final);
      for (const [seat, endpoint] of final.entries()) {
        expect(endpoint.net.mySeat).toBe(seat);
        expect(endpoint.game.viewSeat).toBe(seat);
        expect(endpoint.net.connection).toBe("open");
        expect(endpoint.net.connected).toBe(true);
        expect(endpoint.net.host).toBe(0);
        expect(endpoint.net.started).toBe(true);
        expect(endpoint.net.mapId).toBe("guanzhong");
      }

      // guest 单独销毁/重置,host 的每端字段和私密内容仍保留本端值。
      const resetGuest = await b.request({ kind: "reset" });
      const hostAfterReset = await a.observe();
      expect(resetGuest.net.mySeat).toBe(-1);
      expect(resetGuest.net.connection).toBe("idle");
      expect(resetGuest.net.connected).toBe(false);
      expect(resetGuest.game.viewSeat).toBe(-1);
      expect(resetGuest.game.snapshot).toBeNull();
      expect(hostAfterReset.net.mySeat).toBe(0);
      expect(hostAfterReset.net.connection).toBe("open");
      expect(hostAfterReset.net.connected).toBe(true);
      expect(hostAfterReset.game.viewSeat).toBe(0);
      expect(hostAfterReset.game.snapshot!.players[0].jinnangHand).toEqual(
        final[0].game.snapshot!.players[0].jinnangHand,
      );
      expect(snapshotProjection(hostAfterReset.game.snapshot!)).toEqual(view);
    });
  }, 60_000);

  // #1421/#1422 的真 REST/WS 原座恢复覆盖迁至独立端。固定 seed1 停在 host 选都门,
  // guest maxAttempts=0 确定性耗尽;恢复不清托管,仅显式收回才关。零生产退避墙钟。
  it("隔离原座手动恢复Setup摘要", async () => {
    await withIsolatedPair("exhausted", async (pair) => {
      const [, guest] = pair.clients;
      let views = await startIsolatedPair(pair, 2, 1);
      if (views[1].engine!.currentSetupPlayerIndex === 1) {
        await guest.request({
          kind: "pickCapital",
          tileIndex: Math.min(...views[1].engine!.offeredCapitals),
        });
        views = await pair.wait("guest 选都后停在 host 真人门", (current) =>
          current.every((view) => view.engine!.currentSetupPlayerIndex === 0),
        );
      }
      expect(views[0].engine!.currentSetupPlayerIndex).toBe(0);
      expect(views[1].engine!.currentSetupPlayerIndex).toBe(0);
      assertLocalSeats(views);
      const readServerGuest = async (): Promise<NetSeatMeta> => {
        const response = await fetch(`${serverBase}/room/debug?room=${roomId}`);
        expect(response.ok).toBe(true);
        const debug = (await response.json()) as { room: { roomId: string; seats: NetSeatMeta[] } };
        expect(debug.room.roomId).toBe(roomId);
        return debug.room.seats[1]!;
      };
      expect((await readServerGuest()).autoPilot).toBe(false);
      await guest.request({ kind: "setAutoPilot", on: true });
      views = await pair.wait("guest 托管在各自广播中落账", (current) =>
        current.every((view) => view.net.seats[1]!.autoPilot),
      );
      expect(await readServerGuest()).toMatchObject({ seat: 1, online: true, autoPilot: true });
      const before = assertFourProjections(views);
      const offered = views[0].engine!.offeredCapitals;
      expect(views[1].engine!.offeredCapitals).toEqual(offered);
      expect(views[1].wire.urls).toHaveLength(1);
      expect(views[1].wire.readyStates).toEqual([WebSocket.OPEN]);

      await guest.request({ kind: "closeSocket" });
      views = await pair.wait(
        "guest 耗尽且 host 独立连接见证离线",
        (current) =>
          current[0].net.connection === "open" &&
          !current[0].net.seats[1]!.online &&
          current[1].net.connection === "gaveUp",
        2_000,
      );
      assertLocalSeats(views);
      expect(views[0].sessionReady).toBe(true);
      expect(views[0].net.connected).toBe(true);
      expect(views[0].net.reconnect).toBeNull();
      expect(views[1].sessionReady).toBe(false);
      expect(views[1].net.connected).toBe(false);
      expect(views[1].net.pending).toBe(false);
      expect(views[1].wire.readyStates).toEqual([WebSocket.CLOSED]);
      expect(await readServerGuest()).toMatchObject({ online: false, autoPilot: true });
      expect(snapshotProjection(views[1].engine!)).toEqual(before);
      expect(snapshotProjection(views[1].game.snapshot!)).toEqual(before);
      const originalUrl = views[1].wire.urls[0]!;
      const originalCredentials = views[1].credentials!;
      await guest.request({ kind: "reconnect" });
      await guest.request({ kind: "reconnect" });
      views = await pair.wait("原座权威 Setup 摘要恢复", (current) =>
        current.every(
          (view) =>
            view.sessionReady &&
            view.net.connection === "open" &&
            view.net.seats[1]!.online &&
            view.net.seats[1]!.autoPilot,
        ),
      );
      assertLocalSeats(views);
      expect(views[1].wire.urls).toEqual([originalUrl, originalUrl]);
      const recoveredUrl = new URL(views[1].wire.urls[1]!);
      expect(recoveredUrl.searchParams.get("room")).toBe(originalCredentials.roomId);
      expect(recoveredUrl.searchParams.get("seat")).toBe("1");
      expect(recoveredUrl.searchParams.get("token")).toBe(originalCredentials.seatToken);
      expect(assertFourProjections(views)).toEqual(before);
      for (const view of views) {
        expect(view.engine!.currentSetupPlayerIndex).toBe(0);
        expect(view.engine!.offeredCapitals).toEqual(offered);
        expect(view.engine!.setupPhase).toBe("PickCapital");
        expect(view.net.pending).toBe(false);
        expect(view.net.connectionFailure).toBeNull();
        expect(view.game.snapshot!.players.map((player) => player.jinnangHand)).toEqual(
          view.engine!.players.map((player) => player.jinnangHand),
        );
      }
      expect(await readServerGuest()).toMatchObject({ seat: 1, online: true, autoPilot: true });
      await guest.request({ kind: "setAutoPilot", on: false });
      views = await pair.wait("guest 显式收回在两端广播落账", (current) =>
        current.every((view) => !view.net.seats[1]!.autoPilot),
      );
      expect(await readServerGuest()).toMatchObject({ online: true, autoPilot: false });
      expect(assertFourProjections(views)).toEqual(before);
      expect(views[1].engine!.offeredCapitals).toEqual(offered);
    });
  }, 15_000);

  // 固定 seed1 真人门 + 只冻结 guest 的生产退避回调。真 WS 断开后先读每端
  // closed/open/进度,显式释放回调再真重拨,不靠 ±30% 时序也不弃试重来。
  // #1297 outcomeKind 豁免只在本 Playing 恢复边界沿用;其他例仍作全字段等式。
  it("隔离Playing自动重连:单端断线、生产退避与摘要水合、四向收敛后续局", async () => {
    await withIsolatedPair("held", async (pair) => {
      const [host, guest] = pair.clients;
      await startIsolatedPair(pair, 2, 1);
      await finishIsolatedSetup(pair);
      let views = await firstPlayingDecision(pair);
      assertLocalSeats(views);
      assertPrivateHands(views);
      const before = assertFourProjections(views);
      expect(before.turnPhase).toBe("AwaitingDecision");
      expect(views[0].engine!.decisionOwner).toBe(1);
      expect(views[1].engine!.decisionOwner).toBe(1);
      const ownHands = views.map((view, seat) => view.game.snapshot!.players[seat].jinnangHand);
      const hostSeq = views[0].net.eventBatchSeq;
      expect(views[1].net.eventBatchSeq).toBeGreaterThan(0);
      const originalUrl = views[1].wire.urls[0]!;
      const snapshotsBefore = views[1].wire.receivedTypes.filter(
        (type) => type === "snapshot",
      ).length;
      await guest.request({ kind: "closeSocket" });
      views = await pair.wait(
        "guest 退避被冻结且 host 连续在线",
        (current) =>
          current[0].net.connection === "open" &&
          !current[0].net.seats[1]!.online &&
          current[1].net.connection === "closed" &&
          current[1].wire.retryPending === 1,
      );
      assertLocalSeats(views);
      expect(views[0].sessionReady).toBe(true);
      expect(views[0].net.connected).toBe(true);
      expect(views[0].net.reconnect).toBeNull();
      expect(views[0].wire.readyStates).toEqual([WebSocket.OPEN]);
      expect(views[0].net.eventBatchSeq).toBe(hostSeq);
      expect(views[1].sessionReady).toBe(false);
      expect(views[1].net.connected).toBe(false);
      expect(views[1].net.pending).toBe(false);
      expect(views[1].net.reconnect).toEqual({ attempt: 1, max: 10 });
      expect(views[1].wire.readyStates).toEqual([WebSocket.CLOSED]);
      expect(views[1].wire.retryDelays).toEqual([1_000]);
      expect(assertFourProjections(views)).toEqual(before);
      await guest.request({ kind: "advanceReconnect" });
      views = await pair.wait(
        "真重拨后当前摘要校准完成",
        (current) =>
          current.every(
            (view) =>
              view.sessionReady && view.net.connection === "open" && view.net.seats[1]!.online,
          ),
        2_000,
      );
      assertLocalSeats(views);
      expect(views[0].wire.urls).toHaveLength(1);
      expect(views[1].wire.urls).toEqual([originalUrl, originalUrl]);
      expect(views[1].wire.readyStates).toEqual([WebSocket.CLOSED, WebSocket.OPEN]);
      expect(views[1].wire.retryPending).toBe(0);
      expect(views[1].net.reconnect).toBeNull();
      expect(views[1].net.eventBatchSeq).toBe(0);
      expect(views[1].net.lastEvents).toBeNull();
      expect(
        views[1].wire.receivedTypes.filter((type) => type === "snapshot").length,
      ).toBeGreaterThan(snapshotsBefore);
      // 历史缺陷只剥 outcomeKind,其余字段与断线前逐项比较,四份都不能漏。
      const assertRestoredCore = (current: ClientPair): void => {
        for (const view of current) {
          for (const snapshot of [view.engine!, view.game.snapshot!]) {
            expect({ ...snapshotProjection(snapshot), outcomeKind: null }).toEqual({
              ...before,
              outcomeKind: null,
            });
          }
        }
      };
      assertRestoredCore(views);
      assertPrivateHands(views);
      for (const [seat, view] of views.entries()) {
        expect(view.game.snapshot!.players[seat].jinnangHand).toEqual(ownHands[seat]);
        expect(view.net.pending).toBe(false);
        expect(view.net.connectionFailure).toBeNull();
      }
      // 固定 seed1 首门为 guest 的购地决策,恢复后仅由 guest 放行一次。
      // 传输面直派沿用 #1297 的 headless 输入锁边界,生产编码与服务器鉴权照走。
      const turn = before.turnNumber;
      const eventsBeforeContinuation = views[1].wire.events.length;
      await guest.request({ kind: "sendCommand", command: { type: "endDecision" } });
      views = await pair.wait("恢复后 guest 应答经服务器推进新回合", (current) =>
        current.every((view) => view.engine!.turnNumber > turn),
      );
      views = await pair.wait("新回合四向公开投影收敛", (current) => {
        const projected = current.flatMap((view) => [
          snapshotProjection(view.engine!),
          snapshotProjection(view.game.snapshot!),
        ]);
        return projected.every((view) => sameCoreProjection(projected[0], view));
      });
      expect(views[0].engine!.turnNumber).toBeGreaterThan(turn);
      expect(views[1].engine!.turnNumber).toBeGreaterThan(turn);
      expect(views[1].net.eventBatchSeq).toBeGreaterThan(0);
      expect(
        // turnStarted 首部在回次自增前盖章;新增事件片段证明续流,新回次另由状态断言。
        views[1].wire.events
          .slice(eventsBeforeContinuation)
          .some((event) => event.kind === "turnStarted"),
      ).toBe(true);
      assertPrivateHands(views);
      expect((await host.observe()).net.connection).toBe("open");
    });
  }, 15_000);

  // #453/#1316 的落盘腿迁至独立端,补齐原共享装配无法成立的每端座位/私密询问集。
  // 红证明:共享装配 guest 入座即把 host 的真实 netStore.mySeat 从0覆为1。
  // 宽窗30s > 本例总预算15s,手答后等事件屏障再发重复;不允许超时代答冒充有效手答。
  it("隔离双人类反应窗:有效应答、明确拒重复、两座恰一次与结算落盘", async () => {
    await withIsolatedPair("automatic", async (pair) => {
      const [host, guest] = pair.clients;
      await startIsolatedPair(pair, 3, 2849, "魏");
      await finishIsolatedSetup(pair);
      let views = await pair.wait("连环计双人类反应窗", (current) =>
        current.every(
          (view) =>
            view.engine!.reaction?.kind === "jinnang" && view.engine!.reaction.cardId === "连环计",
        ),
      );
      assertLocalSeats(views);
      assertPrivateHands(views);
      assertFourProjections(views);
      const announcedCard = views[0].engine!.reaction!.cardId;
      const seq = views[0].engine!.pendingReaction!.seq;
      const guestHintBefore = views[1].game.hint;
      const ownHands = views.map((view, seat) => view.game.snapshot!.players[seat].jinnangHand);
      for (const [seat, view] of views.entries()) {
        expect(view.net.connection).toBe("open");
        expect(view.wire.errors).toEqual([]);
        for (const snapshot of [view.engine!, view.game.snapshot!]) {
          expect(snapshot.pendingReaction!.seq).toBe(seq);
          expect(snapshot.pendingReaction!.answers).toEqual([]);
          const reaction = snapshot.reaction;
          if (reaction === null || reaction.kind !== "jinnang")
            throw new Error("本座缺少锦囊反应窗");
          expect(reaction.windowMs).toBe(30_000);
          expect(reaction.queriedBySeat).toEqual(seat === 0 ? [0, -1] : [-1, 1]);
          expect(snapshot.pendingReaction!.view).toEqual(reaction);
        }
        expect(view.wire.events.filter((event) => event.kind === "reactionAnswered")).toEqual([]);
        const opened = view.wire.events.find((event) => event.kind === "reactionOpened");
        if (opened === undefined || opened.kind !== "reactionOpened")
          throw new Error("缺少真实开窗事件");
        expect(opened.queriedSeats).toEqual(seat === 0 ? [0, -1] : [-1, 1]);
      }
      await host.request({
        kind: "sendCommand",
        command: { type: "respondReaction", seat: 0, use: false },
      });
      views = await pair.wait("host 有效应答在两端事件与挂起窗恰记一次", (current) =>
        current.every(
          (view) =>
            view.wire.events.filter(
              (event) => event.kind === "reactionAnswered" && event.seat === 0,
            ).length === 1 &&
            view.engine!.pendingReaction?.seq === seq &&
            view.engine!.pendingReaction.answers.length === 1,
        ),
      );
      const assertHostAnsweredOnce = (current: ClientPair): void => {
        for (const [seat, view] of current.entries()) {
          expect(
            view.wire.events
              .filter((event) => event.kind === "reactionAnswered")
              .map((event) => ({ seat: event.seat, use: event.use })),
          ).toEqual([{ seat: 0, use: false }]);
          for (const snapshot of [view.engine!, view.game.snapshot!]) {
            expect(snapshot.pendingReaction!.seq).toBe(seq);
            expect(snapshot.pendingReaction!.answers).toEqual([{ seat: 0, use: false }]);
            expect(snapshot.turnPhase).toBe("AwaitingReaction");
            expect(snapshot.reaction).toMatchObject({
              queriedBySeat: seat === 0 ? [0, -1] : [-1, 1],
            });
          }
        }
      };
      assertHostAnsweredOnce(views);
      await host.request({
        kind: "sendCommand",
        command: { type: "respondReaction", seat: 0, use: false },
      });
      views = await pair.wait(
        "同窗重复应答收到生产 error",
        (current) => current[0].wire.errors.length === 1,
      );
      expect(views[0].wire.errors).toEqual(["非本窗被询问座位,不能应答(更不能替他人应答)"]);
      expect(views[0].game.hint).toBe("非本窗被询问座位,不能应答(更不能替他人应答)");
      expect(views[1].game.hint).toBe(guestHintBefore);
      expect(views[1].wire.errors).toEqual([]);
      assertLocalSeats(views);
      assertHostAnsweredOnce(views);
      assertFourProjections(views);
      assertPrivateHands(views);

      await guest.request({
        kind: "sendCommand",
        command: { type: "respondReaction", seat: 1, use: false },
      });
      views = await pair.wait("guest 有效应答与连环计结算事件到两端", (current) =>
        current.every(
          (view) =>
            view.engine!.pendingReaction === null &&
            view.engine!.turnPhase !== "AwaitingReaction" &&
            view.wire.events.filter((event) => event.kind === "reactionAnswered").length === 2 &&
            view.wire.events.some((event) => event.kind === "duelResolved"),
        ),
      );
      await host.request({
        kind: "sendCommand",
        command: { type: "respondReaction", seat: 0, use: false },
      });
      views = await pair.wait("窗后重复仍明确拒绝且四向公开收敛", (current) => {
        const projected = current.flatMap((view) => [
          snapshotProjection(view.engine!),
          snapshotProjection(view.game.snapshot!),
        ]);
        return (
          current[0].wire.errors.length === 2 &&
          projected.every((view) => sameProjection(projected[0], view))
        );
      });
      assertFourProjections(views);
      assertLocalSeats(views);
      assertPrivateHands(views);
      for (const [seat, view] of views.entries()) {
        expect(
          view.wire.events
            .filter((event) => event.kind === "reactionAnswered")
            .map((event) => ({ seat: event.seat, use: event.use })),
        ).toEqual([
          { seat: 0, use: false },
          { seat: 1, use: false },
        ]);
        expect(view.engine!.reaction).toBeNull();
        expect(view.game.snapshot!.reaction).toBeNull();
        expect(view.game.snapshot!.players[seat].jinnangHand).toEqual(ownHands[seat]);
      }
      expect(views[0].wire.errors).toEqual(
        Array(2).fill("非本窗被询问座位,不能应答(更不能替他人应答)"),
      );
      expect(views[1].wire.errors).toEqual([]);
      // 权威持久化是本例独立的最终账,真实手答已经由上面的事件屏障证明。
      const recordLog = (): string[] => {
        const record = JSON.parse(
          readFileSync(join(tmpDir!, "rooms", `${roomId}.json`), "utf8"),
        ) as { snapshot: GameSnapshot };
        return record.snapshot.log.map((entry) => entry.detail);
      };
      const answeredBy = (details: string[], seat: number): string[] =>
        details.filter((detail) => detail.startsWith(`reactionRespond seat=p${seat} `));
      const deadline = Date.now() + 5_000;
      let details = recordLog();
      while (
        !details.some((detail) => detail.includes("jinnangUse") && detail.includes(announcedCard))
      ) {
        if (Date.now() > deadline)
          throw new Error(`连环计未落权威结算账:${JSON.stringify(details)}`);
        await Bun.sleep(10);
        details = recordLog();
      }
      expect(answeredBy(details, 0)).toEqual(["reactionRespond seat=p0 use=0 card=- share=-"]);
      expect(answeredBy(details, 1)).toEqual(["reactionRespond seat=p1 use=0 card=- share=-"]);
      expect(
        details.some((detail) => detail.includes("jinnangUse") && detail.includes(announcedCard)),
      ).toBe(true);
    });
  }, 15_000);
});
