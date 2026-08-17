// 从 Wikimedia Commons 抓一张图,落到 public/assets/<category>/,并登记进
// manifest.json + CREDITS.md。无原生依赖:用 Commons 缩略图参数控体积;SVG 源直接存。
//
// 用法:
//   bun scripts/fetch-asset.ts --id hero:zhouyu   --query "Zhou Yu Three Kingdoms portrait" --category heroes
//   bun scripts/fetch-asset.ts --id treasure:seal --query "Imperial Seal of China jade"      --category treasures --width 256
//   bun scripts/fetch-asset.ts --id treasure:seal --query "传国玉玺" --skip 1
//
// 限 Wikimedia Commons。跳过非图文件(PDF/DjVu 书扫);优先 SVG/矢量;429 退避重试。
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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
  query: string;
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
  const category = get("category") ?? "misc";
  if (!id || !query) {
    console.error("用法:fetch-asset.ts --id <assetId> --query <搜索词> [--category heroes|treasures|tiles] [--width 256] [--limit 8]");
    process.exit(2);
  }
  return { id, query, category, width: parseInt(get("width") ?? "240", 10), limit: parseInt(get("limit") ?? "8", 10) };
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

async function download(url: string, dest: string): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 429) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    return buf.length;
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

async function main(): Promise<void> {
  const args = parseArgs();
  const catDir = join(ASSETS, args.category);
  mkdirSync(catDir, { recursive: true });

  const titles = await searchFiles(args.query, args.limit);
  if (!titles.length) throw new Error(`Wikimedia 无结果:${args.query}`);
  const picked = await pickCandidate(titles, args.width);
  if (!picked) throw new Error(`无可用的图片结果(全是 PDF/非图?):${args.query}`);

  const { info, title } = picked;
  const slug = slugify(args.id);
  const filename = `${slug}${info.ext}`;
  const relPath = `assets/${args.category}/${filename}`;
  const dest = join(catDir, filename);
  // 清掉同 id 旧文件(可能扩展名不同,避免遗留)
  for (const f of existsSync(catDir) ? (await import("node:fs")).readdirSync(catDir) : []) {
    if (f.startsWith(`${slug}.`)) {
      try {
        unlinkSync(join(catDir, f));
      } catch {
        /* ignore */
      }
    }
  }
  const bytes = await download(info.thumburl, dest);

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
    `- **${args.id}** — ${info.license} / ${info.author} — ${bytes}B (${info.width}×${info.height}, ${info.mime}) — [source](${info.source}) — ${today}${reviewTag}`,
  );
  console.log(`✓ ${args.id} → ${relPath} (${bytes}B, ${info.mime}${reviewTag})\n  ${title}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
