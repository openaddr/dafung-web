// 双端对跑的父端句柄。Bun 1.3.14 Worker 终止仍为实验 API,用可等待退出的子进程。
import { join } from "node:path";
import type {
  DualClientObservation,
  DualClientOperation,
  DualClientRequest,
  DualClientResponse,
} from "./dual-client-observation";

interface PendingRead {
  resolve(observation: DualClientObservation): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class DualClientProcess {
  private readonly child;
  private readonly stderr: Promise<string>;
  private readonly pending = new Map<number, PendingRead>();
  private nextId = 0;
  private last: DualClientObservation | null = null;

  constructor(
    private readonly label: string,
    serverBase: string,
  ) {
    this.child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "dual-client-runtime.ts"), serverBase],
      {
        cwd: join(import.meta.dir, "..", ".."),
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
        ipc: (response: DualClientResponse) => {
          const pending = this.pending.get(response.id);
          if (pending === undefined)
            throw new Error(`${this.label}:收到未知请求 ${response.id} 的回包`);
          this.pending.delete(response.id);
          clearTimeout(pending.timer);
          if (response.ok) {
            this.last = response.observation;
            pending.resolve(response.observation);
          } else pending.reject(new Error(`${this.label}:${response.error}`));
        },
      },
    );
    this.stderr = new Response(this.child.stderr).text();
    void this.child.exited.then(async (code) => {
      const stderr = await this.stderr;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`${this.label}:子进程提前退出(code=${code})\n${stderr}`));
      }
      this.pending.clear();
    });
  }

  request(operation: DualClientOperation): Promise<DualClientObservation> {
    if (this.child.exitCode !== null)
      return Promise.reject(new Error(`${this.label}:子进程已退出(code=${this.child.exitCode})`));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`${this.label}:IPC ${operation.kind} 超时(5s)\n${JSON.stringify(this.last)}`),
        );
      }, 5_000);
      this.pending.set(id, { resolve, reject, timer });
      const request: DualClientRequest = { id, operation };
      try {
        this.child.send(request);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`${this.label}:IPC ${operation.kind} 发送失败:${String(error)}`));
      }
    });
  }

  observe(): Promise<DualClientObservation> {
    return this.request({ kind: "observe" });
  }

  private async waitForExit(): Promise<number> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.child.exited,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${this.label}:关闭后子进程未在5s内退出`)),
            5_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    try {
      if (this.child.exitCode === null) {
        await this.request({ kind: "reset" });
        this.child.disconnect();
      }
      const code = await this.waitForExit();
      if (code !== 0) throw new Error(`${this.label}:子进程退出码 ${code}\n${await this.stderr}`);
    } finally {
      // 仅终止本句柄刚拉起的子进程,失败清理不留 WS/重连计时器/IPC 孤儿。
      if (this.child.exitCode === null) {
        this.child.kill();
        await this.waitForExit();
      }
    }
  }
}
