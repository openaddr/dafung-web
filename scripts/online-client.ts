// 无头联机客户端(#1164 棒一):bun 原生 WebSocket 包一层协议方——connect/收下行
// 缓冲/按谓词等帧/经 wire.ts 编码上行/关连。协议级联机 e2e(棒二故障矩阵与 spec 迁移)
// 的客户端原语,替代「开浏览器才能联机」的旧通路。
//
// 与真客户端(src/app/controllers/online.ts)的边界:本客户端**不持有引擎状态裁决**
// ——权威在服务器(红线 2/3),这里没有引擎镜像、不折事件(event-fold 是应用层投影,
// 不属协议方职责);它只做三件事:
//   ① 缓冲下行帧并提供「等某类下行到达(带显式超时,超时当场抛)」的确定性等待原语
//      ——测试时序竞速零容忍,任何等待必须带明确超时与失败语义,禁裸等;
//   ② 上行只经 wire.ts 的编码单源(cmdMsg/pickCapitalMsg/autoPilotMsg),禁手拼
//      JSON 字面量绕过协议单源(wire.ts 头注契约);
//   ③ 观测面:最近一份 snapshot(重连摘要校准锚)、按到达序收集的 events 批、
//      error 下行文本、以及全量下行帧归档(frames;spec 迁移的逐帧审计用)——供测试
//      断言「按序收到下行/没有错误回报/逐帧形状合规」。
// 等待语义:waitFor 按 FIFO 扫描缓冲,命中即取出;不命中的帧**保留在缓冲**(滤过式,
// 照 server-cmd-error.test.ts 的 nextMessageOfType 先例),等待者先到先得。
import type { GameCommand } from "../src/core/authority";
import type { EventBatchMsg, ServerMsg, SnapshotMsg } from "./wire";
import { autoPilotMsg, cmdMsg, pickCapitalMsg } from "./wire";

/** 连接关闭信息(等待者与诊断用)。 */
export interface CloseInfo {
  code: number;
  reason: string;
}

/** 等待者登记:谓词 + resolve/reject + 超时句柄(超时当场抛,绝不裸等)。 */
interface Waiter {
  pred: (m: ServerMsg) => boolean;
  desc: string;
  resolve: (m: ServerMsg) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface OnlineClientOptions {
  /** 建连超时(ms);超时当场抛。缺省 5000(本机回环,常规裕量)。 */
  openTimeoutMs?: number;
}

export class OnlineClient {
  /** 最近一份 snapshot 下行(首连/重连整房摘要都会更新;重连校准锚的读取口)。 */
  snapshot: SnapshotMsg | null = null;
  /** 按到达序收集的全部 events 消息(#390 唯一对局状态通路的线级视角)。 */
  readonly batches: EventBatchMsg[] = [];
  /** 收到的 error 下行文本(协议错误回报通道;测试断言「零错误」用)。 */
  readonly errors: string[] = [];
  /** 按到达序归档的全部下行帧(棒二 spec 迁移:react-online 系列 spec 的线级
   *  framereceived 收集器对偶)。等待者消费过的帧也在此留档——下行形状审计(逐帧
   *  快照审计/保密 redaction 对账)需要完整帧流,不只是一份 latest 快照。 */
  readonly frames: ServerMsg[] = [];

  private readonly buffer: ServerMsg[] = [];
  private readonly waiters: Waiter[] = [];
  private readonly ws: WebSocket;
  private openFlag = false;
  private closedFlag = false;
  private readonly closedInternal: Promise<CloseInfo>;
  private closedInfo: CloseInfo = { code: 0, reason: "" };
  /** onClose 里 resolve(close 事件必达,该 promise 永不 reject)。 */
  private resolveClosed: (info: CloseInfo) => void = () => {};

  private constructor(
    ws: WebSocket,
    readonly url: string,
  ) {
    this.ws = ws;
    // 本构造只在 open 事件之后执行(connect 的 resolve 路径),开放态由此落定。
    this.openFlag = true;
    // 处理器在构造内同步挂上(建连 open 事件的任务里完成,先于任何后续消息任务,
    // 首帧不丢——open 摘要与后续广播之间没有可丢帧的窗口)。
    ws.addEventListener("message", (ev) => this.ingest(ev));
    ws.addEventListener("close", (ev) => this.onClose(ev));
    this.closedInternal = new Promise<CloseInfo>((resolve) => {
      // onClose 里 resolve;此处永不 reject(close 事件必达,bun WS 生命周期保证)。
      this.resolveClosed = resolve;
    });
  }

  /** 建连并等 open(open 超时/建连失败当场抛;URL 形状与直连服务器一致,可经
   *  fault-proxy 的端口,代理只透传 path+search)。 */
  static connect(url: string, options: OnlineClientOptions = {}): Promise<OnlineClient> {
    const timeoutMs = options.openTimeoutMs ?? 5000;
    const ws = new WebSocket(url);
    return new Promise<OnlineClient>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`WS 建连超时(${timeoutMs}ms):${url}`));
      }, timeoutMs);
      ws.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve(new OnlineClient(ws, url));
        },
        { once: true },
      );
      ws.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error(`WS 建连失败:${url}`));
        },
        { once: true },
      );
    });
  }

  get isOpen(): boolean {
    return this.openFlag;
  }

  get isClosed(): boolean {
    return this.closedFlag;
  }

  /** 等连接关闭(代理硬断/服务器解散后归零;超时当场抛)。 */
  async waitClosed(timeoutMs: number): Promise<CloseInfo> {
    if (this.closedFlag) return this.closedInfo;
    return await Promise.race([
      this.closedInternal,
      Bun.sleep(timeoutMs).then((): CloseInfo => {
        throw new Error(`等待连接关闭超时(${timeoutMs}ms):${this.url}`);
      }),
    ]);
  }

  /** 收下一帧(缓冲优先;无帧则等,超时当场抛)。 */
  async next(timeoutMs: number, desc = "下一帧下行"): Promise<ServerMsg> {
    const buffered = this.buffer.shift();
    if (buffered != null) return buffered;
    return await this.waitFor(() => true, desc, timeoutMs);
  }

  /** 等首个匹配谓词的下行帧(缓冲 FIFO 扫描,命中取出;不命中帧保留;等待者先到
   *  先得)。超时当场抛,错误信息带等待描述与缓冲帧型清单——失败可诊断。 */
  async waitFor<T extends ServerMsg = ServerMsg>(
    pred: (m: ServerMsg) => boolean,
    desc: string,
    timeoutMs: number,
  ): Promise<T> {
    const hit = this.buffer.findIndex(pred);
    if (hit >= 0) return this.buffer.splice(hit, 1)[0]! as T;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.timer === timer);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(
          new Error(
            `等待下行超时(${timeoutMs}ms):${desc};缓冲 ${this.buffer.length} 帧 [${frameTypes(this.buffer)}]`,
          ),
        );
      }, timeoutMs);
      this.waiters.push({
        pred,
        desc,
        resolve: (m) => resolve(m as T),
        reject,
        timer,
      });
    });
  }

  /** 等一份 snapshot 下行(可带谓词,如「轮到我选都」「Playing 已入局」)。 */
  waitSnapshot(
    pred: ((s: SnapshotMsg) => boolean) | null,
    desc: string,
    timeoutMs: number,
  ): Promise<SnapshotMsg> {
    return this.waitFor<SnapshotMsg>(
      (m) => m.type === "snapshot" && (pred == null || pred(m)),
      desc,
      timeoutMs,
    );
  }

  /** 等一份 events 事件批下行(#390 唯一对局状态通路)。 */
  waitEventBatch(desc: string, timeoutMs: number): Promise<EventBatchMsg> {
    return this.waitFor<EventBatchMsg>((m) => m.type === "events", desc, timeoutMs);
  }

  // ──────────────────────────── 上行(经 wire.ts 编码单源)────────────────────────────
  /** 对局命令(GameCommand 族;形状单源 wire.cmdMsg,禁手拼 JSON)。 */
  sendCmd(cmd: GameCommand): void {
    this.sendRaw(cmdMsg(cmd));
  }

  /** 选都落子(L41;wire.pickCapitalMsg)。 */
  sendPickCapital(tileIndex: number): void {
    this.sendRaw(pickCapitalMsg(tileIndex));
  }

  /** 自助托管开关(ADR-0028;wire.autoPilotMsg)。 */
  sendAutoPilot(on: boolean): void {
    this.sendRaw(autoPilotMsg(on));
  }

  /** 客户端主动关连(优雅挥手;硬断走 fault-proxy 的 killNow)。 */
  close(): void {
    if (this.openFlag) {
      this.openFlag = false;
      this.ws.close();
    }
  }

  private sendRaw(text: string): void {
    if (!this.openFlag) throw new Error(`连接已不在开放态,拒绝上行:${this.url}`);
    this.ws.send(text);
  }

  // ──────────────────────────── 下行泵 ────────────────────────────
  /** 一帧下行入站:形状校验(非协议形状当场炸,零兜底)→ 观测面归档 → 等待者
   *  FIFO 认领(首个命中者取走,其余继续等)→ 无人认领入缓冲。 */
  private ingest(ev: MessageEvent): void {
    const raw = ev.data;
    if (typeof raw !== "string") {
      throw new Error(`下行帧非文本(协议全文本 JSON):${String(raw).slice(0, 120)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`下行帧非 JSON:${raw.slice(0, 200)}`);
    }
    if (
      typeof parsed !== "object" ||
      parsed == null ||
      typeof (parsed as ServerMsg).type !== "string"
    ) {
      throw new Error(`下行帧非 ServerMsg 形状(缺 type 判别):${raw.slice(0, 200)}`);
    }
    const msg = parsed as ServerMsg;
    this.frames.push(msg);
    if (msg.type === "snapshot") this.snapshot = msg;
    else if (msg.type === "events") this.batches.push(msg);
    else if (msg.type === "error") this.errors.push(msg.error);
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i]!;
      if (!w.pred(msg)) continue;
      this.waiters.splice(i, 1);
      clearTimeout(w.timer);
      w.resolve(msg);
      return; // 帧被等待者消费,不入缓冲
    }
    this.buffer.push(msg);
  }

  /** close 事件:关闭态落定 + 全部在等等待者当场抛(等待的帧永远不会来了,裸等
   *  到超时只会掩盖断连事实)。 */
  private onClose(ev: CloseEvent): void {
    this.closedFlag = true;
    this.openFlag = false;
    this.closedInfo = { code: ev.code, reason: ev.reason ?? "" };
    this.resolveClosed(this.closedInfo);
    const waiters = [...this.waiters];
    this.waiters.length = 0;
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.reject(new Error(`连接已关闭,等待落空(${w.desc};close code=${ev.code}):${this.url}`));
    }
  }
}

/** 缓冲帧型清单(超时报错诊断用):按 type 计数,如 "snapshot×2, events×5"。 */
function frameTypes(buffer: ServerMsg[]): string {
  const counts = new Map<string, number>();
  for (const m of buffer) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
  return [...counts.entries()].map(([t, n]) => `${t}×${n}`).join(", ") || "空";
}
