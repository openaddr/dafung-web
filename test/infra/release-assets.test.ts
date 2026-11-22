import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishReleaseAssets } from "../../scripts/release";

const TAG = "v2026.11.1";
const COMMIT = "a".repeat(40);
const RELEASES = "repos/openaddr/dafung-web/releases";
const APK = {
  name: "v2026.11.1-aarch64.apk",
  size: 3,
  digest: "sha256:dd37c2d7274f7ea982cb83390c36918fee9ce8889073c44b68cdc00bdb8c3e04",
  browser_download_url: "https://example.test/download/apk",
};
const SERVER = {
  name: "dafung-server-v2026.11.1.tar.gz",
  size: 14,
  digest: "sha256:cb9bd4b731cf502b6eab98c3676d762b401d5cf68b0c846f54dbd10c89daa716",
  browser_download_url: "https://example.test/download/server",
};
const RELEASE_URL = "https://example.test/release/123";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

function fixture(local?: string, remote?: string) {
  const root = mkdtempSync(join(tmpdir(), "dafung-release-assets-"));
  roots.push(root);
  const apk = join(root, APK.name);
  const archive = join(root, SERVER.name);
  writeFileSync(apk, "apk");
  writeFileSync(archive, "server archive");
  const writes: string[] = [];
  const release = {
    id: 123,
    tag_name: TAG,
    target_commitish: "master",
    draft: true,
    prerelease: false,
    html_url: RELEASE_URL,
    assets: [] as (typeof APK)[],
  };
  let created = remote !== undefined;
  let uploadedAsset = (asset: typeof APK) => asset;
  let afterUpload = () => {};
  let afterPublish = () => {};
  const run = (argv: string[]) => {
    const [program, command, endpoint] = argv;
    const method = argv[argv.indexOf("--method") + 1];
    if (program === "git" && command === "tag") {
      if (endpoint === "--list") return local ? TAG : "";
      writes.push("tag");
      local = argv[3];
      return "";
    }
    if (program === "git" && command === "rev-parse") return local || "";
    if (program === "git" && command === "ls-remote") {
      return remote ? `${remote}\trefs/tags/${TAG}` : "";
    }
    if (program === "git" && command === "push") {
      writes.push("push");
      if (remote) throw new Error("远端标签已存在");
      remote = COMMIT;
      return "";
    }
    if (program === "gh" && command === "api") {
      if (endpoint === RELEASES && method === "POST") {
        writes.push("create");
        created = true;
        release.draft = argv.includes("draft=true");
        return JSON.stringify(release);
      }
      if (endpoint === RELEASES) return created ? JSON.stringify(release) : "";
      if (endpoint === `${RELEASES}/${release.id}` && method === "PATCH") {
        writes.push("publish");
        release.draft = false;
        afterPublish();
        return JSON.stringify(release);
      }
      if (endpoint?.startsWith(`https://uploads.github.com/${RELEASES}/${release.id}/assets?`)) {
        const name = new URL(endpoint).searchParams.get("name");
        const asset = [APK, SERVER].find((value) => value.name === name);
        if (!asset || release.assets.some((value) => value.name === name)) {
          throw new Error(`意外或重复上传:${name}`);
        }
        writes.push(asset.name);
        release.assets.push(uploadedAsset(asset));
        afterUpload();
        return "";
      }
    }
    throw new Error(`意外的发布命令:${argv.join(" ")}`);
  };
  const apkReport = { apk, size: APK.size, sha256: APK.digest.slice("sha256:".length) };
  return {
    writes,
    release,
    uploadAs: (transform: typeof uploadedAsset) => {
      uploadedAsset = transform;
    },
    afterUpload: (callback: () => void) => {
      afterUpload = callback;
    },
    afterPublish: (callback: () => void) => {
      afterPublish = callback;
    },
    publish: (draft: boolean, reusePrepared = false) =>
      publishReleaseAssets(
        TAG,
        apkReport,
        { path: archive, size: SERVER.size, sha256: SERVER.digest.slice("sha256:".length) },
        draft,
        run,
        COMMIT,
        reusePrepared,
      ),
    archive,
  };
}

test("同一草稿 Release 上传并核验 arm64 APK 与服务端包", () => {
  const host = fixture();
  const report = host.publish(true);
  expect(host.writes).toEqual(["tag", "push", "create", APK.name, SERVER.name]);
  expect(host.release.draft).toBe(true);
  expect(report).toEqual({
    releaseUrl: RELEASE_URL,
    downloadUrl: APK.browser_download_url,
    serverArchive: {
      path: host.archive,
      size: SERVER.size,
      sha256: SERVER.digest.slice("sha256:".length),
      downloadUrl: SERVER.browser_download_url,
    },
  });
});

test("要求公开时，远端服务端包摘要核对失败的 Release 保留为草稿", () => {
  const host = fixture();
  host.uploadAs((asset) => (asset.name === SERVER.name ? { ...asset, digest: APK.digest } : asset));
  expect(() => host.publish(false)).toThrow("远端 Release 资产与本地文件不一致");
  expect(host.release.draft).toBe(true);
  expect(host.writes).toEqual(["tag", "push", "create", APK.name, SERVER.name]);
});

test("同一提交重试仅补齐缺少资产，再按已核验的草稿 ID 公开", () => {
  const host = fixture(COMMIT, COMMIT);
  host.release.assets = [APK];
  expect(host.publish(false).downloadUrl).toBe(APK.browser_download_url);
  expect(host.writes).toEqual([SERVER.name, "publish"]);
  expect(host.release.draft).toBe(false);
  expect(() => host.publish(false)).toThrow("已公开发布");
  expect(host.writes).toEqual([SERVER.name, "publish"]);
});

test("预检拦下冲突的标签或草稿资产，发布前拦下被换掉的草稿", () => {
  const wrongTag = fixture(COMMIT, "b".repeat(40));
  expect(() => wrongTag.publish(false)).toThrow("指向其他提交");
  expect(wrongTag.writes).toEqual([]);

  const badAssets = fixture(COMMIT, COMMIT);
  for (const assets of [
    [APK, SERVER, { ...SERVER, name: "extra.tar.gz" }],
    [APK, { ...SERVER, name: "wrong.tar.gz" }],
    [APK, { ...SERVER, size: SERVER.size + 1 }],
    [{ ...APK, digest: SERVER.digest }, SERVER],
  ]) {
    badAssets.release.assets = assets;
    expect(() => badAssets.publish(false)).toThrow("远端 Release 资产");
    expect(badAssets.writes).toEqual([]);
  }

  const replaced = fixture(COMMIT, COMMIT);
  replaced.release.assets = [APK];
  replaced.afterUpload(() => {
    replaced.release.id += 1;
  });
  expect(() => replaced.publish(false)).toThrow("草稿身份发生变化");
  expect(replaced.release.draft).toBe(true);
  expect(replaced.writes).toEqual([SERVER.name]);
});

test("客户端签名核验后记录的两项摘要用于发布，服务端包被改写时不上传", () => {
  const host = fixture(COMMIT, COMMIT);
  writeFileSync(host.archive, "modified archive");
  expect(() => host.publish(false)).toThrow("交付前资产内容发生变化");
  expect(host.writes).toEqual([]);
});

test("公开请求已生效但丢失响应时，同一份本地回执可只读补验", () => {
  const host = fixture(COMMIT, COMMIT);
  host.release.assets = [APK, SERVER];
  host.afterPublish(() => {
    throw new Error("发布响应丢失");
  });
  expect(() => host.publish(false)).toThrow("发布响应丢失");
  expect(host.release.draft).toBe(false);
  expect(() => host.publish(false)).toThrow("已公开发布");
  expect(() => host.publish(true, true)).toThrow("已公开发布");
  expect(host.publish(false, true).serverArchive.downloadUrl).toBe(SERVER.browser_download_url);
  host.release.assets = [APK];
  expect(() => host.publish(false, true)).toThrow("远端 Release 资产缺失");
  expect(host.writes).toEqual(["publish"]);
});
