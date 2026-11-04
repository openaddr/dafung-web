// 锦囊签(#1071,spec #1069 决议⑤ T2 装配):JINNANG_CARDS 全量 9 种 JinnangCardFace
// 标准档网格(8px 基 120×160 竖笺 3:4,陈列数=目录种数;flex-wrap 居中,窄档自然换行,
// 体部内滚承接)+ 点卡开 PileShell 包 JinnangCardDetail 详情叠层(题名=牌名、朱印章=
// JINNANG_FAMILY 族章字、面板五段=牌名/章行+目标域+牌库数/全文/脚注,样式随
// jinnang-card.css 同文件自带)。卡面角注=牌库张数(copies,「×N」浅印,纸底画材色
// 浅掺 --card-ink;children 槽挂入,卡面组件维持纯展示豁免)。
// 交互语义(开合)归本件;选中语言=hover 金描边光圈(§4.6,名将签同款);
// testid 消费 MANUAL_TID.card(id)/detail(id),id=目录中文牌名。
import { useState } from "react";
import { JINNANG_CARDS, jinnangCardOf } from "@core/jinnang";
import { JinnangCardFace, JinnangCardDetail } from "@app/components/card/JinnangCardFace";
import { JINNANG_FAMILY } from "@app/components/card/jinnang-face-data";
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
          <button
            key={def.id}
            type="button"
            data-testid={MANUAL_TID.card(def.id)}
            title={`${def.id} · 牌库 ${def.copies} 张`}
            onClick={() => setDetailId(def.id)}
            className="block cursor-pointer rounded-[0.9em] border-0 bg-transparent p-0 outline-offset-2 transition hover:shadow-[0_0_0_2px_var(--color-gold)]"
          >
            <JinnangCardFace cardId={def.id} size="standard">
              <CopiesNote copies={def.copies} />
            </JinnangCardFace>
          </button>
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
