// 按需读取上下文(#1465):源每次重读,会话目录只保存已展示页的 SHA-256。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const PAGE_CHARS = 4000;
const BATCH_CHARS = 8000;
const HELP = `用法:
  bun scripts/context-read.ts file <路径> [--lines <起行:止行>] [--page <页码>]
  bun scripts/context-read.ts issue <编号> --repo <owner/repo> [--body | --comments | --children] [--page <页码>]
  bun scripts/context-read.ts diff --base <revision> --target <revision> [--file <仓库相对路径>] [--repository <路径>] [--page <页码>]
  bun scripts/context-read.ts batch [--session <标识>] [--budget <字符数>] [--cursor <JSON>]
  通用选项: --session <标识>、--again、--help

会话取显式 --session 或 CODEX_THREAD_ID,两者都没有时报错。
Issue 默认仅元信息;正文、评论和子票分别按需读取。每次重新读取源或请求 GitHub。
diff 用 jj 将 base/target 各解析为唯一 commit;默认摘要与文件索引,--file 按页展开,续页固定实际提交。
每页最多 ${PAGE_CHARS} 个 Unicode 字符,含长行;页末给出下一页参数。行号从 1 开始,含首尾行。
未变化页明确省略,--again 强制展示。系统临时目录仅保存会话内已展示页的摘要。
batch 从 stdin 读取既有 argv 的 JSON 数组,输出 JSON pages 与短游标 next。
总预算默认 ${BATCH_CHARS} 个 Unicode 字符,含 JSON 元信息与换行;--again 也受限。
续批传入原 stdin 数组和 --cursor '<next JSON>';每页自己的 next 仍用于翻页。
一页及元信息超出总预算时显式报错,需增大 --budget。顶层 session 供未自带会话的请求继承。

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

interface BatchCursor {
  index: number;
  args: string[];
}

interface BatchRequest {
  requests: string[][];
  budget?: number;
  session?: string;
  again?: boolean;
  cursor?: BatchCursor;
}

interface ContextBatch {
  pages: ContextPage[];
  next: BatchCursor | null;
}

interface PreparedPage {
  page: ContextPage;
  args: string[];
  remember: () => void;
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

async function jjRead(repository: string, args: string[]): Promise<string> {
  const child = Bun.spawn(
    ["jj", "--repository", repository, "--no-pager", "--color=never", ...args],
    {
      cwd: repository,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`jj 读取失败(exit ${code}): ${stderr}`);
  return stdout;
}

async function jjCommit(repository: string, revision: string): Promise<string> {
  const output = await jjRead(repository, [
    "log",
    "--no-graph",
    `--revision=${revision}`,
    "--limit=2",
    '--template=commit_id ++ "\\n"',
  ]);
  const commits = output
    .trim()
    .split("\n")
    .filter((id) => id !== "");
  if (commits.length !== 1) throw new Error(`diff revision 必须解析为唯一 jj commit: ${revision}`);
  return commits[0]!;
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

async function prepareContext(args: string[], github: GithubRead): Promise<PreparedPage> {
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
      base: { type: "string" },
      target: { type: "string" },
      file: { type: "string" },
      repository: { type: "string" },
    },
  });
  const session = values.session === undefined ? process.env.CODEX_THREAD_ID : values.session;
  if (!session) throw new Error("需要 CODEX_THREAD_ID 或 --session <会话标识>");
  const [mode, target] = positionals;
  if (
    (mode === "diff" && positionals.length !== 1) ||
    (mode !== "diff" && (positionals.length !== 2 || (mode !== "file" && mode !== "issue")))
  )
    throw new Error(
      "用法:context-read file <路径> / issue <编号> --repo <owner/repo> / diff --base <rev> --target <rev>",
    );
  if (
    mode !== "diff" &&
    [values.base, values.target, values.file, values.repository].some(
      (value) => value !== undefined,
    )
  )
    throw new Error("--base/--target/--file/--repository 仅用于 diff");
  const sections = (["body", "comments", "children"] as const).filter((name) => values[name]);
  const nextArgs =
    mode === "diff" ? [mode, "--session", session] : [mode!, target!, "--session", session];
  let text: string;
  let resource: string;
  if (mode === "diff") {
    if (values.repo !== undefined || sections.length > 0 || values.lines !== undefined)
      throw new Error("diff 不接受 --repo/--body/--comments/--children/--lines");
    if (!values.base || !values.target) throw new Error("diff 需要 --base 与 --target");
    if (values.file === "") throw new Error("diff --file 不能为空");
    const repository = resolve(values.repository === undefined ? "." : values.repository);
    const base = await jjCommit(repository, values.base);
    const targetCommit = await jjCommit(repository, values.target);
    const diffArgs = ["diff", "--ignore-working-copy", `--from=${base}`, `--to=${targetCommit}`];
    resource = `diff:${repository} ${base}..${targetCommit}`;
    nextArgs.push("--repository", repository, "--base", base, "--target", targetCommit);
    if (values.file === undefined) {
      const stat = await jjRead(repository, [...diffArgs, "--stat"]);
      const index = await jjRead(repository, [...diffArgs, "--summary"]);
      text = `${stat}\nFiles:\n${index}`;
      resource += " summary";
    } else {
      text = await jjRead(repository, [
        ...diffArgs,
        "--git",
        "--",
        `root-file:${JSON.stringify(values.file)}`,
      ]);
      resource += ` file:${values.file}`;
      nextArgs.push("--file", values.file);
    }
  } else if (mode === "file") {
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
  return {
    page: {
      resource,
      page,
      pages,
      totalChars: chars.length,
      omitted,
      content: omitted ? null : content,
      next: page === pages ? null : [...nextArgs, "--page", String(page + 1)],
    },
    args: [...nextArgs, "--page", String(page), ...(values.again ? ["--again"] : [])],
    remember: () => {
      if (!omitted) {
        mkdirSync(cacheDir, { recursive: true });
        writeFileSync(cacheFile, digest);
      }
    },
  };
}

export function readContext(args: string[], github?: GithubRead): Promise<ContextPage>;
export function readContext(args: BatchRequest, github?: GithubRead): Promise<ContextBatch>;
export async function readContext(
  args: string[] | BatchRequest,
  github: GithubRead = githubJson,
): Promise<ContextPage | ContextBatch> {
  if (Array.isArray(args)) {
    const prepared = await prepareContext(args, github);
    prepared.remember();
    return prepared.page;
  }
  const budget = args.budget === undefined ? BATCH_CHARS : args.budget;
  if (!Number.isSafeInteger(budget) || budget < 1) throw new Error("batch budget 必须是正整数");
  if (
    !Array.isArray(args.requests) ||
    !args.requests.every(
      (request) => Array.isArray(request) && request.every((arg) => typeof arg === "string"),
    )
  )
    throw new Error('batch 需要 JSON argv 数组,如 [["file","AGENTS.md"]]');
  const start = args.cursor === undefined ? 0 : args.cursor.index;
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    (args.cursor !== undefined &&
      (start >= args.requests.length ||
        !Array.isArray(args.cursor.args) ||
        !args.cursor.args.every((arg) => typeof arg === "string")))
  )
    throw new Error("batch cursor 无效");
  const prepareAt = (index: number) => {
    let request =
      index === start && args.cursor !== undefined ? args.cursor.args : args.requests[index]!;
    if (
      args.session !== undefined &&
      !request.some((arg) => arg === "--session" || arg.startsWith("--session="))
    )
      request = [...request, "--session", args.session];
    if (args.again) request = [...request, "--again"];
    return prepareContext(request, github);
  };
  const outputChars = (next: BatchCursor | null, pageChars: number, count: number) =>
    Array.from(`${JSON.stringify({ pages: [], next })}\n`).length +
    pageChars +
    Math.max(0, count - 1);
  const result: ContextBatch = { pages: [], next: null };
  const displayed: PreparedPage[] = [];
  let pageChars = 0;
  let current = start < args.requests.length ? await prepareAt(start) : null;
  for (let index = start; current !== null; index++) {
    const candidateChars = pageChars + Array.from(JSON.stringify(current.page)).length;
    const count = result.pages.length + 1;
    // 即使去掉续读游标也已超额时,不再拉下一项源。
    if (outputChars(null, candidateChars, count) > budget) {
      result.next = { index, args: current.args };
      break;
    }
    const following = index + 1 < args.requests.length ? await prepareAt(index + 1) : null;
    const next = following === null ? null : { index: index + 1, args: following.args };
    if (outputChars(next, candidateChars, count) > budget) {
      result.next = { index, args: current.args };
      break;
    }
    result.pages.push(current.page);
    displayed.push(current);
    result.next = next;
    pageChars = candidateChars;
    current = following;
  }
  if (
    (start < args.requests.length && result.pages.length === 0) ||
    outputChars(result.next, pageChars, result.pages.length) > budget
  )
    throw new Error(`batch budget ${budget} 不足以展示一页及续读元信息;请增大 --budget`);
  for (const entry of displayed) entry.remember();
  return result;
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") console.log(HELP);
    else if (args[0] === "batch") {
      const { values } = parseArgs({
        args: args.slice(1),
        options: {
          session: { type: "string" },
          again: { type: "boolean" },
          budget: { type: "string" },
          cursor: { type: "string" },
        },
      });
      const batch = await readContext({
        requests: JSON.parse(await Bun.stdin.text()),
        session: values.session,
        again: values.again,
        budget: values.budget === undefined ? BATCH_CHARS : Number(values.budget),
        cursor: values.cursor === undefined ? undefined : JSON.parse(values.cursor),
      });
      process.stdout.write(`${JSON.stringify(batch)}\n`);
    } else {
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
