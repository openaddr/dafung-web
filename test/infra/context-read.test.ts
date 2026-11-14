// #1465:公开读取接口守会话去重与新鲜源;临时文件与 GitHub 边界隔离,不发网络请求。
import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readContext } from "../../scripts/context-read";

const roots: string[] = [];
const CLI = resolve(import.meta.dir, "../../scripts/context-read.ts");

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
