// 真服务器与故障代理只守硬断重连和确定性丢帧后的摘要校准。
// DAFUNG_SLOW=1 定向执行;健康、隐私与反应窗由独立双端和领域测试覆盖。
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { protocolTestPort } from "../../scripts/dev-ports";
import { FaultProxy, type FaultProxyNotice, type FaultProxyStats } from "../../scripts/fault-proxy";
import { OnlineClient } from "../../scripts/online-client";
import type { SnapshotMsg } from "../../scripts/wire";

// 慢例池开关:describe 级 skip 连钩子一起跳(默认池不白起服务器);DAFUNG_SLOW=1 才跑,判据见文件头注。
const describeSlow = describe.skipIf(!process.env.DAFUNG_SLOW);

// spawn 端口按 workspace 名派生(#1181,单源 scripts/dev-ports.ts,基址 4281 与
// server-cmd-error 的 4280 保持历史 1 间隔——同 workspace 两测试同跑各占一口):
// 并行 workspace 同跑慢池不撞口;显式 env DAFUNG_PROTOCOL_PORT 最高优先可覆盖
// (空串兜派生默认,`||` 与服务端端口参数同口径)。
const PORT =
  process.env.DAFUNG_PROTOCOL_PORT ||
  String(protocolTestPort(basename(join(import.meta.dir, "..", ".."))));
const BASE = `http://127.0.0.1:${PORT}`;
const WS_ORIGIN = `ws://127.0.0.1:${PORT}`;
const REPO_ROOT = join(import.meta.dir, "..", "..");

let proc: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
let TMP_DIR: string;
let serverStderr: { text: () => string };

/** spawn 后轮询 /health 就绪(超时抛,附服务器 stderr 取证)。 */
async function waitHealthy(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* 未起监听,继续轮询 */
    }
    await Bun.sleep(100);
  }
  throw new Error(`服务器 ${timeoutMs}ms 内未就绪;stderr:${serverStderr.text()}`);
}

function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<Record<string, unknown>>);
}

/** WS 建连 URL(客户端连代理端口;代理透传 path+search,真实服务器语义不变)。 */
function wsUrl(proxyPort: number, roomId: string, seat: number, token: string): string {
  return `ws://127.0.0.1:${proxyPort}/ws?room=${roomId}&seat=${seat}&token=${token}`;
}

describeSlow("协议级联机 e2e(#1164):真服务器 + 故障代理 + 无头客户端", () => {
  beforeAll(async () => {
    // describe 级 skip 连钩子一起跳(server-cmd-error 探针先例):进到这里=慢池已开。
    TMP_DIR = mkdtempSync(join(tmpdir(), "dafung-1164-"));
    // spawn 前预检端口无残孤占位(server-cmd-error 同款,#594 实锤:残孤占口 → 健康
    // 检查打旧进程、新进程 EADDRINUSE 暴毙 → 假失败)。
    let stale = false;
    try {
      stale = (await fetch(`${BASE}/health`)).ok;
    } catch {
      /* 连接失败 = 端口空闲,正常路径 */
    }
    if (stale) {
      throw new Error(
        `端口 ${PORT} 已有 /health 应答:疑似残孤测试服占位。` +
          `处置:netstat -ano | grep :${PORT} 查 PID → tasklist 验名为 bun.exe → taskkill //PID <pid> //F`,
      );
    }
    // spawn 用 process.execPath(当前运行时 bun 的真实可执行文件绝对路径),禁用 PATH
    // 上的 "bun":本机实证(WinGet/nvm 双装)PATH 解析走启动器,落成两进程对——被跟踪
    // 的 PID 一 kill 就退,真服务器进程逍遥法外,泄漏成下一轮的「残孤占口」(2026-11-07
    // 实锤:spawn pid 退出 143 而监听口的真身另坐 PID)。execPath 单进程直起,kill 即杀。
    proc = Bun.spawn([process.execPath, "scripts/server.ts"], {
      cwd: REPO_ROOT, // 仓库根:地图清单 ./public/maps 相对 cwd 解析(缺失即抛)
      env: {
        ...process.env,
        PORT,
        HOST: "127.0.0.1",
        ROOMS_DIR: TMP_DIR,
        LOGS_DIR: TMP_DIR, // 对局日志/房间落盘一并进临时目录,不污染仓库 data/
        STATIC_DIR: TMP_DIR, // 无静态托管需求(静态只按请求读,目录缺失本就 404)
        // 机遇隔离(#118 教训:节奏类变更必须可隔离;playwright.config 同款注入)
        JIYU_CONFIG: realpathSync(join(REPO_ROOT, "test", "fixtures", "jiyu-off.json")),
        // bot 配速关(bot 座位即时步进;托管人类座位的 2s/拍单节拍不受此 env 影响,
        // core/timings 单源,统一原则无分档)——本测试墙钟主项见文件头注
        E2E_BOT_STEP_MS: "0",
        // 看门狗全关:停摆不代打、断线不保留、决策不接管——一切停滞=测试超时响亮暴露
        DECISION_TIMEOUT_MS: "0",
        RETENTION_WINDOW_MS: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    serverStderr = captureStream(proc.stderr);
    void captureStream(proc.stdout); // 启动横幅只作诊断,不消费断言
    await waitHealthy();
  });

  afterAll(async () => {
    // describe 级 skip 连钩子一起跳:进到这里 beforeAll 必已跑过,TMP_DIR 必已建。
    // 进程句柄是自己 spawn 的,直接 kill(execPath 直起,单进程即杀);杀后验死——
    // /health 不再应答才删临时目录。验死不验就删 = 泄漏服务器下一个事件写盘 ENOENT
    // 崩溃(上一轮实测);继续应答 = 上一位测试的 server 没死干净,当场响亮暴露。
    proc?.kill();
    await proc?.exited;
    const deadline = Date.now() + 5000;
    for (;;) {
      const alive = await fetch(`${BASE}/health`)
        .then((r) => r.ok)
        .catch(() => false);
      if (!alive) break;
      if (Date.now() > deadline) {
        throw new Error("服务器 kill 后 5s 仍应答 /health:进程未死干净,拒绝删除临时目录");
      }
      await Bun.sleep(100);
    }
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("场景二 断线重连:代理硬断两侧→持 token 重连收整房摘要校准→续局不炸", async () => {
    const proxy = FaultProxy.start({ targetOrigin: WS_ORIGIN });
    try {
      // 建房(2 座:座位 1 bot)→ 开局 → 选都 → 开托管,游戏进入服务器代打推进
      const created = await post("/room/new", { seats: 2, bot: "1", seed: 2 });
      expect(created.ok).toBe(true);
      const roomId = created.roomId as string;
      const hostToken = created.seatToken as string;
      await post("/room/map", { roomId, seatToken: hostToken, mapId: "guanzhong" });
      await post("/room/start", { roomId, seatToken: hostToken });
      const a = await OnlineClient.connect(wsUrl(proxy.port, roomId, 0, hostToken));
      await drivePickCapital(a, 0);
      await a.waitSnapshot((s) => s.phase === "Playing", "进 Playing", 15000);
      await setAutoPilotEchoed(a, 0, true);
      await waitTurnStarted(a, 2, 45000, "推进 2 回合");

      // 旋钮③实战:硬断两侧连接(对局中;非优雅挥手)。客户端确定性等到关闭。
      proxy.killNow();
      const closeInfo = await a.waitClosed(5000);
      expect(proxy.getStats().kills).toBe(1);
      expect(closeInfo.code).not.toBe(0); // close 事件已到达(等死不靠猜)

      // 服务器侧:座位离线但不炸,托管+bot 继续代打(进程存活 = /health 仍应答)
      const health = await fetch(`${BASE}/health`);
      expect(health.ok).toBe(true);

      // 持原 token 原地重连(代理继续监听,原 URL 直连得全新连接对;ADR-0005:token
      // 是座位归属唯一凭证)。首帧必为整房摘要校准(重连=摘要水合,断线期间事件不补发)。
      const a2 = await OnlineClient.connect(wsUrl(proxy.port, roomId, 0, hostToken));
      const summary = (await a2.next(5000, "重连整房摘要")) as SnapshotMsg;
      expect(summary.type).toBe("snapshot");
      expect(summary.roomId).toBe(roomId);
      expect(summary.phase).toBe("Playing");
      expect(summary.turnNumber).toBeGreaterThanOrEqual(1);

      // resync 后续局:托管+bot 的回合继续推进,再等到一个 turnStarted(不炸、不冻结)
      await waitTurnStarted(a2, 1, 45000, "重连后续局推进");
      expect(a2.errors, "重连后零 error 下行").toEqual([]);

      // 收尾:解散房间(服务器侧停驱动,重连端收 dismissed)
      const dismissed = await post("/room/dismiss", { roomId, seatToken: hostToken });
      expect(dismissed.ok).toBe(true);
      await a2.waitFor((m) => m.type === "dismissed", "重连端收解散通知", 5000);
      await a2.waitClosed(5000);
    } finally {
      proxy.stop();
    }
  }, 90000);

  it("场景四 丢帧档:toClient 确定性丢帧(图案可断言)→ 客户端饿死 → 重连摘要校准回正续局", async () => {
    // 2 座(座位 1 bot):单客户端即够——饿死断言的「服务器仍在发」由代理 dropped
    // 计数持续增长正着证,不需要第二目击者。
    const notices: FaultProxyNotice[] = [];
    const proxy = FaultProxy.start({
      targetOrigin: WS_ORIGIN,
      onNotice: (n) => notices.push(n),
    });
    try {
      const created = await post("/room/new", { seats: 2, bot: "1", seed: 3 });
      expect(created.ok).toBe(true);
      const roomId = created.roomId as string;
      const hostToken = created.seatToken as string;
      await post("/room/map", { roomId, seatToken: hostToken, mapId: "guanzhong" });
      await post("/room/start", { roomId, seatToken: hostToken });
      const a = await OnlineClient.connect(wsUrl(proxy.port, roomId, 0, hostToken));
      await drivePickCapital(a, 0);
      await a.waitSnapshot((s) => s.phase === "Playing", "进 Playing", 15000);
      await setAutoPilotEchoed(a, 0, true);
      await waitTurnStarted(a, 1, 45000, "零故障推进 1 回合");
      const staleView = a.snapshot?.turnNumber;
      expect(staleView, "饿死前客户端有校准锚").toBeGreaterThanOrEqual(1);

      // 旋钮②图案档:N=2——到达序计数(含被丢帧)逢偶数序号丢。定格段:关旋钮后
      // 同步段内读 stats 与 notices(丢帧判定在帧到达时同步发生,关旋钮后零新 drop,
      // 两个读数必然同源),断言图案确定性。
      proxy.setDropEveryN("toClient", 2);
      await waitStats(proxy, (s) => s.dropped.toClient >= 2, "N=2 丢 2 帧", 45000);
      proxy.setDropEveryN("toClient", null);
      const s2 = proxy.getStats();
      const drops2 = notices.flatMap((n) => (n.kind === "dropped" ? [n] : []));
      expect(drops2.length, "notice 与 stats 计数一致(同一同步定格段)").toBe(s2.dropped.toClient);
      expect(drops2.length, "N=2 段确有丢帧").toBeGreaterThanOrEqual(2);
      for (const n of drops2) {
        expect(n.direction, "丢帧方向 toClient").toBe("toClient");
        expect(n.ordinal % 2, `丢帧序号 ${n.ordinal} 落 N=2 图案(偶数)`).toBe(0);
      }

      // 旋钮②饿死档:N=1——全部下行帧丢弃。先排空在途转发链(零延迟下链步=微任务
      // 级,250ms 是数量级裕量)再取基线,之后对照:客户端 frames 零增长(到达才
      // 归档,全丢=不增)而代理 dropped 持续增长(服务器仍在发=对局仍在推进)。
      proxy.setDropEveryN("toClient", 1);
      await Bun.sleep(250);
      const framesAtStarve = a.frames.length;
      const s1 = await waitStats(
        proxy,
        (s) => s.dropped.toClient >= s2.dropped.toClient + 3,
        "N=1 再丢 3 帧(服务器持续在发)",
        45000,
      );
      expect(a.frames.length, "饿死窗内客户端零帧到达").toBe(framesAtStarve);
      expect(s1.dropped.toClient, "饿死窗内代理持续丢帧").toBeGreaterThan(s2.dropped.toClient);
      // 序号计数单调连续(旋钮 N 2→null→1 三次调整不重置):dropped 序号严格递增
      const ordinals = notices.flatMap((n) => (n.kind === "dropped" ? [n.ordinal] : []));
      expect(ordinals.length, "两段合计丢帧数").toBeGreaterThanOrEqual(5);
      for (let i = 1; i < ordinals.length; i++) {
        expect(ordinals[i]!, `丢帧序号单调递增(${ordinals[i - 1]}→${ordinals[i]})`).toBeGreaterThan(
          ordinals[i - 1]!,
        );
      }

      // 撤旋钮 → 硬断 → 持 token 重连:首帧必为整房摘要校准(丢掉的帧不补发,
      // ADR-0020 决策 4;摘要即权威状态的完整投影,客户端校准回正)。
      proxy.setDropEveryN("toClient", null);
      proxy.killNow();
      await a.waitClosed(5000);
      expect(proxy.getStats().kills).toBe(1);
      const a2 = await OnlineClient.connect(wsUrl(proxy.port, roomId, 0, hostToken));
      const summary = (await a2.next(5000, "重连整房摘要")) as SnapshotMsg;
      expect(summary.phase).toBe("Playing");
      expect(summary.turnNumber, "重连摘要不落后于饿死前客户端视图").toBeGreaterThanOrEqual(
        staleView!,
      );
      // 重连摘要的保密投影(cutover 用例三的协议面断言落点):seat0 视角他人(bot)
      // 手牌恒空、牌库只剩数量
      expect(summary.players[1]?.jinnangHand, "bot 手牌对 seat0 不可见").toEqual([]);
      expect(summary.jinnangDeck, "牌库牌序不可见(只剩数量)").toEqual([]);
      expect(summary.jinnangDeckCount, "Playing 摘要牌库数量在场").toBeGreaterThan(0);

      // 续局不炸:托管+bot 继续推进,再等到一个 turnStarted;零 error 下行
      await waitTurnStarted(a2, 1, 45000, "重连后续局推进");
      expect(a2.errors, "重连后零 error 下行").toEqual([]);

      const dismissed = await post("/room/dismiss", { roomId, seatToken: hostToken });
      expect(dismissed.ok).toBe(true);
      await a2.waitFor((m) => m.type === "dismissed", "重连端收解散通知", 5000);
      await a2.waitClosed(5000);
    } finally {
      proxy.stop();
    }
  }, 120000);
});

// ──────────────────────────── 测试本地帮手 ────────────────────────────

/** 等本座位的托管标记在下行回读生效:lobby 消息(③ 元数据拍)或 snapshot(校准拍
 *  元数据搭车)任一载体看到 seats[seat].autoPilot === on 即可——读态不读车种。
 *  sinceFrame=调用方发上行命令前的 frames.length:回读必须落在**该命令之后到达**的帧
 *  上——缓冲里有开关之前的旧载体帧(开局序列 autoPilot 恒 false),waitFor 的 FIFO
 *  扫描会拿旧帧冒充回读(2026-11-07 实锤:关托管的「回读」匹配到开局旧帧,收回根本
 *  没生效,后续冻结断言全盘皆错)。 */
async function waitAutopilot(
  c: OnlineClient,
  seat: number,
  on: boolean,
  sinceFrame: number,
): Promise<void> {
  const deadline = Date.now() + 15000;
  for (;;) {
    const hit = c.frames
      .slice(sinceFrame)
      .some(
        (m) => (m.type === "lobby" || m.type === "snapshot") && m.seats[seat]?.autoPilot === on,
      );
    if (hit) return;
    const left = deadline - Date.now();
    if (left <= 0) {
      throw new Error(
        `托管标记回读超时:座位 ${seat} 期望 ${on ? "开" : "关"}(自帧 ${sinceFrame} 起;` +
          `error 下行 ${c.errors.length} 条)`,
      );
    }
    await Bun.sleep(50);
  }
}

/** 托管开关发送+回读一步:记发命令前的帧位,回读只认其后到达的载体(理由见
 *  waitAutopilot 头注)。 */
async function setAutoPilotEchoed(c: OnlineClient, seat: number, on: boolean): Promise<void> {
  const sentAt = c.frames.length;
  c.sendAutoPilot(on);
  await waitAutopilot(c, seat, on, sentAt);
}

/** 驱动本座位选都:等「轮到我」的校准快照(Setup 期每拍带快照,状态稳定到本座位
 *  落子为止,无时序竞态)→ 取三选一首候选落子。 */
async function drivePickCapital(c: OnlineClient, seat: number): Promise<void> {
  const snap = await c.waitSnapshot(
    (s) =>
      s.phase === "Setup" && s.setupPhase === "PickCapital" && s.currentSetupPlayerIndex === seat,
    `轮到座位 ${seat} 选都`,
    20000,
  );
  expect(snap.offeredCapitals.length, "选都三选一候选").toBe(3);
  c.sendPickCapital(snap.offeredCapitals[0]!);
}

/** 等客户端累计收到 ≥ minCount 个 turnStarted 事件(回合推进的线级证据;fresh 客户端
 *  从零计数,已有存量的客户端必须用 waitTurnStartedBeyond)。超时当场抛,绝不裸等。 */
async function waitTurnStarted(
  c: OnlineClient,
  minCount: number,
  timeoutMs: number,
  desc: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (countTurnStarted(c) >= minCount) return;
    const left = deadline - Date.now();
    if (left <= 0) {
      throw new Error(
        `回合推进超时:${desc}(等 ${minCount} 个 turnStarted,实收 ${countTurnStarted(c)};` +
          `已收事件批 ${c.batches.length} 个,error 下行 ${c.errors.length} 条)`,
      );
    }
    await c.waitEventBatch(desc, left);
  }
}

function countTurnStarted(c: OnlineClient): number {
  return c.batches.reduce(
    (n, batch) => n + batch.events.filter((e) => e.kind === "turnStarted").length,
    0,
  );
}

/** 轮询等待代理统计满足谓词(丢帧/硬断计数;50ms 步进,超时当场抛附 stats 快照)。 */
async function waitStats(
  proxy: FaultProxy,
  pred: (s: FaultProxyStats) => boolean,
  desc: string,
  timeoutMs: number,
): Promise<FaultProxyStats> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = proxy.getStats();
    if (pred(s)) return s;
    const left = deadline - Date.now();
    if (left <= 0) {
      throw new Error(`代理统计等待超时:${desc};stats=${JSON.stringify(s)}`);
    }
    await Bun.sleep(50);
  }
}

// ──────────────────────────── 下行形状审计(校准快照判定,react-online-cutover 镜像)────────────────────────────

// ──────────────────────────── 保密口径断言(react-online-secrecy 镜像)────────────────────────────

/** 诊断流收集(spawn 进程 stderr/stdout):截断累积,流中断(进程终止的伴随现象)
 *  记入缓冲显式回报,不静默吞。 */
function captureStream(stream: ReadableStream<Uint8Array>): { text: () => string } {
  const dec = new TextDecoder();
  let buf = "";
  let done = false;
  void (async () => {
    const reader = stream.getReader();
    for (;;) {
      try {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        if (buf.length < 16384) buf += dec.decode(value, { stream: true });
      } catch (err) {
        buf += `\n[诊断流中断(进程终止的伴随现象):${(err as Error).message}]`;
        break;
      }
    }
    done = true;
  })();
  return { text: () => buf + (done ? "" : "…") };
}
