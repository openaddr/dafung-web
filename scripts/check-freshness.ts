// 开工基线新鲜度检查(2026-09-26,学自 ZCode scripts/check-workspace-freshness.mjs):
// 当前分支落后自己的远端、或落后 origin/master 超阈值时失败——防止在旧基线上
// 分析、写测试、修已经消失的问题(worktree 多票并行时最容易踩)。
// 2026-10-11 retro 收紧(#446 两误报复盘):落后 master 的默认阈值 50→10,且「领先+落后」
// 的特性分支从警告升级为失败(显式 --allow-behind 豁免)——审计取证的 file:line 对基线
// 漂移零容忍,警告级提示会被「命令退出 0」掩盖;另加冲突标记扫描(#462 事故防复发)。
//
// 判定规则:
//   1) fetch 失败 → 失败:网络不通时结论不可信;修网络,或显式 --no-fetch 用本地引用
//      (离线 deliberately,会打提示)。
//   2) 落后自己的 upstream(任何数量)→ 失败:先 git merge --ff-only <upstream>。
//   3) ahead==0 且落后 origin/master 超阈值 → 失败:本地 master 类分支纯过期。
//   4) ahead>0 且落后 origin/master 超阈值 → 失败:落后超阈值的分叉基线上取证/开工,
//      行号与结论都会失真;确属有意分叉的施工分支加 --allow-behind 显式豁免(仍打印差值)。
//   5) 已跟踪文件含未解冲突标记(行首 `<<<<<<< `/`>>>>>>> `)→ 失败:冲突标记入库
//      会污染所有下游读取方(#462 实锤;只查外对,规避 md setext 分隔线误报)。
//
// 用法:bun scripts/check-freshness.ts [--max-behind-master 10] [--no-fetch] [--allow-behind]

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

async function git(...gitArgs: string[]): Promise<string> {
  const proc = Bun.spawnSync(["git", ...gitArgs], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    const err = new Error(
      `git ${gitArgs.join(" ")} 失败:${new TextDecoder().decode(proc.stderr).trim()}`,
    );
    (err as Error & { code?: string }).code = "GIT_FAIL";
    throw err;
  }
  return new TextDecoder().decode(proc.stdout).trim();
}

const head = await git("rev-parse", "HEAD");
const branch = await git("rev-parse", "--abbrev-ref", "HEAD");

if (doFetch) {
  const fetch = Bun.spawnSync(["git", "fetch", "origin", "--prune"], {
    stdout: "inherit",
    stderr: "pipe",
  });
  if (fetch.exitCode !== 0) {
    console.error(`[freshness] git fetch 失败:${new TextDecoder().decode(fetch.stderr).trim()}`);
    console.error(
      "[freshness] 网络不通时新鲜度结论不可信:修好网络重跑;确认离线工作请加 --no-fetch",
    );
    process.exit(2);
  }
} else {
  console.log("[freshness] --no-fetch:用本地引用判定(可能过期)");
}

// upstream 存在性独立探测:没有 upstream(如未 push -u 的新分支、detached)只警告跳过。
const hasUpstream =
  Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", "@{upstream}"]).exitCode === 0;

const failures: string[] = [];
if (hasUpstream) {
  const [ahead, behind] = (await git("rev-list", "--left-right", "--count", "HEAD...@{upstream}"))
    .split("\t")
    .map(Number);
  if (behind > 0) {
    failures.push(
      `落后自己的 upstream ${behind} 个提交(ahead ${ahead})——先 git merge --ff-only @{upstream}`,
    );
  }
} else {
  console.log(
    `[freshness] ${branch === "HEAD" ? "(detached)" : branch} 没有远端跟踪分支,跳过 upstream 检查(是否忘了 push -u?)`,
  );
}

const [aheadMain, behindMain] = (
  await git("rev-list", "--left-right", "--count", "HEAD...origin/master")
)
  .split("\t")
  .map(Number);
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

// 冲突标记扫描(只查外对 `<<<<<<< `/`>>>>>>> `,行首+空格,规避 md setext `======` 误报)。
// git grep 退出码:0=有命中,1=无命中(常态),其他=出错——不走上方会抛错的 git() 助手。
const grepProc = Bun.spawnSync(
  ["git", "grep", "-l", "-I", "-E", "^(<<<<<<< |>>>>>>> )", "--", "."],
  { stdout: "pipe", stderr: "pipe" },
);
if (grepProc.exitCode !== 0 && grepProc.exitCode !== 1) {
  console.error(
    `[freshness] 冲突标记扫描失败:${new TextDecoder().decode(grepProc.stderr).trim()}`,
  );
  process.exit(2);
}
const conflicted = new TextDecoder().decode(grepProc.stdout).trim();
if (conflicted.length > 0) {
  failures.push(`以下文件含未解冲突标记(污染所有下游读取方,见 #462):\n${conflicted}`);
}

if (failures.length > 0) {
  console.error(`[freshness] 基线过期,先同步再开工(${head.slice(0, 9)}):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `[freshness] OK:${branch === "HEAD" ? "(detached)" : branch} @ ${head.slice(0, 9)} 对齐基线`,
);

// 顶层 await 要求本文件是 module
export {};
