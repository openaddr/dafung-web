// Bun 完整放行入口(#1438):禁止筛选参数和 bun:test 聚焦标记。
// 裸 bun test 仍可定向诊断,package 的 test/test:slow 才声明完整放行。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import ts from "typescript";

if (process.argv.length > 2) {
  console.error(
    "[bun-release] 完整放行不接受参数(含 --only/--pass-with-no-tests/文件/-t);定向诊断请用裸 bun test。",
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
checkDirectory("test");
const child = Bun.spawn([process.execPath, "test"], {
  stdin: "inherit",
  stdout: "pipe",
  stderr: "pipe",
});
async function tee(
  stream: ReadableStream<Uint8Array>,
  target: NodeJS.WriteStream,
): Promise<string> {
  let tail = "";
  const reader = stream.getReader();
  for (;;) {
    const { value: chunk, done } = await reader.read();
    if (done) break;
    target.write(chunk);
    tail = (tail + Buffer.from(chunk).toString()).slice(-4096);
  }
  return tail;
}
const [stdout, stderr, code] = await Promise.all([
  tee(child.stdout, process.stdout),
  tee(child.stderr, process.stderr),
  child.exited,
]);
if (code !== 0) process.exit(code);
const summary = [...stripVTControlCharacters(stdout + stderr).matchAll(/^\s*(\d+) pass\r?$/gm)].at(
  -1,
);
if (!summary || Number(summary[1]) === 0) {
  console.error("[bun-release] 零执行或缺少 Bun 通过汇总,不构成完整放行。");
  process.exit(1);
}
