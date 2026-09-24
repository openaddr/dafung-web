// core 纯度门禁(2026-09-25,学自 ZCode architecture-policy.yaml 的缩样版):
// AGENTS.md 架构红线 #1(core 零 DOM/零 app 依赖)与 #2(player-agnostic)从
// 「评审自觉」变「可执行检查」——CI check job 与本地随手跑,违规列文件行号退出 1。
// 口径:先剥注释(块+行)再扫描——红线禁的是「使用」,文档/注释提及不算;
// 字符串里恰好长成 document./window. 的概率为零兜底原则下的可接受噪声,出现再议。
import { Glob } from "bun";

const ROOT = `${import.meta.dir}/../src/core`;
const FORBIDDEN_IMPORT = /from\s+["'](@app\/|\.\.\/app\/|\.\/\.\.\/app\/)/;
const FORBIDDEN_GLOBAL = /\b(document|window|localStorage|navigator|requestAnimationFrame|cancelAnimationFrame)\s*[.((]/;
const FORBIDDEN_REACT = /from\s+["']react["']/;
const FORBIDDEN_IS_LOCAL = /\bisLocal\b/;

const violations: string[] = [];
let files = 0;

for (const path of new Glob("**/*.{ts,tsx}").scanSync({ cwd: ROOT })) {
  files++;
  const full = `${ROOT}/${path}`;
  const src = await Bun.file(full).text();
  // 剥注释:块注释(非贪婪,跨行)→ 行注释;不追求词法级精确,门禁够用即可。
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const lines = code.split("\n");
  const rel = `src/core/${path}`;
  lines.forEach((line, i) => {
    const n = `${rel}:${i + 1}`;
    if (FORBIDDEN_IMPORT.test(line)) violations.push(`${n}  core 引入 app 层:${line.trim()}`);
    if (FORBIDDEN_REACT.test(line)) violations.push(`${n}  core 引入 react:${line.trim()}`);
    if (FORBIDDEN_IS_LOCAL.test(line)) violations.push(`${n}  player-agnostic 红线(isLocal):${line.trim()}`);
    const g = FORBIDDEN_GLOBAL.exec(line);
    if (g) violations.push(`${n}  core 使用 DOM 全局 ${g[1]}:${line.trim()}`);
  });
}

if (violations.length > 0) {
  console.error(`core 纯度门禁: ${violations.length} 处违规(AGENTS.md 架构红线 #1/#2)\n`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log(`core 纯度 OK: ${files} 个文件,零 app/DOM/player 依赖`);
