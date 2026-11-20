// 组件收口:器物豁免(永久)——机遇笺纯展示，开合归 ManualEncountersTab。
import type { HTMLAttributes } from "react";
import type { EncounterDef, EncounterTier } from "@core/encounters";
import { encounterArt } from "@app/components/card/encounter-art";
import "@app/components/card/jinnang-card.css";
import "@app/components/card/encounter-art.css";

/** 档位色由界格线和档位章表达，全档名由组头与详情承载。 */
export const ENCOUNTER_TIER_FACE: Record<EncounterTier, { fam: string; seal: string }> = {
  好运: { fam: "var(--color-money)", seal: "好" }, // 青绿
  中性: { fam: "var(--color-seal-qing)", seal: "中" }, // 黛青
  霉运: { fam: "var(--color-danger)", seal: "霉" }, // 朱砂
};

interface EncounterCardFaceProps extends HTMLAttributes<HTMLDivElement> {
  encounter: EncounterDef;
}

export function EncounterCardFace({
  encounter,
  className,
  children,
  ...rest
}: EncounterCardFaceProps) {
  const tier = ENCOUNTER_TIER_FACE[encounter.tier];
  const art = encounterArt(encounter.id);
  return (
    <div
      className={["jinnang-card", className ?? ""].filter(Boolean).join(" ")}
      style={{ ["--fam" as string]: tier.fam }}
      {...rest}
    >
      <div className="tou">
        <span className="jie" />
        <span className={encounter.id.length > 3 ? "ming long" : "ming"}>{encounter.id}</span>
      </div>
      <div className="zhang">
        <span
          className="seal"
          style={{
            background: "color-mix(in srgb, var(--fam) 62%, var(--color-bg-deep))",
          }}
        >
          {tier.seal}
        </span>
      </div>
      <div className="yang encounter-card-art">
        <img src={art.src} alt="" loading="lazy" decoding="async" />
      </div>
      <div className="jiao">{encounter.text}</div>
      {children}
    </div>
  );
}
