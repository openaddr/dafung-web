import * as path from "node:path";

export function cleanupMerged(bookmark: string, jj: (...args: string[]) => string): void {
  // 确认合入后仅传播本书签的删除,不触碰其他工作区待删的书签。
  const localDelete = Bun.spawnSync(["jj", "bookmark", "delete", bookmark], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (localDelete.exitCode !== 0) {
    console.warn(
      `[pr-merge] 本地书签 ${bookmark} 删除失败(可手动 jj bookmark delete):${new TextDecoder().decode(localDelete.stderr).trim()}`,
    );
  } else {
    const pushDeleted = Bun.spawnSync(["jj", "git", "push", "--bookmark", `exact:${bookmark}`], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (pushDeleted.exitCode !== 0) {
      console.warn(`[pr-merge] 远端分支删除失败,请定点清理 ${bookmark};合并已验证。`);
    }
  }
  // 不 abandon 归拢前的提交:其他工作区和书签可能仍在使用它们。
  // 只在远端和本地 master 均更新成功后前移停靠位。
  const fetched = Bun.spawnSync(["jj", "git", "fetch"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (fetched.exitCode !== 0) {
    console.warn(
      "[pr-merge] jj git fetch 失败——跳过自动收账(手动:fetch → move master → 回主树 jj new master)",
    );
    return;
  } else {
    const moved = Bun.spawnSync(["jj", "bookmark", "move", "master", "--to", "master@origin"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (moved.exitCode !== 0) {
      console.warn(
        `[pr-merge] master 书签移动失败(可手动 jj bookmark move master --to master@origin):${new TextDecoder().decode(moved.stderr).trim()}`,
      );
      return;
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
        console.warn(
          "[pr-merge] 主树 @ 有活——不动,让给在场会话;游玩/构建前自行回主树 jj new master",
        );
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
  // 本工作区只有空停靠或与已合树相同时才前移。
  {
    const probe = (rev: string, template: string) =>
      Bun.spawnSync(["jj", "log", "-r", rev, "--no-graph", "-T", template], {
        stdout: "pipe",
        stderr: "pipe",
      });
    const out = (p: { exitCode: number; stdout: Uint8Array }) =>
      new TextDecoder().decode(p.stdout).trim();
    const at = probe("@", 'if(empty, "EMPTY", "OCCUPIED")');
    const masterId = probe("master", "change_id.short()");
    if (at.exitCode !== 0 || masterId.exitCode !== 0) {
      console.warn(
        `[pr-merge] 本 workspace @ 状态探测失败(手动 jj new master):${out(at) || out(masterId)}`,
      );
    } else {
      const dock = () =>
        Bun.spawnSync(["jj", "new", "master"], { stdout: "inherit", stderr: "inherit" });
      if (out(at) !== "OCCUPIED") {
        const parentId = probe("@-", "change_id.short()");
        if (parentId.exitCode === 0 && out(parentId) === out(masterId)) {
          console.log("[pr-merge] 本 workspace @ 已停靠新 master,免动");
        } else {
          const done = dock();
          console.log(
            done.exitCode === 0
              ? "[pr-merge] 本 workspace @ 已前移停靠新 master(空 @ 自动遗弃重起)"
              : "[pr-merge] 本 workspace 停靠失败(可手动 jj new master)",
          );
        }
      } else {
        const treeDiff = Bun.spawnSync(
          ["jj", "diff", "--from", "@", "--to", "master@origin", "--name-only"],
          { stdout: "pipe", stderr: "pipe" },
        );
        const sameTree = treeDiff.exitCode === 0 && out(treeDiff) === "";
        if (!sameTree) {
          console.warn(
            "[pr-merge] 本 workspace @ 有活且与 master@origin 内容不同——不动。继续改活先 jj new;骑在已合 change 上时先 jj rebase -d master 拆内容(how-to「版本协作」)",
          );
        } else {
          const done = dock();
          console.log(
            done.exitCode === 0
              ? "[pr-merge] 本 workspace @ 骑占已合 change,已停靠新 master 起空位(原 change 留痕可溯)"
              : "[pr-merge] 本 workspace 停靠失败(可手动 jj new master)",
          );
        }
      }
    }
  }
}
