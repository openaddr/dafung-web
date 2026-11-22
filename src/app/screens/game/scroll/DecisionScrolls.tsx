// 城池决策弹层(购地/扩军):从旧侧栏 ActionInline 迁入弹层体系(S9 起壳为
// 全屏宣告横幅,卷轴壳退役)。
// 交互重构原则:所有需要玩家权衡的选择一律走弹层,侧栏手牌区不再有决策按钮;
// 弹层轮到即自动弹出(DecisionScrollLayer 按相位路由),且无可关 ×——决策相位必须选择。
// 按钮 testid 沿用旧 action-* 命名(action-buy/…),文案与语义不变,
// 只是位置从侧栏搬进弹层,e2e 断言零语义变化。
// (经过都城必停后「驻跸或行进」卷轴已删:引擎直接结算,无玩家抉择。)
// spec #107 C1(UI 半边选项集消费缝):购地与扩军的可用性/不可用原因一律从快照
// choices(choices.ts 注册表产出,ADR-0013)读取,UI 不再重推 canBuy/maxed/reason
// ——全游戏不可购原因只有引擎一处口径。
import { useState } from "react";
import type { GameCommand } from "@core/authority";
import type { ChoiceOption } from "@core/choices";
import { cityIncomeOf } from "@core/city-income";
import { INITIAL_CITY_LEVEL } from "@core/constants";
import { cityTradeTermsOf, sellValueOf, type PropertyDef } from "@core/economy";
import { formatMoney } from "@core/money";
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
  choices,
  onCommand,
}: {
  tileName: string;
  /** 地域行区名(=分组名,Theme.groupNames 单源经 DecisionScrollLayer;空=未知分组省略段)。 */
  groupLabel: string;
  /** 城池档位两字名(Theme.cityTierNames 单源经 DecisionScrollLayer,ADR-0042 决策 6)。 */
  tierLabel: string;
  /** 城池定义直传(catalog PropertyDef 结构超集,手工收窄已收口)。 */
  property: PropertyDef;
  cash: number;
  /** 当前相位选项集(快照透出):buy 项的 available/reason 单源引擎注册表。 */
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // 选项集单源(spec #107 C1 / ADR-0013):可购与否与原因只读引擎注册表产出
  // (「银两不足」),UI 不再重推 cash 判定——旧手抄文案与引擎 reason 的漂移在此
  // 绝根。选项缺失 = 相位与注册表不符(数据 bug),非空断言让其抛(零兜底)。
  const buy = choices.find((o) => o.id === "buy")!;
  // G-20:买不起时价值表默认折叠(决策已不可行,全表只是噪音);可点开查看
  const [showValues, setShowValues] = useState(buy.available);
  // #729:拍板两钮钉底(壳 footer 槽)——说明文段/主数值行/等级表/不可购原因留正文井,
  // 正文内滚浏览,「购地/不取」恒在场不随内容滚走(矮横屏实测钮曾被表压出视口)。
  return (
    <BannerShell
      title="购地抉择"
      testid={T.buyScroll}
      footer={
        <div className="flex items-center justify-center gap-3">
          <BannerButton
            primary
            disabled={!buy.available}
            testid={TESTIDS.actionButton("buy")}
            onClick={() => onCommand({ type: "buyProperty" })}
          >
            购地 {formatMoney(property.purchasePrice)}
          </BannerButton>
          <BannerButton
            testid={TESTIDS.actionButton("skip")}
            onClick={() => onCommand({ type: "endDecision" })}
          >
            不取
          </BannerButton>
        </div>
      }
    >
      <p className="m-1 mb-2 text-center text-xs text-paper-dim">
        「{tileName}」{tierLabel}
        {groupLabel ? ` · ${groupLabel}` : ""} · 无主 · 每轮收益{" "}
        {formatMoney(cityIncomeOf(property))}
      </p>
      {/* 主数值行(#767 弹窗详情族①):持有/需/余差从摘要行升格的独立主行,
          买不买得起 0.5 秒可读(余绿/差红);#566 符号语义照旧(付得起记「余」) */}
      <AffordRow cash={cash} need={property.purchasePrice} purpose="purchase" />
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
      {!buy.available && <p className="mt-2 text-center text-xs text-paper-dim">{buy.reason}</p>}
    </BannerShell>
  );
}

// ── 扩军抉择(AwaitingDecision + OwnProperty;升级免费,由到达己城触发)──
export function UpgradeDecisionScroll({
  tileName,
  tierLabel,
  level,
  property,
  isCapital,
  choices,
  onCommand,
}: {
  tileName: string;
  /** 城池档位两字名(Theme.cityTierNames 单源经 DecisionScrollLayer,ADR-0042 决策 6)。 */
  tierLabel: string;
  level: number;
  /** 城池定义直传(catalog PropertyDef 结构超集,手工收窄已收口)。 */
  property: ValueTableProperty;
  /** 是否城主的都城(#671):都城第二列显示补给(固定值,不随档位;都城不可变卖)。 */
  isCapital: boolean;
  /** 当前相位选项集(快照透传):upgrade 项的 available/reason 单源引擎注册表。 */
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // 选项集单源(spec #107 C1 / ADR-0013):可否扩军与原因(「已满级」)只读引擎注册表
  // 产出,UI 不再重推 level >= maxLevel(升级免费,无银两门槛)。选项缺失 = 相位与
  // 注册表不符(数据 bug),非空断言让其抛(零兜底)。
  const upgrade = choices.find((o) => o.id === "upgrade")!;
  const current = cityTradeTermsOf(property, level);
  const next = upgrade.available ? cityTradeTermsOf(property, level + 1) : null;
  // #729:扩军/按兵不动两钮钉底(同购地),变化行与价值表留正文井
  return (
    <BannerShell
      title="扩军抉择"
      testid={T.upgradeScroll}
      footer={
        <div className="flex items-center justify-center gap-3">
          <BannerButton
            primary
            disabled={!upgrade.available}
            testid={TESTIDS.actionButton("upgrade")}
            onClick={() => onCommand({ type: "upgradeProperty" })}
          >
            扩军(免费)
          </BannerButton>
          <BannerButton
            testid={TESTIDS.actionButton("skip")}
            onClick={() => onCommand({ type: "endDecision" })}
          >
            按兵不动
          </BannerButton>
        </div>
      }
    >
      <p className="m-1 text-center text-sm text-paper-dim">
        「{tileName}」<span className="text-xs">{tierLabel}</span> 当前 Lv.{level} · 扩军免费
      </p>
      {next !== null ? (
        <>
          <p className="m-1 text-center text-sm text-paper-dim">
            交易加成 ×{current.multiplier} +{formatMoney(current.addition)} → ×{next.multiplier} +
            {formatMoney(next.addition)}
          </p>
          <p className="m-1 text-center text-sm text-paper-dim">
            变卖价 {formatMoney(sellValueOf(property, level))} →{" "}
            {formatMoney(sellValueOf(property, level + 1))}
          </p>
        </>
      ) : (
        <p className="m-1 mb-3 text-center text-sm text-paper-dim">({upgrade.reason})</p>
      )}
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
