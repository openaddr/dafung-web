// 协议级联机 e2e(#1164,棒一地基+棒二故障矩阵与 spec 迁移;#1160 无头确定性测试体系):
// 真服务器进程 + 真 WS + 故障注入代理(scripts/fault-proxy.ts)+ 无头联机客户端
// (scripts/online-client.ts)的收口门。
//
// 与 test/online/local-room.test.ts(单机通路)的本质差别、以及为什么必须走真进程:local-room
// 用进程内 RoomRegistry + 内存双工,验证的是「编排与客户端共享一份房间逻辑」;本文件要
// 验证的恰是内存双工里**不存在的那一层**——wire.ts 上行的真实编解码、server.ts 的 WS
// 生命周期/广播/flush 节拍、跨进程的下行到达序、代理旋钮下的传输故障行为、以及下行
// 形状(校准/保密投影)的线上事实。这层只有「spawn 真 server + 真 WS 连接」能覆盖
// (同 test/online/server-cmd-error.test.ts 先例,spawn/预检/清理组织方式搬自它)。
//
// 用例全景(棒二起;旋钮×断言与迁移落点总表见 docs/adr/0055-protocol-fault-e2e.md):
//   故障矩阵:
//   ① 零故障基线:双客户端经各自代理建房→入座→开局→双选都→开托管→驱动若干回合,
//      断言双方都按序收到下行事件批(批语义/首部/(round,turn) 非降)。
//   ② 断线重连:代理 killNow 硬断→服务器侧座位离线但不炸→持原 token 重连→首帧必为
//      整房摘要校准(ADR-0020 决策 4:重连=摘要水合,事件不补发)→续局继续推进。
//   ③ 延迟档:双端 setLatencyMs(80) 全程带延迟建连/选都/托管推进——下行批序不变、
//      延迟撤除后无积压卡死(续推即证)。
//   ④ 丢帧档:toClient 确定性丢帧(N=2 断言丢帧序号落偶数图案 → N=1 全饿死:frames
//      零增长而代理 dropped 计数持续增长)→ 撤旋钮+硬断+重连 → 整房摘要校准回正
//      (含他人手牌/牌库序保密投影)→ 续局不炸。
//   ⑤ 杀房主档:killNow 断房主连接(另一真人+bot 在局)→ lobby 指纹:座位下线+
//      房主移交在场真人(ADR-0002)→ 掉线座位回合链停在其决策门(autoRoll 代摇不代
//      决策,看门狗本测试环境全关)→ 重连归座但房主身份不回迁(移交单向)→ 托管续推
//      (解散权随移交走)。
//   spec 迁移(断言语义等价,出处逐条见各用例头注与 ADR-0055 迁移总表):
//   ⑥ 事件批下行形状 ← e2e/react-online-events.spec.ts(整文件迁入,spec 删除)。
//   ⑦ 托管语义:收回即停/重开恢复 ← react-online-autopilot.spec.ts 用例一(逻辑面)。
//   ⑧ 下行形状审计:摘要后零逐步快照 ← react-online-cutover.spec.ts 用例一。
//   ⑨ 掉线元数据 lobby 指纹通道 ← react-online-cutover.spec.ts 用例二。
//   ⑩ 保密下行常规局 ← react-online-secrecy.spec.ts 用例一;⑪ 种子局询问集 ← 用例二
//      (两例整文件迁入,spec 删除)。
//   ⑫ 整局骑局(#1181):4 座(2 真 bot + 双真人座开局托管一次,此后全 bot 代打)经
//      零故障代理从开局骑到 gameOver(中段 50ms 延迟扰动一段再撤)——双端 gameOver
//      事件一致、(round,turn) 非降、重连整房摘要 isOver/winner 面一致。gameOver 档位
//      =must-fold(event-tiers 单源)无校准快照随行,终局状态面唯一通路=重连摘要;
//      ADR-0055「承认的取舍」的整局边界条就此收口。
// 确定性纪律(flake 零容忍):所有等待显式超时(超时当场抛,禁裸等);游戏推进全部
// 服务器驱动(托管=ADR-0028 单一开关,bot 座位服务器代打),客户端不发「赌时序」的
// 对局命令;故障旋钮全确定性(固定延迟/序号丢帧/编程硬断,禁随机抖动——故障落在
// 哪一帧是确定的,断言可精确到 notice 的 ordinal)。冻结类断言(收回即停/掉线冻结)
// 走滚动静默窗(waitForFreeze:静默阈值 > 运转时回合间隔上限,窗内出现新 turnStarted
// 即重计时,观察域内不停=违约)——静默判定是权威语义(未托管人类决策门=推进唯一
// 钥匙)的必然结果,停点位置由重连摘要 decisionOwner/恢复推进反证钉死,非时序赌。
// 元数据下行(在线翻转/房主移交)读态不读车种:非校准拍走 lobby 形状一条,校准拍
// 搭校准快照车(server.ts flush 形态,快照自带 WireRoomFields)。服务器 bot 配速关
// (E2E_BOT_STEP_MS=0)、机遇隔离(e2e/jiyu-off.json)、看门狗全关(DECISION/RETENTION
// =0,停摆=响亮挂测而非静默代打)。托管步进 2s/拍(core/timings 单源,#927 统一原则
// 不设分档)是本文件墙钟主项,用例预算按「步数×2s」富余给。
//
// 慢例池(测试管线提速批口径,#1026):真服务器进程 + 真 WS 整类,整文件入慢例池
// (判据=「单例实测 ≥3s 且属整局骑局/整局恢复/真实进程类」的真实进程支;用例墙钟
// 0.04-34s 不等[2026-11-07 收口轮标定],但 spawn 真服务器 ~3s 是文件级固定开销,与
// test/online/server-cmd-error 先例同判)。默认池不留用例(核心确定性已由两跑门 + check:goldens 管)。
// DAFUNG_SLOW=1 才跑(bun run test:slow),默认池 skip(skip 行可见);用 describe 级
// skipIf——探针实测(server-cmd-error 同款):it 全跳时文件级 beforeAll 照跑,describe
// 级才连钩子一起跳,默认池不白起一台真服务器(并行会话撞口即假红)。
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { EVENT_TIERS } from "../../src/core/event-tiers";
import { protocolTestPort } from "../../scripts/dev-ports";
import { FaultProxy, type FaultProxyNotice, type FaultProxyStats } from "../../scripts/fault-proxy";
import { OnlineClient } from "../../scripts/online-client";
import type { SnapshotMsg } from "../../scripts/wire";

// 慢例池开关:describe 级 skip 连钩子一起跳(默认池不白起服务器);DAFUNG_SLOW=1 才跑,判据见文件头注。
const describeSlow = describe.skipIf(!process.env.DAFUNG_SLOW);

// spawn 端口按 workspace 名派生(#1181,单源 scripts/dev-ports.ts,基址 4281 与
// server-cmd-error 的 4280 保持历史 1 间隔——同 workspace 两测试同跑各占一口):
// 并行 workspace 同跑慢池不撞口;显式 env DAFUNG_PROTOCOL_PORT 最高优先可覆盖
// (空串兜派生默认,`||` 同 playwright.config #807 口径)。
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
        JIYU_CONFIG: join(REPO_ROOT, "e2e", "jiyu-off.json"),
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

  it("场景一 零故障基线:双客户端经代理建房/入座/开局/选都/开托管,双方按序收到下行事件", async () => {
    const proxyA = FaultProxy.start({ targetOrigin: WS_ORIGIN });
    const proxyB = FaultProxy.start({ targetOrigin: WS_ORIGIN });
    try {
      // 建房(3 座:座位 2 bot=服务器代打)→ 入座 → 选图 → 开局
      const created = await post("/room/new", { seats: 3, bot: "2", seed: 1 });
      expect(created.ok).toBe(true);
      const roomId = created.roomId as string;
      const hostToken = created.seatToken as string;
      const joined = await post("/room/join", { roomId });
      expect(joined.ok).toBe(true);
      const guestSeat = joined.seat as number;
      const guestToken = joined.seatToken as string;
      await post("/room/map", { roomId, seatToken: hostToken, mapId: "guanzhong" });
      await post("/room/start", { roomId, seatToken: hostToken });

      // 双客户端经代理连 WS;首帧必为整房摘要(server open 处理器:强制排空后发摘要)
      const a = await OnlineClient.connect(wsUrl(proxyA.port, roomId, 0, hostToken));
      const b = await OnlineClient.connect(wsUrl(proxyB.port, roomId, guestSeat, guestToken));
      const a0 = (await a.next(5000, "A 开局摘要")) as SnapshotMsg;
      const b0 = (await b.next(5000, "B 开局摘要")) as SnapshotMsg;
      expect(a0.type).toBe("snapshot");
      expect(b0.type).toBe("snapshot");
      expect(a0.roomId).toBe(roomId);
      expect(b0.roomId).toBe(roomId);
      expect(a0.phase).toBe("Setup");

      // 双端各自选都(Setup 每拍带校准快照,三选一候选随快照下发;并发等各自轮到)
      await Promise.all([drivePickCapital(a, 0), drivePickCapital(b, guestSeat)]);

      // 入局校准快照(finishSetup 批 gameStarted ∈ 校准事件集,ADR-0020 决策 3)
      await a.waitSnapshot((s) => s.phase === "Playing", "A 侧进 Playing", 15000);
      await b.waitSnapshot((s) => s.phase === "Playing", "B 侧进 Playing", 15000);

      // 双端开托管(命令族③ autoPilot;无归属校验,无时序竞态),各端回读本座位的
      // 托管标记生效。载体不挑:托管开关的下行随 flush 形态二选一——非校准拍走
      // ③ lobby 消息,校准拍(如恰逢 AwaitingJinnang 窗)元数据搭快照车,客户端读态
      // 不读车种(两种载体的 seats 形状同源,WireRoomFields)。
      await setAutoPilotEchoed(a, 0, true);
      await setAutoPilotEchoed(b, guestSeat, true);

      // 驱动若干回合:服务器代打(托管 2s/拍 × 每回合 2-3 拍 + bot 即时)——双方各等
      // 3 个 turnStarted(约两整回合);预算按步数×2s 富余给(口径见文件头注)
      await waitTurnStarted(a, 3, 45000, "A 侧推进 3 回合");
      await waitTurnStarted(b, 3, 45000, "B 侧推进 3 回合");

      // 断言:双方都按序收到下行事件批(与 react-online-events 断言口径一致,场景六整例落地)
      assertOrderedDownlink(a, "A");
      assertOrderedDownlink(b, "B");
      expect(a.errors, "A 零 error 下行").toEqual([]);
      expect(b.errors, "B 零 error 下行").toEqual([]);
      // 代理确实双向搬运了帧(哑管道不是空壳)
      const relayedA = proxyA.getStats().relayed;
      expect(relayedA.toClient).toBeGreaterThan(0);
      expect(relayedA.toServer).toBeGreaterThan(0);

      // host 解散出口:双方收到 dismissed,连接随后关闭(服务器侧主动断开)
      const dismissed = await post("/room/dismiss", { roomId, seatToken: hostToken });
      expect(dismissed.ok).toBe(true);
      expect((await a.waitFor((m) => m.type === "dismissed", "A 收解散通知", 5000)).type).toBe(
        "dismissed",
      );
      expect((await b.waitFor((m) => m.type === "dismissed", "B 收解散通知", 5000)).type).toBe(
        "dismissed",
      );
      await a.waitClosed(5000);
      await b.waitClosed(5000);
    } finally {
      proxyA.stop();
      proxyB.stop();
    }
  }, 90000);

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

  it("场景三 延迟档:双端 80ms 固定延迟全程推进,下行批序不变,撤除后无积压卡死", async () => {
    // 延迟在建连前挂上(覆盖建连/选都/托管/推进全程;双端各自代理=「双端」旋钮口径)。
    const duo = await startTwoHumanGame({ armProxy: (p) => p.setLatencyMs(80) });
    const { hostToken, a, b, guestSeat, proxyA, proxyB } = duo;
    try {
      // 带延迟推进:托管代打若干回合,下行批序保持(转发链同向串行,第 N+1 帧恒晚
      // 于第 N 帧——非降断言与棒一同口径)
      await setAutoPilotEchoed(a, 0, true);
      await setAutoPilotEchoed(b, guestSeat, true);
      await waitTurnStarted(a, 3, 45000, "延迟下 A 侧推进 3 回合");
      await waitTurnStarted(b, 2, 45000, "延迟下 B 侧推进 2 回合");
      assertOrderedDownlink(a, "延迟 A");
      assertOrderedDownlink(b, "延迟 B");
      expect(a.errors, "延迟 A 零 error 下行").toEqual([]);
      expect(b.errors, "延迟 B 零 error 下行").toEqual([]);
      const relayedA = proxyA.getStats().relayed;
      expect(relayedA.toClient, "延迟下 A 下行有帧").toBeGreaterThan(0);
      expect(relayedA.toServer, "延迟下 A 上行有帧").toBeGreaterThan(0);

      // 撤除延迟:续推不卡(若转发链积压/卡死,等不到新 turnStarted 就地响亮超时;
      // a 已有存量,推进证据取「超过存量」的新 turnStarted)
      proxyA.setLatencyMs(0);
      proxyB.setLatencyMs(0);
      await waitTurnStartedBeyond(a, countTurnStarted(a), 45000, "撤除延迟后 A 续推");
      assertOrderedDownlink(a, "撤除后 A");
      expect(a.errors, "撤除后零 error 下行").toEqual([]);
    } finally {
      await teardownDuo(duo, hostToken);
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

  it("场景五 杀房主档:房主硬断→房主移交在场真人→掉线座位回合停决策门→重连归座不回迁→托管续推", async () => {
    // 3 座(host0 / guest1 / bot2):按 room.ts 产品语义断服务器侧行为——
    // markSeatOffline → transferHostIfNeeded(在场最久在线真人)+ 保留窗/决策看门狗
    // 本测试环境全关(RETENTION/DECISION=0)→ 掉线未托管人类座位回合链停在其决策门
    // 冻结(ADR-0002 默认冻结;autoRoll 代摇不代决策;无决策回合会空转数轮才停在
    // 首个含决策的回合);重连归座,房主身份不回迁(transferHostIfNeeded 只在掉线时
    // 触发)。seed 4 钉死(种子哨兵口径):冻结时点骰流敏感(20 种子扫描全数在
    // recall+kill 后 ≤12s 冻结,seed 4 实测 ~11s/60s 预算)。**回读必须先于硬断落定**
    // (setAutoPilotEchoed 的帧位回读保证)——2026-11-07 实锤:回收帧还在代理转发链
    // 里就被 killNow 硬断作废,座位实际仍被托管,冻结断言整盘皆错(对局日志无
    // on=false 行取证)。
    const proxyA = FaultProxy.start({ targetOrigin: WS_ORIGIN });
    const proxyB = FaultProxy.start({ targetOrigin: WS_ORIGIN });
    try {
      const created = await post("/room/new", { seats: 3, bot: "2", seed: 4 });
      expect(created.ok).toBe(true);
      const roomId = created.roomId as string;
      const hostToken = created.seatToken as string;
      const joined = await post("/room/join", { roomId });
      const guestSeat = joined.seat as number;
      const guestToken = joined.seatToken as string;
      await post("/room/map", { roomId, seatToken: hostToken, mapId: "guanzhong" });
      await post("/room/start", { roomId, seatToken: hostToken });
      const host = await OnlineClient.connect(wsUrl(proxyA.port, roomId, 0, hostToken));
      const guest = await OnlineClient.connect(wsUrl(proxyB.port, roomId, guestSeat, guestToken));
      await Promise.all([drivePickCapital(host, 0), drivePickCapital(guest, guestSeat)]);
      await host.waitSnapshot((s) => s.phase === "Playing", "进 Playing", 15000);
      // 双端托管先把 host 的首个回合推过去(托管在线与否与断线无关:autoPilot 集不因
      // 断线清除,掉线座位若仍被托管则照常代打、不会冻结——冻结前提=掉线+未托管)
      await setAutoPilotEchoed(host, 0, true);
      await setAutoPilotEchoed(guest, guestSeat, true);
      // 等 guest(seat1)回合开始(host 首回合已推完):此刻收回 host 托管+硬断,
      // 时相确定性落在「下一轮到 host 必冻」(轮转按 draft 序,guest 回合内无人能跳座)
      await waitTurnStartedOfSeatBeyond(guest, guestSeat, 0, 60000, "host 首回合结束");
      // 收回托管(带帧位回读,见用例头注的 in-flight 实锤);回读落定后才许硬断
      await setAutoPilotEchoed(host, 0, false);
      const seat0AtKill = countTurnStartedOfSeat(guest, 0);

      // 杀房主:硬断 host 连接(proxyA 只挂 host 一对;killNow 不伤 guest 的 proxyB 对)
      proxyA.killNow();
      await host.waitClosed(5000);
      expect(proxyA.getStats().kills).toBe(1);
      expect((await fetch(`${BASE}/health`)).ok, "服务器不炸").toBe(true);

      // 房间元数据下行(③ 房间生命周期;ADR-0002 移交语义):guest 收到
      // started=true + 座位 0 下线 + 房主移交自己(在场最久在线真人=座位 1)。
      // 载体二选一(server.ts flush 形态):非校准拍走 lobby 形状一条,校准拍元数据
      // 搭校准快照车(快照自带 WireRoomFields)——读态不读车种(与托管回读同口径)。
      const transferMeta = await guest.waitFor(
        (m) =>
          (m.type === "lobby" || m.type === "snapshot") &&
          m.started === true &&
          m.host === guestSeat &&
          m.seats[0]?.online === false,
        "guest 收房主移交+座位0下线(lobby/snapshot 任一载体)",
        20000,
      );
      expect(transferMeta.type === "lobby" || transferMeta.type === "snapshot").toBe(true);

      // 冻结语义:掉线未托管座位(host)的回合链停在其决策门——guest 视角等下一发
      // turnStarted(seat0) 到达(其回合开始),之后滚动静默窗(12s 零新 turnStarted;
      // 阈值>运转时回合间隔上限,无决策回合会空转数轮才停在首个含决策的 host 回合,
      // 静默位置不预设)确认推进已停。停点=host 决策门由重连摘要 decisionOwner 钉死。
      await waitTurnStartedOfSeatBeyond(guest, 0, seat0AtKill, 90000, "掉线座位回合开始");
      await waitForFreeze(guest, 12000, 60000, "掉线座位决策门冻结");
      expect(guest.errors, "冻结期零 error 下行").toEqual([]);

      // 重连归座(ADR-0005 token 唯一凭证):首帧整房摘要,停摆相位可见——
      // 仍 Playing、决策门在 seat0(冻结位置的精确协议面证据);房主身份不回迁
      // (移交单向,transferHostIfNeeded 只在掉线时触发)
      const host2 = await OnlineClient.connect(wsUrl(proxyA.port, roomId, 0, hostToken));
      const summary = (await host2.next(5000, "重连整房摘要")) as SnapshotMsg;
      expect(summary.phase).toBe("Playing");
      expect(summary.decisionOwner, "对局停在掉线座位决策门").toBe(0);
      expect(summary.host, "房主身份不回迁(仍座位1)").toBe(guestSeat);
      expect(summary.seats[0]?.online, "摘要座位表:seat0 已归座在线").toBe(true);
      // guest 侧房间元数据跟着翻回在线(载体 lobby/snapshot 二选一,房主仍是 1)
      await guest.waitFor(
        (m) =>
          (m.type === "lobby" || m.type === "snapshot") &&
          m.host === guestSeat &&
          m.seats[0]?.online === true,
        "guest 收座位0回归(房主仍1)",
        20000,
      );

      // 续推:掉线座位自助托管接管自己(ADR-0028 唯一开关)→ 链解冻,推进恢复
      await setAutoPilotEchoed(host2, 0, true);
      await waitTurnStarted(host2, 1, 45000, "托管接管后续推");
      expect(host2.errors, "续推零 error 下行").toEqual([]);
      expect(guest.errors, "guest 零 error 下行").toEqual([]);

      // 收尾:房主已是座位 1——解散权随移交走(guest token 才能解散,旁证移交生效)
      const dismissed = await post("/room/dismiss", { roomId, seatToken: guestToken });
      expect(dismissed.ok, "移交后解散权随新房主").toBe(true);
      await guest.waitFor((m) => m.type === "dismissed", "guest 收解散通知", 5000);
      await host2.waitFor((m) => m.type === "dismissed", "重连房主收解散通知", 5000);
      await guest.waitClosed(5000);
      await host2.waitClosed(5000);
    } finally {
      proxyA.stop();
      proxyB.stop();
    }
  }, 150000);

  it("场景六 事件批下行形状:选都逐转移到达双端,内容与顺序符合批语义 ← react-online-events 迁移", async () => {
    // 迁移落点:e2e/react-online-events.spec.ts「事件批下行:开局选都逐转移到达双端,
    // 内容与顺序符合批语义」整例迁入(断言语义等价:双端同流、批非空、首部齐全、
    // 转移序非降、两次建城、开局收尾链)。浏览器线级 framereceived 收集器由
    // OnlineClient.frames/batches 归档等价替代;2 真人座与原 spec 同形(无 bot)。
    const duo = await startTwoHumanGame();
    const { hostToken, a, b } = duo;
    try {
      // 断言面(原 spec 逐条;players/type 等断言已由 startTwoHumanGame 的开场摘要与
      // drivePickCapital 的候选断言覆盖,不再重复)
      for (const [label, c] of [
        ["host", a],
        ["guest", b],
      ] as const) {
        // 两笔选都转移各一批(末位选都的编排批内含 finishSetup 收尾链,见 #375 批语义)
        expect(c.batches.length, `${label} 收到事件批`).toBeGreaterThanOrEqual(2);
        for (const batch of c.batches) {
          expect(batch.events.length, `${label} 非空批`).toBeGreaterThan(0);
          for (const ev of batch.events) {
            expect(typeof ev.kind, `${label} 事件 kind`).toBe("string");
            expect(ev.seat === null || typeof ev.seat === "number", `${label} 事件 seat`).toBe(
              true,
            );
            expect(typeof ev.round, `${label} 事件 round`).toBe("number");
            expect(typeof ev.turn, `${label} 事件 turn`).toBe("number");
          }
        }
        // 到达序 = 转移发生序:拼接后 (round, turn) 非降
        const stamps: [number, number][] = c.batches.flatMap((batch) =>
          batch.events.map((ev) => [ev.round, ev.turn] as [number, number]),
        );
        for (let i = 1; i < stamps.length; i++) {
          const cmp = stamps[i]![0] - stamps[i - 1]![0] || stamps[i]![1] - stamps[i - 1]![1];
          expect(cmp, `${label} 事件批转移序非降`).toBeGreaterThanOrEqual(0);
        }
        // 选都与开局收尾确实走了通道:两次建城(两真人座各一)+ finishSetup 链
        const kinds: string[] = c.batches.flatMap((batch) => batch.events.map((ev) => ev.kind));
        expect(
          kinds.filter((k) => k === "capitalSelected"),
          `${label} 两次建城事件`,
        ).toHaveLength(2);
        expect(kinds, `${label} 开局收尾链`).toEqual(
          expect.arrayContaining(["setupCompleted", "gameStarted", "turnStarted"]),
        );
      }
      expect(a.errors, "host 零 error 下行").toEqual([]);
      expect(b.errors, "guest 零 error 下行").toEqual([]);
    } finally {
      await teardownDuo(duo, hostToken);
    }
  }, 60000);

  it("场景七 托管语义:双端托管推进,host 收回即停在决策门,重开推进恢复 ← react-online-autopilot 迁移", async () => {
    // 迁移落点:e2e/react-online-autopilot.spec.ts「双端托管:推进,host 中途收回即停
    // (冻结),重开推进恢复」的**托管语义逻辑面**(有界断言,不骑终局)迁入;开关
    // aria-checked/设置弹层交互断言留在浏览器侧(该文件用例二守 UI 通路)。观测口从
    // __dafung 调试钩子换成协议面:turnStarted 批=推进证据,权威语义(未托管人类决策
    // 门=推进唯一钥匙)替代浏览器态轮询;收回时相确定性落在 guest 回合中(见下)。
    // seed 1 钉死(种子哨兵口径):冻结时点=收回座位首个含决策的回合,骰流决定它
    // 第几回合到来(20 种子扫描全数在 recall 后 ≤8s 冻结;钉 seed 让时点也确定)。
    const duo = await startTwoHumanGame({ seed: 1 });
    const { hostToken, a, b, guestSeat } = duo;
    try {
      // 双端开托管 → 推进(host 首回合推过,guest 回合开始)
      await setAutoPilotEchoed(a, 0, true);
      await setAutoPilotEchoed(b, guestSeat, true);
      await waitTurnStartedOfSeatBeyond(b, guestSeat, 0, 60000, "guest 回合开始");

      // host 中途收回:回读复位(lobby/snapshot 元数据载体的 seats[0].autoPilot=false)。
      // 收回时相确定落在 guest 回合中——两座严格轮转,下一 turnStarted 必是 seat0。
      await setAutoPilotEchoed(a, 0, false);
      const seat0AtRecall = countTurnStartedOfSeat(a, 0);

      // 链停在 host 决策门:新 turnStarted(seat0) 到达(其回合开始)后滚动静默窗
      // (12s 零新 turnStarted;无决策回合会空转数轮才停在首个含决策的 host 回合,
      // 静默位置不预设)。停点唯一性由权威语义保证(guest 仍托管=受控,唯一未受控
      // 人类的决策门是推进唯一钥匙);重开托管后续推恢复反证等的就是 host 的输入。
      await waitTurnStartedOfSeatBeyond(a, 0, seat0AtRecall, 90000, "收回后轮到 host");
      await waitForFreeze(a, 12000, 60000, "收回后对局冻结");
      await waitForFreeze(b, 12000, 60000, "收回后 guest 侧同样冻结");
      expect(a.errors, "冻结期 host 零 error").toEqual([]);

      // 重开托管 → 推进恢复(超过冻结存量数的新 turnStarted;不骑终局)
      await setAutoPilotEchoed(a, 0, true);
      await waitTurnStartedBeyond(a, countTurnStarted(a), 60000, "重开托管后推进恢复");
      expect(a.errors, "恢复期零 error").toEqual([]);
      expect(b.errors, "guest 零 error").toEqual([]);
    } finally {
      await teardownDuo(duo, hostToken);
    }
  }, 150000);

  it("场景八 下行形状审计:整房摘要之后零逐步快照,只允许校准快照 ← react-online-cutover 迁移", async () => {
    // 迁移落点:e2e/react-online-cutover.spec.ts「托管骑局:零逐步快照,状态下行只走
    // 事件批与校准快照」的**线级帧形状断言**迁入(有界骑局:推进过两轮即收审计,不骑
    // 终局——终局折叠收敛由 test/ 房间级全程骑局用例守住)。校准判定口径与 server.ts
    // 同源镜像(EVENT_TIERS 档位表 + 决策窗集合,逐字搬运原 spec 镜像,见文件尾)。
    const duo = await startTwoHumanGame();
    const { hostToken, a, b, guestSeat } = duo;
    try {
      await setAutoPilotEchoed(a, 0, true);
      await setAutoPilotEchoed(b, guestSeat, true);
      await waitTurnStarted(a, 3, 90000, "托管骑局推进 3 回合");

      // 快照审计:每客户端首帧 snapshot=整房摘要(豁免),此后逐步快照必须为零,
      // 只允许校准快照
      for (const [label, c] of [
        ["host", a],
        ["guest", b],
      ] as const) {
        const snaps = c.frames.filter((m) => m.type === "snapshot") as SnapshotMsg[];
        expect(snaps.length, `${label} 开局校准快照存在`).toBeGreaterThanOrEqual(1);
        const violations: { phase: string; turnPhase: string }[] = [];
        for (const [i, snap] of snaps.entries()) {
          if (i === 0) continue; // 整房摘要(open 处理器同步首发,每连接恰一份)
          if (!isCalibrationSnapshot(snap)) {
            violations.push({ phase: snap.phase, turnPhase: String(snap.turnPhase) });
          }
        }
        expect(violations, `${label} 逐步快照必须为零(只允许摘要与校准快照)`).toEqual([]);
        // 事件批通路:托管骑局的转移批全部经 {type:"events"} 到达
        expect(c.batches.length, `${label} 事件批到达`).toBeGreaterThanOrEqual(1);
      }
      expect(a.errors, "host 零 error 下行").toEqual([]);
      expect(b.errors, "guest 零 error 下行").toEqual([]);
    } finally {
      await teardownDuo(duo, hostToken);
    }
  }, 120000);

  it("场景九 对局中掉线元数据走 lobby 指纹通道,重连在线翻转 ← react-online-cutover 迁移", async () => {
    // 迁移落点:e2e/react-online-cutover.spec.ts「对局中掉线:元数据走 lobby 指纹通道,
    // 其余座位看到 online 翻转」整例迁入(裸关 socket → client.close() 同为客户端侧
    // 挥手,服务器侧同为 close→markSeatOffline 通路)。掉线座位选非房主(guest):
    // 房主身份不动(host===0),只翻 online——与场景五的房主掉线移交语义互补。
    // 载体口径修正(server.ts flush 形态实证,原 spec 的纯 lobby 断言在 Setup 停摆流
    // 不成立):元数据非校准拍走 lobby、校准拍搭快照车,读态不读车种。选都在本例不
    // 驱动(Setup 停摆不碍元数据通路;started 在 /room/start 即成立)。
    const duo = await startTwoHumanGame({ picks: false });
    const { roomId, hostToken, a, b, guestSeat, guestToken, proxyB } = duo;
    try {
      // guest 裸关连接(原 spec 走浏览器 sock.ws.close())
      b.close();
      await b.waitClosed(5000);
      // host 收到房间元数据:started=true + 座位 1 online=false + 房主未动
      const offlineMeta = await a.waitFor(
        (m) =>
          (m.type === "lobby" || m.type === "snapshot") &&
          m.started === true &&
          m.host === 0 &&
          m.seats[guestSeat]?.online === false,
        "host 收座位1下线(lobby/snapshot 任一载体;房主未动)",
        20000,
      );
      expect(offlineMeta.type === "lobby" || offlineMeta.type === "snapshot").toBe(true);

      // 重连:座位回归 → 元数据翻回 online=true(房主仍是 0);首帧整房摘要照发
      const b2 = await OnlineClient.connect(wsUrl(proxyB.port, roomId, guestSeat, guestToken));
      const summary = (await b2.next(5000, "重连整房摘要")) as SnapshotMsg;
      expect(summary.phase, "Setup 停摆期重连,摘要照发").toBe("Setup");
      await a.waitFor(
        (m) =>
          (m.type === "lobby" || m.type === "snapshot") &&
          m.seats[guestSeat]?.online === true &&
          m.host === 0,
        "host 收座位1回归(lobby/snapshot 任一载体)",
        20000,
      );
      expect(a.errors, "host 零 error 下行").toEqual([]);
      expect(b2.errors, "重连端零 error 下行").toEqual([]);

      const dismissed = await post("/room/dismiss", { roomId, seatToken: hostToken });
      expect(dismissed.ok).toBe(true);
      await a.waitFor((m) => m.type === "dismissed", "A 收解散通知", 5000);
      await b2.waitFor((m) => m.type === "dismissed", "重连端收解散通知", 5000);
      await a.waitClosed(5000);
      await b2.waitClosed(5000);
    } finally {
      proxyB.stop();
      duo.proxyA.stop();
    }
  }, 60000);

  it("场景十 保密下行:快照无他人手牌/无牌库序,事件批询问集只含自己或匿名占位 ← react-online-secrecy 迁移", async () => {
    // 迁移落点:e2e/react-online-secrecy.spec.ts 用例一「guest 视角:摘要/校准快照无
    // 他人手牌、无牌库序;事件批询问集只含自己或匿名占位」整例迁入(常规局无种子,
    // 双端对账;redaction 口径 = seat-projection 装配单口,ADR-0016/ADR-0020 决策 2)。
    const duo = await startTwoHumanGame();
    const { hostToken, a, b, guestSeat } = duo;
    try {
      await setAutoPilotEchoed(a, 0, true);
      await setAutoPilotEchoed(b, guestSeat, true);
      await waitTurnStarted(a, 2, 60000, "驱动窗推进 2 回合(保证帧面非空)");
      expectFramesRedacted(a.frames, 0, "host");
      expectFramesRedacted(b.frames, guestSeat, "guest");
      expect(a.errors, "host 零 error 下行").toEqual([]);
      expect(b.errors, "guest 零 error 下行").toEqual([]);
    } finally {
      await teardownDuo(duo, hostToken);
    }
  }, 90000);

  it("场景十一 种子局 419:被询问者见[自己],非被询问席只见匿名占位 ← react-online-secrecy 迁移", async () => {
    // 迁移落点:e2e/react-online-secrecy.spec.ts 用例二「种子局:被询问者(guest)见
    // [自己],非被询问席(host)只见匿名占位——身份不出网」整例迁入。种子 419+国号
    // 预设魏+3 座(bot2)+关中图逐字对齐原 spec(种子哨兵口径:房间形状进骰流,一字
    // 不差);种子保证 bot 选都后即出横征暴敛开 jinnang 窗。
    const duo = await startTwoHumanGame({ seats: 3, bot: "2", seed: 419, guohao: "魏" });
    const { hostToken, a, b, guestSeat } = duo;
    try {
      // 选都一结束 bot 即出横征暴敛(种子 419 离线核算):等两端事件批流出现 jinnang 窗
      const jinnangWindowOf = (c: OnlineClient) =>
        c.batches
          .flatMap((batch) => batch.events)
          .find((ev) => ev.kind === "reactionOpened" && ev.windowKind === "jinnang") as
          | { queriedSeats?: number[] }
          | undefined;
      await waitForCond(
        () => jinnangWindowOf(b) != null,
        "guest 事件批流出现 jinnang 窗(种子 419)",
        45000,
      );
      // 被询问者视角:god-view [1] → 自己可见
      expect(jinnangWindowOf(b)?.queriedSeats, "被询问者见[自己]").toEqual([guestSeat]);
      // 非被询问席视角:同一窗到达 host 帧(同批广播),询问集必须全匿——真实座位
      // (0/1/2)一个都不许出现;数量保留(闭窗算术依赖)
      await waitForCond(
        () => jinnangWindowOf(a) != null,
        "host 事件批流出现同一 jinnang 窗",
        20000,
      );
      const hostQueried = jinnangWindowOf(a)?.queriedSeats ?? [];
      expect(hostQueried.length, "数量保留(闭窗算术依赖)").toBe(1);
      expect(hostQueried, "host 视角全匿名").toEqual([-1]);
      expect(a.errors, "host 零 error 下行").toEqual([]);
      expect(b.errors, "guest 零 error 下行").toEqual([]);
    } finally {
      await teardownDuo(duo, hostToken);
    }
  }, 90000);

  it("场景十二 整局骑局:全 bot 代打局经零故障代理从开局骑到 gameOver,双端事件与终局摘要面一致", async () => {
    // #1181(ADR-0055「承认的取舍」整局边界条收口):此前 11 场景只骑中段,本例
    // 从开局骑到 gameOver。座位构成:座位 2/3 真 bot(E2E_BOT_STEP_MS=0 即时代打),
    // 座位 0/1 真人(host/guest)——createRoom 硬规则「host(Seat 0)必须是真人」
    // (room.ts),纯 bot 座位房不存在;双真人座开局各托管一次(ADR-0028 单一开关),
    // 此后四座全为服务器代打,对局推进零人类输入。墙钟主项因此是双真人座的托管单节拍
    // 2s/拍(core/timings 单源,#927 统一原则无分档),bot 座位零节拍。地图/目标价:
    // zhongyuan 8 城小盘 + target=6000(地图顶层 30000 的短目标,ADR-0055「短目标价
    // 做代理内整局」候选落地;yanzhou 夹具图不经服务器地图清单,不可用于真 spawn 通
    // 路),seed 3001 钉骰流(种子哨兵口径:终局回合/胜者随骰流,骰流变更先红,处置
    // 走重钓配方)。实测整局 ~31s/8 轮(2026-11-07 探路标定)。
    const duo = await startTwoHumanGame({
      seats: 4,
      bot: "2,3",
      seed: 3001,
      mapId: "zhongyuan",
      target: 6000,
    });
    const { roomId, hostToken, guestToken, guestSeat, a, b, proxyA, proxyB } = duo;
    try {
      // 双端托管生效后对局自走(回读三律:setAutoPilotEchoed 帧位后缀扫描)
      await setAutoPilotEchoed(a, 0, true);
      await setAutoPilotEchoed(b, guestSeat, true);

      // 中段延迟扰动(「带故障骑到终局」):开局托管首冲是一波 bot/托管连锁帧,
      // 等首冲落定后双代理同挂 50ms/帧,再等 2 个 turnStarted(2s/拍节拍下 ≈4s+
      // 带故障窗)撤除;撤除前后 relayed 计数差 >0 证故障窗内确有帧经代理转发
      // (转发计数在延迟睡眠之后落账,fault-proxy.forward 单源)。
      await waitTurnStartedBeyond(a, countTurnStarted(a), 60000, "托管首冲推进");
      const relayedAtArm = proxyA.getStats().relayed.toClient;
      const relayedAtArmB = proxyB.getStats().relayed.toClient;
      proxyA.setLatencyMs(50);
      proxyB.setLatencyMs(50);
      await waitTurnStartedBeyond(a, countTurnStarted(a) + 1, 60000, "带 50ms 延迟推进");
      proxyA.setLatencyMs(0);
      proxyB.setLatencyMs(0);
      expect(proxyA.getStats().relayed.toClient, "A 延迟窗内有帧经代理转发").toBeGreaterThan(
        relayedAtArm,
      );
      expect(proxyB.getStats().relayed.toClient, "B 延迟窗内有帧经代理转发").toBeGreaterThan(
        relayedAtArmB,
      );

      // 骑到终局:双端各在事件批流里收到 gameOver(事件时刻戳单源引擎,同批广播
      // 必同值;超时=骑局失败,当场响亮)
      await waitForCond(() => gameOverEventOf(a) != null, "A 收 gameOver 事件", 90000);
      await waitForCond(() => gameOverEventOf(b) != null, "B 收 gameOver 事件", 10000);
      const ga = gameOverEventOf(a)!;
      const gb = gameOverEventOf(b)!;
      expect(gb.seat, "双端 gameOver 主体(胜者座位)一致").toBe(ga.seat);
      expect(gb.reason, "双端 gameOver 判据一致").toBe(ga.reason);
      expect(ga.reason, "整局骑完非作废(reason≠aborted)").not.toBe("aborted");

      // 断言面(与零故障基线同口径):(round,turn) 非降 + 零 error 下行
      assertOrderedDownlink(a, "骑局 A");
      assertOrderedDownlink(b, "骑局 B");
      expect(a.errors, "骑局 A 零 error 下行").toEqual([]);
      expect(b.errors, "骑局 B 零 error 下行").toEqual([]);
      // 整局帧量经代理搬运(哑管道不是空壳)
      expect(proxyA.getStats().relayed.toClient, "A 下行有帧").toBeGreaterThan(0);
      expect(proxyA.getStats().relayed.toServer, "A 上行有帧").toBeGreaterThan(0);
      expect(proxyB.getStats().relayed.toClient, "B 下行有帧").toBeGreaterThan(0);
      expect(proxyB.getStats().relayed.toServer, "B 上行有帧").toBeGreaterThan(0);

      // 终局状态面(isOver/winner 面一致):gameOver 档位 must-fold(event-tiers
      // 单源),无校准快照随行,客户端快照停在终局前——双端各以原座位重连(ADR-0005
      // token 唯一凭证),首帧整房摘要即终局面;两份摘要 + gameOver 事件 subject
      // 三方对账。
      const a2 = await OnlineClient.connect(wsUrl(proxyA.port, roomId, 0, hostToken));
      const b2 = await OnlineClient.connect(wsUrl(proxyB.port, roomId, guestSeat, guestToken));
      const sa = (await a2.next(5000, "A 重连终局摘要")) as SnapshotMsg;
      const sb = (await b2.next(5000, "B 重连终局摘要")) as SnapshotMsg;
      expect(sa.phase, "A 摘要终局相位").toBe("GameOver");
      expect(sb.phase, "B 摘要终局相位").toBe("GameOver");
      expect(sa.isOver, "A 摘要 isOver 面").toBe(true);
      expect(sb.isOver, "B 摘要 isOver 面").toBe(true);
      expect(sa.winner, "双端 winner 面一致").toBe(sb.winner);
      // 类型对齐(bun:test toBe 按实际侧定型,跨型即红):reason 从 string 事件侧起比
      // (VictoryReason 可赋给 string);winner 快照面带 null,已由上行 isOver 断言
      // 收紧事实,`!` 为文件既有惯用法(gameOverEventOf(a)! 同款)——断言仍逐值比对,
      // 不变量若破当场红,零静默。
      expect(ga.reason, "摘要判据与事件 reason 对账").toBe(sa.winReason);
      expect(sa.players[ga.seat]?.id, "胜者=gameOver 主体座位").toBe(sa.winner!);
      expect(sb.players[ga.seat]?.id, "B 侧同座对账").toBe(sb.winner!);

      // 收尾:对局已终,房仍须解散(服务器侧停驱动+释放)。连接拓扑:重连后 a2/b2
      // 才是座位表里的在册 socket(server open 处理器 set 覆盖,a/b 成孤儿——同样
      // 取代关系让 dismiss 前两座位始终在线,transferHostIfNeeded 不触发,hostToken
      // 解散权不旁落);dismissed 只达在册的 a2/b2,孤儿 a/b 客户端侧优雅关。
      const dismissed = await post("/room/dismiss", { roomId, seatToken: hostToken });
      expect(dismissed.ok).toBe(true);
      await a2.waitFor((m) => m.type === "dismissed", "A2 收解散通知", 5000);
      await b2.waitFor((m) => m.type === "dismissed", "B2 收解散通知", 5000);
      await a2.waitClosed(5000);
      await b2.waitClosed(5000);
      a.close();
      b.close();
      await a.waitClosed(5000);
      await b.waitClosed(5000);
    } finally {
      proxyA.stop();
      proxyB.stop();
    }
  }, 120000);
});

// ──────────────────────────── 测试本地帮手 ────────────────────────────

/** 终局事件提取(事件批流归档里找 gameOver;骑局终局的等待谓词与双端对账口)。
 *  返回面收窄到断言用的四字段;gameOver 恒带主体座位(胜者;aborted 时=派发主体,
 *  game-events GameOverBody 头注),GameEventBase 的 number|null 在此 kind 恒为
 *  number——收窄随 kind 语义,非兜底。 */
function gameOverEventOf(
  c: OnlineClient,
): { seat: number; reason: string; round: number; turn: number } | undefined {
  const ev = c.batches.flatMap((batch) => batch.events).find((e) => e.kind === "gameOver");
  return ev
    ? { seat: ev.seat as number, reason: ev.reason, round: ev.round, turn: ev.turn }
    : undefined;
}

/** 双真人座对局基建(棒二场景三/六/七/八/九/十/十一/十二共用):建房(缺省 2 座无 bot,
 *  可带种子/国号/bot 档/目标价/地图)→ 选图开局 → 双客户端各经独立零故障代理连入 →
 *  (缺省)双端选都 → 等 Playing。返回句柄与代理,收尾用 teardownDuo。 */
async function startTwoHumanGame(
  opts: {
    /** 代理启动后、建连前的旋钮预挂(如延迟档)。 */
    armProxy?: (p: FaultProxy) => void;
    /** 是否在本帮手内驱动双端选都(缺省 true;场景九要掉线,免选)。 */
    picks?: boolean;
    /** 座位数(缺省 2;种子局 3 座 bot2;整局骑局 4 座 bot=2,3)。 */
    seats?: number;
    /** bot 座位(CSV 座位号,如 "2" 或 "2,3")。 */
    bot?: string;
    /** 房间种子(种子局口径:逐字对齐原 spec)。 */
    seed?: number;
    /** host 预设国号(种子局口径:进骰流,一字不差)。 */
    guohao?: string;
    /** 目标身价(缺省随地图顶层;整局骑局用短目标压墙钟,ADR-0055 候选落地)。 */
    target?: number;
    /** 地图(缺省 guanzhong;整局骑局用 zhongyuan 8 城小盘)。 */
    mapId?: string;
  } = {},
): Promise<{
  roomId: string;
  hostToken: string;
  guestToken: string;
  guestSeat: number;
  a: OnlineClient;
  b: OnlineClient;
  proxyA: FaultProxy;
  proxyB: FaultProxy;
}> {
  const proxyA = FaultProxy.start({ targetOrigin: WS_ORIGIN });
  const proxyB = FaultProxy.start({ targetOrigin: WS_ORIGIN });
  opts.armProxy?.(proxyA);
  opts.armProxy?.(proxyB);
  const created = await post("/room/new", {
    seats: opts.seats ?? 2,
    ...(opts.bot != null ? { bot: opts.bot } : {}),
    ...(opts.seed != null ? { seed: opts.seed } : {}),
    ...(opts.guohao != null ? { guohao: opts.guohao } : {}),
    ...(opts.target != null ? { target: opts.target } : {}),
  });
  expect(created.ok).toBe(true);
  const roomId = created.roomId as string;
  const hostToken = created.seatToken as string;
  const joined = await post("/room/join", { roomId });
  expect(joined.ok).toBe(true);
  const guestSeat = joined.seat as number;
  const guestToken = joined.seatToken as string;
  await post("/room/map", { roomId, seatToken: hostToken, mapId: opts.mapId ?? "guanzhong" });
  await post("/room/start", { roomId, seatToken: hostToken });
  const a = await OnlineClient.connect(wsUrl(proxyA.port, roomId, 0, hostToken));
  const b = await OnlineClient.connect(wsUrl(proxyB.port, roomId, guestSeat, guestToken));
  if (opts.picks !== false) {
    await Promise.all([drivePickCapital(a, 0), drivePickCapital(b, guestSeat)]);
    await a.waitSnapshot((s) => s.phase === "Playing", "A 侧进 Playing", 15000);
    await b.waitSnapshot((s) => s.phase === "Playing", "B 侧进 Playing", 15000);
  }
  return { roomId, hostToken, guestToken, guestSeat, a, b, proxyA, proxyB };
}

/** 对局收尾:解散房间(房主权柄)→ 双端收 dismissed 且连接关闭。连接已被断掉重连的
 *  用例(场景四/五/九自收尾)不经过此帮手。 */
async function teardownDuo(
  duo: { roomId: string; a: OnlineClient; b: OnlineClient },
  hostToken: string,
): Promise<void> {
  const dismissed = await post("/room/dismiss", { roomId: duo.roomId, seatToken: hostToken });
  expect(dismissed.ok).toBe(true);
  await duo.a.waitFor((m) => m.type === "dismissed", "A 收解散通知", 5000);
  await duo.b.waitFor((m) => m.type === "dismissed", "B 收解散通知", 5000);
  await duo.a.waitClosed(5000);
  await duo.b.waitClosed(5000);
}

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

/** 等客户端累计 turnStarted 超过 baseline(「撤除故障后续推/收回后恢复」的证据;
 *  已有存量的客户端用它,不用等不到的 minCount 口径)。超时当场抛。 */
async function waitTurnStartedBeyond(
  c: OnlineClient,
  baseline: number,
  timeoutMs: number,
  desc: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (countTurnStarted(c) > baseline) return;
    const left = deadline - Date.now();
    if (left <= 0) {
      throw new Error(
        `回合推进超时:${desc}(等 turnStarted 超过 ${baseline},实收 ${countTurnStarted(c)};` +
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

/** 指定座位的 turnStarted 计数(turnStarted 的 subject=新活跃玩家,冻结门定位用)。 */
function countTurnStartedOfSeat(c: OnlineClient, seat: number): number {
  return c.batches.reduce(
    (n, batch) =>
      n + batch.events.filter((e) => e.kind === "turnStarted" && e.seat === seat).length,
    0,
  );
}

/** 等指定座位的新 turnStarted 到达(超出 baseline;「轮到谁了」的确定性门——存量
 *  不算,只认收回/杀连之后的新事件)。超时当场抛。 */
async function waitTurnStartedOfSeatBeyond(
  c: OnlineClient,
  seat: number,
  baseline: number,
  timeoutMs: number,
  desc: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (countTurnStartedOfSeat(c, seat) > baseline) return;
    const left = deadline - Date.now();
    if (left <= 0) {
      const errs = c.errors.length > 0 ? `;error 下行:${c.errors.join(" | ")}` : "";
      throw new Error(
        `回合门等待超时:${desc}(等座位 ${seat} 的 turnStarted 超过 ${baseline},` +
          `实收 ${countTurnStartedOfSeat(c, seat)};事件批 ${c.batches.length} 个${errs})`,
      );
    }
    await c.waitEventBatch(desc, left);
  }
}

/** 冻结断言(滚动静默窗,确定性):quietMs 内零新 turnStarted = 推进已停。权威语义
 *  下唯一未受控人类的决策门是推进唯一钥匙;无决策回合会空转数轮才停在首个含决策的
 *  回合,静默起点不预设,滚动扫描兜住。quietMs 必须大于游戏运转时的最大 turnStarted
 *  间隔(托管 2s/拍 × 每回合 2-3 拍 + bot 即时 ≈ 6-10s/回合,12s 是裕量档);horizon
 *  观察域内不停 = 响亮违约(冻结语义被破坏)。连接中断 = 断言前提塌了,当场抛(不把
 *  断线误判成冻结)。停点位置不在本帮手断言——由调用方用后续摘要(decisionOwner)/
 *  恢复推进(等的是谁的输入)钉死。 */
async function waitForFreeze(
  c: OnlineClient,
  quietMs: number,
  horizonMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + horizonMs;
  let lastCount = countTurnStarted(c);
  let lastChange = Date.now();
  for (;;) {
    const quietFor = Date.now() - lastChange;
    if (quietFor >= quietMs) return;
    if (Date.now() > deadline) {
      throw new Error(
        `${label} 冻结违约:观察域 ${horizonMs}ms 内推进未停(turnStarted 已达 ${countTurnStarted(c)})`,
      );
    }
    const left = Math.max(Math.min(deadline - Date.now(), quietMs - quietFor), 1);
    try {
      await c.waitEventBatch(`${label} 冻结观察窗`, left);
    } catch {
      if (c.isClosed) throw new Error(`${label} 冻结断言期间连接中断,前提塌了(非冻结证据)`);
      continue; // 等待超时 = 本段静默,回循环头判窗
    }
    if (countTurnStarted(c) > lastCount) {
      lastCount = countTurnStarted(c);
      lastChange = Date.now();
    }
  }
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

/** 轮询等待任意条件成立(事件批流已入归档、无需再等帧的场景;50ms 步进)。 */
async function waitForCond(pred: () => boolean, desc: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (pred()) return;
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`条件等待超时:${desc}`);
    await Bun.sleep(50);
  }
}

/** 按序下行断言:批非空、每事件带首部(kind/seat/round/turn),拼接后 (round, turn)
 *  非降(事件时刻戳随引擎单调)。 */
function assertOrderedDownlink(c: OnlineClient, label: string): void {
  expect(c.batches.length, `${label} 收到事件批`).toBeGreaterThanOrEqual(2);
  let prevRound = -1;
  let prevTurn = -1;
  for (const batch of c.batches) {
    expect(batch.events.length, `${label} 空事件批`).toBeGreaterThan(0);
    for (const ev of batch.events) {
      expect(typeof ev.kind, `${label} 事件 kind`).toBe("string");
      expect(ev.seat === null || typeof ev.seat === "number", `${label} 事件 seat`).toBe(true);
      expect(typeof ev.round, `${label} 事件 round`).toBe("number");
      expect(typeof ev.turn, `${label} 事件 turn`).toBe("number");
      const nonDecreasing = ev.round > prevRound || (ev.round === prevRound && ev.turn >= prevTurn);
      expect(nonDecreasing, `${label} 事件时刻戳 (round,turn)=(${ev.round},${ev.turn}) 非降`).toBe(
        true,
      );
      prevRound = ev.round;
      prevTurn = ev.turn;
    }
  }
}

// ──────────────────────────── 下行形状审计(校准快照判定,react-online-cutover 镜像)────────────────────────────
/** 校准快照判定(口径与 scripts/server.ts CALIBRATION_* 一致):开局 Setup 全程 /
 *  节点批(gameStarted·playerBankrupt)/ 决策窗五相位与反应窗停留 / 校准兜底批
 *  (#430 档位表 fold ∈ {fold+calibration, calibration-only} 的 kind)。其余
 *  snapshot = 逐步快照(违例)。 */
const CALIBRATION_EVENT_KINDS = new Set(["gameStarted", "playerBankrupt"]);
const CALIBRATION_BACKED_KINDS: ReadonlySet<string> = new Set(
  Object.entries(EVENT_TIERS)
    .filter(([, tier]) => tier.fold === "fold+calibration" || tier.fold === "calibration-only")
    .map(([kind]) => kind),
);
const CALIBRATION_WINDOWS = new Set([
  "AwaitingJinnang",
  "AwaitingHeroPick",
  "AwaitingEncounter",
  "AwaitingExhaustion",
  "AwaitingBankruptcySettle",
  "AwaitingReaction",
]);
function isCalibrationSnapshot(msg: {
  phase?: string;
  turnPhase?: string | null;
  events?: unknown;
}): boolean {
  const events = Array.isArray(msg.events) ? (msg.events as { kind: string }[]) : [];
  return (
    msg.phase === "Setup" ||
    CALIBRATION_WINDOWS.has(msg.turnPhase ?? "") ||
    events.length === 0 ||
    events.some((ev) => CALIBRATION_EVENT_KINDS.has(ev.kind)) ||
    events.some((ev) => CALIBRATION_BACKED_KINDS.has(ev.kind))
  );
}

// ──────────────────────────── 保密口径断言(react-online-secrecy 镜像)────────────────────────────
/** 保密口径断言(对单端全部帧):快照他人手牌恒空/牌库恒空只剩数量;事件批 jinnang 窗
 *  queriedSeats ⊆ {自己座位, 匿名占位}。selfSeat 之外的任何真实座位号都是违例。 */
function expectFramesRedacted(
  frames: OnlineClient["frames"],
  selfSeat: number,
  label: string,
): void {
  let snapshots = 0;
  let eventBatches = 0;
  for (const m of frames) {
    if (m.type === "snapshot") {
      snapshots++;
      const snap = m as unknown as {
        phase?: string;
        players?: { jinnangHand: string[] }[];
        jinnangDeck?: string[];
        jinnangDeckCount?: number;
      };
      expect(snap.players, `${label} 快照携带座位表`).toBeTruthy();
      snap.players!.forEach((p, i) => {
        if (i !== selfSeat) {
          expect(p.jinnangHand, `${label} 座位 ${i} 手牌对座位 ${selfSeat} 不可见`).toEqual([]);
        }
      });
      expect(snap.jinnangDeck, `${label} 牌库牌序不可见(只剩数量)`).toEqual([]);
      // 牌库在开局洗序(finishSetup,全员定都后)才存在:选都期快照 count=0 是
      // 「牌库还没有」,不是泄漏——数量保密断言只对 Playing 快照有意义
      if (snap.phase === "Playing") expect(snap.jinnangDeckCount ?? 0).toBeGreaterThan(0);
    }
    if (m.type === "events") {
      eventBatches++;
      const batch = m as unknown as {
        events?: { kind: string; windowKind?: string; queriedSeats?: number[] }[];
      };
      for (const ev of batch.events ?? []) {
        if (ev.kind === "reactionOpened" && ev.windowKind === "jinnang") {
          for (const s of ev.queriedSeats ?? []) {
            expect(
              s === selfSeat || s === -1,
              `${label} 询问集座位 ${s} 对座位 ${selfSeat} 必须匿名(只许自己或 -1 占位)`,
            ).toBe(true);
          }
        }
      }
    }
  }
  expect(snapshots, `${label} 至少收到一份整房摘要`).toBeGreaterThanOrEqual(1);
  expect(eventBatches, `${label} 驱动窗内至少收到一批事件(断言非空性)`).toBeGreaterThanOrEqual(1);
}

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
