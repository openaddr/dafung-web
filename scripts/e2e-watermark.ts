// e2e 环境水位探针(单源,消费方 e2e/global-setup.ts 开跑+收尾两行、scripts/e2e-one.ts
// 入口前置闸)。2026-10-29 retro 立观测(#734 会话 CPU 97% 满载烧 ~35min 归因才定位);
// 2026-11-01 #958 会话复盘立判读(#1003):负载期(收尾 CPU=100%)同 spec 盲跑 3 轮挂例
// 谱漂移,2 轮纯浪费——纪律「开跑即读水位」挡不住,阈值判读接机械闸。
import { execSync } from "node:child_process";

export interface Watermark {
  /** CPU 利用率百分比;非 win32 或解析失败为 null(只打印原文不判读)。 */
  cpu: number | null;
  /** 原始水位行(cpu=N% bun=N msedge=N node=N 形态)。 */
  text: string;
}

/** win32 一行水位(cpu% + node/bun/msedge 进程计数);其余平台打印跳过说明。 */
export function probeWatermark(): Watermark {
  if (process.platform !== "win32") return { cpu: null, text: "非 win32,探针跳过" };
  const ps =
    "$cpu=(Get-CimInstance Win32_Processor | Select-Object -First 1).LoadPercentage; " +
    "$p=(Get-Process node,bun,msedge -ErrorAction SilentlyContinue | Group-Object ProcessName | " +
    'ForEach-Object { "$($_.Name)=$($_.Count)" }) -join " "; "cpu=$cpu% $p"';
  const text = execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`)
    .toString()
    .trim();
  const m = text.match(/cpu=(\d+)%/);
  return { cpu: m ? Number(m[1]) : null, text };
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
