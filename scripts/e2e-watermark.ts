// e2e 环境水位探针(单源,消费方 e2e/global-setup.ts 开跑+收尾两行、scripts/e2e-one.ts
// 入口前置闸)。2026-10-29 retro 立观测(#734 会话 CPU 97% 满载烧 ~35min 归因才定位);
// 2026-11-01 #958 会话复盘立判读(#1003):负载期(收尾 CPU=100%)同 spec 盲跑 3 轮挂例
// 谱漂移,2 轮纯浪费——纪律「开跑即读水位」挡不住,阈值判读接机械闸。
import { execFileSync } from "node:child_process";

export interface Watermark {
  /** CPU 利用率百分比;非 win32 为 null,Windows 解析失败抛错。 */
  cpu: number | null;
  /** 原始 node 总量与工具代理单列,便于真实 OS 探针盘点。 */
  text: string;
  processes: { bun: number; node: number; broker: number; msedge: number } | null;
}

/** OS 进程清单的外显计数接缝:仅同时命中两条 Codex CUA 脚本的 node 单列为代理。
 *  其余 node(含无法读取 CommandLine 的进程)全部计入负载,不放行泛用 server.mjs。 */
export function classifyWatermark(cpu: unknown, processes: unknown): Watermark {
  if (
    typeof cpu !== "number" ||
    !Number.isFinite(cpu) ||
    cpu < 0 ||
    cpu > 100 ||
    !Array.isArray(processes)
  ) {
    throw new Error("[e2e-watermark] OS 水位结构异常,拒绝按零负载继续");
  }
  const counts = { bun: 0, node: 0, broker: 0, msedge: 0 };
  for (const process of processes) {
    if (
      typeof process !== "object" ||
      process === null ||
      typeof process.Name !== "string" ||
      !(typeof process.CommandLine === "string" || process.CommandLine === null)
    ) {
      throw new Error("[e2e-watermark] OS 进程记录异常,拒绝按零负载继续");
    }
    switch (process.Name.toLowerCase()) {
      case "bun.exe":
        counts.bun++;
        break;
      case "msedge.exe":
        counts.msedge++;
        break;
      case "node.exe":
        counts.node++;
        if (
          process.CommandLine !== null &&
          /(?:^|[\\/])require-browser-access\.mjs(?:\s|["']|$)/i.test(process.CommandLine) &&
          /(?:^|[\\/])cua-repl\.mjs(?:\s|["']|$)/i.test(process.CommandLine)
        )
          counts.broker++;
        break;
      default:
        throw new Error(`[e2e-watermark] 探针返回未声明进程:${process.Name}`);
    }
  }
  return {
    cpu,
    processes: counts,
    text: `cpu=${cpu}% bun=${counts.bun} msedge=${counts.msedge} node=${counts.node} broker=${counts.broker} nodeLoad=${counts.node - counts.broker}`,
  };
}

/** 进程水位硬闸(#1280):bun+非代理 node ≥28 拒绝开跑,CPU 警告另走 advisory。 */
export function assertWatermark(watermark: Watermark): void {
  if (watermark.processes === null) return; // 非 win32 无 OS 探针,明确打印跳过。
  const { bun, node, broker } = watermark.processes;
  if (bun + node - broker >= 28) {
    throw new Error(
      `[e2e-one] ⛔ 水位闸:并行会话水位过高(bun=${bun}+nodeLoad=${node - broker}≥28;raw node=${node},broker=${broker}),等其收尾或协调后重跑;进程/调度水位假挂指纹见 #1280。`,
    );
  }
}

/** win32 一行水位(cpu% + node/bun/msedge 进程计数);其余平台打印跳过说明。 */
export function probeWatermark(): Watermark {
  if (process.platform !== "win32")
    return { cpu: null, processes: null, text: "非 win32,探针跳过" };
  const ps =
    "$ErrorActionPreference='Stop'; " +
    "$cpu=(Get-CimInstance Win32_Processor | Select-Object -First 1).LoadPercentage; " +
    "$p=@(Get-CimInstance Win32_Process -Filter \"name='node.exe' OR name='bun.exe' OR name='msedge.exe'\" | Select-Object Name,CommandLine); " +
    "@{cpu=$cpu;processes=$p} | ConvertTo-Json -Compress -Depth 3";
  const result = JSON.parse(
    execFileSync("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true }).toString(),
  );
  return classifyWatermark(result.cpu, result.processes);
}

/** 满载阈值:开跑 ≥80% 判「负载期」(实测竞速事故档 97-100%;80 以下历史无假挂聚集)。 */
const LOADED_CPU_THRESHOLD = 80;

/** 开跑水位前置闸(#1003):打印水位行;CPU ≥ 阈值红字警告(advisory 不拦跑——
 *  负载≠必挂,拦跑会把「等窗口」变成硬失败;但警告必须一眼撞见,挂例谱按过载族读)。 */
export function warnIfLoaded(where: string): Watermark {
  const w = probeWatermark();
  console.log(`[${where}] 开跑水位:${w.text}`);
  if (w.cpu != null && w.cpu >= LOADED_CPU_THRESHOLD) {
    console.error(
      `[${where}] ⚠ CPU ${w.cpu}% 满载=负载期:挂例大概率竞速散布无关 spec(#734/#958 两案实锤),` +
        `先 A/B 基线定性(jj workspace add ../dafung-web-ws-ab -r master@origin 对跑)或延后跑;` +
        `仍要跑请把挂例按过载族读,别逐例排查。`,
    );
  }
  return w;
}
