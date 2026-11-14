// 按需读取上下文(#1465):源每次重读,会话目录只保存已展示页的 SHA-256。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const PAGE_CHARS = 4000;
const HELP = `用法:
  bun scripts/context-read.ts file <路径> [--lines <起行:止行>] [--page <页码>]
  bun scripts/context-read.ts issue <编号> --repo <owner/repo> [--body | --comments | --children] [--page <页码>]
  通用选项: --session <标识>、--again、--help

会话取显式 --session 或 CODEX_THREAD_ID,两者都没有时报错。
Issue 默认仅元信息;正文、评论和子票分别按需读取。每次重新读取源或请求 GitHub。
每页最多 ${PAGE_CHARS} 个 Unicode 字符,含长行;页末给出下一页参数。行号从 1 开始,含首尾行。
未变化页明确省略,--again 强制展示。系统临时目录仅保存会话内已展示页的摘要。

示例:
  bun scripts/context-read.ts file docs/agents/issue-tracker.md --lines 1:20 --session review
  bun scripts/context-read.ts issue 1464 --repo openaddr/dafung-web --body --page 1 --session review`;

type IssueSection = "metadata" | "body" | "comments" | "children";
type GithubRead = (endpoint: string, paginate: boolean) => Promise<unknown>;

interface GithubIssue {
  number: number;
  title: string;
  state: string;
  labels: { name: string }[];
  assignees: { login: string }[];
  updated_at: string;
  html_url: string;
  comments: number;
  body: string | null;
}

interface GithubComment {
  id: number;
  user: { login: string } | null;
  body: string;
  html_url: string;
  created_at: string;
  updated_at: string;
}

interface ContextPage {
  resource: string;
  page: number;
  pages: number;
  totalChars: number;
  omitted: boolean;
  content: string | null;
  next: string[] | null;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function githubJson(endpoint: string, paginate: boolean): Promise<unknown> {
  const args = ["gh", "api", endpoint];
  if (paginate) args.push("--paginate", "--slurp");
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`GitHub 读取失败(exit ${code}): ${stderr}`);
  return JSON.parse(stdout);
}

function issueMetadata(issue: GithubIssue) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    labels: issue.labels.map((label) => label.name),
    assignees: issue.assignees.map((assignee) => assignee.login),
    updatedAt: issue.updated_at,
    url: issue.html_url,
    comments: issue.comments,
  };
}

async function issueContent(
  endpoint: string,
  section: IssueSection,
  github: GithubRead,
): Promise<string> {
  if (section === "metadata" || section === "body") {
    const issue = (await github(endpoint, false)) as GithubIssue;
    if (section === "body") return issue.body === null ? "" : issue.body;
    return JSON.stringify(issueMetadata(issue), null, 2);
  }
  if (section === "comments") {
    const pages = (await github(`${endpoint}/comments?per_page=100`, true)) as GithubComment[][];
    return JSON.stringify(
      pages.flat().map((comment) => ({
        id: comment.id,
        author: comment.user === null ? null : comment.user.login,
        url: comment.html_url,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        body: comment.body,
      })),
      null,
      2,
    );
  }
  const pages = (await github(`${endpoint}/sub_issues?per_page=100`, true)) as GithubIssue[][];
  return JSON.stringify(pages.flat().map(issueMetadata), null, 2);
}

export async function readContext(
  args: string[],
  github: GithubRead = githubJson,
): Promise<ContextPage> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      session: { type: "string" },
      again: { type: "boolean" },
      lines: { type: "string" },
      page: { type: "string", default: "1" },
      repo: { type: "string" },
      body: { type: "boolean" },
      comments: { type: "boolean" },
      children: { type: "boolean" },
    },
  });
  const session = values.session === undefined ? process.env.CODEX_THREAD_ID : values.session;
  if (!session) throw new Error("需要 CODEX_THREAD_ID 或 --session <会话标识>");
  const [mode, target] = positionals;
  if (positionals.length !== 2 || (mode !== "file" && mode !== "issue"))
    throw new Error("用法:context-read file <路径> / issue <编号> --repo <owner/repo>");
  const sections = (["body", "comments", "children"] as const).filter((name) => values[name]);
  const nextArgs = [mode, target!, "--session", session];
  let text: string;
  let resource: string;
  if (mode === "file") {
    if (values.repo !== undefined || sections.length > 0)
      throw new Error("file 不接受 --repo/--body/--comments/--children");
    const file = resolve(target!);
    text = readFileSync(file, "utf8");
    resource = `file:${file}`;
    nextArgs[1] = file;
    if (values.lines !== undefined) {
      const range = /^([1-9]\d*):([1-9]\d*)$/.exec(values.lines);
      if (!range) throw new Error("--lines 需要起止行号,如 1:40");
      const start = Number(range[1]);
      const end = Number(range[2]);
      const lines = text.split(/(?<=\n)/);
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        end > lines.length
      )
        throw new Error(`--lines 超出文件行段(共 ${lines.length} 行)`);
      text = lines.slice(start - 1, end).join("");
      resource += ` lines ${values.lines}`;
      nextArgs.push("--lines", values.lines);
    }
  } else {
    if (values.repo === undefined || !/^[\w.-]+\/[\w.-]+$/.test(values.repo))
      throw new Error("issue 需要显式 --repo <owner/repo>");
    if (!/^[1-9]\d*$/.test(target!) || !Number.isSafeInteger(Number(target)))
      throw new Error("issue 编号必须是正整数");
    if (sections.length > 1 || values.lines !== undefined)
      throw new Error("issue 每次选择 --body/--comments/--children 之一,不接受 --lines");
    const section: IssueSection = sections.length === 0 ? "metadata" : sections[0]!;
    text = await issueContent(`repos/${values.repo}/issues/${target}`, section, github);
    resource = `issue:${values.repo}#${target} ${section}`;
    nextArgs.push("--repo", values.repo);
    if (section !== "metadata") nextArgs.push(`--${section}`);
  }
  const chars = Array.from(text);
  const pages = Math.max(1, Math.ceil(chars.length / PAGE_CHARS));
  const page = Number(values.page);
  if (!/^[1-9]\d*$/.test(values.page) || !Number.isSafeInteger(page) || page > pages)
    throw new Error(`--page 应为 1..${pages}`);
  const content = chars.slice((page - 1) * PAGE_CHARS, page * PAGE_CHARS).join("");
  const cacheDir = join(tmpdir(), "dafung-context-read", sha256(session));
  const cacheFile = join(cacheDir, `${sha256(`${resource}\0${page}`)}.sha256`);
  const digest = sha256(content);
  const previous = existsSync(cacheFile) ? readFileSync(cacheFile, "utf8") : null;
  if (previous !== null && !/^[a-f0-9]{64}$/.test(previous))
    throw new Error(`摘要记录损坏:${cacheFile}`);
  const omitted = !values.again && previous === digest;
  if (!omitted) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, digest);
  }
  return {
    resource,
    page,
    pages,
    totalChars: chars.length,
    omitted,
    content: omitted ? null : content,
    next: page === pages ? null : [...nextArgs, "--page", String(page + 1)],
  };
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") console.log(HELP);
    else {
      const page = await readContext(args);
      console.log(
        `[context-read] ${page.resource} page ${page.page}/${page.pages} (${page.totalChars} chars, ${PAGE_CHARS}/page)`,
      );
      if (page.omitted) console.log("[context-read] unchanged; omitted (--again 显式重读)");
      else console.log(page.content);
      if (page.next !== null)
        console.log(
          `[context-read] next: --page ${page.page + 1}; argv: ${JSON.stringify(page.next)}`,
        );
      else console.log("[context-read] end");
    }
  } catch (error) {
    console.error(`[context-read] ${String(error)}`);
    process.exitCode = 1;
  }
}
