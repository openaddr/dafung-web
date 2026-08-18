// 珍宝/名士详情卷轴(UI F5:手牌卡片点击 → 只读详情)。
// 复用 scroll/ScrollShell 的视觉骨架(宣纸/双金边/拖拽/× 关闭),对照旧 showHandDetail。
// 入参用结构最小字段而非 TreasureDef/HeroDef:快照玩家视图的名士不带 skill(渲染用不到),
// 收窄到展示所需可同时接受快照子集与全量定义。
// #36 详情画像位:顶部统一 3:4 竖版容器——名士显三国杀画像(HeroDef.image,本地资源),
// 珍宝显共用古风纹样占位;容器比例统一,原图比例差异由 object-cover 裁掉。
import { useState } from "react";
import { formatMoney } from "@core/money";
import { guidePriceOf } from "@core/treasures";
import { ScrollShell } from "./scroll";
import { TESTIDS } from "./testids";

export type CardDetail =
  | { kind: "treasure"; card: { id: string; name: string; level: number; desc?: string } }
  | { kind: "hero"; card: { id: string; name: string; title: string; desc: string; image: string } };

/** 画像位外框:双金边圆角 + 宣纸底,风格对齐卷轴体系(色走 tokens:gold/paper/ink)。 */
const PORTRAIT_FRAME =
  "relative mx-auto w-36 overflow-hidden rounded-md border-[3px] border-double border-gold bg-paper-lo shadow-sm";
const PORTRAIT_RATIO = "aspect-[3/4]";

/** 珍宝共用古风纹样占位(#36):内联 SVG,四蝠(福)拱珠式对称纹,色走 token。 */
function TreasurePattern() {
  return (
    <svg viewBox="0 0 120 160" className="h-full w-full" aria-hidden="true">
      <rect width="120" height="160" fill="rgba(140,110,60,0.08)" />
      <circle cx="60" cy="80" r="30" fill="none" stroke="rgba(140,110,60,0.55)" strokeWidth="2" />
      <circle cx="60" cy="80" r="22" fill="rgba(140,110,60,0.18)" />
      <circle cx="60" cy="80" r="8" fill="rgba(140,110,60,0.6)" />
      {[
        [60, 26, 0], [104, 80, 90], [60, 134, 180], [16, 80, 270],
      ].map(([x, y, r], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${r})`} fill="none" stroke="rgba(140,110,60,0.45)" strokeWidth="1.5">
          <path d="M0 0 C -10 -8, -8 -20, 0 -22 C 8 -20, 10 -8, 0 0 Z" />
          <path d="M0 0 C -14 2, -16 12, -6 14 C -2 8, -1 4, 0 0 Z" />
          <path d="M0 0 C 14 2, 16 12, 6 14 C 2 8, 1 4, 0 0 Z" />
        </g>
      ))}
      <rect x="8" y="8" width="104" height="144" rx="4" fill="none" stroke="rgba(140,110,60,0.35)" strokeWidth="1.5" />
    </svg>
  );
}

/** #36 详情画像位:名士显 image(object-cover 裁成 3:4);加载失败显式「画像缺失」
 *  错误态(用户可感知,非静默兜底)。珍宝走 TreasurePattern。 */
function Portrait({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`${PORTRAIT_FRAME} ${PORTRAIT_RATIO}`} data-testid={TESTIDS.cardDetailPortrait}>
      {src === null ? (
        <TreasurePattern />
      ) : failed ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-ink-dim">
          <span className="font-brush text-lg">像</span>
          <span className="text-xs">画像缺失</span>
        </div>
      ) : (
        <img src={src} alt={alt} onError={() => setFailed(true)} className="h-full w-full object-cover" draggable={false} />
      )}
    </div>
  );
}

export function CardDetailScroll({ detail, onClose }: { detail: CardDetail; onClose: () => void }) {
  if (detail.kind === "treasure") {
    const t = detail.card;
    return (
      <ScrollShell title={`「${t.name}」`} onClose={onClose} testid={TESTIDS.cardDetailScroll}>
        <Portrait src={null} alt={t.name} />
        <p className="m-1 mb-3 text-center text-sm text-ink-dim">
          珍宝 · Lv.{t.level} · 指导价 {formatMoney(guidePriceOf(t.level))}
        </p>
        <p className="mx-2 mb-2 text-center text-sm text-ink">{t.desc ?? "世间罕物,无可名状。"}</p>
      </ScrollShell>
    );
  }
  const h = detail.card;
  return (
    <ScrollShell title={`「${h.name}」`} onClose={onClose} testid={TESTIDS.cardDetailScroll}>
      <Portrait src={h.image} alt={`${h.name}画像`} />
      <p className="m-1 mb-3 text-center text-sm text-ink-dim">名士 · {h.title}</p>
      <p className="mx-2 mb-2 text-center text-sm text-ink">{h.desc}</p>
    </ScrollShell>
  );
}
