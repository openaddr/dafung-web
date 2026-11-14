// 本地验证编排(#1439):只选择/调用既有检查,结果绑定 jj 跟踪内容与精确基线。
// plan 只预览;run 串行执行且逐步核内容;verify 不接受改码后的旧结果。
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";

interface Check {
  id: string;
  command: string[];
  env: Record<string, string>;
  reasons: Array<{ path: string; reason: string }>;
}

interface Plan {
  commit: string;
  contentSha256: string;
  base: { revision: string; commit: string };
  changes: string[];
  profiles: string[];
  e2e: string[];
  checks: Check[];
}

const CHECKS: Record<string, { command: string[]; env: Record<string, string> }> =
  Object.fromEntries(
    [
      "lint",
      "check:fmt",
      "build",
      "test",
      "typecheck:scripts",
      "check:core",
      "check:goldens",
      "check:sim-bench",
      "check:board",
      "check:agents-budget",
    ].map((id) => [id, { command: [process.execPath, "run", id], env: {} }]),
  );
CHECKS["test:protocol"] = {
  command: [
    process.execPath,
    "test",
    "test/online/protocol-online.test.ts",
    "test/online/server-cmd-error.test.ts",
  ],
  env: { DAFUNG_SLOW: "1" },
};
CHECKS["test:recovery"] = {
  command: [
    process.execPath,
    "test",
    "test/online/room-recovery.test.ts",
    "test/online/online-recovery.test.ts",
    "test/online/online-dual-run.test.ts",
  ],
  env: { DAFUNG_SLOW: "1" },
};
CHECKS["test:build"] = {
  command: [process.execPath, "test", "test/infra/build-dist.test.ts"],
  env: { DAFUNG_SLOW: "1" },
};
CHECKS["test:release-guard"] = {
  command: [process.execPath, "test", "test/infra/test-release.test.ts"],
  env: { DAFUNG_SLOW: "1" },
};
CHECKS["test:validation"] = {
  command: [process.execPath, "test", "test/infra/validation-selection.test.ts"],
  env: { DAFUNG_SLOW: "1" },
};
CHECKS.test!.env = { DAFUNG_SLOW: "" }; // 基础门禁固定快池,不受调用者的慢池开关污染。

// 生产变更域唯一选择表。多个域同时命中时取并集;显式 profile 也只能增加。
const DOMAINS: Record<
  string,
  { paths: RegExp; checks: string[]; e2e?: string[]; requiresE2e?: boolean }
> = {
  ordinary: {
    paths:
      /^(?:docs\/|.*\.md$|\.(?:gitignore|gitattributes|oxlintrc\.json|oxfmtrc\.json)$|test\/|(?:package\.json|bun\.lock|bunfig\.toml|tsconfig[^/]*\.json)$)/,
    checks: [],
  },
  scripts: {
    paths:
      /^scripts\/(?:bot-driver|build-dist|bun-release|check-[\w-]+|cli|cost-probe|dev-ports|dev|dist-freshness|e2e-one|e2e-watermark|engine-helpers|event-batch|fault-proxy|fetch-asset|frame-probe|generate-theme-tokens|mobile-context|online-client|play|pr-merge|procs|release|room-persistence|room-record|room|seat-projection|server|shot|sim-batch|sim-bench|sim-digest|sim-jinnang|state-digest|test-corpus|test-lock|validate|visual-compare|watchdogs|whole-game|wire|ws-new|ws-run)\.(?:ts|mjs)$/,
    checks: ["typecheck:scripts"],
  },
  engine: {
    paths:
      /^(?:src\/core\/|extensions\/(?!.*\.md$)|public\/(?:maps|config)\/|scripts\/(?:whole-game|state-digest|test-corpus|bot-driver|engine-helpers)\.ts$)/,
    checks: ["check:core", "check:goldens"],
  },
  economy: {
    paths:
      /^(?:src\/core\/(?!(?:theme|geometry|planter|testing|game-events|event-tiers|guohao|model|snapshot|extension-contract)\.ts$)|extensions\/(?!.*\.md$)|public\/(?:maps|config)\/|scripts\/(?:whole-game|bot-driver|engine-helpers)\.ts$)/,
    checks: ["check:sim-bench"],
  },
  protocol: {
    paths:
      /^(?:scripts\/(?:wire|server|room|seat-projection|event-batch|room-record|room-persistence|watchdogs|bot-driver|online-client|fault-proxy)\.ts$|src\/app\/(?:net\/|controllers\/|store\/)|src\/core\/(?:authority|model|snapshot|game-events|event-tiers)\.ts$)/,
    checks: ["test:protocol", "test:recovery"],
  },
  recovery: {
    paths:
      /^(?:scripts\/(?:room|room-record|room-persistence)\.ts$|src\/core\/snapshot\.ts$|src\/app\/net\/(?:reconnecting-socket|snapshot-effects)\.ts$)/,
    checks: ["test:recovery"],
  },
  board: {
    paths: /^(?:src\/app\/components\/board\/|src\/core\/(?:geometry|theme)\.ts$)/,
    checks: ["check:board"],
    e2e: ["e2e/geometry/react-board-layers.spec.ts", "e2e/geometry/react-ambient-align.spec.ts"],
  },
  styles: { paths: /\.css$/, checks: ["check:board"], requiresE2e: true },
  ui: {
    paths: /^(?:src\/app\/(?!(?:net|controllers|store)\/)|src\/styles\/|public\/|index\.html$)/,
    checks: [],
    requiresE2e: true,
  },
  browser: {
    paths:
      /^(?:playwright\.config\.[cm]?[jt]s$|e2e\/(?!.*\.md$)|scripts\/(?:mobile-context|e2e-one|e2e-watermark|shot|frame-probe|cost-probe|visual-compare)\.(?:ts|mjs)$)/,
    checks: [],
    requiresE2e: true,
  },
  agents: { paths: /^AGENTS\.md$/, checks: ["check:agents-budget"] },
  build: {
    paths: /^(?:scripts\/(?:build-dist|dist-freshness)\.ts$|vite\.config\.[cm]?[jt]s$)/,
    checks: ["test:build"],
  },
  guard: {
    paths: /^(?:scripts\/(?:bun-release|test-lock|e2e-one)\.ts$|playwright\.config\.[cm]?[jt]s$)/,
    checks: ["test:release-guard"],
  },
  validation: { paths: /^scripts\/validate\.ts$/, checks: ["test:validation"] },
};

interface Result {
  format: 1;
  cwd: string;
  environment: Record<string, string>;
  plan: Plan;
  base: Plan["base"];
  contentSha256: string;
  startedAt: string;
  finishedAt: string | null;
  elapsedMs: number | null;
  status: "running" | "passed" | "failed";
  results: Array<
    Check & { startedAt: string; finishedAt: string; elapsedMs: number; exitCode: number }
  >;
}

function jj(...args: string[]): string {
  const child = Bun.spawnSync(["jj", ...args], { stdout: "pipe", stderr: "pipe" });
  if (child.exitCode !== 0) throw new Error(`jj ${args.join(" ")}: ${child.stderr.toString()}`);
  return child.stdout.toString().trim();
}

function currentContent(): { commit: string; contentSha256: string } {
  const commit = jj("log", "-r", "@", "--no-graph", "-T", "commit_id");
  const paths = jj("file", "list", "-r", commit)
    .split("\n")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"))
    .sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    const symbolic = lstatSync(path).isSymbolicLink();
    const contents = symbolic ? Buffer.from(readlinkSync(path)) : readFileSync(path);
    hash.update(`${path}\0${symbolic ? "link" : "file"}\0`);
    hash.update(createHash("sha256").update(contents).digest());
  }
  if (jj("log", "-r", "@", "--no-graph", "-T", "commit_id") !== commit)
    throw new Error("读取验证指纹期间工作副本发生变化");
  return { commit, contentSha256: hash.digest("hex") };
}

function assertCurrent(contentSha256: string): void {
  if (currentContent().contentSha256 !== contentSha256)
    throw new Error("代码内容已变化,旧验证结果不可用于当前树;请重新 plan/run");
}

function plan(base: string, profiles: string[], requestedE2e: string[]): Plan {
  const current = currentContent();
  const baseCommit = jj("log", "-r", base, "--no-graph", "-T", "commit_id");
  if (!/^[a-f0-9]{40}$/.test(baseCommit)) throw new Error("--base 必须解析为唯一完整提交");
  if (
    jj("log", "-r", `${baseCommit} & ::${current.commit}`, "--no-graph", "-T", "commit_id") !==
    baseCommit
  )
    throw new Error("--base 必须是当前提交的祖先");
  const changes = jj("diff", "--from", baseCommit, "--to", current.commit, "--name-only")
    .split("\n")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"))
    .sort();
  const selected = new Map<string, Check>();
  const browserSpecs = new Set<string>(requestedE2e);
  const add = (id: string, path: string, reason: string): void => {
    const check = selected.get(id);
    if (check) {
      if (!check.reasons.some((item) => item.path === path && item.reason === reason))
        check.reasons.push({ path, reason });
    } else selected.set(id, { id, ...CHECKS[id]!, reasons: [{ path, reason }] });
  };
  for (const id of ["lint", "check:fmt", "build", "test"]) add(id, "*", "所有变更基础门禁");
  for (const profile of profiles) {
    if (!Object.hasOwn(DOMAINS, profile))
      throw new Error(`未知 --profile:${profile};可选 ${Object.keys(DOMAINS).join(",")}`);
    for (const id of DOMAINS[profile]!.checks) add(id, "--profile", `${profile} 显式补充域`);
    for (const spec of DOMAINS[profile]!.e2e ?? []) browserSpecs.add(spec);
    if (DOMAINS[profile]!.requiresE2e && requestedE2e.length === 0)
      throw new Error(`${profile} 需用 --e2e <相关spec> 明确浏览器范围`);
  }
  for (const path of changes) {
    const matches = Object.entries(DOMAINS).filter(([, domain]) => domain.paths.test(path));
    if (matches.length === 0 && profiles.length === 0)
      throw new Error(`未知影响域:${path};请显式选择 --profile`);
    for (const [name, domain] of matches)
      for (const id of domain.checks) add(id, path, `${name} 生产影响域`);
    const mapped = matches.flatMap(([, domain]) => domain.e2e ?? []);
    if (/^e2e\/.+\.spec\.ts$/.test(path) && existsSync(path)) mapped.push(path);
    if (
      matches.some(([, domain]) => domain.requiresE2e) &&
      mapped.length === 0 &&
      requestedE2e.length === 0
    )
      throw new Error(`UI/浏览器影响域 ${path} 无确定映射;请用 --e2e <相关spec> 明确范围`);
    for (const spec of mapped) browserSpecs.add(spec);
    for (const id of ["lint", "check:fmt", "build", "test"])
      add(
        id,
        path,
        matches.length > 0
          ? `变更域:${matches.map(([name]) => name).join(",")}`
          : `显式分类:${profiles.join(",")}`,
      );
  }
  // 改过的慢例保留原 canary,生产映射选中的同一文件直接补理由,不再启动一次。
  for (const path of changes.filter(
    (path) =>
      /^test\/.+\.test\.tsx?$/.test(path) &&
      existsSync(path) &&
      readFileSync(path, "utf8").includes("DAFUNG_SLOW"),
  )) {
    const covered = [...selected.values()].find((check) => check.command.includes(path));
    if (covered) add(covered.id, path, "修改含 DAFUNG_SLOW 的测试,已由本定向检查覆盖");
    else {
      const id = `test:canary:${path}`;
      CHECKS[id] = { command: [process.execPath, "test", path], env: { DAFUNG_SLOW: "1" } };
      add(id, path, "修改含 DAFUNG_SLOW 的测试");
    }
  }
  for (const spec of browserSpecs) {
    if (!/^e2e\/[\w/-]+\.spec\.ts$/.test(spec) || !existsSync(spec))
      throw new Error(`--e2e 必须是存在的仓库相对 spec 路径:${spec}`);
  }
  if (browserSpecs.size > 0) {
    CHECKS["test:e2e:selected"] = {
      command: [process.execPath, "scripts/e2e-one.ts", ...[...browserSpecs].sort()],
      env: {},
    };
    add("test:e2e:selected", "--e2e/域映射", "定向浏览器回路,沿用 build/水位/flaky 守门");
  }
  return {
    ...current,
    base: { revision: base, commit: baseCommit },
    changes,
    profiles,
    e2e: [...browserSpecs].sort(),
    checks: [...selected.values()],
  };
}

async function run(selected: Plan, output: string | null): Promise<number> {
  const receipt = resolve(
    output ??
      `tmp/validation/${Date.now()}-${selected.contentSha256.slice(0, 12)}-${randomUUID()}.json`,
  );
  const localPath = relative(resolve("tmp"), receipt);
  if (localPath.startsWith("..") || resolve("tmp", localPath) !== receipt)
    throw new Error("--out 必须位于本 workspace 的 tmp/ 内");
  mkdirSync(dirname(receipt), { recursive: true });
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name, value]) => value !== undefined && /^(?:DAFUNG_|E2E_|VITE_|NODE_ENV$)/.test(name),
    ),
  ) as Record<string, string>;
  const result: Result = {
    format: 1,
    cwd: process.cwd(),
    environment,
    plan: selected,
    base: selected.base,
    contentSha256: selected.contentSha256,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    elapsedMs: null,
    status: "running",
    results: [],
  };
  const save = () => writeFileSync(receipt, JSON.stringify(result, null, 2) + "\n");
  writeFileSync(receipt, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); // 每轮独立证据,禁止覆盖。
  const runStart = performance.now();
  console.log(JSON.stringify(selected, null, 2));
  try {
    for (const check of selected.checks) {
      assertCurrent(selected.contentSha256);
      const startedAt = new Date().toISOString();
      const start = performance.now();
      console.log(`[validate] ${check.id}: ${JSON.stringify(check.command)}`);
      const child = Bun.spawn(check.command, {
        env: { ...process.env, ...check.env },
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await child.exited;
      result.results.push({
        ...check,
        startedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - start),
        exitCode,
      });
      save();
      assertCurrent(selected.contentSha256);
      if (exitCode !== 0) {
        result.status = "failed";
        return exitCode;
      }
    }
    result.status = "passed";
    return 0;
  } finally {
    if (result.status === "running") result.status = "failed";
    result.finishedAt = new Date().toISOString();
    result.elapsedMs = Math.round(performance.now() - runStart);
    save();
    console.log(`[validate] ${result.status}: ${resolve(receipt)}`);
  }
}

async function main(): Promise<number> {
  if (resolve(jj("root")) !== process.cwd())
    throw new Error("请从 jj workspace 根目录运行 validate");
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "verify") {
    if (args.length !== 1) throw new Error("用法:validate verify <结果文件>");
    const receipt = JSON.parse(readFileSync(args[0]!, "utf8")) as Result;
    if (
      receipt.format !== 1 ||
      receipt.status !== "passed" ||
      receipt.finishedAt === null ||
      receipt.results.length === 0 ||
      receipt.results.length !== receipt.plan.checks.length ||
      receipt.results.some((check) => check.exitCode !== 0)
    )
      throw new Error("验证结果未完整通过");
    assertCurrent(receipt.contentSha256);
    const selected = plan(receipt.base.commit, receipt.plan.profiles, receipt.plan.e2e);
    if (
      selected.contentSha256 !== receipt.plan.contentSha256 ||
      JSON.stringify(selected.checks) !== JSON.stringify(receipt.plan.checks) ||
      receipt.results.some(
        (check, index) =>
          JSON.stringify({
            id: check.id,
            command: check.command,
            env: check.env,
            reasons: check.reasons,
          }) !== JSON.stringify(selected.checks[index]),
      )
    )
      throw new Error("验证记录的选择范围/实际执行与当前计划不一致");
    console.log("[validate] 当前内容与完整通过的验证结果一致");
    return 0;
  }
  if ((mode !== "plan" && mode !== "run") || args[0] !== "--base" || !args[1])
    throw new Error("用法:validate plan|run --base <rev> / validate verify <结果文件>");
  const profiles: string[] = [];
  const e2e: string[] = [];
  let output: string | null = null;
  for (let i = 2; i < args.length; i += 2) {
    if (!args[i + 1]) throw new Error("参数缺值");
    if (args[i] === "--profile") profiles.push(args[i + 1]!);
    else if (args[i] === "--e2e") e2e.push(args[i + 1]!);
    else if (args[i] === "--out" && mode === "run" && output === null) output = args[i + 1]!;
    else throw new Error(`未知参数:${args[i]}`);
  }
  const selected = plan(args[1], [...new Set(profiles)], [...new Set(e2e)]);
  if (mode === "plan") {
    console.log(JSON.stringify(selected, null, 2));
    return 0;
  }
  return run(selected, output);
}

try {
  process.exit(await main());
} catch (error) {
  console.error(`[validate] ${String(error)}`);
  process.exit(1);
}
