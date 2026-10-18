// 开工基线新鲜度检查(2026-09-26,学自 ZCode scripts/check-workspace-freshness.mjs):
// 当前分支落后自己的远端、或落后 origin/master 超阈值时失败——防止在旧基线上
// 分析、写测试、修已经消失的问题(worktree 多票并行时最容易踩)。
// 2026-10-11 retro 收紧(#446 两误报复盘):落后 master 的默认阈值 50→10,且「领先+落后」
// 的特性分支从警告升级为失败(显式 --allow-behind 豁免)——审计取证的 file:line 对基线
// 漂移零容忍,警告级提示会被「命令退出 0」掩盖;另加冲突标记扫描(#462 事故防复发)。
// 2026-10-15 jj 化(#533,配合项目 jj 单路径):git 调用面整体退役,主树(colocated)
// 与 jj workspace(无 .git)同一套代码。旧四件套映射与取舍:
//   - `git fetch origin --prune` → `jj git fetch`:默认远端即 origin;--prune 无对应
//     也不需要——jj 远端书签是远端状态的镜像,远端删掉的书签 fetch 后本地同步消失,
//     prune 语义天然内含。fetch 失败仍=红(网络断刻意失败语义不变)。
//   - `rev-parse @{upstream}` → 书签存在性探测 `jj log -r '<书签>@origin'`(exit code
//     即答案,等价旧 --verify --quiet)。jj 没有 per-branch upstream 配置,「自己的
//     upstream」改锚定为 @ 的最近书签祖先(`heads(::@ & bookmarks())`)上的本地书签,
//     逐个比对其 `@origin` 对应物。顺带修复:git 版在 colocated 主树里 git HEAD 恒
//     detached、rule 2 永远走「跳过」分支形同虚设;锚点化后此检查真正生效。
//     注意(0.45 实测,#537 试点):jj fetch **不会**自动快进本地书签——纯「落后」要
//     bookmark move(或 rebase -d master@origin)自愈;rule 2 拦截的正是「落后」与
//     「书签与远端分叉(非 ff)」两类状态。
//   - `rev-list --left-right --count` → revset 计数(`jj log --no-graph` 逐 commit 数行)。
//     位置用 @ 本身而非书签位置,ahead 计数一律 `~empty()` 排除 jj 空工作副本提交,
//     否则空 @ 的 ahead+1 会把「纯过期」(ahead==0)误判成「有意分叉」。
//   - `git grep -l -I -E 冲突标记` → `jj file list` × 逐文件扫描:保留「跳过二进制」
//     语义(内容含 NUL 即按二进制跳过,-I 等价);扫描集=jj 跟踪集(@ 树,含未提交
//     新文件,天然跳过 gitignore 的 tmp/、node_modules)。工作副本里的冲突标记本该
//     被抓到——特性不是噪音(零兜底)。
//
// 判定规则:
//   0) 主树占用:当前工作区是主树(colocated 有 .git)且 @ 非空 = 有并行会话留活——
//      此时开工或收口都会把别人的活卷进自己的操作(2026-10-17 书签三度污染 +
//      2026-10-18 收口在主树 jj new master 切走并行工作副本两次)。红 = 一切修改走
//      workspace(AGENTS.md 版本协作);在 jj workspace 里跑则跳过(已隔离,主树
//      占用与己无关)。
//   1) fetch 失败 → 失败:网络不通时结论不可信;修网络,或显式 --no-fetch 用本地引用
//      (离线 deliberately,会打提示)。
//   2) 落后锚点书签自己的 @origin(任何数量)→ 失败:先 jj git fetch,再
//      jj bookmark move <书签> --to <书签>@origin(ff 时)或把当前线 rebase 到其上。
//   3) ahead==0 且落后 origin/master 超阈值 → 失败:本地 master 类分支纯过期。
//   4) ahead>0 且落后 origin/master 超阈值 → 失败:落后超阈值的分叉基线上取证/开工,
//      行号与结论都会失真;确属有意分叉的施工分支加 --allow-behind 显式豁免(仍打印差值)。
//   5) jj 跟踪文件含未解冲突标记(行首 `<<<<<<< `/`>>>>>>> `)→ 失败:冲突标记入库
//      会污染所有下游读取方(#462 实锤;只查外对,规避 md setext 分隔线误报)。
//
// 用法:bun scripts/check-freshness.ts [--max-behind-master 10] [--no-fetch] [--allow-behind]

import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const maxBehind = Number(flag("--max-behind-master") ?? 10);
if (!Number.isInteger(maxBehind) || maxBehind < 0) {
  console.error("[freshness] --max-behind-master 需要一个非负整数");
  process.exit(2);
}
const doFetch = !args.includes("--no-fetch");
const allowBehind = args.includes("--allow-behind");

function jj(...jjArgs: string[]): string {
  const proc = Bun.spawnSync(["jj", ...jjArgs], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    const err = new Error(
      `jj ${jjArgs.join(" ")} 失败:${new TextDecoder().decode(proc.stderr).trim()}`,
    );
    (err as Error & { code?: string }).code = "JJ_FAIL";
    throw err;
  }
  return new TextDecoder().decode(proc.stdout).trim();
}

// revset 存在性探测:对应旧 rev-parse --verify --quiet(书签不存在 → exit≠0)
function revExists(rev: string): boolean {
  return (
    Bun.spawnSync(["jj", "log", "-r", rev, "--no-graph", "-T", "commit_id"], {
      stdout: "pipe",
      stderr: "pipe",
    }).exitCode === 0
  );
}

// revset 计数:每 commit 一行;空集输出为空(实测 exit 0,不是错)
function countRev(rev: string): number {
  const out = jj("log", "-r", rev, "--no-graph", "-T", 'commit_id ++ "\\n"');
  return out === "" ? 0 : out.split("\n").length;
}

const head = jj("log", "-r", "@", "--no-graph", "-T", "commit_id");

// 位置锚:@ 的最近书签祖先(含 @ 自身)上的本地书签名。空集(当前线全无书签,
// 如 detached 的新 workspace)→ 空数组,upstream 检查随之跳过。
// 冲突书签在模板里渲染 `?`/`*` 后缀(git ref 名本就不含这两个字符,剥离安全)——
// 不剥会污染 `${书签}@origin` 探测,恰好漏掉 rule 2 最该拦的「书签与远端分叉」。
const anchorNames = jj(
  "log",
  "-r",
  "heads(::@ & bookmarks())",
  "--no-graph",
  "-T",
  'local_bookmarks ++ "\\n"',
)
  .split("\n")
  .flatMap((line) => line.split(/\s+/))
  .map((name) => name.replace(/[?*]+$/, ""))
  .filter(Boolean);
const label = anchorNames.length > 0 ? anchorNames.join("/") : "(无书签)";

if (doFetch) {
  const fetch = Bun.spawnSync(["jj", "git", "fetch"], {
    stdout: "inherit",
    stderr: "pipe",
  });
  if (fetch.exitCode !== 0) {
    console.error(`[freshness] jj git fetch 失败:${new TextDecoder().decode(fetch.stderr).trim()}`);
    console.error(
      "[freshness] 网络不通时新鲜度结论不可信:修好网络重跑;确认离线工作请加 --no-fetch",
    );
    process.exit(2);
  }
} else {
  console.log("[freshness] --no-fetch:用本地引用判定(可能过期)");
}

const failures: string[] = [];

// rule 0:主树占用(见判定规则 0;workspace 内无 .git 天然跳过)
if (existsSync(".git")) {
  if (jj("log", "-r", "@", "--no-graph", "-T", "empty") === "false") {
    const statLines = jj("diff", "--stat").split("\n").filter(Boolean);
    failures.push(
      `主树 @ 非空(${statLines[statLines.length - 1]})——有并行会话留活,一切修改走 ` +
        `workspace:jj workspace add ../dafung-web-ws-<代号>(AGENTS.md 版本协作);` +
        `收账/收口的 jj new master 也到自己 workspace 跑`,
    );
  }
}

// rule 2:锚点书签逐个比对 @origin 对应物,任何落后都红
if (anchorNames.length > 0) {
  const withRemote = anchorNames.filter((b) => revExists(`${b}@origin`));
  if (withRemote.length > 0) {
    for (const b of withRemote) {
      const behind = countRev(`::(${b}@origin) & ~::@`);
      const ahead = countRev(`::@ & ~::(${b}@origin) & ~empty()`);
      if (behind > 0) {
        failures.push(
          `落后自己的 upstream ${b}@origin ${behind} 个提交(ahead ${ahead})——先 jj git fetch,再 jj bookmark move ${b} --to ${b}@origin(ff 时)或把当前线 rebase 到其上`,
        );
      }
    }
  } else {
    console.log(
      `[freshness] ${label} 没有远端对应书签,跳过 upstream 检查(是否忘了 jj git push --bookmark?)`,
    );
  }
} else {
  console.log("[freshness] 当前线没有书签锚点,跳过 upstream 检查");
}

// rule 3/4:对 origin/master 的分叉判定(ahead 排除空工作副本提交)
const aheadMain = countRev(`::@ & ~::(master@origin) & ~empty()`);
const behindMain = countRev(`::(master@origin) & ~::@`);
if (behindMain > 0) {
  console.log(`[freshness] 与 origin/master 的分叉:ahead ${aheadMain} / behind ${behindMain}`);
}
if (behindMain > maxBehind) {
  if (aheadMain === 0) {
    failures.push(`本地领先 0、落后 origin/master ${behindMain} 个提交——纯过期分支,禁止开工`);
  } else if (allowBehind) {
    console.warn(
      `[freshness] ⚠ --allow-behind 豁免:落后 origin/master ${behindMain} 个提交(ahead ${aheadMain})——审计取证类工作不要用这个豁免`,
    );
  } else {
    failures.push(
      `落后 origin/master ${behindMain} 个提交(ahead ${aheadMain})——旧基线上的行号与结论不可信;先同步,确属有意分叉加 --allow-behind`,
    );
  }
}

// rule 5:冲突标记扫描(只查外对 `<<<<<<< `/`>>>>>>> `,行首+空格,规避 md setext
// `======` 误报);二进制文件(内容含 NUL)跳过
const conflicted: string[] = [];
for (const file of jj("file", "list").split("\n").filter(Boolean)) {
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  if (/^(<<<<<<< |>>>>>>> )/m.test(bytes.toString())) conflicted.push(file);
}
if (conflicted.length > 0) {
  conflicted.sort();
  failures.push(`以下文件含未解冲突标记(污染所有下游读取方,见 #462):\n${conflicted.join("\n")}`);
}

if (failures.length > 0) {
  console.error(`[freshness] 基线过期,先同步再开工(${head.slice(0, 9)}):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`[freshness] OK:${label} @ ${head.slice(0, 9)} 对齐基线`);
