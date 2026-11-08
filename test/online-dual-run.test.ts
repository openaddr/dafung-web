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
// 重连场景范例(#1287 扩充,本文件第二例):在首例装配(配方①-⑤)之上走「真 WS 裸关
// → ReconnectingSocket 退避重连 → 服务器整房摘要水合 → 双端 store 收敛恢复」全链;
// 裸关缝/读数点/断言口径的判词见该例例注。分工判词:线级(裸协议客户端)重连语义归
// test/protocol-online.test.ts 场景二/四/五,断线横幅可见性归 react-online-cutover
// 浏览器地板例——三层各有其环,本例补的是生产客户端栈(OnlineController+双 store)
// 过真断线的恢复语义,互不替代。
//
// 慢例归属:首例实测 ~1.5s(2026-11-08 标定,五连跑 1.49-1.57s),低于「单例 ≥3s 入
// 慢池」判据(docs/how-to/开发与测试.md「把测试跑起来」),常驻默认池;重连例(#1287)
// 单例 ≥3s(真退避 ~1s 起步墙钟=用例本体不可压缩,恢复类),按 local-room 骑局先例
// itSlow 入 DAFUNG_SLOW(bun run test:slow / DAFUNG_SLOW=1 bun test 本文件)。
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GameCommand, GameEngine } from "@core/authority";
import type { MovePath } from "@core/board";
import { loadMap } from "@core/board-loader";
import { OnlineController } from "@app/controllers/online";
import type { ReconnectProgress } from "@app/net/reconnecting-socket";
import { useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import guanzhongData from "../public/maps/guanzhong.json" with { type: "json" };
import { cmdMsg } from "../scripts/wire";

const itSlow = it.skipIf(!process.env.DAFUNG_SLOW);

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

/** 私有面访问缝 ②(测试专用;裸关配方 = react-online-cutover 浏览器地板例同款):
 *  controller.sock(ReconnectingSocket).ws(底层 WebSocket).close()——绕过 closedByUs
 *  直关真 WS,onclose 走「非主动关闭」分支(广播 closed + 排退避重连),即真断线语义;
 *  不经 ReconnectingSocket.close()(那是主动关闭,不重连)。 */
interface SockTestAccess {
  ws: { close(): void } | null;
}
const rawClose = (c: OnlineController): void => {
  const sock = (c as unknown as { sock: SockTestAccess | null }).sock;
  if (sock?.ws == null) throw new Error("socket 未建立,无法裸关(断线场景前置缺失)");
  sock.ws.close();
};

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

// ─── 重连场景件(#1287 第二例专用;首例不消费)────────────────────────────
/** 解散当前模块房(若在):解散权要求房主连接健在——destroy 先行会双座离线,触发
 *  host 移交语义(ADR-0002),原 token 就解不动了(afterAll 同判词,配方收拢于此
 *  供两例复用);成功即清模块变量,防收敛路径重复解散撞 403。 */
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

/** 停在真人决策门(对局冻结判据):Playing 且当前相位在选项注册表(ADR-0013
 *  PHASE_CHOICES,引擎 choicesFor 单口)内有解——Roll/Land/EndTurn 等自动相位返回
 *  空集,反应窗(不注册、E2E_REACTION_MS=300 自解)同为空集。DECISION_TIMEOUT_MS=0
 *  看门狗全关 + 双人房无 bot:真人门停摆 = 对局冻结,「重连前后逐字段一致」的强等式
 *  由此成立(不预设停在哪扇门——首门种随种子,锦囊窗/购地卷轴皆可能)。 */
const parkedAtGate = (c: OnlineController): boolean =>
  hydratedOf(c) && c.engine.phase === "Playing" && c.engine.choicesFor().length > 0;

/** 决策门放行(重连后续局推进驱动):谁的门谁应答(纪律同配方④,不越权代他座),
 *  各注册门给一条「放行/最小承诺」命令——锦囊窗=今不用、购地/扩军卷轴=按兵不动、
 *  招贤=首位候选、珍宝交涉=不交易。返回是否发出了命令(调用方轮询重入)。
 *  下行通路判词(#1287 实测):走**传输面直派**(sock.send × 生产编码单源 cmdMsg),
 *  不走 dispatchCommand——后者的 interactive 闸携带 fxPlaying 行军会话锁,headless
 *  面下行军会话在招贤类门前不落定(interactive 恒 false,静默拒发=门答死锁,试跑
 *  run-134 实证);本层零 DOM 零真实输入语义,门答意图=「重连端能发命令」,真实 WS
 *  上行与 #454 座位鉴权照走,输入锁是浏览器输入保真关切、不属于本层断言面。 */
function passGateIfMine(c: OnlineController): boolean {
  const e = c.engine;
  if (e.phase !== "Playing" || e.decisionOwner !== c.seat) return false;
  let cmd: GameCommand | null = null;
  if (e.turnPhase === "AwaitingJinnang") cmd = { type: "useJinnang", cardId: null };
  else if (e.turnPhase === "AwaitingDecision") cmd = { type: "endDecision" };
  else if (e.turnPhase === "AwaitingHeroPick") {
    const idx = e.choicesFor().findIndex((o) => o.available !== false);
    cmd = { type: "resolveHeroPick", index: idx };
  } else if (e.turnPhase === "AwaitingTreasureOwner") {
    cmd = { type: "resolveTreasureOwner", action: { type: "skip" } };
  }
  // 其余门(破产结算/机遇/体力,开局数回合不可达:机遇房级硬关 jiyu-off,无破产无耗竭)
  // 不预设代答——真到了就是门注册表演化了,挂出来补分支,不静默。
  if (cmd === null) return false;
  const sock = (
    c as unknown as {
      sock: { send(data: string): void; isOpen: boolean } | null;
    }
  ).sock;
  if (sock == null || !sock.isOpen) throw new Error("socket 未建立,无法派发门答命令");
  sock.send(cmdMsg(cmd));
  return true;
}

/** 三方投影稳定读数(连续三拍全等、拍距 400ms):批间瞬态与 300ms 自解反应窗都撑不过
 *  两个拍距,读数点=真停摆。比首例的两拍 300ms 更严(重连前后强等式的取证口径),
 *  同读口径=sameCoreProjection(剥离 outcomeKind,判词见该函数注),返回终拍 A 端投影。 */
async function settledTriple(desc: string, timeoutMs = 20_000): Promise<PublicProjection> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const t1 = readTriple();
    if (t1.s !== null && sameCoreProjection(t1.a, t1.b) && sameCoreProjection(t1.a, t1.s)) {
      await Bun.sleep(400);
      const t2 = readTriple();
      if (
        sameCoreProjection(t1.a, t2.a) &&
        sameCoreProjection(t2.a, t2.b) &&
        sameCoreProjection(t2.a, t2.s)
      ) {
        await Bun.sleep(400);
        const t3 = readTriple();
        if (
          sameCoreProjection(t2.a, t3.a) &&
          sameCoreProjection(t3.a, t3.b) &&
          sameCoreProjection(t3.a, t3.s)
        ) {
          return t3.a;
        }
      }
    }
    if (Date.now() > deadline) {
      const t = readTriple();
      throw new Error(
        `三方投影未稳定(${timeoutMs}ms):${desc}\nA=${JSON.stringify(t.a)}\nB=${JSON.stringify(t.b)}\nS=${JSON.stringify(t.s)}`,
      );
    }
    await Bun.sleep(50);
  }
}

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
    // 触发 host 移交语义(ADR-0002),房主 token 就解不动了。(解散配方收拢于
    // dismissCurrentRoom,#1287 重连例同源复用;成功后已清模块变量,天然幂等。)
    await dismissCurrentRoom("suite 收摊");
    hostCtrl?.destroy();
    guestCtrl?.destroy();
    serverMod?.engineServer.stop(true); // 关监听断连接;单例随测试进程终结
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (tmpDir !== null) rmSync(tmpDir, { recursive: true, force: true });
    // store 复位(可隔离性,见文件头注「store 单例纠缠」盘点)——双 store 成对 reset
    useNetStore.getState().reset();
    useGameStore.getState().reset();
    // 全局面拆脚手架:localStorage shim 连同 server-base 覆写 key 随体焚——不拆则
    // 后跑文件恒见「localStorage 在场+指向已死端口的覆写」(#1297 波评审 P1)
    Reflect.deleteProperty(globalThis, "localStorage");
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

  // ─── 重连场景范例(#1287)────────────────────────────────────────────────
  // 场景:双端对跑到首个真人决策门(对局冻结读数点,parkedAtGate 判据)→ 裸关 guest
  // 底层 WS(rawClose,真断线)→ ReconnectingSocket 指数退避(~1s 起步,±30% 抖动)
  // 重拨原 URL(token 归座,ADR-0005)→ 服务器首帧整房摘要 → OnlineController 摘要
  // 水合 → 双端恢复。断言链逐环取证,不裸等:
  //   ① 断线证据:connection→closed + 重连进度(#494,attempt/10)+ 座位广播翻
  //     offline(掉线元数据走 lobby 指纹通道,host 端收、共享 store 可读——本例全程
  //     只有 guest 一条 socket 变更状态,共享 store「最后写胜」的纠缠在此无害,见头注);
  //   ② 重连边界:connection→open(open 单点清零重连进度)+ #388 重连清批
  //     (eventBatchSeq 归零:旧批作废,状态唯一来源=紧随的整房摘要,ADR-0020 决策 4);
  //   ③ 核心等式:重连后三方投影(两端引擎+共享 gameStore)与断线前读数 P0 核心字段
  //     **逐字段全等**(对局不丢状态;口径=sameCoreProjection,剥离纯表现态
  //     outcomeKind——其折叠面 vs 权威面漂移实测见该函数注,另行上报)。冻结读数点的
  //     **可证性**:host 是全程在线的见证端,断线窗口内每拍复核对 host 投影,host 偏离
  //     P0 = 服务器侧已自行推进(冻结前提破)——该尝试作废,等下一门重来(至多三试);
  //     三试全偏 = 服务器在自动推进停摆门,响亮挂出来。
  //   ④ 恢复后续局可推进:水合出来的活引擎上轮到谁谁放行决策门(passGateIfMine 走
  //     真 WS 命令通路),turnNumber 折进两端 + 事件批续流(eventBatchSeq 回升)——
  //     重连端「能收也能发」的闭环,不是只读快照复活。
  // 慢例归属:单例 ≥3s(双端开局 ~1s + 真退避 ~1s 墙钟 + 放行推进 ~2s,退避墙钟是
  // 用例本体不可压缩,恢复类),itSlow 入 DAFUNG_SLOW(文件头注「慢例归属」)。
  itSlow(
    "重连场景:裸关 WS→退避重连→摘要水合,重连后三方投影与断线前逐字段一致,续局可推进",
    async () => {
      // ⓪ 收首例的房与栈(每例一房一栈;本例不背首例终态,从入座起新开确定性 draft),
      //    并复位 netStore——首例结束时 connection/eventBatchSeq 等残留会污染下方
      //    断线证据断言的基线(新栈 adoptRoom 会重灌房间字段,复位无害)。
      await dismissCurrentRoom("重连例开工前收首例");
      hostCtrl?.destroy(); // dismissed 下行多半已令其自毁(online.ts dismissed 分支),幂等
      guestCtrl?.destroy();
      hostCtrl = null;
      guestCtrl = null;
      useNetStore.getState().reset();

      // ① 新栈新房→开局→双端选都→进 Playing(装配配方③④,首例同款逐环断言)
      const a = new OnlineController(MAP, "guanzhong");
      const b = new OnlineController(MAP, "guanzhong");
      hostCtrl = a;
      guestCtrl = b;
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
          return (
            net.roomId === roomId && net.seats.length === 2 && net.seats.every((s) => s.online)
          );
        },
        "双端入座并在线",
        10_000,
      );
      await a.pickMap("guanzhong");
      await a.startGame();
      await until(() => hydratedOf(a) && a.engine.phase === "Setup", "host 端水合进 Setup", 15_000);
      await until(
        () => hydratedOf(b) && b.engine.phase === "Setup",
        "guest 端水合进 Setup",
        15_000,
      );
      await until(() => pickReady(a) || pickReady(b), "首轮选都就位", 15_000);
      await pickCapitalWhenTurn(pickReady(a) ? a : b);
      await pickCapitalWhenTurn(pickReady(a) ? a : b);
      await until(
        () => a.engine.phase === "Playing" && b.engine.phase === "Playing",
        "双端折叠/水合进 Playing",
        15_000,
      );

      // 首次进入 Playing 时事件面必有批(开局 flush/选都批已过网)——给「重连清批
      // 归零」断言立账;该前置在三试循环外只立一次(清批只在 open 沿发生,首试的
      // seq>0→0 账目即铁证;后续试次 seq 已归零,不再重复立账)。
      expect(useNetStore.getState().eventBatchSeq).toBeGreaterThan(0);

      // ②-⑥ 断线-重连读数验证(三试循环,判词见 ③ 注):每试=停门→P0→见证断线→
      //      见证重连→强等式;host 偏离 P0 即弃试重来。
      let p0: PublicProjection | null = null;
      let view: PublicProjection | null = null;
      let progress: ReconnectProgress | null = null;
      for (let attempt = 1; attempt <= 3 && view === null; attempt++) {
        await until(
          () => parkedAtGate(a) && parkedAtGate(b),
          `试${attempt}:停到真人决策门`,
          30_000,
          stackDump,
        );
        const attemptP0 = await settledTriple(`试${attempt}:断线前读数 P0`);

        // 裸关 guest 底层 socket(缝判词见 rawClose 注)
        rawClose(b);

        // 断线证据(退避窗口 ~1s±30%,25ms 轮询必中 closed 与进度)+ host 冻结见证:
        // host 每拍复核 P0——host 收到的批=服务器真相连续流,它动 = 服务器自行推进,
        // 冻结读数点前提破,本试作废(等重连回座后下一试重停门)。
        let sawClosed = false;
        progress = null;
        let hostAdvanced: PublicProjection | null = null;
        const outageDeadline = Date.now() + 15_000;
        for (;;) {
          const net = useNetStore.getState();
          if (net.connection === "closed") sawClosed = true;
          if (net.reconnect !== null) progress = net.reconnect;
          const hostNow = engineProjection(a.engine);
          if (!sameCoreProjection(hostNow, attemptP0)) {
            hostAdvanced = hostNow;
            break;
          }
          if (sawClosed && progress !== null && net.seats[b.seat]?.online === false) break;
          if (Date.now() > outageDeadline) {
            throw new Error(
              `断线证据不全:closed=${String(sawClosed)} progress=${JSON.stringify(progress)} seats=${JSON.stringify(useNetStore.getState().seats)}`,
            );
          }
          await Bun.sleep(25);
        }
        expect(progress!.attempt).toBeGreaterThanOrEqual(1);
        expect(progress!.max).toBe(10); // 退避放弃上限(ReconnectingSocket 缺省 10 次)

        if (hostAdvanced !== null) {
          // 冻结前提破:等 guest 重连归座回 open,下一试重停门(重连机件本身已由
          // 本试的断线/进度证据走完一遍,弃试不弃取证)。
          console.log(
            `[重连例] 试${attempt} 作废:host 见证服务器在冻结窗内自行推进 P0(turn=${attemptP0.turnNumber} ${attemptP0.turnPhase})→(turn=${hostAdvanced.turnNumber} ${hostAdvanced.turnPhase}),换门重试`,
          );
          await until(
            () => useNetStore.getState().connection === "open",
            `试${attempt} 弃试后重连回 open`,
            15_000,
          );
          continue;
        }

        // 退避重连回 open:进度单点清零 + 重连清批(#388)+ 座位广播翻回 online
        await until(
          () => useNetStore.getState().connection === "open",
          `试${attempt}:退避重连回 open`,
          15_000,
        );
        await until(
          () => useNetStore.getState().seats[b.seat]?.online === true,
          `试${attempt}:重连归座(座位广播翻回 online)`,
          15_000,
        );
        const net = useNetStore.getState();
        expect(net.reconnect).toBeNull(); // 连上即清零(setConnection 单点)
        expect(net.eventBatchSeq).toBe(0); // 重连清批:状态唯一来源=紧随的整房摘要

        // 冻结终验(host 见证到底)+ 核心等式:重连后三方投影与 P0 核心字段(剥离
        // outcomeKind,判词见 sameCoreProjection 注)逐字段全等——对局不丢状态硬断言
        let finalView: PublicProjection;
        try {
          finalView = await settledTriple(`试${attempt}:重连后读数`);
        } catch (err) {
          // 诊断增补(仍抛出):读服务器落盘房间记录=引擎真相,判 fold/summary 谁在说谎
          let serverTruth = "读取失败";
          try {
            const rec = JSON.parse(
              readFileSync(join(tmpDir!, "rooms", `${roomId}.json`), "utf8"),
            ) as {
              snapshot?: {
                turnPhase?: string;
                lastLandOutcomeKind?: string | null;
                pendingLand?: { kind?: string } | null;
              };
            };
            serverTruth = JSON.stringify({
              turnPhase: rec.snapshot?.turnPhase,
              lastLandOutcomeKind: rec.snapshot?.lastLandOutcomeKind,
              pendingLandKind: rec.snapshot?.pendingLand?.kind ?? null,
            });
          } catch (e2) {
            void e2; // 房间记录读取失败本身不影响原错误的抛出
          }
          throw new Error(`${(err as Error).message}\n服务器房间记录快照=${serverTruth}`);
        }
        if (!sameCoreProjection(finalView, attemptP0)) {
          const hostNow = engineProjection(a.engine);
          if (!sameCoreProjection(hostNow, attemptP0)) {
            // host 也偏了:服务器在窗口后半段自行推进,冻结前提破,弃试重来
            console.log(
              `[重连例] 试${attempt} 作废(后段):host 见证推进 P0(turn=${attemptP0.turnNumber} ${attemptP0.turnPhase})→(turn=${hostNow.turnNumber} ${hostNow.turnPhase}),换门重试`,
            );
            continue;
          }
          // host 仍钉在 P0 而 guest 不等 = 重连水合真的丢了/改了状态——产品级红,响亮挂
          expect(finalView).toEqual(attemptP0);
        }
        p0 = attemptP0;
        view = finalView;
      }
      expect(p0).not.toBeNull();
      expect(sameCoreProjection(view, p0!)).toBe(true); // 核心等式终验(口径判词见 sameCoreProjection 注)

      // ⑦ 恢复后续局可推进:轮到谁谁放行决策门(命令走重连后的新 socket 上行),
      //    新回合折进两端;事件批续流以 eventBatchSeq 回升为证
      const p0Turn = p0!.turnNumber;
      const advDeadline = Date.now() + 30_000;
      for (;;) {
        void passGateIfMine(a);
        void passGateIfMine(b);
        const t = readTriple();
        if (t.a.turnNumber > p0Turn && t.b.turnNumber > p0Turn) break;
        if (Date.now() > advDeadline) {
          throw new Error(`重连后续局未推进(30s):P0.turn=${p0Turn}\n${stackDump()}`);
        }
        await Bun.sleep(50);
      }
      // 续流证据=上方 turnNumber 闸门+settledTriple 三方复账(eventBatchSeq 重连清批后从 0 重涨,恒真式已删——#1297 波评审 P1)
      await settledTriple("重连后续局收敛"); // 收在下一稳定读数点,三方复账收尾

      // ⑧ 收摊(先解散后销毁,判词同 afterAll;清模块变量,afterAll 不重复解散)
      await dismissCurrentRoom("重连例收摊");
      a.destroy();
      b.destroy();
      hostCtrl = null;
      guestCtrl = null;
    },
    120_000,
  );

  // ─── 种子直建房·反应窗应答账(#1316 批T2,自 react-reaction-online「#453」例
  //     尾部落盘腿下移)───────────────────────────────────────────────────────
  // 场景(与 e2e 同一种子谱):3 座房(seed 2849 经 /room/new 请求体注入,seat2 不入座
  // 开局 bot 填充)→ 双人类起手识破诡计、bot 起手连环计,选都一结束 bot(draftOrder=
  // [2,1,0] 先动)宣告连环计开出 [0,1] 双窗 → 窗寿内(本环境 E2E_REACTION_MS=300 缩
  // 窗)应答齐 → 连环计照常结算。断言=权威应答账(房间落盘 room-record 直读):每被
  // 询问座位**恰应答一次**(重复应答不重账)→ 结算执行(jinnangUse 落账)。
  // 【确定性判词(#987 口径)】手动应答腿不进断言面:300ms 缩窗下手点应答与权威超时
  // 兜底是时序竞速(浏览器 e2e 靠 15s 加长窗避开;层③无加长 env 缝——服务进程级
  // 单例,env 面属全文件);落盘账不区分手答/代发(同一 reactionRespond use=0 行),
  // 竞速输了断言面不变、赢了也不多断什么——竞速腿零断言增益,不设。窗内手点试探发
  // 一发(成交与否两皆等值)+窗收后重复应答两发探针(必被拒),账面「各恰一次」对
  // 三种到达形态恒等值,零时序依赖。
  it("种子直建房双人类反应窗:应答齐落盘账两座各恰一次、重复应答不重账、结算执行", async () => {
    // ⓪ 收前例的房与栈(每例一房一栈,重连例同款收摊配方)
    await dismissCurrentRoom("应答账例开工前收前例");
    hostCtrl?.destroy();
    guestCtrl?.destroy();
    hostCtrl = null;
    guestCtrl = null;
    useNetStore.getState().reset();

    // ① 种子直建房(LobbyApi 无 seed 缝的最小测试缝,判词见下)+ guest 入座。
    //    seed 缝判词:生产 createRoom 类型面 {seats,target?,guohao?}(#1287 判词
    //    「对跑层 LobbyApi 无 seed 缝不可迁」正指此);服务器 /room/new 契约本收
    //    {seed}(e2e 路由拦截补的同一字段)。最小缝 = 同一 REST 通路请求体补 seed
    //    (api/adoptRoom 私有面 cast,enteredGame/sock 测试缝同族先例)——凭证装配
    //    与 e2e 拦截回包走同一收敛路径,零第二套装配语义。guohao=魏:种子谱按
    //    「host=魏/guest=无预设」离线核算(e2e twoClientsWithSeed 同款对齐)。
    const a = new OnlineController(MAP, "guanzhong");
    const b = new OnlineController(MAP, "guanzhong");
    hostCtrl = a;
    guestCtrl = b;
    const api = a as unknown as {
      api: { createRoom(o: Record<string, unknown>): Promise<Record<string, unknown>> };
      adoptRoom(reply: Record<string, unknown>): Promise<void>;
    };
    await api.adoptRoom(await api.api.createRoom({ seats: 3, seed: 2849, guohao: "魏" }));
    const creds = a as unknown as { roomId: string | null; seatToken: string | null };
    if (creds.roomId == null || creds.seatToken == null)
      throw new Error("adoptRoom 后凭证缺席(入座装配断)");
    roomId = creds.roomId;
    hostToken = creds.seatToken;
    const joined = await b.joinRoom(roomId);
    expect(joined.seat).toBe(1);
    await until(
      () => {
        const net = useNetStore.getState();
        return (
          net.roomId === roomId &&
          net.seats.length === 3 &&
          net.seats.slice(0, 2).every((s) => s.online)
        );
      },
      "双端入座并在线(第 3 座空席开局 bot 填充)",
      10_000,
    );

    // ② 选图 → 开局 → 双人类各自轮到即落子(seat2 bot 由服务器代选)
    await a.pickMap("guanzhong");
    await a.startGame();
    await until(() => hydratedOf(a) && a.engine.phase === "Setup", "host 端水合进 Setup", 15_000);
    await until(() => hydratedOf(b) && b.engine.phase === "Setup", "guest 端水合进 Setup", 15_000);
    await until(() => pickReady(a) || pickReady(b), "首轮选都就位", 15_000);
    await pickCapitalWhenTurn(pickReady(a) ? a : b);
    await pickCapitalWhenTurn(pickReady(a) ? a : b);
    await until(
      () => a.engine.phase === "Playing" && b.engine.phase === "Playing",
      "双端折叠/水合进 Playing",
      15_000,
    );

    // ③ 双人类识破窗到达(seed 2849 谱:bot 宣告连环计开 [0,1] 双窗;per-seat 脱敏
    //    投影=本座真 id 在列、他人 -1)。announcedCard 取本端 view(权威 cardId)。
    const viewOf = (c: OnlineController) => c.engine.pendingReaction?.view ?? null;
    const jinnangQueriedOf = (v: ReturnType<typeof viewOf>): number[] | null =>
      v?.kind === "jinnang" ? v.queriedBySeat : null; // 锦囊窗才有询问集(march 窗无此字段)
    await until(
      () => {
        const hq = jinnangQueriedOf(viewOf(a));
        const gq = jinnangQueriedOf(viewOf(b));
        return hq !== null && hq.includes(0) && hq.length >= 2 && gq !== null && gq.includes(1);
      },
      "双人类识破窗(两端各自在列)",
      30_000,
      stackDump,
    );
    const announcedCard = viewOf(a)!.cardId;
    if (announcedCard == null) throw new Error("双窗无宣告牌 id:结算留痕断言将失真");
    // 窗寿内 host 试探手点应答(缩窗下可能已被代发抢先——拒绝即 pushHint,零断言
    // 依赖,判词见例头注);随后等窗收(应答齐由权威侧定时代发兜底结算推进)。
    const sock = (a as unknown as { sock: { send(data: string): void; isOpen: boolean } | null })
      .sock;
    if (sock == null || !sock.isOpen) throw new Error("socket 未建立,无法派发应答命令");
    sock.send(cmdMsg({ type: "respondReaction", seat: 0, use: false }));
    await until(
      () => viewOf(a) === null && viewOf(b) === null && a.engine.turnPhase !== "AwaitingReaction",
      "应答齐窗收(权威侧定时代发兜底)",
      15_000,
      stackDump,
    );

    // ④ 窗收后重复应答探针:两发 respondReaction 均被拒(窗已收/已应答)——重复应答
    //    不得重账(#453/B2 权威面),房间账面「两座各恰一次」由此钉死。
    sock.send(cmdMsg({ type: "respondReaction", seat: 0, use: false }));
    sock.send(cmdMsg({ type: "respondReaction", seat: 0, use: false }));

    // ⑤ 权威应答账(房间落盘 room-record 直读):p0/p1 各恰一次 reactionRespond+
    //    结算执行(jinnangUse 落账宣告牌)。落盘拍有节奏,until 轮询到账即收。
    const recPath = () => join(tmpDir!, "rooms", `${roomId}.json`);
    let recordLog: string[] = [];
    await until(
      () => {
        const rec = JSON.parse(readFileSync(recPath(), "utf8")) as {
          snapshot?: { log?: { detail?: string }[] };
        };
        recordLog = (rec.snapshot?.log ?? []).map((l) => l.detail ?? "");
        return (
          recordLog.filter((d) => d.includes("reactionRespond") && d.includes("seat=p0")).length ===
            1 &&
          recordLog.filter((d) => d.includes("reactionRespond") && d.includes("seat=p1")).length ===
            1 &&
          recordLog.some((d) => d.includes("jinnangUse") && d.includes(announcedCard))
        );
      },
      `权威应答账:p0/p1 各恰一次+结算执行(宣告牌=${announcedCard})`,
      15_000,
    );
    // 账面等值断言(窗内手点试探/代发抢先/窗后重复探针三种形态下均恰各一行)
    expect(
      recordLog.filter((d) => d.includes("reactionRespond") && d.includes("seat=p0")),
    ).toHaveLength(1);
    expect(
      recordLog.filter((d) => d.includes("reactionRespond") && d.includes("seat=p1")),
    ).toHaveLength(1);
    expect(recordLog.some((d) => d.includes("jinnangUse") && d.includes(announcedCard))).toBe(true);

    // ⑥ 收摊(先解散后销毁,判词同 afterAll;清模块变量,afterAll 不重复解散)
    await dismissCurrentRoom("应答账例收摊");
    a.destroy();
    b.destroy();
    hostCtrl = null;
    guestCtrl = null;
  }, 60_000);
});
