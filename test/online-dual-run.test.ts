// 双端对跑范例例(#1283,ADR-0062 层③):两个完整客户端栈(真 OnlineController + 真
// gameStore/netStore)经**真 WebSocket**(bun 原生 WS 客户端 × 服务器真升级面)连**进程内
// 引擎服务器**(scripts/server.ts 编程内起缝:export engineServer 句柄,PORT=0 随机临时
// 端口),跑通 建房→入座→选图→开局→双端选都→Playing→服务器 #188 自动起摇代掷代行,
// 断言 = 双端引擎公开投影逐字段收敛(含共享 gameStore 快照三方对账)+ 事件折算对账
// (diceRolled/marchArrived 属 must-fold 档,无校准快照随行,折进两端副本的状态唯一来源
// 是事件批折叠——两端一致即折算语义对账),零 DOM 断言。
//
// 装配配方(本层模板,后续对跑例照此抄):
//   ① 服务器缝:beforeAll 先设 env 再动态 import scripts/server——import 即起服(进程内
//      单例,重复 import 走模块缓存),句柄 .port 取实际口、.stop(true) 收摊。env 面:
//      PORT=0(随机口)/HOST=127.0.0.1/ROOMS_DIR·LOGS_DIR·STATIC_DIR→tmp/EXTENSIONS_DIR→
//      tmp 空目录(合法零包环境,不裹挟共享进程的引擎注册面)/JIYU_CONFIG→e2e/jiyu-off.json
//      (机遇隔离,#118 教训)/E2E_BOT_STEP_MS=0/E2E_REACTION_MS=300(缩反应窗)/
//      DECISION_TIMEOUT_MS·RETENTION_WINDOW_MS=0(看门狗全关:停摆=响亮挂测,协议级
//      e2e 同款)。缝的判词见 scripts/server.ts「编程内起缝」注:单例长驻进程,导出已存在
//      的 serve 结果是最小缝,不另设装配函数。
//   ② 地址面:bun 运行时无 localStorage/location(量实,1.3.14)——补 localStorage 最小
//      shim(仅 getItem/setItem/removeItem),经 server-base 单源的**既有覆写通路**
//      (dafung.server-base,APK 联机改址同一条路;覆写存在时 getServerBase 短路,不触
//      location)写入 http://127.0.0.1:<port>。客户端零注入缝:OnlineController→
//      LobbyApi(REST fetch)→ReconnectingSocket(默认工厂 new WebSocket,bun 原生可用)
//      全走生产装配路径,不造第二套 socket 语义。
//   ③ 双栈:各 new OnlineController(guanzhong,"guanzhong")(同图,lobby 广播的 mapId
//      不触发 rebuildForMap)→ host.createRoom / guest.joinRoom(REST 大厅,adoptRoom
//      内建真 WS)。
//   ④ 驱动纪律:各端只认自己的座位(draft 序不预设,谁轮到谁 setupPickCapital,读各自
//      引擎的 offeredCapitals——落子时刻的候选已滚出被选都城);对局推进全服务器驱动
//      (#188 autoRoll 代摇不代决策,停在首个决策门,DECISION_TIMEOUT=0 冻结=稳定读数点)。
//   ⑤ 收敛读数:单线程内同步读三份投影(两端引擎 + 共享 gameStore 快照)原子成对比较,
//      不等即重试;相等后静置一拍复读(排除「正被后续事件批推进」的瞬时相等);一切
//      等待显式超时,超时即抛并附三方投影 JSON 转储(逐字段定位漂移,禁裸等)。
//
// 本层禁什么(ADR-0062 层③口径):几何/像素/DOM 断言零容忍。演出链(DOM/音频)在 bun
// 缺席由 SnapshotEffects 捕获报错不断言(local-room 先例 wisdom 复用)。保密截面不在
// 收敛面:联机下行按座位投影(他人 jinnangHand/牌序 per-端不同是特性不是漂移),投影
// 白名单只取公开字段(相位/回合/骰/路径/现金/位置/都城/地产/麾下/珍宝 id/手牌数)。
//
// store 单例纠缠(预期成本,ADR-0062 后果节;本例实测盘点):同进程双栈共享 zustand
// 模块单例——netStore 的 per-端字段(mySeat/connection)最后写胜、随栈抖动,断言面避开
// (只断双端同值的房间字段);gameStore 快照 = 最后同步端,因两端收敛故三方投影必一致。
// per-端隔离治理(可重置/实例隔离)按可隔离性常设原则随票治理,src/app/store/** 不在本
// 票文件所有权内(#1284 领域),此处仅盘点不下刀。收摊 reset netStore + setScreen 回
// setup:现状盘点守 store 初值的默认池用例(event-feed)自带 reset,其余消费面吃 delta,
// 复位后对任何执行序零污染。
//
// 慢例归属:本例实测 ~1.5s(2026-11-08 标定,五连跑 1.49-1.57s),低于「单例 ≥3s 入
// 慢池」判据(docs/how-to/开发与测试.md「把测试跑起来」),常驻默认池;若后续演化
// (扩驱动窗/加整局骑程)单例 ≥3s,按 local-room 骑局先例 itSlow 入 DAFUNG_SLOW
// (bun run test:slow)。
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GameEngine } from "@core/authority";
import type { MovePath } from "@core/board";
import { loadMap } from "@core/board-loader";
import { OnlineController } from "@app/controllers/online";
import { useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import guanzhongData from "../public/maps/guanzhong.json" with { type: "json" };

// ─── 测试环境面:bun 无 localStorage(量实),补最小 shim 供 server-base 单源读覆写 ───
const memStorage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string): string | null => memStorage.get(key) ?? null,
    setItem: (key: string, value: string): void => void memStorage.set(key, String(value)),
    removeItem: (key: string): void => void memStorage.delete(key),
  },
  configurable: true,
});

/** 私有面访问缝(测试专用;enteredGame @app 内聚私有,online-first-frame-fold 先例):
 *  该端已收首帧整房摘要并水合 = 双端各自入局的 per-端证据(共享 store 给不出的面)。 */
interface ControllerTestAccess {
  enteredGame: boolean;
}
const hydratedOf = (c: OnlineController): boolean =>
  (c as unknown as ControllerTestAccess).enteredGame;

type ServerModule = typeof import("../scripts/server");
let serverMod: ServerModule | null = null;
let tmpDir: string | null = null;
let serverBase = "";
const savedEnv = new Map<string, string | undefined>();
function setEnv(key: string, value: string): void {
  savedEnv.set(key, process.env[key]);
  process.env[key] = value;
}

let hostCtrl: OnlineController | null = null;
let guestCtrl: OnlineController | null = null;
let roomId = "";
let hostToken = "";

const MAP = loadMap(guanzhongData);

/** 显式超时等待(protocol-online 同纪律,禁裸等):超时当场抛,绝不静默;可附状态
 *  快照转储(诊断超时现场,不改变判定)。 */
async function until(
  cond: () => boolean,
  desc: string,
  timeoutMs: number,
  dump?: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`等待超时:${desc}${dump ? `\n${dump()}` : ""}`);
    await Bun.sleep(25);
  }
}

/** 双端相位快照(超时诊断现场用)。 */
const stackDump = (): string => {
  const row = (c: OnlineController | null, label: string): string => {
    if (c === null) return `${label}=未构造`;
    const e = c.engine;
    return `${label}[phase=${e.phase} setup=${e.setupPhase} idx=${e.currentSetupPlayerIndex} turnPhase=${e.turnPhase} turn=${e.turnNumber} active=${e.activeIndex} owner=${e.decisionOwner}]`;
  };
  const net = useNetStore.getState();
  return `${row(hostCtrl, "A")} ${row(guestCtrl, "B")} net[hint=${String(net.hint)} conn=${net.connection}]`;
};

/** 该端轮到自己选都(已水合 + Setup·PickCapital + 决策序落在本座位)。 */
const pickReady = (c: OnlineController): boolean =>
  hydratedOf(c) &&
  c.engine.phase === "Setup" &&
  c.engine.setupPhase === "PickCapital" &&
  c.engine.currentSetupPlayerIndex === c.seat;

/** 轮到谁谁落子:取该端自己引擎的三选一首候选(落子时刻的候选已滚出被选都城),
 *  上行经 WS({type:"pickCapital"}),生效等该端投影推进(候选滚换/进 Playing)。 */
async function pickCapitalWhenTurn(c: OnlineController): Promise<void> {
  await until(() => pickReady(c), `轮到座位 ${c.seat} 选都`, 15_000);
  const tile = c.engine.offeredCapitals[0]!;
  c.setupPickCapital(tile);
  await until(
    () => c.engine.phase === "Playing" || c.engine.currentSetupPlayerIndex !== c.seat,
    `座位 ${c.seat} 选都落子生效`,
    15_000,
  );
}

/** 轮到我出锦囊就「今不用」(useJinnang cardId=null):开局首回合的真人锦囊决策窗在
 *  DECISION_TIMEOUT=0 的测试环境无人代管,不 decline 就永远到不了 Roll——测试双端当
 *  「只出'今不用'的真人」,命令走真 WS(useJinnang 全命令通路),窗口闭后链归
 *  #188 autoRoll 代掷。返回是否发出了命令(调用方轮询重入;pending/演出未落定时
 *  interactive=false,dispatchCommand 自身守卫不发)。 */
function declineJinnangIfAsked(c: OnlineController): boolean {
  const e = c.engine;
  if (e.phase !== "Playing" || e.turnPhase !== "AwaitingJinnang") return false;
  if (e.decisionOwner !== c.seat || !c.interactive) return false;
  c.dispatchCommand({ type: "useJinnang", cardId: null });
  return true;
}

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

function engineProjection(e: GameEngine): PublicProjection {
  return {
    phase: e.phase,
    turnPhase: e.turnPhase,
    round: e.round,
    turnNumber: e.turnNumber,
    activeIndex: e.activeIndex,
    roundAnchor: e.roundAnchor,
    decisionOwner: e.decisionOwner,
    isOver: e.isOver,
    jinnangDeckCount: e.jinnangDeckCount,
    lastRollDie: e.lastRoll?.die ?? null,
    lastMove: e.lastMove ?? null,
    takenCapitals: [...e.takenCapitalIndices].sort((a, b) => a - b),
    outcomeKind: e.lastLandOutcome?.kind ?? null,
    pendingLandKind: e.pendingLand?.kind ?? null,
    players: e.players.map(publicPlayerOf),
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

/** 三方投影同读(单线程内同步读,原子成对):两端引擎 + 共享 gameStore 快照(最后同步
 *  端的投影;两端收敛则三方必一致)。快照未就位返回 null(比较自然不等,走重试)。 */
function readTriple(): {
  a: PublicProjection;
  b: PublicProjection;
  s: PublicProjection | null;
} {
  const snap = useGameStore.getState().snapshot;
  return {
    a: engineProjection(hostCtrl!.engine),
    b: engineProjection(guestCtrl!.engine),
    s: snap === null ? null : snapshotProjection(snap),
  };
}

const sameProjection = (x: PublicProjection | null, y: PublicProjection | null): boolean =>
  JSON.stringify(x) === JSON.stringify(y);

describe("双端对跑(#1283):双客户端栈 × 真 WS × 进程内引擎服务器", () => {
  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dafung-dual-run-"));
    mkdirSync(join(tmpDir, "extensions"), { recursive: true }); // 空目录 = 合法零包环境
    setEnv("PORT", "0");
    setEnv("HOST", "127.0.0.1");
    setEnv("ROOMS_DIR", join(tmpDir, "rooms"));
    setEnv("LOGS_DIR", join(tmpDir, "logs"));
    setEnv("STATIC_DIR", join(tmpDir, "static"));
    setEnv("EXTENSIONS_DIR", join(tmpDir, "extensions"));
    setEnv("JIYU_CONFIG", join(import.meta.dir, "..", "e2e", "jiyu-off.json"));
    setEnv("E2E_BOT_STEP_MS", "0");
    setEnv("E2E_REACTION_MS", "300");
    setEnv("DECISION_TIMEOUT_MS", "0");
    setEnv("RETENTION_WINDOW_MS", "0");
    serverMod = await import("../scripts/server"); // import 即起服(env 已就位)
    serverBase = `http://127.0.0.1:${serverMod.engineServer.port}`;
    localStorage.setItem("dafung.server-base", serverBase);
  }, 15_000);

  afterAll(async () => {
    // 先解散(房主连接还在,解散权没被移交)再销毁控制器——destroy 先行会双座离线,
    // 触发 host 移交语义(ADR-0002),房主 token 就解不动了。
    if (roomId !== "" && hostToken !== "") {
      const res = await fetch(`${serverBase}/room/dismiss`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomId, seatToken: hostToken }),
      });
      expect(res.ok, `解散房间失败(HTTP ${res.status}):${await res.text()}`).toBe(true);
    }
    hostCtrl?.destroy();
    guestCtrl?.destroy();
    serverMod?.engineServer.stop(true); // 关监听断连接;单例随测试进程终结
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (tmpDir !== null) rmSync(tmpDir, { recursive: true, force: true });
    // store 复位(可隔离性,见文件头注「store 单例纠缠」盘点)
    useNetStore.getState().reset();
    useGameStore.getState().setScreen("setup");
  }, 15_000);

  it("双栈真 WS 对跑:建房→入座→选图→开局→双端选都→事件折算推进,双端公开投影逐字段收敛", async () => {
    const a = new OnlineController(MAP, "guanzhong");
    const b = new OnlineController(MAP, "guanzhong");
    hostCtrl = a;
    guestCtrl = b;

    // 建房(host=座位0)+ 入座(guest=座位1):REST 大厅 + adoptRoom 内建真 WS
    const created = await a.createRoom({ seats: 2 });
    expect(created.ok).toBe(true);
    roomId = created.roomId;
    hostToken = created.seatToken;
    expect(a.seat).toBe(0);
    const joined = await b.joinRoom(roomId);
    expect(joined.seat).toBe(1);
    await until(
      () => {
        const net = useNetStore.getState();
        return net.roomId === roomId && net.seats.length === 2 && net.seats.every((s) => s.online);
      },
      "双端入座并在线",
      10_000,
    );

    // 选图(同图不触发 rebuildForMap)→ 开局(引擎在服务器侧构造,双端等广播)
    await a.pickMap("guanzhong");
    await a.startGame();

    // 双端各自水合进 Setup(draft 序不预设),谁轮到谁落子
    await until(() => hydratedOf(a) && a.engine.phase === "Setup", "host 端水合进 Setup", 15_000);
    await until(() => hydratedOf(b) && b.engine.phase === "Setup", "guest 端水合进 Setup", 15_000);
    expect(hydratedOf(a)).toBe(true);
    expect(hydratedOf(b)).toBe(true);
    await until(() => pickReady(a) || pickReady(b), "首轮选都就位", 15_000);
    await pickCapitalWhenTurn(pickReady(a) ? a : b);
    await pickCapitalWhenTurn(pickReady(a) ? a : b);

    // 双端进 Playing(finishSetup 批 gameStarted 折算 + 校准快照水合,双保险同值)
    await until(
      () => a.engine.phase === "Playing" && b.engine.phase === "Playing",
      "双端折叠/水合进 Playing",
      15_000,
    );

    // 事件折算素材:服务器 #188 自动起摇(AUTO_ROLL_DELAY_MS=1s)代发 rollAndMove,
    // 掷骰/行军族事件批(must-fold 档,无校准快照随行)折进两端只读副本;首掷前唯一
    // 真人决策 = 开局锦囊窗,轮到就「今不用」(declineJinnangIfAsked,确定性不靠种子)
    const rollDeadline = Date.now() + 30_000;
    for (;;) {
      if (a.engine.lastRoll != null && b.engine.lastRoll != null) break;
      void declineJinnangIfAsked(a);
      void declineJinnangIfAsked(b);
      if (Date.now() > rollDeadline) {
        throw new Error(`等待超时:两端折得首掷 diceRolled\n${stackDump()}`);
      }
      await Bun.sleep(25);
    }

    // 三方投影收敛:相等后静置复读,稳定相等才算数(读数点=决策门冻结或批间静默)
    const deadline = Date.now() + 20_000;
    let view: PublicProjection | null = null;
    for (;;) {
      const t1 = readTriple();
      if (sameProjection(t1.a, t1.b) && sameProjection(t1.a, t1.s)) {
        await Bun.sleep(300);
        const t2 = readTriple();
        if (
          sameProjection(t1.a, t2.a) &&
          sameProjection(t2.a, t2.b) &&
          sameProjection(t2.a, t2.s)
        ) {
          view = t2.a;
          break;
        }
      }
      if (Date.now() > deadline) {
        const t = readTriple();
        throw new Error(
          `三方投影未收敛(20s):\nA=${JSON.stringify(t.a)}\nB=${JSON.stringify(t.b)}\nS=${JSON.stringify(t.s)}`,
        );
      }
      await Bun.sleep(50);
    }

    // 事件折算对账(must-fold 族;状态唯一来源 = 事件批折叠,无校准快照背书)
    expect(view!.phase).toBe("Playing"); // gameStarted 折算
    expect(view!.turnNumber).toBeGreaterThanOrEqual(1); // turnStarted 折算
    expect(view!.lastRollDie).not.toBeNull(); // diceRolled 折算(#188 autoRoll 代摇)
    expect(view!.lastMove).not.toBeNull(); // marchArrived/capitalHalt 折算
    expect(view!.players.some((p) => p.position !== p.capitalIndex)).toBe(true); // 有人离都行军
    expect(view!.takenCapitals).toHaveLength(2); // 双端选都落账(capitalSelected×2)

    // 房间元数据(双端同值面;per-端字段见头注「store 单例纠缠」盘点,不在断言面)
    const net = useNetStore.getState();
    expect(net.roomId).toBe(roomId);
    expect(net.host).toBe(0);
    expect(net.started).toBe(true);
    expect(net.mapId).toBe("guanzhong");
    expect(net.seats).toHaveLength(2);
    expect(net.seats.every((seat) => seat.online)).toBe(true);
    expect(net.connection).toBe("open");
  }, 90_000);
});
