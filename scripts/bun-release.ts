// Bun 放行守门(#1438/#1439):完整入口禁筛选,选检仅接受显式 --files 精确文件。
// 裸 bun test 仍可定向诊断,package 的 test/test:slow 才声明完整放行。
import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { stripVTControlCharacters } from "node:util";
import ts from "typescript";
import { readLogTail, reportCommandResult, runLoggedCommand } from "./command-log";

const args = process.argv.slice(2).map((arg) => arg.replaceAll("\\", "/"));
const files = args[0] === "--files" ? args.slice(1) : [];
if (
  args.length > 0 &&
  (args[0] !== "--files" ||
    files.length === 0 ||
    files.some((path) => !/^test\/[\w/-]+\.test\.tsx?$/.test(path) || !statSync(path).isFile()))
) {
  console.error(
    "[bun-release] 完整放行不接受筛选参数;选检须 --files <test/内精确测试文件>,禁止 --only/-t/--pass-with-no-tests。",
  );
  process.exit(2);
}

function checkFocus(path: string): void {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const bindings = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "bun:test"
    )
      continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) namespaces.add(named.name.text);
    if (named && ts.isNamedImports(named)) {
      for (const specifier of named.elements) {
        if (["test", "it", "describe"].includes((specifier.propertyName ?? specifier.name).text))
          bindings.add(specifier.name.text);
      }
    }
  }
  function isTest(node: ts.Expression): boolean {
    if (ts.isIdentifier(node)) return bindings.has(node.text);
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return isTest(node.expression);
    if (ts.isCallExpression(node)) return isTest(node.expression);
    if (ts.isPropertyAccessExpression(node)) {
      return (
        isTest(node.expression) ||
        (ts.isIdentifier(node.expression) &&
          namespaces.has(node.expression.text) &&
          ["test", "it", "describe"].includes(node.name.text))
      );
    }
    if (ts.isElementAccessExpression(node)) return isTest(node.expression);
    return false;
  }
  // skipIf/each 等返回的测试函数也保留 only;沿绑定传播,包含多级别名。
  let changed = true;
  while (changed) {
    changed = false;
    const collect = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        isTest(node.initializer) &&
        !bindings.has(node.name.text)
      ) {
        bindings.add(node.name.text);
        changed = true;
      }
      ts.forEachChild(node, collect);
    };
    collect(source);
  }
  function visit(node: ts.Node): void {
    if (
      (ts.isPropertyAccessExpression(node) &&
        node.name.text === "only" &&
        isTest(node.expression)) ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteral(node.argumentExpression) &&
        node.argumentExpression.text === "only" &&
        isTest(node.expression))
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      throw new Error(`[bun-release] 拒绝聚焦标记:${path}:${line + 1}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

function checkDirectory(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) checkDirectory(path);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) checkFocus(path);
  }
}
async function firstTestFailure(path: string): Promise<string> {
  const input = createReadStream(path);
  const lines = createInterface({ input, crlfDelay: Infinity });
  let file = "";
  let location = "";
  let reason = "";
  let firstError = "";
  try {
    for await (const raw of lines) {
      const line = stripVTControlCharacters(raw);
      const heading = /^((?:[A-Za-z]:)?[^:]+\.test\.tsx?):$/.exec(line);
      if (heading) {
        file = heading[1]!.replaceAll("\\", "/");
        location = "";
        reason = "";
      }
      if (/^\s*(?:error|\w*Error): /.test(line)) {
        reason = line.trim().slice(0, 360);
        if (!firstError) firstError = reason;
      }
      const frame = /^(\s+at .+):(\d+:\d+)\)?$/.exec(line);
      if (!location && file && frame?.[1]?.replaceAll("\\", "/").endsWith(file)) {
        location = `${file}:${frame[2]}`;
      }
      if (line.startsWith("(fail) ")) {
        const name = line
          .slice(7)
          .replace(/ \[[\d.]+ms\]$/, "")
          .slice(0, 220);
        return [location || file, name, reason].filter(Boolean).join(" · ");
      }
      if (/^\((?:pass|skip|todo)\) /.test(line)) {
        location = "";
        reason = "";
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return firstError;
}

try {
  checkDirectory("test");
  const { code, elapsedMs, failedToStart, log } = await runLoggedCommand([
    process.execPath,
    "test",
    ...files,
  ]);
  if (code !== 0) {
    const detail = failedToStart
      ? (await readLogTail(log.stderr)).trim().slice(0, 360)
      : await firstTestFailure(log.stderr);
    console.error(`[test] 失败 · ${detail || `Bun 退出 ${code}`} · 完整日志 ${log.dir}`);
    process.exitCode = code;
  } else {
    const summary = await readLogTail(log.stderr, 4096);
    const passed = [...summary.matchAll(/^[ \t]*(\d+) pass\r?$/gm)].at(-1)?.[1];
    const skipped = [...summary.matchAll(/^[ \t]*(\d+) skip\r?$/gm)].at(-1)?.[1] ?? "0";
    if (!passed || Number(passed) === 0) {
      throw new Error(`零执行或缺少 Bun 通过汇总，不构成所选范围放行 · 完整日志 ${log.dir}`);
    }
    reportCommandResult(
      `test · ${passed} 通过 · ${skipped} 跳过 · ${(elapsedMs / 1000).toFixed(1)} 秒 · 完整日志 ${log.dir}`,
    );
  }
} catch (error) {
  console.error(`[test] 失败 · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
