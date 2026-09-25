// 开工基线新鲜度检查(2026-09-26,学自 ZCode scripts/check-workspace-freshness.mjs):
// 当前分支落后自己的远端、或落后 origin/master 超阈值时失败——防止在旧基线上
// 分析、写测试、修已经消失的问题(worktree 多票并行时最容易踩)。
//
// 判定规则:
//   1) fetch 失败 → 失败:网络不通时结论不可信;修网络,或显式 --no-fetch 用本地引用
//      (离线 deliberately,会打提示)。
//   2) 落后自己的 upstream(任何数量)→ 失败:先 git merge --ff-only <upstream>。
//   3) ahead==0 且落后 origin/master 超阈值 → 失败:本地 master 类分支纯过期。
//   4) ahead>0 且落后 origin/master 超阈值 → 警告不失败:特性分支分叉是正常的,
//      但数字打出来,由你决定是否 rebase(有未提交改动时不要盲目 rebase)。
//
// 用法:bun scripts/check-freshness.ts [--max-behind-master 50] [--no-fetch]

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const maxBehind = Number(flag("--max-behind-master") ?? 50);
if (!Number.isInteger(maxBehind) || maxBehind < 0) {
  console.error("[freshness] --max-behind-master 需要一个非负整数");
  process.exit(2);
}
const doFetch = !args.includes("--no-fetch");

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
if (behindMain > maxBehind) {
  if (aheadMain === 0) {
    failures.push(`本地领先 0、落后 origin/master ${behindMain} 个提交——纯过期分支,禁止开工`);
  } else {
    console.warn(
      `[freshness] ⚠ 特性分支落后 origin/master ${behindMain} 个提交(ahead ${aheadMain})——分叉正常,自行决定是否 rebase`,
    );
  }
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
