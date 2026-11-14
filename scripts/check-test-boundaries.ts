// 浏览器回归退役边界。截图/排查工具可保留,测试目录不启动真实浏览器。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export function inspectTestBoundaries(root: string): string[] {
  const issues: string[] = [];
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const field of ["dependencies", "devDependencies"]) {
    if (field in pkg && "@playwright/test" in pkg[field])
      issues.push("package.json: 常驻浏览器测试依赖 @playwright/test 已退役");
  }
  if ("scripts" in pkg)
    for (const [name, command] of Object.entries(pkg.scripts))
      if (name.startsWith("test:e2e") || /playwright\s+test/.test(String(command)))
        issues.push(`package.json: 浏览器回归入口 ${name} 已退役`);
  for (const name of readdirSync(root))
    if (/^playwright\.config\.[cm]?[jt]s$/.test(name)) issues.push(`${name}: 浏览器测试配置已退役`);
  if (
    existsSync(join(root, "e2e")) &&
    [...new Bun.Glob("**/*").scanSync({ cwd: join(root, "e2e"), onlyFiles: true })].length > 0
  )
    issues.push("e2e/: 常驻浏览器用例目录已退役");

  const browserModule =
    /^(?:@playwright\/test|playwright|puppeteer(?:-core)?|selenium-webdriver|webdriverio)(?:\/|$)/;
  const auxiliary = new Set([
    "scripts/shot.mjs",
    "scripts/frame-probe.ts",
    "scripts/cost-probe.ts",
    "scripts/visual-compare.mjs",
    "scripts/mobile-context.ts",
  ]);
  function scan(relative: string): void {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) scan(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        const source = ts.createSourceFile(
          path,
          readFileSync(join(root, path), "utf8"),
          ts.ScriptTarget.Latest,
          true,
        );
        const visit = (node: ts.Node): void => {
          let module: ts.Expression | undefined;
          if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
            module = node.moduleSpecifier;
          else if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) && node.expression.text === "require"))
          )
            module = node.arguments[0];
          if (
            module &&
            ts.isStringLiteral(module) &&
            browserModule.test(module.text) &&
            !(module.text === "playwright" && auxiliary.has(path))
          )
            issues.push(`${path}: 仅既有单次辅助工具可导入浏览器 ${module.text}`);
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    }
  }
  for (const dir of ["src", "scripts", "test", "extensions"])
    if (existsSync(join(root, dir))) scan(dir);
  return issues;
}

if (import.meta.main) {
  const issues = inspectTestBoundaries(process.cwd());
  if (issues.length > 0) {
    console.error(issues.join("\n"));
    process.exit(1);
  }
  console.log("[test-boundaries] 无常驻浏览器回归入口");
}
