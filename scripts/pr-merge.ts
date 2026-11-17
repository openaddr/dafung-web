// PR 收口:核基线与文件集 → 一次检查 → push → 开 PR → squash → 定点收账。
// 用法与恢复条件见 docs/how-to/开发与测试.md「版本协作」。
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { cleanupMerged } from "./pr-merge-cleanup";
import { checksFor } from "./pr-merge-checks";

function jjOutput(...args: string[]): string {
  const proc = Bun.spawnSync(["jj", ...args], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    console.error(
      `[pr-merge] jj ${args.join(" ")} 失败:${new TextDecoder().decode(proc.stderr).trim()}`,
    );
    process.exit(1);
  }
  return new TextDecoder().decode(proc.stdout);
}

function jj(...args: string[]): string {
  return jjOutput(...args).trim();
}

function changedPaths(output: string): string[] {
  return output
    .split("\n")
    .map((p) => p.trim().replaceAll("\\", "/"))
    .filter(Boolean)
    .sort();
}

function comparePaths(actual: string[], declared: string[]) {
  const actualSet = new Set(actual);
  const declaredSet = new Set(declared);
  return {
    extras: actual.filter((p) => !declaredSet.has(p)),
    missing: declared.filter((p) => !actualSet.has(p)),
  };
}

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const repoFlag = ["-R", "openaddr/dafung-web"];

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

const usage =
  "用法: bun scripts/pr-merge.ts <书签名> [--title 标题] [--body-file 路径] [--create-only] --expect 路径 [--expect 路径 ...]";
const parsed = (() => {
  try {
    return parseArgs({
      options: {
        help: { type: "boolean" },
        title: { type: "string" },
        "body-file": { type: "string" },
        "create-only": { type: "boolean" },
        expect: { type: "string", multiple: true },
      },
      allowPositionals: true,
    });
  } catch (error) {
    console.error(`[pr-merge] ${String(error)}\n${usage}`);
    process.exit(2);
  }
})();
if (parsed.values.help) {
  console.log(usage);
  process.exit(0);
}
const bookmark = parsed.positionals[0];
if (!bookmark || parsed.positionals.length !== 1) {
  console.error(`[pr-merge] 请指定唯一书签。${usage}`);
  process.exit(2);
}
if (realpathSync(path.dirname(import.meta.dir)) !== realpathSync(process.cwd())) {
  console.error("[pr-merge] 请从当前工作区根目录运行该工作区的收口脚本。");
  process.exit(1);
}
const createOnly = parsed.values["create-only"] ?? false;
const expectPaths = [...new Set((parsed.values.expect ?? []).map((p) => p.replaceAll("\\", "/")))];
let bodyFile = parsed.values["body-file"];

// 0) 恢复预检:head=本书签的 PR 若已 MERGED,即上次收口已过合并、断在清理/收账——
//    跳过描述检查/新鲜度门/push/开 PR/合并(1-4 步)直达删分支+收账。各步本就容忍
//    已做过的状态(书签被手工删走→删分支步 warn 后照走)。
//    撞名守卫(#753 实锤:书签名与历史已合 PR 撞头名——retro-gates 撞 #594——预检
//    命中旧 PR 误入恢复模式,删头分支=自动关掉在途 PR):命中多条、或唯一命中合入
//    时间超过 1 天(真恢复=收口刚断在清理/收账,重跑就在当下),一律响亮中止不进
//    恢复模式,按提示换名书签重开(惯例 <票号>-<名>,how-to「版本协作」)。
const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const mergedMatches = (() => {
  const probe = Bun.spawnSync(
    [
      "gh",
      ...repoFlag,
      "pr",
      "list",
      "--head",
      bookmark,
      "--state",
      "merged",
      "--json",
      "url,mergedAt",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  // 探测失败不许静默降级成「无已合入 PR」——网络抖动会误入主流程,死在第 1 步书签
  // 检查(书签已被手工删走的恢复态)或合并步 already-merged 死循环。此刻零状态变更,
  // 响亮中止零成本;下游合并本来就离不开 gh。
  if (probe.exitCode !== 0) {
    console.error(
      `[pr-merge] 恢复预检 gh 探测失败(网络?)——停,稍后重跑:${new TextDecoder().decode(probe.stderr).trim()}`,
    );
    process.exit(1);
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(probe.stdout));
    if (!Array.isArray(parsed)) throw new Error("非数组");
    return parsed as Array<{ url: string; mergedAt: string }>;
  } catch (err) {
    console.error(
      `[pr-merge] 恢复预检返回解析失败——停,稍后重跑:${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
})();
if (mergedMatches.length > 1) {
  console.error(
    `[pr-merge] 恢复预检撞名:书签 ${bookmark} 名下有 ${mergedMatches.length} 个已合 PR(${mergedMatches.map((m) => m.url).join(", ")})——歧义,不进恢复模式。换名书签重开(惯例 <票号>-<名>,how-to「版本协作」)。`,
  );
  process.exit(1);
}
let mergedPrUrl = "";
if (mergedMatches.length === 1) {
  const only = mergedMatches[0]!;
  const ageMs = Date.now() - Date.parse(only.mergedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > RECOVERY_MAX_AGE_MS) {
    console.error(
      `[pr-merge] 恢复预检命中陈旧已合 PR:${only.url}(合入于 ${only.mergedAt})——疑与历史分支撞名(#594 实锤),不进恢复模式。换名书签重开(惯例 <票号>-<名>);确属本票恢复态走手动清理+收账链(how-to「版本协作」)。`,
    );
    process.exit(1);
  }
  const openMatches: unknown = JSON.parse(
    gh("pr", "list", "--head", bookmark, "--state", "open", "--json", "url"),
  );
  if (!Array.isArray(openMatches)) throw new Error("恢复预检返回的未合 PR 列表不是数组");
  if (openMatches.length > 0) {
    console.error(`[pr-merge] 书签 ${bookmark} 仍有未合 PR,停止恢复清理以保留其分支。`);
    process.exit(1);
  }
  mergedPrUrl = only.url;
}

let prNumber = "";
if (mergedPrUrl) {
  prNumber = mergedPrUrl.match(/\/pull\/(\d+)/)?.[1] ?? "";
  if (!prNumber) {
    console.error(`[pr-merge] 从已合入 PR URL 提取号失败:${mergedPrUrl}`);
    process.exit(1);
  }
  console.log(`[pr-merge] PR #${prNumber} 已 MERGED——恢复模式:跳过 push/合并,直达清理+收账。`);
}

if (!prNumber) {
  if (expectPaths.length === 0 || expectPaths.some((p) => !p)) {
    console.error("[pr-merge] 缺少 --expect 路径,请先声明预期文件集。");
    process.exit(2);
  }
  if (bodyFile === "-") {
    const body = readFileSync(0, "utf8");
    if (!body) {
      console.error("[pr-merge] PR 正文为空。");
      process.exit(2);
    }
    bodyFile = path.join(os.tmpdir(), `pr-merge-body-${Date.now()}.md`);
    writeFileSync(bodyFile, body);
  } else if (
    bodyFile !== undefined &&
    (!existsSync(bodyFile) || !statSync(bodyFile).isFile() || statSync(bodyFile).size === 0)
  ) {
    console.error(`[pr-merge] PR 正文文件不存在或为空:${bodyFile}`);
    process.exit(2);
  }

  const startup = jj("log", "-r", "@", "--no-graph", "-T", "commit_id");
  const originalTarget = jj("log", "-r", bookmark, "--no-graph", "-T", "commit_id");
  if (jj("diff", "--from", startup, "--to", originalTarget, "--name-only") !== "") {
    console.error(
      "[pr-merge] 工作区与目标书签内容不同,请先在自己的空工作区 jj new 目标书签再运行。",
    );
    process.exit(1);
  }
  jj("git", "fetch");
  const base = jj("log", "-r", "master@origin", "--no-graph", "-T", "commit_id");
  if (
    jj("log", "-r", "@", "--no-graph", "-T", "commit_id") !== startup ||
    jj("log", "-r", bookmark, "--no-graph", "-T", "commit_id") !== originalTarget
  ) {
    console.error("[pr-merge] 工作区或目标书签在预检期间变化,停止收口。");
    process.exit(1);
  }
  if (jj("log", "-r", `${base} & ::${originalTarget}`, "--no-graph", "-T", "commit_id") !== base) {
    console.error("[pr-merge] 书签不在最新 master@origin 之上,先重定基。");
    process.exit(1);
  }
  // 空工作副本可继续;与目标同树时新建空子提交,其他非空状态拒绝收口。
  {
    const occ = jj("log", "-r", "@", "--no-graph", "-T", 'if(empty, "EMPTY", "OCCUPIED")');
    if (occ === "OCCUPIED") {
      const sameTree = jj("diff", "--from", "@", "--to", originalTarget, "--name-only") === "";
      if (sameTree) {
        jj("new", originalTarget);
        console.log("[pr-merge] 工作副本与目标书签同树——已起空停靠,保留原提交。");
      } else {
        console.error(
          "[pr-merge] 当前工作区 @ 有活——继续收口会搁浅它(1.1 物化)并误报占用(freshness rule 0)。让出主树(AGENTS 版本协作「@ 有别人的活=让出」);确认归属属自己后清空再跑。",
        );
        process.exit(1);
      }
    }
  }

  // 1) 书签在本地且已描述(空描述=未交付,红)
  const description = jj(
    "log",
    "-r",
    originalTarget,
    "--no-graph",
    "-T",
    "description.first_line()",
  );
  if (!description) {
    console.error(`[pr-merge] 书签 ${bookmark} 的 change 没有描述——先 jj describe(交付纪律)。`);
    process.exit(1);
  }
  const title = parsed.values.title ?? description;

  // 1.1) 多提交书签自动等效 squash(2026-10-28 七波 retro:脚本只认单提交,集成链
  //      每波手工 new+restore 六次实锤):master@origin..书签 范围 >1 提交且链底父辈
  //      恰为 master@origin(fast-forward 链)时,按等效配方 new+restore 归拢为单
  //      提交(树=原链尖,内容无损);链底不在 master@origin(master 已另推进)→
  //      红即停先重定基——tree-copy 会抹掉 master 侧额外提交,不许自动碰。
  const chainCommits = jj(
    "log",
    "-r",
    `${base}..${originalTarget}`,
    "--no-graph",
    "-T",
    'commit_id.short() ++ "\\n"',
  )
    .split("\n")
    .filter(Boolean);
  let expectedTarget = originalTarget;
  if (chainCommits.length > 1) {
    const chainRoots = jj(
      "log",
      "-r",
      `roots(${base}..${originalTarget})`,
      "--no-graph",
      "-T",
      'commit_id.short() ++ "\\n"',
    )
      .split("\n")
      .filter(Boolean);
    const masterOriginId = jj(
      "log",
      "-r",
      "master@origin",
      "--no-graph",
      "-T",
      "commit_id.short()",
    );
    const rootParents = chainRoots.flatMap((r) =>
      jj("log", "-r", `${r}-`, "--no-graph", "-T", "commit_id.short()").split("\n").filter(Boolean),
    );
    if (!rootParents.every((p) => p === masterOriginId)) {
      console.error(
        "[pr-merge] 书签是多提交链且链底不在 master@origin 上——先重定基再收口(自动 squash 的 tree-copy 会抹掉 master 侧额外提交,不许自动碰)。",
      );
      process.exit(1);
    }
    const fullDescription = jj("log", "-r", originalTarget, "--no-graph", "-T", "description");
    jj("new", base, "-m", fullDescription);
    jj("restore", "--from", originalTarget);
    expectedTarget = jj("log", "-r", "@", "--no-graph", "-T", "commit_id");
    if (jj("log", "-r", bookmark, "--no-graph", "-T", "commit_id") !== originalTarget) {
      console.error("[pr-merge] 目标书签在归拢期间变化,停止收口。");
      process.exit(1);
    }
    jj("bookmark", "move", bookmark, "--to", expectedTarget, "--allow-backwards");
    jj("new", expectedTarget);
    console.log(
      `[pr-merge] 多提交链(${chainCommits.length} 提交)已等效 squash 为单提交(树=原链尖)。`,
    );
  }

  // 1.17) 书签基线过期显式预检(#807):range diff(master@origin→书签)与 change 自身
  //       diff 不一致 = 书签踩着旧基线(master@origin 已被并行票推进),继续走只会先
  //       撞 1.2 的 expect 清单墙,被误读成「并行写入折入」错走 split(本波六度实锤)
  //       ——这里直接红出 rebase 指向。1.1 已把多提交链归拢到 master@origin 上,故
  //       此处两份 diff 不一致只剩基线落后一种成因,检测无歧义。
  {
    const rangeFiles = changedPaths(
      jj("diff", "--from", base, "--to", expectedTarget, "--name-only"),
    );
    const changeFiles = changedPaths(jj("diff", "-r", expectedTarget, "--name-only"));
    const { extras: onlyInRange, missing: onlyInChange } = comparePaths(rangeFiles, changeFiles);
    if (onlyInRange.length > 0 || onlyInChange.length > 0) {
      console.error(
        "[pr-merge] 书签基线落后 master@origin(并行合入折入检测):先在书签所在 workspace 内 " +
          "jj rebase -d master@origin 再重跑(主树空停靠上跑=空转不生效,#984 实锤)",
      );
      if (onlyInRange.length > 0) {
        console.error(`[pr-merge] 仅 range 侧有(并行票折入的文件):\n  ${onlyInRange.join("\n  ")}`);
      }
      if (onlyInChange.length > 0) {
        console.error(`[pr-merge] 仅 change 侧有:\n  ${onlyInChange.join("\n  ")}`);
      }
      process.exit(1);
    }
  }

  // 1.18) 冲突态预检(#990 会话实锤:jj rebase 留冲突不报错、一等公民只挡 push——
  //       push 处的拒收迟到且不含文件名;提前红 = 重定基后忘消解的场景一句话定位)。
  if (jj("log", "-r", expectedTarget, "--no-graph", "-T", 'if(conflict, "yes", "no")') === "yes") {
    console.error(
      `[pr-merge] ${bookmark} 提交含未解冲突——消解冲突文件后(进该 workspace 跑一条 jj 命令触发快照)再重跑`,
    );
    process.exit(1);
  }

  // 1.2) 预期文件集对账(--expect 可重复声明;S3 闸,见头注)。对账对象=change diff
  //      本体(即 PR 将含的全部文件);路径反斜杠归一(Windows jj 输出带「\」)。
  if (expectPaths.length > 0) {
    const actual = changedPaths(jj("diff", "-r", expectedTarget, "--name-only"));
    const declared = [...expectPaths].sort();
    const { extras, missing } = comparePaths(actual, declared);
    if (extras.length > 0 || missing.length > 0) {
      if (extras.length > 0) {
        console.error(
          `[pr-merge] change 里有声明外的文件(并行写入折入?先 split 拆出再推):\n  ${extras.join("\n  ")}`,
        );
      }
      if (missing.length > 0) {
        console.error(
          `[pr-merge] 声明了但 change 里没有(编辑被并行抹掉?声明笔误?):\n  ${missing.join("\n  ")}`,
        );
      }
      process.exit(1);
    }
    console.log(`[pr-merge] 文件集对账通过(声明 ${declared.length} = 实际 ${actual.length} 个)`);
  }

  if (jj("diff", "--from", "@", "--to", expectedTarget, "--name-only") !== "") {
    console.error("[pr-merge] 工作区与目标书签内容不同,停止收口。");
    process.exit(1);
  }

  // 检查只运行一次,长输出交给现有 command-log。
  const target = jj("log", "-r", bookmark, "--no-graph", "-T", "commit_id");
  if (target !== expectedTarget) {
    console.error("[pr-merge] 目标书签在预检期间变化,停止收口。");
    process.exit(1);
  }
  const working = jj("log", "-r", "@", "--no-graph", "-T", "commit_id");
  const assertUnchanged = () => {
    if (
      jj("log", "-r", "@", "--no-graph", "-T", "commit_id") !== working ||
      jj("log", "-r", bookmark, "--no-graph", "-T", "commit_id") !== target ||
      jj("log", "-r", "master@origin", "--no-graph", "-T", "commit_id") !== base
    ) {
      console.error("[pr-merge] 检查期间代码、书签或基线发生变化,停止收口。");
      process.exit(1);
    }
  };
  const runCheck = (check: string, command: string[], env: Record<string, string> = {}) => {
    console.log(`[pr-merge] 检查 ${check}…`);
    const result = Bun.spawnSync(
      [process.execPath, path.join(import.meta.dir, "command-log.ts"), "--", ...command],
      { stdout: "inherit", stderr: "inherit", env: { ...process.env, ...env } },
    );
    if (result.exitCode !== 0) {
      console.error(`[pr-merge] ${check} 失败,停止收口。`);
      process.exit(result.exitCode || 1);
    }
    assertUnchanged();
  };
  const paths = changedPaths(jj("diff", "-r", target, "--name-only"));
  const checks = (() => {
    try {
      return checksFor(base, target, paths, jjOutput);
    } catch (error) {
      console.error(`[pr-merge] 检查选择失败:${String(error)}`);
      process.exit(1);
    }
  })();
  console.log(`[pr-merge] 检查:${checks.map(({ name }) => name).join(", ")}`);
  assertUnchanged();
  for (const { name, command, env } of checks) runCheck(name, command, env);
  jj("git", "fetch");
  assertUnchanged();

  // 1.5) push(幂等:已推过=exit 0)——先推后验新鲜度(#751 retro 实锤:归拢 squash
  //      后本地书签与远端旧链尖必然 divergence,此时验新鲜度=「落后自己的 upstream」
  //      假红,红文案还误导成 master 被推进;先推平再验,红就只剩真并行推进一种)。
  //      推了才发现红=远端留一条待重定基的分支,无实害,下次收口自然覆盖。
  jj("git", "push", "--bookmark", `exact:${bookmark}`);
  console.log(`[pr-merge] 书签已推:${bookmark}`);

  // 1.6) 新鲜度门(2026-10-18 retro:并行落票期 DIRTY 拖到合并才被 GitHub 告知,
  // 回溯重定基冤枉半小时;红即停,刻意带旧基线收口走手动链 + check:freshness --allow-behind)
  const freshness = Bun.spawnSync(["bun", "scripts/check-freshness.ts"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (freshness.exitCode !== 0) {
    console.error(
      "[pr-merge] check:freshness 红——处置看上方 [freshness] 逐条输出(落后自己的远端书签=改写头后直推;落后 origin/master=并行推进先重定基;主树占用=验归属),勿按单一猜测处置。",
    );
    process.exit(1);
  }
  assertUnchanged();

  // 3) 开 PR(已存在则复用开着的)
  let url = "";
  const createArgs = ["pr", "create", "--head", bookmark, "--base", "master", "--title", title];
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
  prNumber = url.match(/\/pull\/(\d+)/)?.[1] ?? "";
  if (!prNumber) {
    console.error(`[pr-merge] 从 URL 提取 PR 号失败:${url}`);
    process.exit(1);
  }
  console.log(`[pr-merge] PR #${prNumber}:${url}`);

  const prBase = JSON.parse(gh("pr", "view", prNumber, "--json", "baseRefName,baseRefOid")) as {
    baseRefName: string;
    baseRefOid: string;
  };
  assertUnchanged();
  if (prBase.baseRefName !== "master" || prBase.baseRefOid !== base) {
    console.error("[pr-merge] PR 目标分支或基线不符,请核对并重新检查。");
    process.exit(1);
  }

  if (createOnly) {
    console.log("[pr-merge] --create-only:到此为止,合并交主线。");
    process.exit(0);
  }

  // 4) 带号合并 + 验证 MERGED(gh 输出会说谎——usage 报错时可能已合入;以 state 为准)
  gh("pr", "merge", prNumber, "--squash", "--match-head-commit", target);
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
}

cleanupMerged(bookmark, jj);
console.log(`[pr-merge] #${prNumber} 合并已验证。`);
