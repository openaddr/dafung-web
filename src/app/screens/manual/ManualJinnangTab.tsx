// 手册锦囊签按目录陈列牌面与牌库张数。点牌后用牌堆弹层展示与对局共用的锦囊详情。
import { useState } from "react";
import { JINNANG_CARDS, jinnangCardOf } from "@core/jinnang";
import { JinnangCardFace, JinnangCardDetail } from "@app/components/card/JinnangCardFace";
import { JINNANG_FAMILY } from "@app/components/card/jinnang-face-data";
import { SelectableFaceButton } from "@app/components/card/SelectableFaceButton";
import { PileShell } from "@app/screens/game/PileModal";
import { MANUAL_TID } from "./testids";

/** 牌库张数角注(右下角贴签):「×N」自注释——牌库份数是收藏语境的陈列信息,
 *  文字本身即信息(§4.6 例外),不与卡面既有章/笺脚双通道重复。落位与两行截断的
 *  笺脚带恒相交(DOM 几何实测 17×10px,恰在省略号尾),故做实纸贴签(95% 纸底+
 *  发丝衬边)盖住尾字带,读作钤在角上的勘签,不与笺脚墨字透底互混。 */
function CopiesNote({ copies }: { copies: number }) {
  return (
    <span
      aria-label={`牌库 ${copies} 张`}
      className="absolute right-[0.45em] bottom-[0.35em] rounded-[0.25em] border border-[color-mix(in_srgb,var(--card-ink)_14%,transparent)] bg-[color-mix(in_srgb,var(--card-paper)_95%,transparent)] px-[0.35em] text-[1.32em] leading-[1.4] font-variant-numeric tabular-nums text-[color-mix(in_srgb,var(--card-ink)_45%,transparent)]"
    >
      ×{copies}
    </span>
  );
}

/** 锦囊签:全目录标准档网格 + 单卡详情叠层(spec #1069 决议⑤)。 */
export default function ManualJinnangTab() {
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = detailId != null ? jinnangCardOf(detailId) : null;
  return (
    <>
      <div className="flex flex-wrap justify-center gap-3">
        {JINNANG_CARDS.map((def) => (
          <SelectableFaceButton
            key={def.id}
            data-testid={MANUAL_TID.card(def.id)}
            aria-label={`${def.id} · 牌库 ${def.copies} 张`}
            onClick={() => setDetailId(def.id)}
          >
            <JinnangCardFace cardId={def.id} size="standard">
              <CopiesNote copies={def.copies} />
            </JinnangCardFace>
          </SelectableFaceButton>
        ))}
      </div>
      {detail != null && (
        <PileShell
          title={detail.id}
          seal={JINNANG_FAMILY[detail.tags[0]].label}
          sub="手册 · 锦囊"
          testid={MANUAL_TID.detail(detail.id)}
          onClose={() => setDetailId(null)}
        >
          <div className="flex justify-center py-1">
            <JinnangCardDetail cardId={detail.id} />
          </div>
        </PileShell>
      )}
    </>
  );
}
