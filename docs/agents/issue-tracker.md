# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues at `openaddr/dafung-web`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **多行 body 一律 `--body-file -`(stdin 直灌)**:仓库 `tmp/` 下落盘的文件会凭空消失(2026-10-11 两次实锤,连 heredoc 同命令使用都被清理进程抢先),临时文件确需落盘时走系统临时目录,禁入仓库 tmp/。
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone. **jj workspace 内无 .git,gh 探测不到仓库**:补 `-R openaddr/dafung-web`(或设 `GH_REPO=openaddr/dafung-web`)。

## 本仓库特记:gh 可用性

**2026-08-29 起 `gh` 已安装并认证完成**(openaddr,keyring,scopes 含 repo/read:org),以上 gh 命令为主要通路,优先使用。

若 gh 暂不可用,备选通路 = **git 凭据管理器 token + REST API**(曾在 PR #1-#10 全流程验证):

```bash
token=$(printf "protocol=https\nhost=github.com\n" | git credential fill 2>/dev/null | grep '^password=' | cut -d= -f2)
# 建条目
curl -s -X POST -H "Authorization: token $token" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/openaddr/dafung-web/issues -d '{"title":"...","body":"...","labels":["needs-triage"]}'
# 读/列/评论/关:
#   GET  /repos/openaddr/dafung-web/issues/<n>          (读,评论在 /comments)
#   GET  /repos/openaddr/dafung-web/issues?state=open   (列)
#   POST /repos/openaddr/dafung-web/issues/<n>/comments -d '{"body":"..."}'
#   PATCH /repos/openaddr/dafung-web/issues/<n> -d '{"state":"closed"}'
```

多行 body 经 JSON 文件传入(`-d @file`),避免 shell 转义问题。gh 完成认证后(`gh auth login`)优先回到 gh 命令。

## Pull requests as a triage surface

**PRs as a request surface:no**——本仓库不把 PR 当需求单走 triage 状态机(工单一律进 issues)。

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

注:本仓库 master 有分支保护(禁直推/禁 merge commit,一律 PR + squash),PR 号与 issue 号共用同一编号空间。**仓库 VCS=jj colocated(优先)**:合入后主树收账已由 `pr-merge.ts` 尾步自动做,手动通路见[开发与测试](../how-to/开发与测试.md)「版本协作」节;子代理协作走 jj workspace(正式通道;git worktree = 逃生舱通道)。

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`(或上节 curl 等效)。

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue — `gh api --method POST repos/<owner>/<repo>/issues/<map>/sub_issues -F sub_issue_id=<child-db-id>`(字段名是 `sub_issue_id`,传 `sub_id` 必 422,2026-10-19 实踩;child-db-id 同样 `gh api …/issues/<n> --jq .id` 取). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev. **批挂后必须回读核对**:`gh api repos/<owner>/<repo>/issues/<map>/sub_issues --jq '.[].number'`——sub-issue 挂载偶发静默失败(`--silent` 吞错,#461 实测)。
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.

## 历史约定(2026-08 之前)

`.scratch/<feature>/`(spec.md + issues/NN-slug.md)的本地 markdown 约定自本文件改版起**废止**,新工单一律进 GitHub Issues。`.scratch/` 保留为临时脚本/草稿目录,不再是 tracker。
