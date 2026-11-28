import { useState } from "react";
import { formatMoney } from "@dafung/core/engine/money";
import type {
  TreasureDecision,
  TreasureTradeCandidate,
  TreasureTradeIntent,
  TreasureTradeMode,
} from "@dafung/core/room/treasure-decisions";
import { TreasurePickModal } from "../TreasurePickModal";
import { BannerShell, BannerButton } from "./BannerShell";
import { SCROLL_TESTIDS as T } from "./testids";

type TreasureVisitorScrollProps = {
  ownerGuohao: string;
  visitorGuohao: string;
  tileName: string;
} & (
  | {
      role: "owner";
      decision: TreasureDecision;
      mode: Exclude<TreasureTradeMode, "skip"> | null;
      selectedTreasure: TreasureTradeCandidate | null;
      interactive: boolean;
      canConfirm: boolean;
      onIntent: (intent: TreasureTradeIntent | { type: "confirm" | "cancel" }) => void;
    }
  | { role: "visitor"; treasureCount: number }
);

const MODES = {
  skip: { label: "暂不交易", testid: T.treasureSkip },
  fair: { label: "公道买卖", testid: T.treasureModeFair },
  premium: { label: "坐地起价", testid: T.treasureModePremium },
};

export function TreasureVisitorScroll(props: TreasureVisitorScrollProps) {
  const { ownerGuohao, visitorGuohao, tileName } = props;
  const [visitorDismissed, setVisitorDismissed] = useState(false);
  const decisionTitle = `${ownerGuohao}·珍宝抉择`;

  // 访客可关掉等待卷轴，本次交涉仍由城主处理。
  if (props.role === "visitor") {
    if (visitorDismissed) return null;
    return (
      <BannerShell
        title={decisionTitle}
        testid={T.treasureScroll}
        onClose={() => setVisitorDismissed(true)}
      >
        <p className="m-1 mb-3.5 text-center text-sm text-paper-dim">
          {visitorGuohao} 落「{tileName}」。{ownerGuohao} 有 {props.treasureCount}{" "}
          件珍宝,正在权衡是否出售…
        </p>
      </BannerShell>
    );
  }

  const { decision, mode, selectedTreasure, interactive, canConfirm, onIntent } = props;
  return (
    <>
      <BannerShell
        title={mode === null ? decisionTitle : `${MODES[mode].label}·选珍宝`}
        testid={T.treasureScroll}
      >
        <p className="m-1 mb-3.5 text-center text-sm text-paper-dim">
          {visitorGuohao} 落「{tileName}」。{ownerGuohao} 有 {decision.candidates.length} 件珍宝。
        </p>
        {mode === null && (
          <div className="flex flex-wrap justify-center gap-3">
            {decision.modes.map((option) => (
              <BannerButton
                key={option}
                primary={option === "skip"}
                testid={MODES[option].testid}
                disabled={!interactive}
                onClick={() => onIntent({ type: "chooseTreasureMode", mode: option })}
              >
                {MODES[option].label}
              </BannerButton>
            ))}
          </div>
        )}
      </BannerShell>
      {mode !== null && (
        <TreasurePickModal
          title={`${MODES[mode].label} · 选珍宝`}
          seal="交"
          sub={`${ownerGuohao} · 卖出的珍宝离手入${visitorGuohao}`}
          context={
            mode === "fair" && decision.fairUpgradesCity ? (
              <p className="treasure-pick-context">成交后{tileName} +1 级</p>
            ) : undefined
          }
          treasures={decision.candidates}
          picked={selectedTreasure}
          interactive={interactive}
          canConfirm={canConfirm}
          tagOf={({ guidePrice, premiumPrice }, selected) => {
            if (selected)
              return `成交 · 至 ${formatMoney(mode === "fair" ? guidePrice : premiumPrice)}`;
            if (mode === "fair") return `指导价 ${formatMoney(guidePrice)}`;
            return (
              <span className="treasure-pick-ask">
                <span>指导价 {formatMoney(guidePrice)}</span>
                <b>要价 {formatMoney(premiumPrice)}</b>
              </span>
            );
          }}
          summaryOf={({ name, guidePrice, premiumPrice }) =>
            mode === "fair"
              ? `卖出 ${name} · 入账 ${formatMoney(guidePrice)}`
              : `卖出 ${name} · 指导价 ${formatMoney(guidePrice)} + 加价 ${formatMoney(premiumPrice - guidePrice)} = 入账 ${formatMoney(premiumPrice)}`
          }
          confirmLabel="成交"
          testids={{
            container: T.treasurePick,
            item: T.treasureItem,
            confirm: T.treasureConfirm,
            back: T.treasureBack,
          }}
          onSelect={(treasureId) => onIntent({ type: "selectTreasure", treasureId })}
          onConfirm={() => onIntent({ type: "confirm" })}
          onClose={() => onIntent({ type: "cancel" })}
        />
      )}
    </>
  );
}
