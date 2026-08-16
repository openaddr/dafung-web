// 珍宝/名士详情卷轴(UI F5:手牌卡片点击 → 只读详情)。
// 复用 scroll/ScrollShell 的视觉骨架(宣纸/双金边/拖拽/× 关闭),对照旧 showHandDetail。
// 入参用结构最小字段而非 TreasureDef/HeroDef:快照玩家视图的名士不带 skill(渲染用不到),
// 收窄到展示所需可同时接受快照子集与全量定义。
import { formatMoney } from "@core/money";
import { guidePriceOf } from "@core/treasures";
import { ScrollShell } from "./scroll";
import { TESTIDS } from "./testids";

export type CardDetail =
  | { kind: "treasure"; card: { id: string; name: string; level: number; desc?: string } }
  | { kind: "hero"; card: { id: string; name: string; title: string; desc: string } };

export function CardDetailScroll({ detail, onClose }: { detail: CardDetail; onClose: () => void }) {
  if (detail.kind === "treasure") {
    const t = detail.card;
    return (
      <ScrollShell title={`「${t.name}」`} onClose={onClose} testid={TESTIDS.cardDetailScroll}>
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
      <p className="m-1 mb-3 text-center text-sm text-ink-dim">名士 · {h.title}</p>
      <p className="mx-2 mb-2 text-center text-sm text-ink">{h.desc}</p>
    </ScrollShell>
  );
}
