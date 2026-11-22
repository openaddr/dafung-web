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
const CLIENT = "apps/client";
const CORE = "packages/core";
const DIST = join(CLIENT, "dist");
const catalog = JSON.stringify([
  {
    id: "demo",
    name: "内置地图",
    file: "boards/map.json",
    desc: "",
    tileCount: 1,
    targetNetWorth: 1,
  },
]);
const roots: string[] = [];
const testBuild = test.skipIf(!process.env.DAFUNG_SLOW);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

function fixture(): string {
  mkdirSync(join(ROOT, "tmp"), { recursive: true });
  const root = mkdtempSync(join(ROOT, "tmp/build-dist-"));
  roots.push(root);
  for (const dir of [
    join(CLIENT, "src"),
    join(CLIENT, "public"),
    join(CORE, "src/engine"),
    join(CORE, "maps/boards"),
    join(CORE, "extensions"),
    "apps/server",
    "scripts",
  ]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  for (const script of ["build-dist.ts", "dist-freshness.ts", "packaged-maps.ts"]) {
    cpSync(join(ROOT, "scripts", script), join(root, "scripts", script));
  }
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      type: "module",
      version: "2026.11.1",
      scripts: {
        "build:client": "bun scripts/build-dist.ts --typecheck",
        "build:bundle": "bun scripts/build-dist.ts",
      },
    }),
  );
  cpSync(join(ROOT, "bun.lock"), join(root, "bun.lock"));
  for (const pkg of [CLIENT, CORE]) {
    writeFileSync(join(root, pkg, "package.json"), '{"type":"module"}');
  }
  writeFileSync(
    join(root, CLIENT, "index.html"),
    '<script type="module" src="/src/entry.ts"></script>',
  );
  writeFileSync(
    join(root, CLIENT, "src/entry.ts"),
    'import { value } from "../../../packages/core/src/engine/bundled"; console.log(value);',
  );
  writeFileSync(join(root, CORE, "src/engine/bundled.ts"), 'export const value: string = "first";');
  writeFileSync(join(root, CORE, "maps/index.json"), catalog);
  writeFileSync(join(root, CORE, "maps/extra.json"), "{}");
  writeFileSync(join(root, CORE, "maps/boards/map.json"), '{"name":"内置地图"}');
  writeFileSync(join(root, CORE, "extensions/manifest.json"), "{}");
  writeFileSync(join(root, CLIENT, "public/message.txt"), "resource");
  cpSync(join(ROOT, CLIENT, "vite.config.ts"), join(root, CLIENT, "vite.config.ts"));
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { module: "esnext", moduleResolution: "bundler", skipLibCheck: true },
      include: ["src"],
    }),
  );
  writeFileSync(
    join(root, CLIENT, "tsconfig.json"),
    '{"extends":"../../tsconfig.json","include":["src"]}',
  );
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
  "build:client 产出 WebView 资源和内置地图,再次构建仍过类型门而免打包",
  () => {
    const root = fixture();
    const first = run(root, "build:client");
    expect(first.code, first.output).toBe(0);
    expect(readFileSync(join(root, DIST, "maps/index.json"), "utf8")).toBe(catalog);
    expect(readdirSync(join(root, DIST, "maps")).sort()).toEqual(["boards", "index.json"]);
    expect(readFileSync(join(root, DIST, "maps/boards/map.json"), "utf8")).toBe(
      '{"name":"内置地图"}',
    );
    expect(readFileSync(join(root, DIST, "message.txt"), "utf8")).toBe("resource");
    expect(fresh(root)).toBe(true);
    const second = run(root, "build:client");
    expect(second.code, second.output).toBe(0);
    expect(second.output).toContain("tsc --noEmit");
    expect(second.output).toContain("dist 新鲜,跳过打包");
    expect(fresh(fixture())).toBe(false); // 另一个 workspace/项目不能继承这份产物。
  },
  20_000,
);

testBuild(
  "客户端源码/资源/配置/依赖与共享包变化均失效,产物缺损也不可复用",
  () => {
    const root = fixture();
    expect(run(root, "build:bundle").code).toBe(0);
    const changes: [string, string][] = [
      [
        join(CLIENT, "src/entry.ts"),
        'import { value } from "../../../packages/core/src/engine/bundled"; console.log("changed", value);',
      ],
      [join(CLIENT, "public/message.txt"), "changed resource"],
      [join(CLIENT, "vite.config.ts"), "export default { build: { sourcemap: false } };"],
      [join(CLIENT, "package.json"), '{"type":"module","private":true}'],
      ["package.json", readFileSync(join(root, "package.json"), "utf8") + "\n"],
      ["scripts/packaged-maps.ts", "// 构建工具变更"],
      ["bun.lock", readFileSync(join(root, "bun.lock"), "utf8") + "\n"],
      [join(CORE, "src/engine/bundled.ts"), 'export const value: string = "second";'],
      [join(CORE, "maps/boards/map.json"), '{"name":"新内置地图"}'],
      [join(CORE, "extensions/manifest.json"), '{"id":"demo"}'],
    ];
    for (const [path, content] of changes) {
      const original = readFileSync(join(root, path), "utf8");
      writeFileSync(join(root, path), content);
      expect(fresh(root), path).toBe(false);
      writeFileSync(join(root, path), original);
    }
    writeFileSync(join(root, "apps/server/index.ts"), "throw Error('独立服务端代码');");
    expect(fresh(root)).toBe(true);
    writeFileSync(
      join(root, CORE, "src/engine/bundled.ts"),
      'export const value: string = "second";',
    );
    const rebuilt = run(root, "build:bundle");
    expect(rebuilt.code, rebuilt.output).toBe(0);
    expect(rebuilt.output).toContain("执行打包");
    expect(fresh(root)).toBe(true);
    const bundles = join(root, DIST, "bundles");
    const asset = readdirSync(bundles).find((name) => /^core-.*\.js$/.test(name))!;
    expect(readFileSync(join(bundles, asset), "utf8")).toContain("second");
    rmSync(join(bundles, asset));
    expect(fresh(root)).toBe(false);
  },
  20_000,
);

testBuild(
  "类型失败/打包失败/进程中断均撤销完成判据,子进程退出码传到CLI",
  () => {
    const root = fixture();
    expect(run(root, "build:bundle").code).toBe(0);
    const entryPath = join(root, CLIENT, "src/entry.ts");
    const entry = readFileSync(entryPath, "utf8");
    writeFileSync(entryPath, entry + '\nconst broken: number = "wrong";');
    const typeFailure = run(root, "build:client");
    expect(typeFailure.code, typeFailure.output).toBe(2);
    writeFileSync(entryPath, entry);
    expect(fresh(root)).toBe(false); // 恢复原输入也不能让失败前的旧产物复活。

    const configPath = join(root, CLIENT, "vite.config.ts");
    const config = readFileSync(configPath, "utf8");
    for (const [action, code] of [
      ["process.exit(23)", 23],
      ['process.kill(process.pid, "SIGTERM")', null],
    ] as const) {
      expect(run(root, "build:bundle").code).toBe(0);
      writeFileSync(
        configPath,
        `export default { plugins: [{ name: "intentional-stop", buildStart() { ${action}; } }] };`,
      );
      const stopped = run(root, "build:bundle");
      if (code === null) expect(stopped.code, stopped.output).not.toBe(0);
      else expect(stopped.code, stopped.output).toBe(code);
      writeFileSync(configPath, config);
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
