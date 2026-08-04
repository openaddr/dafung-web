// 渲染层素材解析器:把 core 产出的 id(hero:zhouyu / treasure:seal / tile:Wolong …)
// 解析成可用 URL。缺失(manifest 未加载 / 无此条目)→ 返回 null,调用方走现有 SVG 程序化绘制,**绝不崩**。
//
// ⚠️ 红线 1:本文件只准被 src/render/* import,绝不准被 src/core/* import(core 零 DOM)。
// ⚠️ 红线 4:绝不把 Image/HTMLImageElement/Canvas 句柄塞进引擎状态;这里只返回字符串 URL。
// 引擎只认数据 id,渲染层负责 id → 素材映射 + fallback。

import { el } from "./dom";

export interface AssetRef {
  url: string; // 站点根绝对路径,如 /assets/heroes/zhouyu.webp
  license?: string;
  author?: string;
  source?: string;
  reviewRequired?: boolean;
}

/** manifest 条目的原始形状(fetch-asset.ts 写入、人工可读)。 */
interface ManifestEntry {
  path?: string; // 相对 public/,如 assets/heroes/zhouyu.webp(brief 约定)
  url?: string; // 或直接给站点根 URL
  license?: string;
  author?: string;
  source?: string;
  review_required?: boolean; // JSON 习惯 snake_case
  reviewRequired?: boolean;
}

const MANIFEST_URL = "/assets/manifest.json";
let cache: Record<string, ManifestEntry> | null = null;
let inflight: Promise<void> | null = null;

/** 拉取并缓存 manifest。幂等。失败 = 空缓存(全部走 fallback,绝不崩)。 */
export function loadAssetManifest(): Promise<void> {
  if (cache) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
      cache = res.ok ? ((await res.json()) as Record<string, ManifestEntry>) : {};
    } catch {
      cache = {}; // 离线/无 manifest → 全部 fallback
    }
  })();
  return inflight;
}

/** manifest 是否已就绪(决定是否需要等加载后重渲一次)。 */
export function manifestReady(): boolean {
  return cache != null;
}

/** 同步查 id → AssetRef;未就绪或无此条目 → null(调用方走 SVG fallback)。 */
export function lookupAsset(id: string): AssetRef | null {
  if (!cache) return null;
  const e = cache[id];
  if (!e) return null;
  const url = e.url ?? (e.path ? (e.path.startsWith("/") ? e.path : "/" + e.path) : null);
  if (!url) return null;
  const reviewRequired = e.reviewRequired ?? e.review_required ?? false;
  return { url, license: e.license, author: e.author, source: e.source, reviewRequired };
}

/** id 有素材 → 返回 <img>(class/lazy/review 标记);无 → null,调用方走文本/SVG fallback。
 *  珍宝实例 id 形如 "lychee-3"(牌堆序列化后缀),manifest 存的是基础 id "treasure:lychee",
 *  故调用方需先 strip 后缀(见 treasureAssetImg)。 */
export function assetImg(id: string, cls: string): HTMLImageElement | null {
  const a = lookupAsset(id);
  if (!a) return null;
  const img = el("img", { class: cls, src: a.url, alt: "", loading: "lazy", decoding: "async" });
  img.dataset.assetId = id;
  if (a.reviewRequired) img.dataset.review = "1";
  return img;
}

/** 珍宝实例 id(lychee-3)→ 基础 id(lychee)→ 素材;后缀序列剥离。 */
export function treasureAssetImg(treasureInstanceId: string, cls: string): HTMLImageElement | null {
  return assetImg("treasure:" + treasureInstanceId.replace(/-\d+$/, ""), cls);
}

