import { useState } from "react";
import { cityIncomeOf } from "@dafung/core/engine/city-income";
import { fullDefenseOf } from "@dafung/core/engine/defense";
import { INITIAL_CITY_LEVEL } from "@dafung/core/engine/constants";
import { cityTradeTermsOf, sellValueOf, type PropertyDef } from "@dafung/core/engine/economy";
import { formatMoney } from "@dafung/core/engine/money";
import type { LandDecisionCommand, LandDecisionOption } from "@dafung/core/protocol/wire";
import { BannerShell, BannerButton } from "./BannerShell";
import { AffordRow } from "./AffordRow";
import { ValueTable, type ValueTableProperty } from "./ValueTable";
import { SCROLL_TESTIDS as T } from "./testids";
import { TESTIDS } from "../testids";

// ── 购地抉择(AwaitingDecision + PropertyAvailable)──
export function BuyDecisionScroll({
  tileName,
  groupLabel,
  tierLabel,
  property,
  cash,
  options,
  onChoose,
}: {
  tileName: string;
  /** 地域行区名(=分组名,Theme.groupNames 单源经 DecisionScrollLayer;空=未知分组省略段)。 */
  groupLabel: string;
  /** 城池档位两字名(Theme.cityTierNames 单源经 DecisionScrollLayer,ADR-0042 决策 6)。 */
  tierLabel: string;
  /** 城池定义直传(catalog PropertyDef 结构超集,手工收窄已收口)。 */
  property: PropertyDef;
  cash: number;
  options: readonly LandDecisionOption[];
  onChoose: (command: LandDecisionCommand["type"]) => void;
}) {
  const buy = options.find((option) => option.command === "buyProperty")!;
  const skip = options.find((option) => option.command === "endDecision")!;
  // G-20:买不起时价值表默认折叠(决策已不可行,全表只是噪音);可点开查看
  const [showValues, setShowValues] = useState(buy.available);
  // #729:拍板两钮钉底(壳 footer 槽)——说明文段/主数值行/等级表/不可购原因留正文井,
  // 正文内滚浏览,「购地/不取」恒在场不随内容滚走(矮横屏实测钮曾被表压出视口)。
  return (
    <BannerShell
      title="购地抉择"
      testid={T.buyScroll}
      summary={
        <>
          <p className="text-center text-sm">
            {tileName} · {tierLabel}
            {groupLabel ? ` · ${groupLabel}` : ""} · 每轮收益 {formatMoney(cityIncomeOf(property))}
          </p>
          <AffordRow cash={cash} need={buy.cost} purpose="purchase" />
          {!buy.available && <p className="text-center text-sm text-danger">{buy.reason}</p>}
        </>
      }
      footer={
        <div className="flex items-center justify-center gap-3">
          <BannerButton
            primary
            disabled={!buy.available}
            testid={TESTIDS.actionButton("buy")}
            onClick={() => onChoose(buy.command)}
          >
            {buy.label}
          </BannerButton>
          <BannerButton
            disabled={!skip.available}
            testid={TESTIDS.actionButton("skip")}
            onClick={() => onChoose(skip.command)}
          >
            {skip.label}
          </BannerButton>
        </div>
      }
    >
      {/* 复用城池详情的等级表:买地的权衡核心是这座城往后怎么生钱——交易加成(未来
          坐地卖珍宝的定价参数)与逐级变卖价(破产跑道)。#92:买入即落 Lv.1,高亮购入档 */}
      {showValues ? (
        <ValueTable
          property={property}
          second="sell"
          highlight={{ level: INITIAL_CITY_LEVEL, label: "购入档" }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowValues(true)}
          // 触达热区垫(#761 ④):视觉字号不动,透明 ::before 上下外扩 12px(命中高
          // ≈43px ≥40 触达口径,DESIGN「视觉与热区可分离」;topbar tbtn ::after 同惯例,
          // 绝对定位不占布局、视觉零位移)
          className="relative mx-auto mb-1 block font-deco text-xs text-gold-deep underline before:absolute before:inset-x-[-8px] before:inset-y-[-12px] before:content-[''] "
        >
          查看等级表
        </button>
      )}
    </BannerShell>
  );
}

// ── 扩军抉择(AwaitingDecision + OwnProperty;升级免费,由到达己城触发)──
export function UpgradeDecisionScroll({
  tileName,
  tierLabel,
  level,
  defense,
  property,
  isCapital,
  options,
  onChoose,
}: {
  tileName: string;
  /** 城池档位两字名(Theme.cityTierNames 单源经 DecisionScrollLayer,ADR-0042 决策 6)。 */
  tierLabel: string;
  level: number;
  defense: number;
  /** 城池定义直传(catalog PropertyDef 结构超集,手工收窄已收口)。 */
  property: ValueTableProperty;
  /** 是否城主的都城(#671):都城第二列显示补给(固定值,不随档位;都城不可变卖)。 */
  isCapital: boolean;
  options: readonly LandDecisionOption[];
  onChoose: (command: LandDecisionCommand["type"]) => void;
}) {
  const upgrade = options.find((option) => option.command === "upgradeProperty")!;
  const skip = options.find((option) => option.command === "endDecision")!;
  const current = cityTradeTermsOf(property, level);
  const reason = upgrade.available ? null : upgrade.reason;
  const next = upgrade.available
    ? { ...cityTradeTermsOf(property, level + 1), defense: fullDefenseOf(level + 1) }
    : null;
  // #729:扩军/按兵不动两钮钉底(同购地),变化行与价值表留正文井
  return (
    <BannerShell
      title="扩军抉择"
      testid={T.upgradeScroll}
      summary={
        <div className="text-center text-sm">
          <p>
            {tileName} · {tierLabel} · {level} 级{upgrade.available && ` → ${level + 1} 级`}
          </p>
          {next !== null ? (
            <>
              <p>
                防御 {defense}/{fullDefenseOf(level)} → {next.defense}/{next.defense}
              </p>
              <p>
                交易加成 ×{current.multiplier} +{formatMoney(current.addition)} → ×{next.multiplier}{" "}
                +{formatMoney(next.addition)}
              </p>
              {!isCapital && (
                <p>
                  变卖价 {formatMoney(sellValueOf(property, level))} →{" "}
                  {formatMoney(sellValueOf(property, level + 1))}
                </p>
              )}
            </>
          ) : (
            <p className="text-danger">{reason}</p>
          )}
        </div>
      }
      footer={
        <div className="flex items-center justify-center gap-3">
          <BannerButton
            primary
            disabled={!upgrade.available}
            testid={TESTIDS.actionButton("upgrade")}
            onClick={() => onChoose(upgrade.command)}
          >
            {upgrade.label}
          </BannerButton>
          <BannerButton
            disabled={!skip.available}
            testid={TESTIDS.actionButton("skip")}
            onClick={() => onChoose(skip.command)}
          >
            {skip.label}
          </BannerButton>
        </div>
      }
    >
      {/* #92:扩军权衡也上同一张表,高亮「扩军后」档(当前级+1;满级时下标越界,自然无命中行);
          #671:都城第二列显示补给 */}
      <ValueTable
        property={property}
        second={isCapital ? "supply" : "sell"}
        highlight={{ level: level + 1, label: "扩军后" }}
      />
    </BannerShell>
  );
}
