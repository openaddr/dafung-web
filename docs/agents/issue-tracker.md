# 工单：GitHub Issues

仓库为 `openaddr/dafung-web`；需求与规格都建 Issue，PR 只用于交付。技能要求“发布到工单”即创建 Issue。命令显式指定仓库，不依赖当前目录探测。

PRs as a request surface: no

## 读取与写入

```bash
bun scripts/context-read.ts issue <票号> --repo openaddr/dafung-web
bun scripts/context-read.ts issue <票号> --repo openaddr/dafung-web --body
gh issue list --repo openaddr/dafung-web --state open --limit 50 --json number,title,labels,assignees,updatedAt,url
```

默认只读新鲜元信息；正文、评论、子票分别用 `--body`、`--comments`、`--children`，续页用 `--page`。会话标识与重读见[上下文与长命令输出](../how-to/开发与测试.md#上下文与长命令输出)。

多行正文、评论及编辑统一用 `--body-file -` 从 stdin 传入；确需文件时放系统临时目录，仓库 `tmp/` 会被清理。

```bash
gh issue create --repo openaddr/dafung-web --title '<标题>' --body-file - <<'BODY'
<正文>
BODY
```

评论用 `gh issue comment <票号> --repo openaddr/dafung-web --body-file -`；改正文用 `gh issue edit` 同样传 body。标签用 `gh issue edit <票号> --repo openaddr/dafung-web --add-label '<标签>'` 或 `--remove-label`，口径见[分诊标签](./triage-labels.md)。

**关闭顺序**：先独立 `gh issue comment` 落结论，再 `gh issue close <票号> --repo openaddr/dafung-web`。已关票补评也单独 comment；`close --comment` 对已关票可能静默丢评论。Issue 与 PR 共用编号空间，引用含混时先查明类型。

## 子票、阻塞与并行认领

使用当前 gh 的原生子票与依赖命令：

```bash
gh issue edit <父票> --repo openaddr/dafung-web --add-sub-issue <子票>
gh issue edit <子票> --repo openaddr/dafung-web --add-blocked-by <阻塞票>
gh api repos/openaddr/dafung-web/issues/<父票>/sub_issues --jq '.[].number'
gh api repos/openaddr/dafung-web/issues/<子票> --jq .issue_dependencies_summary.blocked_by
```

建票时可加 `--parent <父票>`、`--blocked-by <票号>,<票号>`；批挂后回读核对。`blocked_by` 只计未关闭的阻塞票，为 0 才能开工。

认领前扫开放票标题，候选票再读近评论，防止并行重复实施；有交叉先在票上对账。按父票顺序选无开放 blocker、无 assignee 的第一张票，以 `gh issue edit <票号> --repo openaddr/dafung-web --add-assignee @me` 作为认领的首次写入。

wayfinder 的地图票标 `wayfinder:map`，正文保留笔记、已有决策与待澄清项；子票标 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling` 或 `wayfinder:task`。完成后先评论、关闭子票，再把结论摘要和链接回填父票。版本交付与并入命令只查[开发与测试](../how-to/开发与测试.md)。
