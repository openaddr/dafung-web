// 从 Wikimedia Commons 或 三国杀 wiki(patchwiki)抓图,落到 public/assets/<category>/,
// 并登记进 manifest.json + CREDITS.md。无原生依赖。
//
// 用法:
//   # Commons 搜索模式(限 Wikimedia Commons):
//   bun scripts/fetch-asset.ts --id hero:zhouyu   --query "Zhou Yu Three Kingdoms portrait" --category heroes
//   bun scripts/fetch-asset.ts --id treasure:seal --query "Imperial Seal of China jade"      --category treasures --width 256
//
//   # 三国杀 wiki 模式(武将立绘扩容,默认 --category heroes;完整流程见 docs/hero-expansion.md):
//   bun scripts/fetch-asset.ts --id hero:simayi:sgs --wiki "https://wiki.biligame.com/sgs/index.php?curid=2199"
//   bun scripts/fetch-asset.ts --id hero:simayi:sgs --wiki "https://wiki.biligame.com/sgs/文件:司马懿-经典形象.png"
//   bun scripts/fetch-asset.ts --id hero:simayi:sgs --wiki "https://patchwiki.biligame.com/images/sgs/0/0a/<hash>.png"
//
// Commons 模式:跳过非图文件(PDF/DjVu 书扫);优先 SVG/矢量;429 退避重试。
// wiki 模式:File 页(curid 或「文件:」标题)走 imageinfo API 取原图直链 + 上传者 + 尺寸口径;
//   patchwiki 缩略图直链自动还原为原图;下载后按 PNG 签名读 IHDR 尺寸,与 API 口径不符即抛错;
//   授权口径固定为「学习/朋友娱乐,不商用」,review_required=true(APK 公开发布前人工复核)。
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
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
  wiki?: string;
  category: string;
  width: number;
  limit: number;
}
function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const id = get("id");
  const query = get("query");
  const wiki = get("wiki");
  if (!id || (!query && !wiki) || (query && wiki)) {
    console.error(
      "用法:\n" +
        "  fetch-asset.ts --id <assetId> --query <搜索词> [--category heroes|treasures|tiles] [--width 256] [--limit 8]  # Commons 搜索\n" +
        "  fetch-asset.ts --id <assetId> --wiki <wikiFile页URL|patchwiki直链> [--category heroes]                       # 三国杀 wiki 立绘",
    );
    process.exit(2);
  }
  return {
    id,
    query,
    wiki,
    category: get("category") ?? (wiki ? "heroes" : "misc"),
    width: parseInt(get("width") ?? "240", 10),
    limit: parseInt(get("limit") ?? "8", 10),
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

/** 下载到 dest,返回原始 Buffer(调用方按需读长度/解析头部)。 */
async function download(url: string, dest: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 429) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    return buf;
  }
  throw new Error(`下载失败(429 重试用尽): ${url}`);
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
    `&iiprop=url|extmetadata|size|mime&iiurlwidth=${width}`;
  const j = await getJson(url);
  const pages = j?.query?.pages ?? {};
  const page: any = Object.values(pages)[0];
  const ii = page?.imageinfo?.[0];
  if (!ii) throw new Error(`无 imageinfo:${title}`);
  const strip = (s: string | undefined) => (s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const em = ii.extmetadata ?? {};
  const thumburl = (ii.thumburl ?? ii.url) as string;
  const mime: string = ii.mime ?? "";
  const source = `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  let ext = extname(new URL(thumburl).pathname);
  if (!ext) ext = mime === "image/svg+xml" ? ".svg" : mime === "image/jpeg" ? ".jpg" : ".png";
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
const GOOD_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/tiff", "image/svg+xml"]);
async function pickCandidate(titles: string[], width: number): Promise<{ info: ImgInfo; title: string } | null> {
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

/** 清掉同 slug 旧文件(可能扩展名不同,避免遗留)。 */
function removeStaleFiles(catDir: string, slug: string): void {
  for (const f of readdirSync(catDir)) {
    if (f.startsWith(`${slug}.`)) {
      try {
        unlinkSync(join(catDir, f));
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 三国杀 wiki(patchwiki)立绘管线 —— 操作手册见 docs/hero-expansion.md
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
    if (!u.pathname.startsWith("/images/")) throw new Error(`patchwiki 链接不在 /images/ 下(疑似站点资源):${raw}`);
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
  if (buf.length < 24 || !buf.subarray(0, 8).equals(SIG)) throw new Error("不是 PNG 文件(签名不符)");
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
  const params: Record<string, string> = { action: "query", format: "json", prop: "imageinfo", iiprop: "url|size|user" };
  if (ref.pageid !== undefined) params.pageids = String(ref.pageid);
  else params.titles = ref.title!;
  const j = await getJson(`${SGS_API}?${new URLSearchParams(params)}`);
  const pages = j?.query?.pages ?? {};
  const page: any = Object.values(pages)[0];
  if (!page || page.missing !== undefined || page.ns !== 6)
    throw new Error(`wiki 上找不到该 File 页(注意:要传「文件:XXX」页的 curid/标题,不是武将主页面):${JSON.stringify(ref)}`);
  const ii = page.imageinfo?.[0];
  if (!ii) throw new Error(`File 页无 imageinfo:${page.title}`);
  return { pageid: page.pageid, fileTitle: page.title, url: ii.url, width: ii.width, height: ii.height, user: ii.user ?? "unknown" };
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
  if (!originalUrl.toLowerCase().endsWith(".png")) throw new Error(`本管线只收 PNG 原图:${originalUrl}`);

  const filename = `${slug}.png`;
  const relPath = `assets/${args.category}/${filename}`;
  const dest = join(catDir, filename);
  removeStaleFiles(catDir, slug);
  const buf = await download(originalUrl, dest);
  const dims = pngSize(buf);
  if (apiWidth && (dims.width !== apiWidth || dims.height !== apiHeight))
    throw new Error(`下载实物尺寸 ${dims.width}×${dims.height} 与 wiki 口径 ${apiWidth}×${apiHeight} 不符(疑似取错图):${originalUrl}`);

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
  console.log(`✓ ${args.id} → ${relPath} (${buf.length}B, ${dims.width}×${dims.height}, image/png ⚠️ review_required)\n  ${source}`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.wiki) return mainWiki(args);

  const catDir = join(ASSETS, args.category);
  mkdirSync(catDir, { recursive: true });

  const titles = await searchFiles(args.query!, args.limit);
  if (!titles.length) throw new Error(`Wikimedia 无结果:${args.query}`);
  const picked = await pickCandidate(titles, args.width);
  if (!picked) throw new Error(`无可用的图片结果(全是 PDF/非图?):${args.query}`);

  const { info, title } = picked;
  const slug = slugify(args.id);
  const filename = `${slug}${info.ext}`;
  const relPath = `assets/${args.category}/${filename}`;
  const dest = join(catDir, filename);
  removeStaleFiles(catDir, slug);
  const buf = await download(info.thumburl, dest);

  const licenseClear = /\b(CC0|CC-?BY|Public domain|GFDL|PD)\b/i.test(info.license);
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
  appendCredit(
    `- **${args.id}** — ${info.license} / ${info.author} — ${buf.length}B (${info.width}×${info.height}, ${info.mime}) — [source](${info.source}) — ${today}${reviewTag}`,
  );
  console.log(`✓ ${args.id} → ${relPath} (${buf.length}B, ${info.mime}${reviewTag})\n  ${title}`);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
