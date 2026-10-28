// PR 收口一键(2026-10-16 retro,#552 报废事故防复发):
// 书签 → push → 开 PR → **带号** squash 合并 → 验证 MERGED → 才删远端分支 → 清本地书签。
// 顺序本身就是护栏,封死三条已实锤的手工事故链:
//   - gh pr merge 裸跑(不带 PR 号)在 jj 主树必炸「not on any branch」(detached HEAD)——脚本内部从 create 的 URL 提取号。
//   - 远端 head 分支在合并确认前被删 = GitHub 自动关闭 PR 且不可重开(#552 实锤)——删分支排在校验之后。
//   - 远端分支删除与 jj 远端账本不同步,删后同名书签 `jj git push` 报「Nothing changed」拒推——换名书签重开,
//     本脚本管不到历史账本,但保证新收口不再产生这种残局。
//   - 并行会话落票把 master 推前,DIRTY 拖到合并才暴露 = 回溯重定基——push 前强制 check:freshness(红即停)。
//   - workspace 收工即删,主树 @ 无人前移,游玩线一 build 就是旧代码(2026-10-19 实锤)——
//     合并验证后自动收账:move master 书签 + 主树空停靠的 @ 前移(有活不动)。
//   - 断网断在合并后(#628 实锤):重跑即恢复——0 步预检 head 书签的 PR 已 MERGED 就跳过
//     push/合并直达清理+收账(gh pr merge 对已合入 PR 非零报错,不预检则恢复态死循环)。
// 用法:bun scripts/pr-merge.ts <书签名> [--title "<标题>"] [--body-file <路径>] [--create-only]
//   <书签名> 须已在本地存在且已 `jj describe`(空描述直接红,交付纪律=描述即标题);
//   --create-only 只 push+开 PR,不合并不删分支(派单代理交付用,主线 QC 后再全链收口)。
//   --expect <路径>(可重复,**必带,缺省拒收**)= 预期文件集硬闸(S3):change diff 与
//   声明集精确对账,多出(并行写入折入,先 split)与少了(编辑被并行抹掉/声明笔误)都
//   红即停——两案同根(2026-10-17 档位珠批折入远端书签、骰签批主树编辑被活会话抹盘且
//   门禁全绿假 assurance)。清单生成=jj diff --from master@origin --to <书签> --name-only。
//   多提交书签(集成链)自动等效 squash 归拢为单提交再对账(链底须在 master@origin 上,
//   否则红即停先重定基;2026-10-28 七波 retro)。
// 仓库定位:主树与书签分支内 gh 自动识别;jj workspace 无 .git,自动补 `-R openaddr/dafung-web`。
import * as path from "node:path";

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
const expectPaths = args
  .flatMap((a, i) => (a === "--expect" ? [args[i + 1] ?? ""] : []))
  .filter((p) => p && !p.startsWith("--"));
if (!bookmark || bookmark.startsWith("-")) {
  console.error(
    "[pr-merge] 用法:bun scripts/pr-merge.ts <书签名> [--title ...] [--body-file <路径>] [--create-only] [--expect <路径>]...",
  );
  process.exit(2);
}

// 0) 恢复预检:head=本书签的 PR 若已 MERGED,即上次收口已过合并、断在清理/收账——
//    跳过描述检查/新鲜度门/push/开 PR/合并(1-4 步)直达删分支+收账。各步本就容忍
//    已做过的状态(书签被手工删走→删分支步 warn 后照走)。
const mergedPrUrl = (() => {
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
      "url",
      "-q",
      ".[0].url",
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
  return new TextDecoder().decode(probe.stdout).trim();
})();

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
  // 1) 书签在本地且已描述(空描述=未交付,红)
  const description = jj("log", "-r", bookmark, "--no-graph", "-T", "description.first_line()");
  if (!description) {
    console.error(`[pr-merge] 书签 ${bookmark} 的 change 没有描述——先 jj describe(交付纪律)。`);
    process.exit(1);
  }
  const title = flag("--title") ?? description;

  // 1.1) 多提交书签自动等效 squash(2026-10-28 七波 retro:脚本只认单提交,集成链
  //      每波手工 new+restore 六次实锤):master@origin..书签 范围 >1 提交且链底父辈
  //      恰为 master@origin(fast-forward 链)时,按等效配方 new+restore 归拢为单
  //      提交(树=原链尖,内容无损);链底不在 master@origin(master 已另推进)→
  //      红即停先重定基——tree-copy 会抹掉 master 侧额外提交,不许自动碰。老链
  //      head 与票书签留作 head,手动清。
  const chainCommits = jj(
    "log",
    "-r",
    `master@origin..${bookmark}`,
    "--no-graph",
    "-T",
    'commit_id.short() ++ "\\n"',
  )
    .split("\n")
    .filter(Boolean);
  if (chainCommits.length > 1) {
    const chainRoots = jj(
      "log",
      "-r",
      `roots(master@origin..${bookmark})`,
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
    const fullDescription = jj("log", "-r", bookmark, "--no-graph", "-T", "description");
    jj("new", "master@origin", "-m", fullDescription);
    jj("restore", "--from", bookmark);
    jj("bookmark", "move", bookmark, "--to", "@", "--allow-backwards");
    console.log(
      `[pr-merge] 多提交链(${chainCommits.length} 提交)已等效 squash 为单提交(树=原链尖);老链 head 与票书签手动清`,
    );
  }

  // 1.15) --expect 必带(2026-10-28 retro:缺省=文件集闸静默跳过,带病合入实锤——
  //       事后全树对比才补验)。清单生成=jj diff --from master@origin --to <书签> --name-only。
  if (expectPaths.length === 0) {
    console.error(
      "[pr-merge] 缺 --expect——文件集闸不许跳过(清单=jj diff --from master@origin --to <书签> --name-only)。",
    );
    process.exit(1);
  }

  // 1.2) 预期文件集对账(--expect 可重复声明;S3 闸,见头注)。对账对象=change diff
  //      本体(即 PR 将含的全部文件);路径反斜杠归一(Windows jj 输出带「\」)。
  if (expectPaths.length > 0) {
    const norm = (p: string) => p.replaceAll("\\", "/");
    const actual = jj("diff", "-r", bookmark, "--name-only")
      .split("\n")
      .map((s) => norm(s.trim()))
      .filter(Boolean)
      .sort();
    const declared = expectPaths.map(norm).sort();
    const extras = actual.filter((f) => !declared.includes(f));
    const missing = declared.filter((f) => !actual.includes(f));
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
    console.log(`[pr-merge] 文件集对账通过(${actual.length} 个):${actual.join(" ")}`);
  }

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
  prNumber = url.match(/\/pull\/(\d+)/)?.[1] ?? "";
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
}

// 5) 确认合入后才许删分支(时序即护栏)——jj 全通道(2026-10-18 retro:旧
//    git push origin --delete 通道在 workspace 无 .git 必炸;`push --deleted`
//    是全仓扫尾,顺带传播其他会话已删待推的受tracking书签,语义可接受)
const localDelete = Bun.spawnSync(["jj", "bookmark", "delete", bookmark], {
  stdout: "pipe",
  stderr: "pipe",
});
if (localDelete.exitCode !== 0) {
  console.warn(
    `[pr-merge] 本地书签 ${bookmark} 删除失败(可手动 jj bookmark delete):${new TextDecoder().decode(localDelete.stderr).trim()}`,
  );
} else {
  const pushDeleted = Bun.spawnSync(["jj", "git", "push", "--deleted"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (pushDeleted.exitCode !== 0) {
    console.warn(
      "[pr-merge] 远端分支删除传播失败(可手动 jj git push --deleted)——合并已验证,残留不碍收口。",
    );
  }
}
// 6) 自动收账(合入即主树前移,AGENTS 版本协作的唯一 @ 例外):fetch → move 本地
//    master 书签 → 把主树(default 工作区)空停靠的 @ 前移到新 master。守卫:主树 @
//    有活(OCCUPIED)一律不动——「收账防折写」禁令的核心原样保留,让给在场会话;
//    已停靠 master 则幂等跳过。任一步失败只警告不退出:合并已验证,收账残留不碍收口
//    (与删分支步同口径),手动补两条 = jj bookmark move master --to master@origin +
//    回主树 jj new master。
const fetched = Bun.spawnSync(["jj", "git", "fetch"], {
  stdout: "inherit",
  stderr: "inherit",
});
if (fetched.exitCode !== 0) {
  console.warn(
    "[pr-merge] jj git fetch 失败——跳过自动收账(手动:fetch → move master → 回主树 jj new master)",
  );
} else {
  const moved = Bun.spawnSync(["jj", "bookmark", "move", "master", "--to", "master@origin"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (moved.exitCode !== 0) {
    console.warn(
      `[pr-merge] master 书签移动失败(可手动 jj bookmark move master --to master@origin):${new TextDecoder().decode(moved.stderr).trim()}`,
    );
  }
  // 主树定位:default 工作区路径(jj workspace list 逐行「<名>: <路径> <change> …」;
  // 相对路径相对当前 workspace root,在主树里跑时为「.」)
  const mainLine = jj("workspace", "list")
    .split("\n")
    .find((l) => l.startsWith("default:"));
  const mainRel = mainLine?.split(/\s+/)[1];
  if (!mainRel) {
    console.warn("[pr-merge] workspace list 无 default 工作区——跳过主树停靠前移");
  } else {
    const mainTree = path.resolve(jj("root"), mainRel);
    const jjAt = (rev: string, template: string) =>
      Bun.spawnSync(["jj", "log", "-r", rev, "--no-graph", "-T", template], {
        cwd: mainTree,
        stdout: "pipe",
        stderr: "pipe",
      });
    const occupancy = jjAt("@", 'if(empty, "EMPTY", "OCCUPIED")');
    if (occupancy.exitCode !== 0) {
      console.warn(
        `[pr-merge] 主树状态探测失败(可手动回主树 jj new master):${new TextDecoder().decode(occupancy.stderr).trim()}`,
      );
    } else if (new TextDecoder().decode(occupancy.stdout).trim() !== "EMPTY") {
      console.warn("[pr-merge] 主树 @ 有活——不动,让给在场会话;游玩/构建前自行回主树 jj new master");
    } else {
      const docked = jjAt("@-", "change_id.short()");
      const atMaster = Bun.spawnSync(
        ["jj", "log", "-r", "master", "--no-graph", "-T", "change_id.short()"],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (
        docked.exitCode === 0 &&
        atMaster.exitCode === 0 &&
        new TextDecoder().decode(docked.stdout).trim() ===
          new TextDecoder().decode(atMaster.stdout).trim()
      ) {
        console.log("[pr-merge] 主树已停靠新 master,跳过前移");
      } else {
        const dock = Bun.spawnSync(["jj", "new", "master"], {
          cwd: mainTree,
          stdout: "inherit",
          stderr: "inherit",
        });
        console.log(
          dock.exitCode === 0
            ? "[pr-merge] 主树已前移停靠新 master(空 @ 自动收账)"
            : "[pr-merge] 主树停靠前移失败(可手动回主树 jj new master)",
        );
      }
    }
  }
}
console.log(`[pr-merge] #${prNumber} 收口完成。`);
