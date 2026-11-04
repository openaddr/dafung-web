// 珍宝签(#1071,spec #1069 决议⑤ T2 装配):TREASURES 全量 6 种 TreasureCardFace
// 网格(装裱形制,art 走 treasureImagePath(id) 回查目录画心,陈列数=目录种数)按
// level 升序陈列(同级保持目录序,sort 稳定)+ 点卡开 PileShell 大档详情:
// 画心大图(金框)+ 品级角标 + 指导价(guidePriceOf 带「两」后缀,formatMoney 单源)
// + 风味描述。陈列档 7.2px em 基(108×144):六件一行恰收进 844×390 体部宽
// (940 弹层内容宽 753px:6×108+5×14=718),更窄 flex-wrap 换行、体部内滚承接。
// 交互语义(开合)归本件;选中语言=hover 金描边光圈(§4.6,名将/锦囊签同款);
// testid 消费 MANUAL_TID.card(id)/detail(id),id=目录英文 id。
import { useState } from "react";
import { TREASURES, guidePriceOf } from "@core/treasures";
import { formatMoney } from "@core/money";
import { TreasureCardFace } from "@app/components/card/JinnangCardFace";
import { treasureImagePath } from "@app/components/card/jinnang-face-data";
import { PileShell } from "@app/screens/game/PileModal";
import { MANUAL_TID } from "./testids";

/** 陈列序:level 升序(同级保持目录序;sort 稳定,模块级只排一次)。 */
const TREASURE_ROWS = [...TREASURES].sort((a, b) => a.level - b.level);

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
      <div className="shrink-0 rounded-[6px] border-2 border-[color-mix(in_srgb,var(--color-lacquer-gold)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-paper)_42%,var(--color-bg-deep))] p-1">
        <img
          src={treasureImagePath(id)}
          alt={`${name}画心`}
          className="h-[min(56dvh,300px)] w-auto rounded-[3px] object-cover"
        />
      </div>
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

/** 珍宝签:全目录品级升序网格 + 大档详情叠层(spec #1069 决议⑤)。 */
export default function ManualTreasuresTab() {
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = detailId != null ? TREASURE_ROWS.find((t) => t.id === detailId) : null;
  return (
    <>
      <div className="flex flex-wrap justify-center gap-3.5">
        {TREASURE_ROWS.map((t) => {
          const image = treasureImagePath(t.id);
          return (
            <button
              key={t.id}
              type="button"
              data-testid={MANUAL_TID.card(t.id)}
              title={`${t.name} · 品级 ${t.level} · 指导价 ${formatMoney(guidePriceOf(t.level))}`}
              onClick={() => setDetailId(t.id)}
              style={{ fontSize: "7.2px" }}
              className="block cursor-pointer rounded-[0.9em] border-0 bg-transparent p-0 text-left outline-offset-2 transition hover:shadow-[0_0_0_2px_var(--color-gold)]"
            >
              <TreasureCardFace
                name={t.name}
                level={t.level}
                desc={t.desc}
                art={image != null ? <img src={image} alt="" /> : undefined}
              />
            </button>
          );
        })}
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
