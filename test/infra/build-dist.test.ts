// #1434:CLI 与产物新鲜度接缝。真实小型 Vite 项目守成功复用/输入失效/失败退出,
// 不镜像标记内部结构。真实 tsc/Vite/中断场景约 19s,按进程类判据入慢池;
// 默认池不启动打包夹具,修改本文件时由慢池 canary 定向守住。
import { afterEach, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const roots: string[] = [];
const testBuild = test.skipIf(!process.env.DAFUNG_SLOW);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

function fixture(): string {
  mkdirSync(join(ROOT, "tmp"), { recursive: true });
  const root = mkdtempSync(join(ROOT, "tmp/build-dist-"));
  roots.push(root);
  for (const dir of ["src", "public", "scripts"]) mkdirSync(join(root, dir));
  cpSync(join(ROOT, "scripts"), join(root, "scripts"), { recursive: true });
  const { scripts } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", scripts }));
  cpSync(join(ROOT, "bun.lock"), join(root, "bun.lock"));
  writeFileSync(join(root, "index.html"), '<script type="module" src="/src/entry.ts"></script>');
  writeFileSync(
    join(root, "src/entry.ts"),
    'import { value } from "../scripts/bundled"; console.log(value);',
  );
  writeFileSync(join(root, "scripts/bundled.ts"), 'export const value: string = "first";');
  writeFileSync(join(root, "public/message.txt"), "resource");
  writeFileSync(join(root, "vite.config.ts"), "export default { build: { minify: false } };");
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { module: "esnext", moduleResolution: "bundler", skipLibCheck: true },
      include: ["src"],
    }),
  );
  writeFileSync(join(root, "tsconfig.scripts.json"), "{}");
  return root;
}

function run(root: string, command: string) {
  const child = Bun.spawnSync([process.execPath, "run", command], { cwd: root });
  return { code: child.exitCode, output: child.stdout.toString() + child.stderr.toString() };
}

function fresh(root: string): boolean {
  const script = `import { distFreshness } from ${JSON.stringify(join(ROOT, "scripts/dist-freshness.ts"))}; console.log(distFreshness().fresh);`;
  const child = Bun.spawnSync([process.execPath, "--eval", script], { cwd: root });
  expect(child.exitCode).toBe(0);
  return child.stdout.toString().trim() === "true";
}

testBuild(
  "常规 build 成功后可复用产物,再次 build 仍过类型门而免打包",
  () => {
    const root = fixture();
    const first = run(root, "build");
    expect(first.code, first.output).toBe(0);
    expect(fresh(root)).toBe(true);
    const second = run(root, "build");
    expect(second.code, second.output).toBe(0);
    expect(second.output).toContain("tsc --noEmit");
    expect(second.output).toContain("dist 新鲜,跳过打包");
    expect(fresh(fixture())).toBe(false); // 另一个 workspace/项目不能继承这份产物。
  },
  20_000,
);

testBuild(
  "源码/资源/配置/依赖与被打包脚本变化均失效,产物缺损也不可复用",
  () => {
    const root = fixture();
    expect(run(root, "build:bundle").code).toBe(0);
    const changes: [string, string][] = [
      [
        "src/entry.ts",
        'import { value } from "../scripts/bundled"; console.log("changed", value);',
      ],
      ["public/message.txt", "changed resource"],
      ["vite.config.ts", "export default { build: { minify: false, sourcemap: true } };"],
      ["package.json", readFileSync(join(root, "package.json"), "utf8") + "\n"],
      ["bun.lock", readFileSync(join(root, "bun.lock"), "utf8") + "\n"],
      ["scripts/bundled.ts", 'export const value: string = "second";'],
    ];
    for (const [path, content] of changes) {
      const original = readFileSync(join(root, path), "utf8");
      writeFileSync(join(root, path), content);
      expect(fresh(root), path).toBe(false);
      writeFileSync(join(root, path), original);
    }
    writeFileSync(join(root, "scripts/bundled.ts"), 'export const value: string = "second";');
    const rebuilt = run(root, "build:bundle");
    expect(rebuilt.code, rebuilt.output).toBe(0);
    expect(rebuilt.output).toContain("执行打包");
    expect(fresh(root)).toBe(true);
    const asset = readdirSync(join(root, "dist/assets")).find((name) => name.endsWith(".js"))!;
    expect(readFileSync(join(root, "dist/assets", asset), "utf8")).toContain("second");
    rmSync(join(root, "dist/assets", asset));
    expect(fresh(root)).toBe(false);
  },
  20_000,
);

testBuild(
  "类型失败/打包失败/进程中断均撤销完成判据,子进程退出码传到CLI",
  () => {
    const root = fixture();
    expect(run(root, "build:bundle").code).toBe(0);
    const entry = readFileSync(join(root, "src/entry.ts"), "utf8");
    writeFileSync(join(root, "src/entry.ts"), entry + '\nconst broken: number = "wrong";');
    const typeFailure = run(root, "build");
    expect(typeFailure.code, typeFailure.output).toBe(2);
    writeFileSync(join(root, "src/entry.ts"), entry);
    expect(fresh(root)).toBe(false); // 恢复原输入也不能让失败前的旧产物复活。

    const config = readFileSync(join(root, "vite.config.ts"), "utf8");
    for (const [action, code] of [
      ["process.exit(23)", 23],
      ['process.kill(process.pid, "SIGTERM")', null],
    ] as const) {
      expect(run(root, "build:bundle").code).toBe(0);
      writeFileSync(
        join(root, "vite.config.ts"),
        `export default { plugins: [{ name: "intentional-stop", buildStart() { ${action}; } }] };`,
      );
      const stopped = run(root, "build:bundle");
      if (code === null) expect(stopped.code, stopped.output).not.toBe(0);
      else expect(stopped.code, stopped.output).toBe(code);
      writeFileSync(join(root, "vite.config.ts"), config);
      expect(fresh(root)).toBe(false);
    }
    expect(run(root, "build:bundle").code).toBe(0);
    const lock = readFileSync(join(root, "bun.lock"));
    rmSync(join(root, "bun.lock"));
    expect(run(root, "build:bundle").code).not.toBe(0);
    writeFileSync(join(root, "bun.lock"), lock);
    expect(fresh(root)).toBe(false); // 无法确认输入而退出,也必须撤销旧完成判据。
  },
  20_000,
);
