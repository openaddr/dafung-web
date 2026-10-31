// 发版一条命令:出安卓安装包(APK)→ git tag → GitHub Releases(带 APK 资产)。
// 用法:bun scripts/release.ts [--draft] [--dry-run]
//   --draft   发布为草稿,网页核对后手动 publish
//   --dry-run 只跑前置对账,不构建不发布
// 前置:①主树运行(workspace 无 .git,git tag 通路不通);②@ 为空停靠且父=master@origin
//   (树上内容=发布内容);③Android 环境四件套在位(缺了 tauri build 自行响亮报错,不兜底);
//   ④gh 已登录(未登录 create 步自行红)。
// 版本单源 package.json(CalVer):发版前先 bump version 走 PR 合入 master(AGENTS.md 规约)。
// 签名现状:debug 签名包可装、同机可覆盖升级(签名=本机 debug.keystore);正式签名未配,
//   配好后再切 --release。出包配方与产物路径见 docs/how-to/开发与测试.md「安卓出包」。
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

const APK_DIR = "src-tauri/gen/android/app/build/outputs/apk/aarch64/debug";
const APK_PATH = `${APK_DIR}/app-aarch64-debug.apk`;
const ASSET_DIR = "tmp/release";

function run(cmd: string[], inherit = false): { ok: boolean; out: string } {
  const proc = Bun.spawnSync(
    cmd,
    inherit ? { stdout: "inherit", stderr: "inherit" } : { stdout: "pipe", stderr: "pipe" },
  );
  const out = inherit
    ? ""
    : `${proc.stdout?.toString() ?? ""}\n${proc.stderr?.toString() ?? ""}`.trim();
  return { ok: proc.exitCode === 0, out };
}

function red(msg: string): never {
  console.error(`[release] ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const draft = args.includes("--draft");
const dryRun = args.includes("--dry-run");
const known = ["--draft", "--dry-run"];
if (args.some((a) => !known.includes(a))) {
  red(
    `未知参数 ${args.filter((a) => !known.includes(a)).join(" ")}——用法:bun scripts/release.ts [--draft] [--dry-run]`,
  );
}

// 1) 主树闸:发版要 git tag + 推 tag。
if (!existsSync(".git")) red("请在主树运行:发版要 git tag + 推 tag,workspace 无 .git 走不通。");

// 0) 先 fetch 把 master@origin 拉新——对旧基线打 tag = 发出旧代码。
const fetched = run(["jj", "git", "fetch"]);
if (!fetched.ok) red(`jj git fetch 失败:${fetched.out}`);

// 2) 停靠位闸:@ 空、父=master@origin,树上内容才等于发布内容。
const masterId = run(["jj", "log", "-r", "master@origin", "--no-graph", "-T", "commit_id"]).out;
if (masterId.length !== 40) red(`master@origin 解析异常:${masterId}`);
const atEmpty = run([
  "jj",
  "log",
  "-r",
  "@",
  "--no-graph",
  "-T",
  'if(empty, "empty", "dirty")',
]).out;
const parentId = run(["jj", "log", "-r", "@-", "--no-graph", "-T", "commit_id"]).out;
if (atEmpty !== "empty")
  red("@ 非空——发布内容=树上内容,先清空 @(收账走 jj new master,残留先清掉)。");
if (parentId !== masterId) {
  red(
    `@ 父(${parentId.slice(0, 9)})不是 master@origin(${masterId.slice(0, 9)})——先收账对齐基线(jj new master@origin)。`,
  );
}

// 3) 版本与远端 tag 查重(版本号只能前进,重号即红)。
const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const tag = `v${version}`;
const remoteTag = run(["git", "ls-remote", "origin", `refs/tags/${tag}`]);
if (!remoteTag.ok) red(`git ls-remote 失败:${remoteTag.out}`);
if (remoteTag.out) red(`远端已有 ${tag}——先 bump package.json version 再发。`);
console.log(
  `[release] 发布目标 master@origin=${masterId.slice(0, 9)} tag=${tag}${draft ? " (draft)" : ""}${dryRun ? " (dry-run,到此为止)" : ""}`,
);
if (dryRun) process.exit(0);

// 4) 出包 + 版本对账。
const build = run(["bunx", "tauri", "android", "build", "--debug", "--target", "aarch64"], true);
if (!build.ok) red("tauri android build 失败——环境四件套/上游报错看上方输出。");
if (!existsSync(APK_PATH)) red(`产物不在预期位置:${APK_PATH}`);
const meta = JSON.parse(readFileSync(`${APK_DIR}/output-metadata.json`, "utf8")) as {
  elements?: { versionName?: string }[];
};
const apkVersion = meta.elements?.[0]?.versionName;
if (apkVersion !== version) {
  red(
    `版本对账失败:APK versionName=${apkVersion} ≠ package.json ${version}——产物陈旧或 tauri.conf 引用链断,先排查。`,
  );
}

// 5) tag + 推远端(幂等:同指已存在跳过;异指红出人工核对)。
const localTag = run(["git", "rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`]);
if (localTag.ok && localTag.out !== masterId) {
  red(
    `本地 ${tag} 已存在且指向 ${localTag.out.slice(0, 9)} ≠ ${masterId.slice(0, 9)}——人工核对后删重打。`,
  );
}
if (!localTag.ok && !run(["git", "tag", tag, masterId]).ok) red("git tag 失败。");
if (!run(["git", "push", "origin", `refs/tags/${tag}`], true).ok) {
  red("推 tag 失败——修好网络/权限重跑(已做步骤幂等跳过)。");
}

// 6) 发 Release(资产改名带版本号;--generate-notes 按提交史生成 body)。
mkdirSync(ASSET_DIR, { recursive: true });
const asset = `${ASSET_DIR}/${tag}-aarch64.apk`;
copyFileSync(APK_PATH, asset);
const ghArgs = [
  "gh",
  "release",
  "create",
  tag,
  asset,
  "--verify-tag",
  "--generate-notes",
  "--title",
  tag,
];
if (draft) ghArgs.push("--draft");
const created = run(ghArgs, true);
if (!created.ok)
  red(
    `gh release create 失败——若 Release 已存在,gh release view ${tag} 核对后手动补资产或删了重跑。`,
  );
console.log(
  `[release] 完成:${tag} 已发布,资产 ${asset}(debug 签名,可装机);标题/notes 可 gh release edit 润色。`,
);
