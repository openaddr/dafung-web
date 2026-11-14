// 组件收口:器物级图文行册直接用 Base UI Button 行为层；详情沿用 PileShell。
// 珍宝签(#1445):左画心、中名称与全文、右品级与指导价。目录按品级升序、同级
// 目录序陈列；详情叠层打开期间列表保持挂载，返回继续原位置。画心与价格消费单源。
import { useState } from "react";
import { Button } from "@base-ui/react/button";
import { TREASURES, guidePriceOf } from "@core/treasures";
import { formatMoney } from "@core/money";
import { treasureImagePath } from "@app/components/card/jinnang-face-data";
import { PileShell } from "@app/screens/game/PileModal";
import { MANUAL_TID } from "./testids";
import "./treasure-rows.css";

/** 陈列序:level 升序(同级保持目录序;sort 稳定,模块级只排一次)。 */
const TREASURE_ROWS = [...TREASURES].sort((a, b) => a.level - b.level);

/** 无画心是目录内正常态；列表与详情使用同一画心槽，不渲染空 src 图片。 */
function TreasureArt({ id, name, large = false }: { id: string; name: string; large?: boolean }) {
  const image = treasureImagePath(id);
  return (
    <span className={`manual-treasure-art${large ? " manual-treasure-art-detail" : ""}`}>
      {image != null ? (
        <img src={image} alt={large ? `${name}画心` : ""} />
      ) : (
        <span className="manual-treasure-art-empty">
          <span aria-hidden="true">宝</span>
          <span>暂无画心</span>
        </span>
      )}
    </span>
  );
}

/** 珍宝大档详情体:画心大图(金框双线语义=漆金描边衬纸)+ 右列品级角标/指导价/描述。 */
function TreasureDetailBody({
  id,
  name,
  level,
  desc,
}: {
  id: string;
  name: string;
  level: number;
  desc?: string;
}) {
  return (
    <div className="flex items-start justify-center gap-5 py-1">
      <TreasureArt id={id} name={name} large />
      <div className="flex min-w-0 max-w-[300px] flex-col gap-3 pt-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* 品级角标:斜章制式(ManualModal「册」印同法),数字 tabular */}
          <span className="inline-flex rotate-[2.5deg] items-baseline gap-1.5 rounded-[3px] border border-gold/45 bg-[color-mix(in_srgb,var(--color-lacquer-gold)_22%,var(--color-bg-deep))] px-2 py-0.5 font-brush text-[15px] tracking-[0.1em] text-paper">
            品级
            <i className="not-italic text-[17px] font-variant-numeric tabular-nums">{level}</i>
          </span>
          <span className="text-[15px] font-variant-numeric tabular-nums text-[var(--color-money)]">
            指导价 {formatMoney(guidePriceOf(level))}
          </span>
        </div>
        {desc != null && <p className="m-0 text-[13.5px] leading-[1.85] text-paper-dim">{desc}</p>}
      </div>
    </div>
  );
}

/** 珍宝签:全目录图文行册 + 大档详情叠层。 */
export default function ManualTreasuresTab() {
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = detailId != null ? TREASURE_ROWS.find((t) => t.id === detailId) : null;
  return (
    <>
      <div className="manual-treasure-rows">
        {TREASURE_ROWS.map((t) => (
          <Button
            key={t.id}
            data-testid={MANUAL_TID.card(t.id)}
            title={`${t.name} · 品级 ${t.level} · 指导价 ${formatMoney(guidePriceOf(t.level))}`}
            onClick={() => setDetailId(t.id)}
            className="manual-treasure-row"
          >
            <TreasureArt id={t.id} name={t.name} />
            <span className="manual-treasure-copy">
              <span className="manual-treasure-name">{t.name}</span>
              {t.desc != null && <span className="manual-treasure-desc">{t.desc}</span>}
            </span>
            <span className="manual-treasure-value">
              <span className="manual-treasure-grade">品级 {t.level}</span>
              <span className="manual-treasure-price">
                <span className="sr-only">指导价</span>
                {formatMoney(guidePriceOf(t.level))}
              </span>
            </span>
          </Button>
        ))}
      </div>
      {detail != null && (
        <PileShell
          title={detail.name}
          seal="宝"
          sub="手册 · 珍宝"
          testid={MANUAL_TID.detail(detail.id)}
          onClose={() => setDetailId(null)}
        >
          <TreasureDetailBody
            id={detail.id}
            name={detail.name}
            level={detail.level}
            desc={detail.desc}
          />
        </PileShell>
      )}
    </>
  );
}
