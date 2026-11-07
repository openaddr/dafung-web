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

// ── 确定性源码闸(#1206,形制学 vera20k architecture_guards.rs「determinism guards
// pin the engine files that read platform- or process-dependent values」):src/core 是
// 权威引擎,将来上服务器必须逐位确定性——时钟/随机/环境读取只许经显式注入(seed/时钟
// 走参数),偷读平台/进程依赖值源码级钉死。ADR-0052 的事后比对(两跑逐位一致/黄金台账)
// 只能等红再查,本闸是事前拦截层:已知非确定源的模式族直接禁入扫描面。与逐行红线同款
// 口径:剥注释后扫——禁的是「使用」,注释提及不算;不走 .core-purity-baseline.json,
// 冻结清单就是确定性面的存量台账(登记动作 = 改本文件的评审变更,update 不掩)。
const DETERMINISM_PATTERNS: [RegExp, string][] = [
  [/\bDate\.now\b/, "Date.now"],
  [/\bnew\s+Date\s*\(/, "new Date("],
  [/\bDate\.parse\b/, "Date.parse"],
  [/\bperformance\.now\b/, "performance.now"],
  [/\bMath\.random\b/, "Math.random"],
  [/\bcrypto\.getRandomValues\b/, "crypto.getRandomValues"],
  [/\bcrypto\.randomUUID\b/, "crypto.randomUUID"],
  [/\bprocess\.env\b/, "process.env"],
  [/\bprocess\.platform\b/, "process.platform"],
  [/\bprocess\.cwd\b/, "process.cwd"],
  [/\blocalStorage\b/, "localStorage"],
  [/\bsessionStorage\b/, "sessionStorage"],
  [/\bnavigator\b/, "navigator"],
  [/\bsetTimeout\b/, "setTimeout"],
  [/\bsetInterval\b/, "setInterval"],
  [/\bimport\.meta\.dir\b/, "import.meta.dir"],
  [/\bBun\.file\b/, "Bun.file"],
  [/\breaddirSync\b/, "readdirSync"],
];
// 冻结例外清单(file 级 → 放行模式集):**只准缩不准长**——新模式命中必先答「引擎为何
// 要读平台/进程依赖值」,确属合法时钟/随机面才来此登记并写理由(行内注释即评审记录);
// 条目不再命中 = 存量已清偿,必须同步删条目(stale 检查红提示收紧)。
const DETERMINISM_FREEZE: Record<string, string[]> = {
  // gameId 生成(Date.now+Math.random:实例身份唯一性契约,种子化会让同 seed 房间撞名,
  // ADR-0052 判词)+ startedAt/log ts 墙钟展示戳——无头层 chainLogHash 剥 ts+header
  // (ADR-0052),均非引擎逻辑输入。
  "src/core/authority.ts": ["Date.now", "Math.random"],
  // seed 缺省回退(Math.random)= 无种子本地起局的随机来源,产物记进局头 seed 字段
  // 可重放;联机路径必传 seed(ADR-0052 判词)。
  "src/core/dice.ts": ["Math.random"],
  // ADR-0022 权威侧扩展装载器,bun/node 启动期环境读取,非引擎逻辑面;目录序已显式
  // 字典序排序钉死(消费方仅 scripts/server.ts 装载与 test/,浏览器禁入)。
  "src/core/extension-loader.ts": ["readdirSync"],
};

interface Violation {
  rule: string;
  rel: string;
  line: number;
  text: string;
  message: string;
}

const violations: Violation[] = [];
const detViolations: Violation[] = []; // 确定性闸违规:硬红不进 baseline(冻结清单即台账)
const detHits = new Set<string>(); // 已命中的 "rel:label"(含冻结放行),stale 检查原料
let files = 0;

// ── 壳纪律(#325,ADR-0019 定形):src/core/authority.ts 是引擎权威壳(原 game.ts),
// 与上面逐行红线同场执行的三条结构断言,违规即退出 1:
//  1. shell-line-cap:行数上限锁。#325 定形时壳实为 1349 行(超原目标 900),按票面口径
//     取「当前行数向上取整到 50」= 1350 锁死;后续治理票只减不增,逐票把实际行数压回
//     900 内后再把锁同步收紧。本条是三条中唯一有「存量」形态的:文件可能早已超锁
//     (#858 治理台账),故走基线数值(.core-purity-baseline.json 的 shellLineCapOver
//     字段)——红只对「比已登记存量更肥」的新增;压回锁内后跑 baseline:update 清条目。
//  2. shell-single-class:壳只许 export class GameEngine 一个类声明——防新机制域长回
//     壳里自成一类(域逻辑的去处是独立域模块,ADR-0019 委托式拆分)。不走 baseline——
//     布尔型结构违规是「现在坏了」,没有存量可登记。
//  3. shell-no-free-fn:自由函数定义只许来自 import——壳内不得落地 function 声明
//     (含 export function/async function);数据常量(CMD_BRIEF 等)与 interface/type
//     不受限(#326 types 解散另管)。#325 已把壳内最后一个自由函数 newGameId 内联进构造器。
//     同 2,不走 baseline。
const SHELL_REL = "src/core/authority.ts";
const SHELL_LINE_CAP = 1350; // #325 定形锁(1349 → ceil50);只减不增,压回 900 后同步收紧

const shellViolations: Violation[] = []; // 布尔型结构违规(single-class/no-free-fn):当场红,无存量形态
let shellLineCapViolation: Violation | null = null; // 行数锁:唯一可登记存量的壳断言
let shellLineCount = 0;
{
  const shellFull = await Bun.file(`${ROOT}/authority.ts`).text();
  const rawLines = shellFull.split("\n");
  shellLineCount = shellFull.endsWith("\n") ? rawLines.length - 1 : rawLines.length;
  // 行数锁的存量基线(#858 实录:壳在治理票落地前早已超锁,门禁逐票假红逼人重审)。
  // 基线文件不存在 = 未登记存量,有效锁 = SHELL_LINE_CAP;损坏则让 JSON 错误抛出来。
  const baselineFileEarly = Bun.file(BASELINE);
  const baselineEarly = (await baselineFileEarly.exists()) ? await baselineFileEarly.json() : {};
  const shellLineCapOver: number | undefined = baselineEarly.shellLineCapOver;
  const effectiveCap = Math.max(SHELL_LINE_CAP, shellLineCapOver ?? 0);
  if (shellLineCount > effectiveCap)
    shellLineCapViolation = {
      rule: "shell-line-cap",
      rel: SHELL_REL,
      line: shellLineCount,
      text: `${shellLineCount} 行`,
      message:
        `壳行数 ${shellLineCount} 超上限锁 ${SHELL_LINE_CAP},且超已登记存量 ${shellLineCapOver ?? "无"}(#325 定形锁:只减不增;` +
        `确属验收时点存量先跑 bun run check:core:baseline:update 登记)`,
    };
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
  // 确定性闸扫描面不含测试文件(测试自身可吃时钟/随机造语料)。
  const detScan = !path.endsWith(".test.ts");
  const frozenLabels = DETERMINISM_FREEZE[rel];
  const detSeen = new Set<string>(); // 同行同模式去重
  lines.forEach((line, i) => {
    const text = line.trim();
    const push = (rule: string, message: string) =>
      violations.push({ rule, rel, line: i + 1, text, message });
    if (FORBIDDEN_IMPORT.test(line)) push("app-import", "core 引入 app 层");
    if (FORBIDDEN_REACT.test(line)) push("react-import", "core 引入 react");
    if (FORBIDDEN_IS_LOCAL.test(line)) push("is-local", "player-agnostic 红线(isLocal)");
    const g = FORBIDDEN_GLOBAL.exec(line);
    if (g) push("dom-global", `core 使用 DOM 全局 ${g[1]}`);
    if (!detScan) return;
    for (const [re, label] of DETERMINISM_PATTERNS) {
      if (!re.test(line) || detSeen.has(`${i}:${label}`)) continue;
      detSeen.add(`${i}:${label}`);
      detHits.add(`${rel}:${label}`);
      if (frozenLabels?.includes(label)) continue;
      detViolations.push({
        rule: "determinism",
        rel,
        line: i + 1,
        text,
        message:
          `确定性闸:core 读取 ${label}(时钟/随机/环境面必须显式注入);` +
          "确属合法面 → scripts/check-core-purity.ts DETERMINISM_FREEZE 登记并写理由(只准缩不准长)",
      });
    }
  });
}

// 冻结条目 stale 检查(收紧行,vera20k「stale exceptions → delete the entry」同款):
// 登记的 file:pattern 已零命中 = 存量清偿,条目必须同步删——与新增违规同场红。
for (const [rel, labels] of Object.entries(DETERMINISM_FREEZE)) {
  for (const label of labels) {
    if (detHits.has(`${rel}:${label}`)) continue;
    detViolations.push({
      rule: "determinism-stale",
      rel,
      line: 1,
      text: `${label} 于 ${rel} 已零命中`,
      message: "确定性闸:冻结条目存量已清偿,删 DETERMINISM_FREEZE 条目收紧清单(只准缩)",
    });
  }
}

// 指纹不带行号(行号必漂移);同文件同规则同文本视为同一处,重复出现会被去重登记。
const fingerprint = (v: Violation) => `${v.rule}:${v.rel}:${v.text}`;
const updateBaseline = process.argv[2] === "baseline:update";

// ── 壳纪律先行:shell-single-class/shell-no-free-fn 布尔型结构违规不可登记进 baseline
// (update 模式也不能掩),坏了当场红;shell-line-cap 有存量形态,进下方基线判定。
if (shellViolations.length > 0) {
  console.error(`core 壳纪律(#325): authority.ts 结构违规 ${shellViolations.length} 处\n`);
  for (const v of shellViolations) console.error(`  ${v.rel}:${v.line}  ${v.message}:${v.text}`);
  process.exit(1);
}

// ── 确定性源码闸(#1206)先行:违规与 stale 条目都是「现在坏了」,布尔型不可登记
// (update 模式也不掩),当场红。
if (detViolations.length > 0) {
  console.error(`core 确定性源码闸(#1206): 时钟/随机/环境读取违规 ${detViolations.length} 处\n`);
  for (const v of detViolations) console.error(`  ${v.rel}:${v.line}  ${v.message}:${v.text}`);
  process.exit(1);
}

if (updateBaseline) {
  const seen = new Map<string, Violation>();
  for (const v of violations) if (!seen.has(fingerprint(v))) seen.set(fingerprint(v), v);
  // 行数锁存量同场登记:超锁才记数,压回锁内即清字段(#858 治理票收尾顺手清)。
  const shellLineCapOver = shellLineCount > SHELL_LINE_CAP ? shellLineCount : undefined;
  await Bun.write(
    BASELINE,
    JSON.stringify(
      {
        ...(shellLineCapOver != null ? { shellLineCapOver } : {}),
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
  console.log(
    `baseline updated: ${seen.size} violations` +
      (shellLineCapOver != null ? ` + 壳超锁存量 ${shellLineCapOver} 行` : "") +
      " → .core-purity-baseline.json",
  );
  process.exit(0);
}

// 基线文件不存在 = 空基线(语义如此,非兜底);存在但损坏则让 JSON 错误抛出来。
const baselineFile = Bun.file(BASELINE);
const baseline = (
  (await baselineFile.exists()) ? await baselineFile.json() : { violations: [] }
) as {
  shellLineCapOver?: number;
  violations: { fingerprint: string }[];
};
const baselinePrints = new Set(baseline.violations.map((v) => v.fingerprint));
const fresh = violations.filter((v) => !baselinePrints.has(fingerprint(v)));
const staleCount = violations.length - fresh.length;
// 行数锁存量注脚(#858 台账):超锁但已登记=绿着欠债,债额留在输出里防淡忘。
const shellDebt =
  shellLineCount > SHELL_LINE_CAP
    ? `;壳 ${SHELL_REL} ${shellLineCount} 行超锁 ${SHELL_LINE_CAP}(存量 ${baseline.shellLineCapOver ?? "?"} 已登记,#858 治理台账)`
    : `;壳 ${SHELL_REL} ${shellLineCount}/${SHELL_LINE_CAP} 行(只减不增)`;

if (fresh.length > 0) {
  console.error(
    `core 纯度门禁: 新增 ${fresh.length} 处违规(AGENTS.md 架构红线 #1/#2;存量已登记 ${staleCount} 处)\n`,
  );
  for (const v of fresh) console.error(`  ${v.rel}:${v.line}  ${v.message}:${v.text}`);
  process.exit(1);
}
// 行数锁新增(超出已登记存量)= 新债,与纯度新增同责同红。
if (shellLineCapViolation != null) {
  console.error("core 壳纪律(#325): 壳行数超已登记存量\n");
  console.error(
    `  ${shellLineCapViolation.rel}:${shellLineCapViolation.line}  ${shellLineCapViolation.message}:${shellLineCapViolation.text}`,
  );
  process.exit(1);
}
// 确定性闸 OK 注脚:让「本闸在场」与冻结例外规模常驻门槛输出(清单只准缩,长了看得见)。
const detNote = `;确定性源码闸 OK(模式 ${DETERMINISM_PATTERNS.length} 族,冻结例外 ${Object.values(DETERMINISM_FREEZE).flat().length} 条)`;
if (staleCount > 0) {
  console.log(
    `core 纯度 OK(新增零违规):${files} 个文件;存量 ${staleCount} 处已登记于 .core-purity-baseline.json,修复后记得清对应条目${shellDebt}${detNote}`,
  );
} else {
  console.log(`core 纯度 OK: ${files} 个文件,零 app/DOM/player 依赖${shellDebt}${detNote}`);
}
