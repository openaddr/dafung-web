// 扩展包装载器单测(#378,ADR-0022 权威侧加载器,bun/node fs 通路):目录扫描/
// manifest 解析/入口动态 import/坏包当场炸/空目录=合法零包。临时包用 mkdtemp 现造,
// 示例包(hero-taishici)走真实 extensions/ 目录装一次验全链,用后精确卸载。
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadExtensionPackages, scanExtensionManifests } from "@core/extension-loader";
import { HEROES } from "@core/heroes";
import {
  registerExtensionAuthorityModule,
  registeredExtensionPackages,
  unregisterExtensionPackage,
} from "@core/extension-registry";

const EXTENSIONS_DIR = resolve(import.meta.dir, "../extensions");

/** 现造一个最小扩展包目录(内容全参数化,坏形状用例直接写坏数据)。 */
function makePkgDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "dafung-ext-"));
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

const GOOD_MANIFEST = JSON.stringify({
  id: "tmp-pkg",
  name: "临时包",
  version: "0.0.1",
  entry: "index.js",
});
// 唯一 id(随机后缀)防同进程重复注册冲突;英雄/效果同理。
const seq = () => Math.random().toString(36).slice(2, 8);
const goodEntry = (uid: string) =>
  `export default { heroes: [{ id: "tmp-hero-${uid}", name: "临时将", title: "", desc: "", image: "", skills: [] }], effects: {} };`;

const toUnload: string[] = [];
afterEach(() => {
  while (toUnload.length > 0) unregisterExtensionPackage(toUnload.pop()!);
});

describe("扩展包装载器(#378 权威侧 fs 通路)", () => {
  it("扩展目录不存在 → 炸(环境损坏不静默)", () => {
    expect(() => scanExtensionManifests("./no-such-extensions-dir")).toThrow(/扩展目录不存在/);
  });

  it("空目录 = 合法零包环境:装载返回空表", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dafung-ext-"));
    try {
      expect(await loadExtensionPackages(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("包缺 manifest.json → 炸;manifest 坏 JSON → 炸;字段违规 → 炸", () => {
    const noManifest = makePkgDir({ "pkg-a/index.js": "export default {};" });
    try {
      expect(() => scanExtensionManifests(noManifest)).toThrow(/缺 manifest\.json/);
    } finally {
      rmSync(noManifest, { recursive: true, force: true });
    }
    const badJson = makePkgDir({ "pkg-a/manifest.json": "{ not json" });
    try {
      expect(() => scanExtensionManifests(badJson)).toThrow(/不是合法 JSON/);
    } finally {
      rmSync(badJson, { recursive: true, force: true });
    }
    const badField = makePkgDir({
      "pkg-a/manifest.json": JSON.stringify({
        id: "x",
        name: "x",
        version: "0",
        entry: "../escape.js",
      }),
    });
    try {
      expect(() => scanExtensionManifests(badField)).toThrow(/平铺文件名/);
    } finally {
      rmSync(badField, { recursive: true, force: true });
    }
  });

  it("manifest 声明的入口文件缺失 → 炸(缺入口即炸)", async () => {
    const dir = makePkgDir({ "pkg-a/manifest.json": GOOD_MANIFEST });
    try {
      await expect(loadExtensionPackages(dir)).rejects.toThrow(/权威入口不存在/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("入口缺默认导出贡献对象 → 炸;合法包装载后注册面可见,卸载还原", async () => {
    const uid = seq();
    const badDir = makePkgDir({
      "pkg-a/manifest.json": GOOD_MANIFEST,
      "pkg-a/index.js": "export const x = 1;",
    });
    try {
      await expect(loadExtensionPackages(badDir)).rejects.toThrow(/缺默认导出/);
    } finally {
      rmSync(badDir, { recursive: true, force: true });
    }
    const goodDir = makePkgDir({
      "pkg-a/manifest.json": GOOD_MANIFEST.replace("tmp-pkg", `tmp-pkg-${uid}`),
      "pkg-a/index.js": goodEntry(uid),
    });
    try {
      const loaded = await loadExtensionPackages(goodDir);
      expect(loaded).toHaveLength(1);
      expect(HEROES.some((h) => h.id === `tmp-hero-${uid}`)).toBe(true);
      expect(registeredExtensionPackages().map((m) => m.id)).toContain(`tmp-pkg-${uid}`);
      toUnload.push(`tmp-pkg-${uid}`);
      unregisterExtensionPackage(`tmp-pkg-${uid}`);
      toUnload.pop();
      expect(HEROES.some((h) => h.id === `tmp-hero-${uid}`)).toBe(false);
    } finally {
      rmSync(goodDir, { recursive: true, force: true });
    }
  });

  it("真实示例包(extensions/hero-taishici)装载:名将/效果/台账三处注册,再注册同 id 炸", async () => {
    const before = HEROES.length;
    const loaded = await loadExtensionPackages(EXTENSIONS_DIR);
    const taishici = loaded.find((m) => m.id === "hero-taishici");
    expect(taishici).toBeDefined();
    expect(HEROES.length).toBe(before + 1);
    expect(HEROES.some((h) => h.id === "taishici")).toBe(true);
    toUnload.push("hero-taishici");
    // 幂等闸:同 id 二次装载 = bug,当场炸(而非静默去重)
    expect(() => registerExtensionAuthorityModule({ manifest: taishici! })).toThrow(/重复装载/);
  });
});
