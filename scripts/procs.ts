// 进程取证单源(2026-10-29 retro):「杀进程先验名」「e2e 过载归因」类取证的机械件。
// 列 node/bun 在册进程的 pid/启动时刻/监听端口/命令行,端口归属一眼可判(#734 会话
// 取证 21 个进程归属时,PowerShell 手工拼命令行查询被 bash 变量插值吞掉,换 netstat
// 反推多花一轮——工具化后一条命令出全量,与 global-setup 的开跑水位探针同一口径)。
// 用法:bun scripts/procs.ts [--edge]
//   --edge 附一行 msedge 进程计数概览(e2e 浏览器通道,不逐条列——子进程几十个会淹输出)。
// 仅 win32(powershell);其余平台打印说明退出。

const args = process.argv.slice(2);
const withEdge = args.includes("--edge");
if (process.platform !== "win32") {
  console.log("[procs] 仅 win32(powershell 取证),当前平台跳过。");
  process.exit(0);
}

const ps = [
  `$listeners = @{}`,
  `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object {`,
  `  $k = [int]$_.OwningProcess`,
  `  if ($listeners.ContainsKey($k)) { $listeners[$k] = "$($listeners[$k]),$($_.LocalPort)" }`,
  `  else { $listeners[$k] = "$($_.LocalPort)" }`,
  `}`,
  `Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='bun.exe'" | Sort-Object ProcessId | ForEach-Object {`,
  `  $l = $listeners[[int]$_.ProcessId]; if (-not $l) { $l = '-' }`,
  `  $c = $_.CommandLine; if (-not $c) { $c = '-' } elseif ($c.Length -gt 120) { $c = $c.Substring(0, 120) + '…' }`,
  `  "pid=$($_.ProcessId) $($_.Name.Replace('.exe', '')) start=$($_.CreationDate.ToString('HH:mm:ss')) listen=$l cmd=$c"`,
  `}`,
  withEdge
    ? `$e = (Get-Process msedge -ErrorAction SilentlyContinue | Measure-Object).Count; "msedge=$e(计数概览)"`
    : `$null`,
]
  .filter((line) => line !== `$null`)
  .join("; ");

const proc = Bun.spawnSync(["powershell", "-NoProfile", "-Command", ps], {
  stdout: "pipe",
  stderr: "pipe",
});
const out = proc.stdout.toString().trim();
if (proc.exitCode !== 0) {
  console.error(
    `[procs] powershell 取证失败(exit ${proc.exitCode}):${proc.stderr.toString().trim()}`,
  );
  process.exit(proc.exitCode ?? 1);
}
console.log(out || "[procs] 无 node/bun 进程在册。");
