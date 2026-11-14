// #1465:公开读取接口守会话去重与新鲜源;临时文件与 GitHub 边界隔离,不发网络请求。
import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readContext } from "../../scripts/context-read";

const roots: string[] = [];
const CLI = resolve(import.meta.dir, "../../scripts/context-read.ts");

function jj(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(
    [
      "jj",
      '--config=user.name="Context Test"',
      '--config=user.email="context@example.invalid"',
      ...args,
    ],
    { cwd: root },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

test("文件每次重新读取,同会话只省略未变化页,新会话与显式重读仍显示", async () => {
  const root = mkdtempSync(join(tmpdir(), "context-read-test-"));
  roots.push(root);
  const file = join(root, "note with spaces.md");
  const args = ["file", file, "--session", randomUUID()];
  writeFileSync(file, "first content\n");
  expect((await readContext(args)).content).toBe("first content\n");
  expect((await readContext(args)).omitted).toBe(true);
  expect((await readContext([...args, "--again"])).content).toBe("first content\n");
  expect((await readContext(["file", file, "--session", randomUUID()])).content).toBe(
    "first content\n",
  );
  writeFileSync(file, "changed content\n");
  expect((await readContext(args)).content).toBe("changed content\n");
  unlinkSync(file);
  expect(readContext(args)).rejects.toThrow("ENOENT");
});

test("文件行段按字符连续分页,长行与非 BMP 字符不丢失,省略页仍给续页", async () => {
  const root = mkdtempSync(join(tmpdir(), "context-read-test-"));
  roots.push(root);
  const file = join(root, "long-line.md");
  writeFileSync(file, `excluded\n${"长".repeat(3999)}😀tail\nthird\nexcluded too\n`);
  const args = ["file", file, "--lines", "2:3", "--session", randomUUID()];
  const first = await readContext(args);
  expect(first.content).toBe(`${"长".repeat(3999)}😀`);
  expect(first.pages).toBe(2);
  expect(first.next).not.toBeNull();
  expect(await readContext(first.next!)).toMatchObject({
    content: "tail\nthird\n",
    page: 2,
    next: null,
  });
  expect(await readContext(args)).toMatchObject({ omitted: true, next: first.next });
  expect(readContext([...args, "--page", "3"])).rejects.toThrow("--page");
});

test("Issue 默认仅元信息,首次正文不被误记已读,评论和子票按需且错误不走旧摘要", async () => {
  const issue = {
    number: 42,
    title: "fresh issue",
    state: "open",
    labels: [{ name: "task" }],
    assignees: [{ login: "dev" }],
    updated_at: "2026-11-14T00:00:00Z",
    html_url: "https://github.com/example/repo/issues/42",
    comments: 1,
    body: "first body",
  };
  const requests: string[] = [];
  let unavailable = false;
  const github = async (endpoint: string) => {
    requests.push(endpoint);
    if (unavailable) throw new Error("GitHub unavailable");
    if (endpoint.includes("/comments"))
      return [
        [
          {
            id: 1,
            user: { login: "reader" },
            body: "one comment",
            html_url: "comment-url",
            created_at: "today",
            updated_at: "today",
          },
        ],
      ];
    if (endpoint.includes("/sub_issues"))
      return [[{ ...issue, number: 43, title: "child", body: "child secret" }]];
    return issue;
  };
  const args = ["issue", "42", "--repo", "example/repo", "--session", randomUUID()];
  const metadata = await readContext(args, github);
  expect(metadata.content).toContain("fresh issue");
  expect(metadata.content).not.toContain("first body");
  expect(requests).toEqual(["repos/example/repo/issues/42"]);
  expect((await readContext(args, github)).omitted).toBe(true);
  expect(requests).toHaveLength(2);
  expect((await readContext([...args, "--body"], github)).content).toBe("first body");
  expect((await readContext([...args, "--body"], github)).omitted).toBe(true);
  issue.body = "updated body";
  expect((await readContext([...args, "--body"], github)).content).toBe("updated body");
  expect((await readContext([...args, "--comments"], github)).content).toContain("one comment");
  const children = await readContext([...args, "--children"], github);
  expect(children.content).toContain("child");
  expect(children.content).not.toContain("child secret");
  unavailable = true;
  expect(readContext(args, github)).rejects.toThrow("GitHub unavailable");
});

test("CLI 帮助无需会话,默认取 CODEX_THREAD_ID,缺少会话或显式仓库时非零退出", () => {
  const root = mkdtempSync(join(tmpdir(), "context-read-test-"));
  roots.push(root);
  const file = join(root, "cli note.md");
  writeFileSync(file, "environment session content");
  const env = { ...process.env, CODEX_THREAD_ID: randomUUID() };
  const help = Bun.spawnSync([process.execPath, CLI, "--help"], { env });
  expect(help.exitCode, help.stderr.toString()).toBe(0);
  expect(help.stdout.toString()).toContain("--page");
  const first = Bun.spawnSync([process.execPath, CLI, "file", file], { env });
  expect(first.exitCode, first.stderr.toString()).toBe(0);
  expect(first.stdout.toString()).toContain("environment session content");
  const repeat = Bun.spawnSync([process.execPath, CLI, "file", file], { env });
  expect(repeat.stdout.toString()).toContain("unchanged; omitted");
  const noSession = Bun.spawnSync([process.execPath, CLI, "file", file], {
    env: { ...env, CODEX_THREAD_ID: "" },
  });
  expect(noSession.exitCode).not.toBe(0);
  expect(noSession.stderr.toString()).toContain("CODEX_THREAD_ID");
  const noRepo = Bun.spawnSync([process.execPath, CLI, "issue", "42"], { env });
  expect(noRepo.exitCode).not.toBe(0);
  expect(noRepo.stderr.toString()).toContain("--repo");
});

test("整批 JSON 连同续读元信息受总预算约束,未展示页可原样恢复且不误记已读", async () => {
  const root = mkdtempSync(join(tmpdir(), "context-read-test-"));
  roots.push(root);
  const session = randomUUID();
  const requests = ["first", "second"].map((name) => {
    const file = join(root, `${name}.md`);
    writeFileSync(file, "😀".repeat(4000));
    return ["file", file, "--session", session];
  });
  const batch = await readContext({ requests });
  expect(Array.from(`${JSON.stringify(batch)}\n`).length).toBeLessThanOrEqual(8000);
  expect(batch.pages).toHaveLength(1);
  expect(batch.pages[0]!.content).toBe("😀".repeat(4000));
  expect(batch.next).not.toBeNull();
  expect(batch.next!.index).toBe(1);
  const resumed = await readContext({ requests, cursor: batch.next! });
  expect(resumed.pages).toHaveLength(1);
  expect(resumed.pages[0]!.omitted).toBe(false);
  expect(resumed.pages[0]!.content).toBe("😀".repeat(4000));
  expect(resumed.next).toBeNull();
  expect((await readContext(requests[0]!)).omitted).toBe(true);
  writeFileSync(requests[0]![1]!, "short content");
  await expect(
    readContext({
      requests: [requests[0]!, ["file", requests[0]![1]!, "--session", "long-session".repeat(400)]],
      budget: 1000,
    }),
  ).rejects.toThrow("不足以展示一页");
  expect((await readContext(requests[0]!)).omitted).toBe(false);
});

test("批量 CLI 从 stdin 接 argv manifest,继承会话并用短游标续读,--again 仍限额", () => {
  const root = mkdtempSync(join(tmpdir(), "context-read-test-"));
  roots.push(root);
  const requests = Array.from({ length: 20 }, (_, index) => {
    const file = join(root, `note ${index}.md`);
    writeFileSync(file, "字".repeat(4000));
    return ["file", file];
  });
  const session = randomUUID();
  const run = (extra: string[] = []) =>
    Bun.spawnSync([process.execPath, CLI, "batch", "--session", session, "--again", ...extra], {
      stdin: Buffer.from(JSON.stringify(requests)),
    });
  const first = run();
  expect(first.exitCode, first.stderr.toString()).toBe(0);
  expect(Array.from(first.stdout.toString()).length).toBeLessThanOrEqual(8000);
  const batch = JSON.parse(first.stdout.toString());
  expect(batch.pages).toHaveLength(1);
  expect(batch.next.index).toBe(1);
  expect(JSON.stringify(batch.next).length).toBeLessThan(400);
  const resumed = run(["--cursor", JSON.stringify(batch.next), "--budget", "12000"]);
  expect(resumed.exitCode, resumed.stderr.toString()).toBe(0);
  const continuation = JSON.parse(resumed.stdout.toString());
  expect(continuation.pages[0].resource).toContain("note 1.md");
  expect(continuation.pages).toHaveLength(2);
  expect(continuation.next.index).toBe(3);
});

test("长 Issue manifest 在预算停点后不读取远端长尾,恢复时未展示页仍新鲜", async () => {
  const requests = Array.from({ length: 40 }, (_, index) => [
    "issue",
    String(index + 1),
    "--repo",
    "example/repo",
    "--body",
  ]);
  const calls: string[] = [];
  let body = "字".repeat(4000);
  const github = async (endpoint: string) => {
    calls.push(endpoint);
    return { body };
  };
  const session = randomUUID();
  const first = await readContext({ requests, session, budget: 5000 }, github);
  expect(first.pages).toHaveLength(1);
  expect(first.next!.index).toBe(1);
  expect(calls.length).toBeLessThanOrEqual(3);
  calls.length = 0;
  body = "新".repeat(4000);
  const resumed = await readContext(
    { requests, session, budget: 5000, cursor: first.next! },
    github,
  );
  expect(resumed.pages[0]!.content).toBe(body);
  expect(resumed.pages[0]!.omitted).toBe(false);
  expect(resumed.next!.index).toBe(2);
  expect(calls[0]).toBe("repos/example/repo/issues/2");
  expect(calls.length).toBeLessThanOrEqual(3);
});

test("预算、manifest、游标或源错误显式失败且整批不登记已读", async () => {
  const root = mkdtempSync(join(tmpdir(), "context-read-test-"));
  roots.push(root);
  const file = join(root, "atomic.md");
  writeFileSync(file, "fresh page");
  const args = ["file", file, "--session", randomUUID()];
  for (const budget of [0, -1, 1.5, NaN, Infinity])
    await expect(readContext({ requests: [args], budget })).rejects.toThrow("budget");
  await expect(readContext({ requests: [args], budget: 20 })).rejects.toThrow("不足以展示一页");
  await expect(
    readContext({
      requests: [args, ["file", join(root, "missing.md"), "--session", randomUUID()]],
    }),
  ).rejects.toThrow("ENOENT");
  await expect(readContext({ requests: [args], cursor: { index: 1, args } })).rejects.toThrow(
    "cursor",
  );
  expect((await readContext(args)).omitted).toBe(false);
  const invalid = Bun.spawnSync([process.execPath, CLI, "batch"], {
    stdin: Buffer.from('[["file",42]]'),
  });
  expect(invalid.exitCode).not.toBe(0);
  expect(invalid.stderr.toString()).toContain("JSON argv 数组");
});

test("diff 默认给摘要与文件索引,显式文件逐页读取固定 jj 提交,不展开 fileset 表达式", async () => {
  const root = mkdtempSync(join(tmpdir(), "context-diff-test-"));
  roots.push(root);
  jj(root, "git", "init");
  const base = jj(root, "log", "--no-graph", "-r", "@", "-T", "commit_id");
  jj(root, "new", "-m", "review target");
  const file = "safe(1) | all().md";
  writeFileSync(join(root, file), `${"😀".repeat(8200)}original tail\n`);
  writeFileSync(join(root, "private.md"), "other file content");
  const target = jj(root, "log", "--no-graph", "-r", "@", "-T", "commit_id");
  const args = [
    "diff",
    "--base",
    base,
    "--target",
    "@",
    "--repository",
    root,
    "--session",
    randomUUID(),
  ];
  const summary = await readContext(args);
  expect(summary.resource).toContain(base);
  expect(summary.resource).toContain(target);
  expect(summary.content).toContain(file);
  expect(summary.content).toContain("private.md");
  expect(summary.content).not.toContain("other file content");
  const first = await readContext([...args, "--file", file]);
  expect(first.pages).toBeGreaterThan(2);
  expect(Array.from(first.content!).length).toBe(4000);
  expect(first.next).toContain(target);
  const requests = [
    ["file", join(root, file)],
    [...args, "--file", file, "--again"],
  ];
  const session = randomUUID();
  const batch = await readContext({ requests, session });
  expect(batch.pages).toHaveLength(1);
  expect(batch.next!.args).toContain(target);
  writeFileSync(join(root, file), "later invisible");
  jj(root, "log", "--no-graph", "-r", "@", "-T", "commit_id");
  const resumed = await readContext({ requests, session, cursor: batch.next! });
  expect(resumed.pages[0]!.resource).toContain(target);
  expect(resumed.pages[0]!.content).toContain("😀");
  expect(resumed.pages[0]!.content).not.toContain("later invisible");
  const pages = [first.content!];
  let next = first.next;
  while (next !== null) {
    const page = await readContext(next);
    pages.push(page.content!);
    expect(page.resource).toContain(target);
    next = page.next;
  }
  const diff = pages.join("");
  expect(diff).toContain("😀".repeat(8200));
  expect(diff).toContain("original tail");
  expect(diff).not.toContain("later invisible");
  expect(diff).not.toContain("other file content");
  for (const revision of ["none()", "all()", "missing_revision", "("])
    await expect(
      readContext([
        "diff",
        "--base",
        revision,
        "--target",
        target,
        "--repository",
        root,
        "--session",
        randomUUID(),
      ]),
    ).rejects.toThrow();
});
