// 从 Wikimedia Commons 或 三国杀 wiki(patchwiki)抓图,落到 public/assets/<category>/,
// 并登记进 manifest.json + CREDITS.md。无原生依赖。
//
// 用法:
//   # Commons 搜索模式(限 Wikimedia Commons):
//   bun scripts/fetch-asset.ts --id hero:zhouyu   --query "Zhou Yu Three Kingdoms portrait" --category heroes
//   bun scripts/fetch-asset.ts --id treasure:seal --query "Imperial Seal of China jade"      --category treasures --width 256
//
//   # 三国杀 wiki 模式(武将立绘扩容,默认 --category heroes;完整流程见 docs/how-to/扩将指南.md):
//   bun scripts/fetch-asset.ts --id hero:simayi:sgs --wiki "https://wiki.biligame.com/sgs/index.php?curid=2199"
//   bun scripts/fetch-asset.ts --id hero:simayi:sgs --wiki "https://wiki.biligame.com/sgs/文件:司马懿-经典形象.png"
//   bun scripts/fetch-asset.ts --id hero:simayi:sgs --wiki "https://patchwiki.biligame.com/images/sgs/0/0a/<hash>.png"
//
//   # noname 模式(#507:开源杀 jsdelivr 镜像;拼音→武将映射人工核对,见 docs/design/素材映射.md):
//   bun scripts/fetch-asset.ts --id hero:huatuo:noname --noname huatuo --webp 82 --avatar 200
//   bun scripts/fetch-asset.ts --id texture:lanting --noname lanting_bg --noname-dir background --category textures --webp 80 --max-height 1200
//
//   # 本地克隆模式(FreeKill 等本地仓库素材;授权需显式 --license,否则记 unknown 并 review_required):
//   bun scripts/fetch-asset.ts --id hero:x:fk --local /path/to/FreeKill/asset/hero/x.png --webp 82
//
//   # Freesound 模式(#507 新音效;强制 CC0,ogg 预算默认 50KB,超预算抛错不裁剪):
//   bun scripts/fetch-asset.ts --id audio:rain --freesound https://freesound.org/s/437166/ --category audio
//
//   # Commons 音频模式(--kind audio:只收 audio/ogg;可加 --max-bytes 51200 预算):
//   bun scripts/fetch-asset.ts --id audio:rain --query "rain ogg" --category audio --kind audio --max-bytes 51200
//
//   # Commons File 直取模式(#521 珍宝画心:选图靠人工审图定文件,不靠搜索排序;
//   可加 --webp 82 走 Pillow 转换):
//   bun scripts/fetch-asset.ts --id treasure:seal --commons-file "File:Qing Jade Seal 01.jpg" --category treasures --width 480 --webp 82
//
// Commons 模式:跳过非图文件(PDF/DjVu 书扫);优先 SVG/矢量;429 退避重试。
// wiki 模式:File 页(curid 或「文件:」标题)走 imageinfo API 取原图直链 + 上传者 + 尺寸口径;
//   patchwiki 缩略图直链自动还原为原图;下载后按 PNG 签名读 IHDR 尺寸,与 API 口径不符即抛错;
//   授权口径固定为「学习/朋友娱乐,不商用」,review_required=true(APK 公开发布前人工复核)。
// noname/local 模式:素材源头为三国杀系原画,review_required=true;--webp/--max-height/--avatar
//   走本机 python+Pillow 转换(缺依赖直接抛错,不静默跳过),转换后删中间原件只留 webp。
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ASSETS = join(ROOT, "public/assets");
const MANIFEST = join(ASSETS, "manifest.json");
const CREDITS = join(ASSETS, "CREDITS.md");
const UA = "dafung-web/1.0 (asset-fetcher; contact: repo)"; // Wikimedia 政策要求描述性 UA
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Args {
  id: string;
  query?: string;
  commonsFile?: string;
  wiki?: string;
  noname?: string;
  nonameDir: string;
  local?: string;
  freesound?: string;
  license?: string;
  kind: string;
  category: string;
  width: number;
  limit: number;
  webp?: number;
  maxHeight?: number;
  avatar?: number;
  maxBytes?: number;
}
function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const has = (k: string) => a.includes(`--${k}`);
  const num = (k: string): number | undefined => {
    const v = get(k);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${k} 不是正数:${v}`);
    return n;
  };
  const id = get("id");
  const query = get("query");
  const commonsFile = get("commons-file");
  const wiki = get("wiki");
  const noname = get("noname");
  const local = get("local");
  const freesound = get("freesound");
  const sources = [query, commonsFile, wiki, noname, local, freesound].filter(
    (s) => s !== undefined,
  );
  if (!id || sources.length !== 1) {
    console.error(
      "用法(六源二选一,恰好给一个):\n" +
        "  fetch-asset.ts --id <id> --query <搜索词> [--category heroes|treasures|tiles] [--width 256] [--limit 8] [--kind image|audio] [--max-bytes N]  # Commons 搜索\n" +
        '  fetch-asset.ts --id <id> --commons-file "File:标题.jpg" [--category treasures] [--width 480] [--webp 82]     # Commons File 直取\n' +
        "  fetch-asset.ts --id <id> --wiki <wikiFile页URL|patchwiki直链> [--category heroes]                       # 三国杀 wiki 立绘\n" +
        "  fetch-asset.ts --id <id> --noname <拼音文件名> [--noname-dir character|background] [--webp 82] [--max-height N] [--avatar 200]  # noname jsdelivr\n" +
        '  fetch-asset.ts --id <id> --local <文件路径> [--license "文本"] [--webp 82] [--max-height N] [--avatar 200]  # 本地克隆(FreeKill 等)\n' +
        "  fetch-asset.ts --id <id> --freesound <音效页URL|数字id> [--category audio] [--max-bytes 51200]           # Freesound(强制 CC0)",
    );
    process.exit(2);
  }
  const nonameDir = get("noname-dir") ?? "character";
  if (noname && nonameDir !== "character" && nonameDir !== "background")
    throw new Error(`--noname-dir 只收 character|background:${nonameDir}`);
  const kindAudio = get("kind") === "audio";
  const defaultCategory = wiki
    ? "heroes"
    : noname
      ? nonameDir === "background"
        ? "textures"
        : "heroes"
      : freesound || kindAudio
        ? "audio"
        : "misc";
  return {
    id,
    query,
    commonsFile,
    wiki,
    noname,
    nonameDir,
    local,
    freesound,
    license: get("license"),
    kind: get("kind") ?? "image",
    category: get("category") ?? defaultCategory,
    width: parseInt(get("width") ?? "240", 10),
    limit: parseInt(get("limit") ?? "8", 10),
    webp: get("webp") ? num("webp") : undefined,
    maxHeight: has("max-height") ? num("max-height") : undefined,
    avatar: has("avatar") ? num("avatar") : undefined,
    maxBytes: has("max-bytes") ? num("max-bytes") : undefined,
  };
}

/** 带退避的 GET JSON:429 / 网络错 → 重试(Wikimedia 对突发请求限流)。 */
async function getJson(url: string): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 429) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("请求失败:" + url);
}

/** 下载并返回原始 Buffer(先校验后落盘:预算/签名检查不通过就不写文件)。
 *  与 getJson 同口径:429 / 网络错(连接重置等)→ 退避重试。 */
async function fetchBuffer(url: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 429) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`下载失败(重试用尽): ${url}`);
}

function writeDest(buf: Buffer, dest: string): void {
  writeFileSync(dest, buf);
}

// ---------------------------------------------------------------------------
// 图片转换(python + Pillow;缺依赖/失败一律抛错,零兜底)
// ---------------------------------------------------------------------------

const PY_CONVERT = `import sys, json
from PIL import Image
src, full_out, avatar_out, quality, max_h, avatar_h = (
    sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]))
im = Image.open(src)
has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
im = im.convert("RGBA" if has_alpha else "RGB")
if max_h > 0 and im.height > max_h:
    im.thumbnail((im.width, max_h), Image.LANCZOS)
im.save(full_out, "WEBP", quality=quality)
out = {"width": im.width, "height": im.height}
import os
out["bytes"] = os.path.getsize(full_out)
if avatar_h > 0:
    av = im.copy()
    av.thumbnail((av.width, avatar_h), Image.LANCZOS)
    av.save(avatar_out, "WEBP", quality=quality)
    out["avatar_width"], out["avatar_height"] = av.width, av.height
    out["avatar_bytes"] = os.path.getsize(avatar_out)
print(json.dumps(out))
`;

interface ConvertResult {
  width: number;
  height: number;
  bytes: number;
  avatar_width?: number;
  avatar_height?: number;
  avatar_bytes?: number;
}

/** 源图 → webp(可选限高)+ 小头像变体;返回 Pillow 报告的尺寸与字节数。 */
function convertToWebp(
  src: string,
  fullOut: string,
  avatarOut: string | null,
  quality: number,
  maxHeight: number,
  avatarHeight: number,
): ConvertResult {
  let proc: ReturnType<typeof Bun.spawnSync>;
  try {
    proc = Bun.spawnSync([
      "python",
      "-c",
      PY_CONVERT,
      src,
      fullOut,
      avatarOut ?? src, // 不做头像时给个占位路径,PY 端 avatar_h=0 不会写它
      String(quality),
      String(maxHeight),
      String(avatarHeight),
    ]);
  } catch (e) {
    throw new Error(`python 启动失败(--webp 转换依赖本机 python + Pillow):${String(e)}`);
  }
  if (proc.exitCode !== 0) {
    const err = new TextDecoder().decode(proc.stderr);
    throw new Error(`Pillow 转换失败(exit ${proc.exitCode}):\n${err}`);
  }
  const out = new TextDecoder().decode(proc.stdout).trim().split("\n").pop() ?? "";
  return JSON.parse(out) as ConvertResult;
}

/** --webp 转换收尾:删中间原件,返回 webp 相对路径、尺寸与字节数。 */
function finishImageConvert(
  catDir: string,
  category: string,
  slug: string,
  srcExt: string,
  opts: { webp?: number; maxHeight?: number; avatar?: number },
): { webpPath: string; avatarPath?: string; dims: string; bytes: number; avatarBytes?: number } {
  if (!opts.webp) return { webpPath: "", dims: "", bytes: 0 };
  const srcPath = join(catDir, `${slug}${srcExt}`);
  const webpName = `${slug}.webp`;
  const avatarName = `${slug}-avatar.webp`;
  const r = convertToWebp(
    srcPath,
    join(catDir, webpName),
    opts.avatar ? join(catDir, avatarName) : null,
    opts.webp,
    opts.maxHeight ?? 0,
    opts.avatar ?? 0,
  );
  unlinkSync(srcPath); // 中间原件不落地(CDN/克隆处仍有原件)
  return {
    webpPath: `assets/${category}/${webpName}`,
    avatarPath: opts.avatar ? `assets/${category}/${avatarName}` : undefined,
    dims: `${r.width}×${r.height}${opts.avatar ? ` + 头像 ${r.avatar_width}×${r.avatar_height}` : ""}`,
    bytes: r.bytes,
    avatarBytes: r.avatar_bytes,
  };
}

interface ImgInfo {
  thumburl: string;
  ext: string;
  mime: string;
  license: string;
  author: string;
  source: string;
  width: number;
  height: number;
}
async function imageInfo(title: string, width: number): Promise<ImgInfo> {
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
    `&titles=${encodeURIComponent(title)}&prop=imageinfo` +
    `&iiprop=url|extmetadata|size|mime` +
    (width > 0 ? `&iiurlwidth=${width}` : ""); // width=0 → 原件直链(音频不能用波形缩略图)
  const j = await getJson(url);
  const pages = j?.query?.pages ?? {};
  const page: any = Object.values(pages)[0];
  const ii = page?.imageinfo?.[0];
  if (!ii) throw new Error(`无 imageinfo:${title}`);
  const strip = (s: string | undefined) =>
    (s ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const em = ii.extmetadata ?? {};
  const thumburl = (width > 0 ? (ii.thumburl ?? ii.url) : ii.url) as string;
  const mime: string = ii.mime ?? "";
  const source = `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  let ext = extname(new URL(thumburl).pathname);
  if (!ext)
    ext =
      mime === "image/svg+xml"
        ? ".svg"
        : mime === "image/jpeg"
          ? ".jpg"
          : mime === "audio/ogg"
            ? ".ogg"
            : ".png";
  return {
    thumburl,
    ext,
    mime,
    license: strip(em.LicenseShortName?.value) || "unknown",
    author: strip(em.Artist?.value) || "unknown",
    source,
    width: ii.thumbwidth ?? ii.width,
    height: ii.thumbheight ?? ii.height,
  };
}

/** 搜 File 命名空间,返回前 limit 个候选标题。 */
async function searchFiles(query: string, limit: number): Promise<string[]> {
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search` +
    `&srsearch=${encodeURIComponent(query)}&srnamespace=6&srlimit=${limit}`;
  const j = await getJson(url);
  return (j?.query?.search ?? []).map((h: any) => h.title as string);
}

/** 遍历候选:只接受真正的栅格/矢量图(排除 PDF / DjVu 书扫等);优先 SVG,否则首个可用图。无 → null。 */
const GOOD_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/tiff",
  "image/svg+xml",
]);
async function pickCandidate(
  titles: string[],
  width: number,
): Promise<{ info: ImgInfo; title: string } | null> {
  let firstImage: { info: ImgInfo; title: string } | null = null;
  for (const t of titles) {
    try {
      const info = await imageInfo(t, width);
      if (!GOOD_MIME.has(info.mime)) continue; // 排除 application/pdf、image/vnd.djvu 等书扫
      if (info.mime === "image/svg+xml") return { info, title: t }; // 矢量优先,立即拍板
      if (!firstImage) firstImage = { info, title: t };
    } catch {
      /* 单条失败不影响下一条 */
    }
  }
  return firstImage;
}

/** Commons 音频候选:只收 audio/ogg(项目音效口径),取首个。 */
async function pickAudioCandidate(
  titles: string[],
): Promise<{ info: ImgInfo; title: string } | null> {
  for (const t of titles) {
    try {
      const info = await imageInfo(t, 0);
      if (info.mime === "audio/ogg") return { info, title: t };
    } catch {
      /* 单条失败不影响下一条 */
    }
  }
  return null;
}

function slugify(id: string): string {
  return id.replace(/[:/]/g, "-");
}

function upsertManifest(id: string, entry: Record<string, unknown>): void {
  let data: Record<string, unknown> = {};
  if (existsSync(MANIFEST)) {
    try {
      data = JSON.parse(readFileSync(MANIFEST, "utf-8")) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }
  data[id] = entry;
  writeFileSync(MANIFEST, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function appendCredit(line: string): void {
  const header = existsSync(CREDITS) ? readFileSync(CREDITS, "utf-8") : "# CREDITS\n\n## 条目\n";
  const next = header.endsWith("\n") ? header : header + "\n";
  // 去重:若已有同 id 行,替换(简单实现:按 id 前缀过滤重写)
  const id = line.match(/\*\*([^*]+)\*\*/)?.[1] ?? "";
  const kept = next
    .split("\n")
    .filter((l) => !l.includes(`**${id}**`))
    .join("\n");
  writeFileSync(CREDITS, kept + line + "\n", "utf-8");
}

/** 清掉同 slug 旧文件(可能扩展名不同,避免遗留);含 -avatar 变体。 */
function removeStaleFiles(catDir: string, slug: string): void {
  for (const f of readdirSync(catDir)) {
    if (f.startsWith(`${slug}.`) || f.startsWith(`${slug}-avatar.`)) {
      try {
        unlinkSync(join(catDir, f));
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// noname(jsdelivr)/ 本地克隆 / Freesound 三源(#507)
// ---------------------------------------------------------------------------

const NONAME_CDN = "https://cdn.jsdelivr.net/gh/libccy/noname@master/image";
const NONAME_LICENSE =
  "noname(开源三国杀)内置素材,源头为三国杀官方原画(游卡桌游);本项目仅限学习与朋友间娱乐,不商用";
const NONAME_AUTHOR = "noname 项目(libccy/noname)打包;原画游卡桌游";

/** noname 素材直链:character/<拼音>.jpg 或 background/<名>_bg.jpg。 */
export function nonameImageUrl(base: string, dir: string): string {
  if (!/^[a-z0-9_]+$/i.test(base)) throw new Error(`noname 文件名只收拼音字母/数字/下划线:${base}`);
  if (dir !== "character" && dir !== "background") throw new Error(`noname 目录不认识:${dir}`);
  return `${NONAME_CDN}/${dir}/${base}.jpg`;
}

async function mainNoname(args: Args): Promise<void> {
  const url = nonameImageUrl(args.noname!, args.nonameDir);
  const catDir = join(ASSETS, args.category);
  mkdirSync(catDir, { recursive: true });
  const slug = slugify(args.id);

  const buf = await fetchBuffer(url);
  const srcExt = ".jpg";
  const srcPath = join(catDir, `${slug}${srcExt}`);
  removeStaleFiles(catDir, slug);
  writeDest(buf, srcPath);
  const conv = finishImageConvert(catDir, args.category, slug, srcExt, {
    webp: args.webp,
    maxHeight: args.maxHeight,
    avatar: args.avatar,
  });
  const finalPath = conv.webpPath || `assets/${args.category}/${slug}${srcExt}`;
  const today = new Date().toISOString().slice(0, 10);
  upsertManifest(args.id, {
    path: finalPath,
    ...(conv.avatarPath ? { avatar: conv.avatarPath } : {}),
    source: url,
    license: NONAME_LICENSE,
    author: NONAME_AUTHOR,
    fetched_at: today,
    review_required: true, // 三国杀系原画:APK 公开发布前人工复核(CREDITS.md 授权纪律)
  });
  appendCredit(
    `- **${args.id}** — ${NONAME_LICENSE} / ${NONAME_AUTHOR} — ${conv.bytes || buf.length}B (${conv.dims || "原始 jpg"}, ${conv.webpPath ? "webp" : "image/jpeg"}) — [source](${url}) — ${today} ⚠️ review_required`,
  );
  console.log(
    `✓ ${args.id} → ${finalPath} (${conv.bytes || buf.length}B, ${conv.dims || "原始 jpg"} ⚠️ review_required)\n  ${url}`,
  );
}

async function mainLocal(args: Args): Promise<void> {
  const src = resolve(args.local!);
  if (!existsSync(src)) throw new Error(`本地文件不存在:${src}`);
  const catDir = join(ASSETS, args.category);
  mkdirSync(catDir, { recursive: true });
  const slug = slugify(args.id);
  const srcExt = extname(src).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(srcExt))
    throw new Error(`本地克隆只收 png/jpg/webp:${src}`);

  removeStaleFiles(catDir, slug);
  const stagingName = `${slug}${srcExt}`;
  copyFileSyncLocal(src, join(catDir, stagingName));
  const conv = finishImageConvert(catDir, args.category, slug, srcExt, {
    webp: args.webp ?? 82, // 本地克隆默认转 webp(票面口径:批量转 webp+小头像)
    maxHeight: args.maxHeight,
    avatar: args.avatar,
  });
  const finalPath = conv.webpPath || `assets/${args.category}/${stagingName}`;
  const license = args.license ?? "unknown(本地克隆未声明授权)";
  const today = new Date().toISOString().slice(0, 10);
  upsertManifest(args.id, {
    path: finalPath,
    ...(conv.avatarPath ? { avatar: conv.avatarPath } : {}),
    source: `local:${src}`,
    license,
    author: "本地克隆(FreeKill 等),授权见 license 字段",
    fetched_at: today,
    review_required: true, // 本地来源无法自动验授权:一律人工复核
  });
  appendCredit(
    `- **${args.id}** — ${license} / 本地克隆 ${src} — ${conv.bytes || statSize(join(catDir, stagingName))}B (${conv.dims || "原始文件"}) — ${today} ⚠️ review_required`,
  );
  console.log(
    `✓ ${args.id} → ${finalPath} (${conv.bytes || "?"}B, ${conv.dims || "原始文件"} ⚠️ review_required)\n  local:${src}`,
  );
}

// 本地文件辅助(readFile→writeFile 组合;大小用 statSync)
function copyFileSyncLocal(src: string, dest: string): void {
  writeDest(readFileSync(src), dest);
}
function statSize(p: string): number {
  return statSync(p).size;
}

// ---------------------------------------------------------------------------
// Freesound(CC0 强制)
// ---------------------------------------------------------------------------

/** Freesound 音效页 HTML → lq ogg 预览直链 / 标题 / 作者 / CC 许可名。 */
export function parseFreesoundPage(html: string): {
  oggUrl: string;
  name: string;
  username: string;
  license: string;
} {
  const ogg =
    html.match(/data-ogg="(https:\/\/cdn\.freesound\.org\/previews\/[^"]+-lq\.ogg)"/)?.[1] ??
    html.match(/(https:\/\/cdn\.freesound\.org\/previews\/[^"'\\\s]+-lq\.ogg)/)?.[1];
  if (!ogg) throw new Error("Freesound 页面里找不到 lq ogg 预览直链(页面结构变了?):");
  const title = html.match(/<title>Freesound[^-]*-\s*(.+?) by (.+?)<\/title>/);
  const name = title?.[1]?.trim() ?? "unknown";
  const username = title?.[2]?.trim() ?? "unknown";
  const ccHref = html.match(
    /href="(https?:\/\/creativecommons\.org\/(?:publicdomain\/zero|licenses\/[^"]+)[^"]*)"/,
  )?.[1];
  const license = ccHref?.includes("publicdomain/zero")
    ? "CC0"
    : (ccHref?.match(/licenses\/([a-z-]+)/)?.[1]?.toUpperCase() ?? "unknown");
  return { oggUrl: ogg, name, username, license };
}

async function mainFreesound(args: Args): Promise<void> {
  const raw = args.freesound!;
  const pageUrl = /^\d+$/.test(raw)
    ? `https://freesound.org/s/${raw}/`
    : (normalizeFreesoundUrl(raw) ?? throwBadFreesoundUrl(raw));
  const catDir = join(ASSETS, args.category);
  mkdirSync(catDir, { recursive: true });
  const slug = slugify(args.id);

  const res = await fetchPageWithBackoff(pageUrl);
  const parsed = parseFreesoundPage(res);
  if (parsed.license !== "CC0")
    throw new Error(
      `票面口径:新音效强制 CC0;该音效 license=${parsed.license},换一个(搜索时加 license:"Creative Commons 0" 过滤)。${pageUrl}`,
    );
  const buf = await fetchBuffer(parsed.oggUrl);
  if (args.maxBytes && buf.length > args.maxBytes)
    throw new Error(
      `lq ogg ${buf.length}B 超出预算 ${args.maxBytes}B(不裁剪,换更短音效):${parsed.oggUrl}`,
    );

  const filename = `${slug}.ogg`;
  const relPath = `assets/${args.category}/${filename}`;
  const dest = join(catDir, filename);
  removeStaleFiles(catDir, slug);
  writeDest(buf, dest);

  const soundId = parsed.oggUrl.match(/previews\/\d+\/(\d+)_/)?.[1] ?? "unknown";
  const source = `https://freesound.org/s/${soundId}/`;
  const today = new Date().toISOString().slice(0, 10);
  upsertManifest(args.id, {
    path: relPath,
    source,
    license: "CC0",
    author: `${parsed.username} (Freesound,「${parsed.name}」lq ogg 预览直链)`,
    fetched_at: today,
    review_required: false,
  });
  appendCredit(
    `- **${args.id}** — CC0 / ${parsed.username} (Freesound) — ${buf.length}B (ogg;「${parsed.name}」lq 预览) — [source](${source}) — ${today}`,
  );
  console.log(`✓ ${args.id} → ${relPath} (${buf.length}B, ogg, CC0)\n  ${source}`);
}

function normalizeFreesoundUrl(raw: string): string | null {
  const u = new URL(raw);
  if (u.host !== "freesound.org") return null;
  const m = u.pathname.match(/^\/(?:s|people\/[^/]+\/sounds)\/(\d+)\/?$/);
  return m ? `https://freesound.org/s/${m[1]}/` : null;
}
function throwBadFreesoundUrl(raw: string): never {
  throw new Error(`不是合法 Freesound 音效页 URL(要 /s/<id>/ 或 /people/<u>/sounds/<id>/):${raw}`);
}

/** Freesound 站点对突发请求 403/429:退避重试(指数 + 抖动)。 */
async function fetchPageWithBackoff(url: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) dafung-web-asset-fetcher",
      },
    });
    if (res.status === 403 || res.status === 429) {
      await sleep(2000 * (attempt + 1) * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return await res.text();
  }
  throw new Error(`Freesound 持续 403/429(WAF 限流),稍后再跑:${url}`);
}

// ---------------------------------------------------------------------------
// 三国杀 wiki(patchwiki)立绘管线 —— 操作手册见 docs/how-to/扩将指南.md
// ---------------------------------------------------------------------------

const SGS_API = "https://wiki.biligame.com/sgs/api.php";
const SGS_LICENSE = "三国杀官方武将原画(游卡桌游);本项目仅限学习与朋友间娱乐,不商用";
const SGS_CREDITS_LICENSE = "三国杀官方原画(游卡桌游;仅学习/朋友娱乐,不商用)";

/** 输入 URL 分类:File 页(wiki.biligame.com)或 patchwiki 图片直链;其他来源一律抛错。 */
export type WikiUrlRef =
  | { kind: "filepage"; pageid?: number; title?: string }
  | { kind: "image"; url: string };

export function classifyWikiUrl(raw: string): WikiUrlRef {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`不是合法 URL:${raw}`);
  }
  if (u.host === "patchwiki.biligame.com") {
    if (!u.pathname.startsWith("/images/"))
      throw new Error(`patchwiki 链接不在 /images/ 下(疑似站点资源):${raw}`);
    return { kind: "image", url: originalFromPatchwikiThumb(raw) };
  }
  if (u.host === "wiki.biligame.com") {
    const curid = u.searchParams.get("curid");
    if (curid) {
      const n = Number(curid);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`curid 不是正整数:${curid}`);
      return { kind: "filepage", pageid: n };
    }
    const title = u.searchParams.get("title");
    if (title) return { kind: "filepage", title: decodeWikiTitle(title) };
    const m = u.pathname.match(/^\/sgs\/(.+)$/);
    if (m && m[1] !== "index.php") return { kind: "filepage", title: decodeWikiTitle(m[1]) };
    throw new Error(`wiki URL 里既无 curid 也无页面标题:${raw}`);
  }
  throw new Error(`不支持的来源(只收 wiki.biligame.com / patchwiki.biligame.com):${raw}`);
}

function decodeWikiTitle(t: string): string {
  return decodeURIComponent(t).replace(/_/g, " ");
}

/**
 * patchwiki 缩略图直链还原原图:
 *   /images/sgs/thumb/<a>/<ab>/<file>.png/<N>px-<名>.png → /images/sgs/<a>/<ab>/<file>.png
 * 原图直链(不含 /thumb/)原样返回。
 */
export function originalFromPatchwikiThumb(url: string): string {
  const u = new URL(url);
  const m = u.pathname.match(/^(\/images\/[^/]+)\/thumb\/((?:[^/]+\/){2}[^/]+)\/[^/]+$/);
  if (!m) return url;
  return `${u.origin}${m[1]}/${m[2]}`;
}

/** PNG IHDR 尺寸;签名不符直接抛错(本管线口径:立绘只收 PNG)。 */
export function pngSize(buf: Buffer): { width: number; height: number } {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(SIG))
    throw new Error("不是 PNG 文件(签名不符)");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** "文件:司马懿-经典形象.png" → "司马懿-经典形象"(CREDITS author 行用)。 */
export function fileBaseName(fileTitle: string): string {
  return fileTitle.replace(/^文件:/, "").replace(/\.[a-z0-9]+$/i, "");
}

interface SgsImageInfo {
  pageid: number;
  fileTitle: string;
  url: string;
  width: number;
  height: number;
  user: string;
}

/** File 页 → imageinfo API:原图直链 + 尺寸口径 + 上传者。页面缺失/非 File 页直接抛错。 */
async function resolveSgsFilePage(ref: { pageid?: number; title?: string }): Promise<SgsImageInfo> {
  const params: Record<string, string> = {
    action: "query",
    format: "json",
    prop: "imageinfo",
    iiprop: "url|size|user",
  };
  if (ref.pageid !== undefined) params.pageids = String(ref.pageid);
  else params.titles = ref.title!;
  const j = await getJson(`${SGS_API}?${new URLSearchParams(params)}`);
  const pages = j?.query?.pages ?? {};
  const page: any = Object.values(pages)[0];
  if (!page || page.missing !== undefined || page.ns !== 6)
    throw new Error(
      `wiki 上找不到该 File 页(注意:要传「文件:XXX」页的 curid/标题,不是武将主页面):${JSON.stringify(ref)}`,
    );
  const ii = page.imageinfo?.[0];
  if (!ii) throw new Error(`File 页无 imageinfo:${page.title}`);
  return {
    pageid: page.pageid,
    fileTitle: page.title,
    url: ii.url,
    width: ii.width,
    height: ii.height,
    user: ii.user ?? "unknown",
  };
}

async function mainWiki(args: Args): Promise<void> {
  const ref = classifyWikiUrl(args.wiki!);
  const catDir = join(ASSETS, args.category);
  mkdirSync(catDir, { recursive: true });
  const slug = slugify(args.id);

  let originalUrl: string;
  let author: string;
  let source: string;
  let apiWidth = 0;
  let apiHeight = 0;
  if (ref.kind === "image") {
    originalUrl = ref.url;
    author = "三国杀官方武将原画(游卡桌游)"; // 直链拿不到上传者;推荐用 File 页 URL 入库
    source = ref.url;
  } else {
    const info = await resolveSgsFilePage(ref);
    originalUrl = info.url;
    apiWidth = info.width;
    apiHeight = info.height;
    author = `三国杀(十周年)${fileBaseName(info.fileTitle)} · wiki 上传者 ${info.user}`;
    source = `https://wiki.biligame.com/sgs/index.php?curid=${info.pageid}`;
  }
  if (!originalUrl.toLowerCase().endsWith(".png"))
    throw new Error(`本管线只收 PNG 原图:${originalUrl}`);

  const filename = `${slug}.png`;
  const relPath = `assets/${args.category}/${filename}`;
  const dest = join(catDir, filename);
  removeStaleFiles(catDir, slug);
  const buf = await fetchBuffer(originalUrl);
  writeDest(buf, dest);
  const dims = pngSize(buf);
  if (apiWidth && (dims.width !== apiWidth || dims.height !== apiHeight))
    throw new Error(
      `下载实物尺寸 ${dims.width}×${dims.height} 与 wiki 口径 ${apiWidth}×${apiHeight} 不符(疑似取错图):${originalUrl}`,
    );

  const today = new Date().toISOString().slice(0, 10);
  upsertManifest(args.id, {
    path: relPath,
    source,
    license: SGS_LICENSE,
    author,
    fetched_at: today,
    review_required: true, // 非自由授权素材:APK 公开发布前人工复核(CREDITS.md 授权纪律)
  });
  appendCredit(
    `- **${args.id}** — ${SGS_CREDITS_LICENSE} / ${author} — ${buf.length}B (${dims.width}×${dims.height}, image/png) — [source](${source}) — ${today} ⚠️ review_required`,
  );
  console.log(
    `✓ ${args.id} → ${relPath} (${buf.length}B, ${dims.width}×${dims.height}, image/png ⚠️ review_required)\n  ${source}`,
  );
}

/** Commons 图入库公共尾段(搜索模式与 --commons-file 直取共用):下载(预算内)→
 *  可选 --webp 走 Pillow 转换(中间原件不落地)→ manifest + CREDITS 登记。 */
async function ingestCommonsImage(args: Args, info: ImgInfo, title: string): Promise<void> {
  const catDir = join(ASSETS, args.category);
  mkdirSync(catDir, { recursive: true });
  const slug = slugify(args.id);
  const filename = `${slug}${info.ext}`;
  const dest = join(catDir, filename);
  removeStaleFiles(catDir, slug);
  const buf = await fetchBuffer(info.thumburl);
  if (args.maxBytes && buf.length > args.maxBytes)
    throw new Error(
      `原件 ${buf.length}B 超出 --max-bytes ${args.maxBytes}B(不裁剪,换更短素材):${info.thumburl}`,
    );
  writeDest(buf, dest);
  const conv = finishImageConvert(catDir, args.category, slug, info.ext, {
    webp: args.webp,
    maxHeight: args.maxHeight,
  });
  const relPath = conv.webpPath || `assets/${args.category}/${filename}`;
  const licenseClear = /\b(CC0|CC[\s-]?BY|Public domain|GFDL|PD)\b/i.test(info.license);
  const today = new Date().toISOString().slice(0, 10);
  upsertManifest(args.id, {
    path: relPath,
    source: info.source,
    license: info.license,
    author: info.author,
    fetched_at: today,
    review_required: !licenseClear,
  });
  const reviewTag = !licenseClear ? " ⚠️ review_required" : "";
  const dims = conv.dims || `${info.width}×${info.height}`;
  appendCredit(
    `- **${args.id}** — ${info.license} / ${info.author} — ${conv.bytes || buf.length}B (${dims}, ${conv.webpPath ? "webp" : info.mime}) — [source](${info.source}) — ${today}${reviewTag}`,
  );
  console.log(
    `✓ ${args.id} → ${relPath} (${conv.bytes || buf.length}B, ${conv.webpPath ? "webp" : info.mime}${reviewTag})\n  ${title}`,
  );
}

/** --commons-file 直取(#521 珍宝画心):标题人工审图后精确指定,不走搜索排序;
 *  授权判定/登记与搜索模式同一尾段(ingestCommonsImage)。 */
async function mainCommonsFile(args: Args): Promise<void> {
  const title = decodeURIComponent(args.commonsFile!)
    .replace(/_/g, " ")
    .replace(/^File:/i, "")
    .trim();
  if (!title) throw new Error(`--commons-file 解析不出 File 标题:${args.commonsFile}`);
  const info = await imageInfo(`File:${title}`, args.width);
  if (!GOOD_MIME.has(info.mime))
    throw new Error(`不是可用的栅格/矢量图(mime=${info.mime}):File:${title}`);
  await ingestCommonsImage(args, info, title);
}

async function mainCommons(args: Args): Promise<void> {
  const audio = args.kind === "audio";

  const titles = await searchFiles(args.query!, args.limit);
  if (!titles.length) throw new Error(`Wikimedia 无结果:${args.query}`);
  const picked = audio ? await pickAudioCandidate(titles) : await pickCandidate(titles, args.width);
  if (!picked) throw new Error(`无可用的${audio ? "音频" : "图片"}结果:${args.query}`);

  await ingestCommonsImage(args, picked.info, picked.title);
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.wiki) return mainWiki(args);
  if (args.noname) return mainNoname(args);
  if (args.local) return mainLocal(args);
  if (args.freesound) return mainFreesound(args);
  if (args.commonsFile) return mainCommonsFile(args);
  return mainCommons(args);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
