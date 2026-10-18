// PR 收口一键(2026-10-16 retro,#552 报废事故防复发):
// 书签 → push → 开 PR → **带号** squash 合并 → 验证 MERGED → 才删远端分支 → 清本地书签。
// 顺序本身就是护栏,封死三条已实锤的手工事故链:
//   - gh pr merge 裸跑(不带 PR 号)在 jj 主树必炸「not on any branch」(detached HEAD)——脚本内部从 create 的 URL 提取号。
//   - 远端 head 分支在合并确认前被删 = GitHub 自动关闭 PR 且不可重开(#552 实锤)——删分支排在校验之后。
//   - 远端分支删除与 jj 远端账本不同步,删后同名书签 `jj git push` 报「Nothing changed」拒推——换名书签重开,
//     本脚本管不到历史账本,但保证新收口不再产生这种残局。
//   - 并行会话落票把 master 推前,DIRTY 拖到合并才暴露 = 回溯重定基——push 前强制 check:freshness(红即停)。
// 用法:bun scripts/pr-merge.ts <书签名> [--title "<标题>"] [--body-file <路径>] [--create-only]
//   <书签名> 须已在本地存在且已 `jj describe`(空描述直接红,交付纪律=描述即标题);
//   --create-only 只 push+开 PR,不合并不删分支(派单代理交付用,主线 QC 后再全链收口)。
// 仓库定位:主树与书签分支内 gh 自动识别;jj workspace 无 .git,自动补 `-R openaddr/dafung-web`。

function jj(...args: string[]): string {
  const proc = Bun.spawnSync(["jj", ...args], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    console.error(
      `[pr-merge] jj ${args.join(" ")} 失败:${new TextDecoder().decode(proc.stderr).trim()}`,
    );
    process.exit(1);
  }
  return new TextDecoder().decode(proc.stdout).trim();
}

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const repoFlag: string[] = (() => {
  const inside = Bun.spawnSync(["git", "rev-parse", "--is-inside-work-tree"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return inside.exitCode === 0 && new TextDecoder().decode(inside.stdout).trim() === "true"
    ? []
    : ["-R", "openaddr/dafung-web"];
})();

function gh(...args: string[]): string {
  const proc = Bun.spawnSync(["gh", ...repoFlag, ...args], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    console.error(
      `[pr-merge] gh ${args.join(" ")} 失败:${new TextDecoder().decode(proc.stderr).trim()}`,
    );
    process.exit(1);
  }
  return new TextDecoder().decode(proc.stdout).trim();
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const bookmark = args.find((a) => !a.startsWith("--"));
const createOnly = args.includes("--create-only");
if (!bookmark || bookmark.startsWith("-")) {
  console.error(
    "[pr-merge] 用法:bun scripts/pr-merge.ts <书签名> [--title ...] [--body-file <路径>] [--create-only]",
  );
  process.exit(2);
}

// 1) 书签在本地且已描述(空描述=未交付,红)
const description = jj("log", "-r", bookmark, "--no-graph", "-T", "description.first_line()");
if (!description) {
  console.error(`[pr-merge] 书签 ${bookmark} 的 change 没有描述——先 jj describe(交付纪律)。`);
  process.exit(1);
}
const title = flag("--title") ?? description;

// 1.5) push 前新鲜度门(2026-10-18 retro:并行落票期 DIRTY 拖到合并才被 GitHub 告知,
// 回溯重定基冤枉半小时;红即停,刻意带旧基线收口走手动链 + check:freshness --allow-behind)
const freshness = Bun.spawnSync(["bun", "scripts/check-freshness.ts"], {
  stdout: "inherit",
  stderr: "inherit",
});
if (freshness.exitCode !== 0) {
  console.error("[pr-merge] check:freshness 红——master 已被并行会话推进,先重定基再收口。");
  process.exit(1);
}

// 2) push(幂等:已推过=exit 0)
jj("git", "push", "--bookmark", bookmark);
console.log(`[pr-merge] 书签已推:${bookmark}`);

// 3) 开 PR(已存在则复用开着的)
let url = "";
const bodyFile = flag("--body-file");
const createArgs = ["pr", "create", "--head", bookmark, "--title", title];
if (bodyFile) {
  createArgs.push("--body-file", bodyFile);
} else {
  createArgs.push("--body", title);
}
const created = Bun.spawnSync(["gh", ...repoFlag, ...createArgs], {
  stdout: "pipe",
  stderr: "pipe",
});
if (created.exitCode === 0) {
  url = new TextDecoder().decode(created.stdout).trim();
} else {
  const existing = gh(
    "pr",
    "list",
    "--head",
    bookmark,
    "--state",
    "open",
    "--json",
    "url",
    "-q",
    ".[0].url",
  );
  if (!existing) {
    console.error(
      `[pr-merge] 开 PR 失败且无现存开着的 PR:${new TextDecoder().decode(created.stderr).trim()}`,
    );
    process.exit(1);
  }
  url = existing;
  console.log("[pr-merge] PR 已存在,复用。");
}
const prNumber = url.match(/\/pull\/(\d+)/)?.[1];
if (!prNumber) {
  console.error(`[pr-merge] 从 URL 提取 PR 号失败:${url}`);
  process.exit(1);
}
console.log(`[pr-merge] PR #${prNumber}:${url}`);

if (createOnly) {
  console.log("[pr-merge] --create-only:到此为止,合并交主线。");
  process.exit(0);
}

// 4) 带号合并 + 验证 MERGED(gh 输出会说谎——usage 报错时可能已合入;以 state 为准)
gh("pr", "merge", prNumber, "--squash");
let merged = false;
for (let i = 0; i < 5; i++) {
  const state = gh("pr", "view", prNumber, "--json", "state", "-q", ".state");
  if (state === "MERGED") {
    merged = true;
    break;
  }
  sleepSync(1000);
}
if (!merged) {
  console.error(`[pr-merge] PR #${prNumber} 合并后 state 未到 MERGED——远端分支保留,人工处置。`);
  process.exit(1);
}

// 5) 确认合入后才许删分支(时序即护栏)
Bun.spawnSync(["git", "push", "origin", "--delete", bookmark], {
  stdout: "inherit",
  stderr: "inherit",
});
const localDelete = Bun.spawnSync(["jj", "bookmark", "delete", bookmark], {
  stdout: "pipe",
  stderr: "pipe",
});
if (localDelete.exitCode !== 0) {
  console.warn(
    `[pr-merge] 本地书签 ${bookmark} 清理失败(可手动 jj bookmark delete):${new TextDecoder().decode(localDelete.stderr).trim()}`,
  );
}
console.log(
  `[pr-merge] #${prNumber} 收口完成。主线收账两步:jj git fetch → jj bookmark move master --to master@origin → jj new master`,
);
