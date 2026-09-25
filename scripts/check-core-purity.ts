// core 纯度门禁(2026-09-25,学自 ZCode architecture-policy.yaml 的缩样版):
// AGENTS.md 架构红线 #1(core 零 DOM/零 app 依赖)与 #2(player-agnostic)从
// 「评审自觉」变「可执行检查」——CI check job 与本地随手跑,违规列文件行号退出 1。
// 口径:先剥注释(块+行)再扫描——红线禁的是「使用」,文档/注释提及不算;
// 字符串里恰好长成 document./window. 的概率为零兜底原则下的可接受噪声,出现再议。
//
// Baseline 指纹机制(2026-09-26,学自 ZCode .architecture-baseline.json):
// 给有历史的代码库上新规则时,存量违规按指纹登记进 .core-purity-baseline.json,
// 只对「新增」违规红——新规则零阻力引入,存量按台账逐步清偿。指纹 = 规则:文件:
// 行文本(不带行号,行号必漂移)。当前基线为零,文件尚不存在=空基线,需要时:
//   bun run check:core:baseline:update   # 把当下全部违规登记为存量
import { Glob } from "bun";

const ROOT = `${import.meta.dir}/../src/core`;
const BASELINE = `${import.meta.dir}/../.core-purity-baseline.json`;
const FORBIDDEN_IMPORT = /from\s+["'](@app\/|\.\.\/app\/|\.\/\.\.\/app\/)/;
const FORBIDDEN_GLOBAL =
  /\b(document|window|localStorage|navigator|requestAnimationFrame|cancelAnimationFrame)\s*[.((]/;
const FORBIDDEN_REACT = /from\s+["']react["']/;
const FORBIDDEN_IS_LOCAL = /\bisLocal\b/;

interface Violation {
  rule: string;
  rel: string;
  line: number;
  text: string;
  message: string;
}

const violations: Violation[] = [];
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
    const text = line.trim();
    const push = (rule: string, message: string) =>
      violations.push({ rule, rel, line: i + 1, text, message });
    if (FORBIDDEN_IMPORT.test(line)) push("app-import", "core 引入 app 层");
    if (FORBIDDEN_REACT.test(line)) push("react-import", "core 引入 react");
    if (FORBIDDEN_IS_LOCAL.test(line)) push("is-local", "player-agnostic 红线(isLocal)");
    const g = FORBIDDEN_GLOBAL.exec(line);
    if (g) push("dom-global", `core 使用 DOM 全局 ${g[1]}`);
  });
}

// 指纹不带行号(行号必漂移);同文件同规则同文本视为同一处,重复出现会被去重登记。
const fingerprint = (v: Violation) => `${v.rule}:${v.rel}:${v.text}`;
const updateBaseline = process.argv[2] === "baseline:update";

if (updateBaseline) {
  const seen = new Map<string, Violation>();
  for (const v of violations) if (!seen.has(fingerprint(v))) seen.set(fingerprint(v), v);
  await Bun.write(
    BASELINE,
    JSON.stringify(
      {
        violations: [...seen.values()].map((v) => ({
          fingerprint: fingerprint(v),
          where: `${v.rel}`,
          message: v.message,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`baseline updated: ${seen.size} violations → .core-purity-baseline.json`);
  process.exit(0);
}

// 基线文件不存在 = 空基线(语义如此,非兜底);存在但损坏则让 JSON 错误抛出来。
const baselineFile = Bun.file(BASELINE);
const baseline = (
  (await baselineFile.exists()) ? await baselineFile.json() : { violations: [] }
) as {
  violations: { fingerprint: string }[];
};
const baselinePrints = new Set(baseline.violations.map((v) => v.fingerprint));
const fresh = violations.filter((v) => !baselinePrints.has(fingerprint(v)));
const staleCount = violations.length - fresh.length;

if (fresh.length > 0) {
  console.error(
    `core 纯度门禁: 新增 ${fresh.length} 处违规(AGENTS.md 架构红线 #1/#2;存量已登记 ${staleCount} 处)\n`,
  );
  for (const v of fresh) console.error(`  ${v.rel}:${v.line}  ${v.message}:${v.text}`);
  process.exit(1);
}
if (staleCount > 0) {
  console.log(
    `core 纯度 OK(新增零违规):${files} 个文件;存量 ${staleCount} 处已登记于 .core-purity-baseline.json,修复后记得清对应条目`,
  );
} else {
  console.log(`core 纯度 OK: ${files} 个文件,零 app/DOM/player 依赖`);
}
