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

// ── 壳纪律(#325,ADR-0019 定形):src/core/authority.ts 是引擎权威壳(原 game.ts),
// 与上面逐行红线同场执行的三条结构断言,违规即退出 1(不走 baseline 指纹——结构违规
// 是「现在坏了」,没有存量可登记):
//  1. shell-line-cap:行数上限锁。#325 定形时壳实为 1349 行(超原目标 900),按票面口径
//     取「当前行数向上取整到 50」= 1350 锁死;后续治理票只减不增,逐票把实际行数压回
//     900 内后再把锁同步收紧。
//  2. shell-single-class:壳只许 export class GameEngine 一个类声明——防新机制域长回
//     壳里自成一类(域逻辑的去处是独立域模块,ADR-0019 委托式拆分)。
//  3. shell-no-free-fn:自由函数定义只许来自 import——壳内不得落地 function 声明
//     (含 export function/async function);数据常量(CMD_BRIEF 等)与 interface/type
//     不受限(#326 types 解散另管)。#325 已把壳内最后一个自由函数 newGameId 内联进构造器。
const SHELL_REL = "src/core/authority.ts";
const SHELL_LINE_CAP = 1350; // #325 定形锁(1349 → ceil50);只减不增,压回 900 后同步收紧

const shellViolations: Violation[] = [];
let shellLineCount = 0;
{
  const shellFull = await Bun.file(`${ROOT}/authority.ts`).text();
  const rawLines = shellFull.split("\n");
  shellLineCount = shellFull.endsWith("\n") ? rawLines.length - 1 : rawLines.length;
  if (shellLineCount > SHELL_LINE_CAP)
    shellViolations.push({
      rule: "shell-line-cap",
      rel: SHELL_REL,
      line: shellLineCount,
      text: `${shellLineCount} 行`,
      message: `壳行数 ${shellLineCount} 超上限锁 ${SHELL_LINE_CAP}(#325 定形锁:只减不增)`,
    });
  // 与逐行红线同款剥注释再扫——断言禁的是「声明」,文档注释提及不算。
  const shellCode = shellFull.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const classNames = [...shellCode.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const isSingleGameEngine =
    classNames.length === 1 &&
    classNames[0] === "GameEngine" &&
    /^export class GameEngine/m.test(shellCode);
  if (!isSingleGameEngine)
    shellViolations.push({
      rule: "shell-single-class",
      rel: SHELL_REL,
      line: 1,
      text: `class ${classNames.join(", class ") || "(无)"}`,
      message: `壳只许 export class GameEngine 一个类声明(实见 ${classNames.length} 个)`,
    });
  for (const m of shellCode.matchAll(
    /(?:^|\n)[ \t]*(export\s+)?(default\s+)?(async\s+)?function\s+[A-Za-z_$][\w$]*/g,
  )) {
    const lineNo = shellCode.slice(0, m.index).split("\n").length; // 剥注释后行号,定位够用
    shellViolations.push({
      rule: "shell-no-free-fn",
      rel: SHELL_REL,
      line: lineNo,
      text: m[0].trim(),
      message: "壳内自由函数定义(自由函数只许来自 import;辅助函数应归所在域模块)",
    });
  }
}

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

// 壳纪律先行:结构违规不可登记进 baseline(update 模式也不能掩),坏了当场红。
if (shellViolations.length > 0) {
  console.error(`core 壳纪律(#325): authority.ts 结构违规 ${shellViolations.length} 处\n`);
  for (const v of shellViolations) console.error(`  ${v.rel}:${v.line}  ${v.message}:${v.text}`);
  process.exit(1);
}

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
    `core 纯度 OK(新增零违规):${files} 个文件;存量 ${staleCount} 处已登记于 .core-purity-baseline.json,修复后记得清对应条目;壳 ${SHELL_REL} ${shellLineCount}/${SHELL_LINE_CAP} 行(只减不增)`,
  );
} else {
  console.log(
    `core 纯度 OK: ${files} 个文件,零 app/DOM/player 依赖;壳 ${SHELL_REL} ${shellLineCount}/${SHELL_LINE_CAP} 行(只减不增)`,
  );
}
