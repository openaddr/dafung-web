// 常规决策弹层(购地/扩军/机遇/耗竭):从旧侧栏 ActionInline 迁入弹层体系(S9 起壳为
// 全屏宣告横幅,卷轴壳退役)。
// 交互重构原则:所有需要玩家权衡的选择一律走弹层,侧栏手牌区不再有决策按钮;
// 弹层轮到即自动弹出(DecisionScrollLayer 按相位路由),且无可关 ×——决策相位必须选择。
// 按钮 testid 沿用旧 action-* 命名(action-buy/…),文案与语义不变,
// 只是位置从侧栏搬进弹层,e2e 断言零语义变化。
// (经过都城必停后「驻跸或行进」卷轴已删:引擎直接结算,无玩家抉择。)
// spec #107 C1(UI 半边选项集消费缝):三个弹层的可用性/不可用原因一律从快照
// choices(choices.ts 注册表产出,ADR-0013)读取,UI 不再重推 canBuy/maxed/reason
// ——全游戏不可购原因只有引擎一处口径。
import { useEffect, useRef, useState } from "react";
import type { GameCommand } from "@core/authority";
import type { ChoiceOption } from "@core/choices";
import { formatMoney } from "@core/money";
import { supplyFor } from "@core/economy";
import { BannerShell, BannerButton } from "./BannerShell";
import { ValueTable } from "./ValueTable";
import { SCROLL_TESTIDS as T } from "./testids";
import { TESTIDS } from "../testids";

/** G-19:数字快捷键(1/2/3)触发选项 —— 挂载绑、卸载解;actions 顺序即角标顺序。
 *  Esc 不做(决策不可关是产品设定)。回调里的 disabled 判断由各卷轴自行收口。 */
function useNumberShortcuts(actions: Array<() => void>) {
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= ref.current.length) ref.current[n - 1]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// ── 抉择机遇(AwaitingEncounter,#124):机遇文段 + 目录选项按钮 ──
// 数据单源快照 choices(choices.ts 注册表产出):encounterId/encounterText 随选项携带,
// label=选项原文,available/reason=引擎口径(如以宝换贤的「珍宝不足」),UI 不自行判定。
// 选项下标 = snapshot.choices 数组下标 = def.choices 下标(resolveEncounterChoice 按此结算)。
export function EncounterChoiceScroll({
  encounterId,
  encounterText,
  choices,
  onCommand,
}: {
  encounterId: string;
  encounterText: string;
  /** 当前相位选项集(快照透出):顺序即机遇目录选项序,含不可用项(禁用 + reason)。 */
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // G-19 同口径:数字键 1..n 直选(不可选的选项按键无效)
  useNumberShortcuts(
    choices.map((o, i) => () => {
      if (o.available) onCommand({ type: "resolveEncounterChoice", index: i });
    }),
  );
  return (
    <BannerShell title={`机遇 · ${encounterId}`} testid={T.encounterScroll}>
      {/* 机遇文段:事件描述正文用霞鹜文楷 */}
      <p className="m-1 mb-3.5 text-center text-sm text-ink-dim font-wenkai">{encounterText}</p>
      <div className="flex flex-col gap-2.5">
        {choices.map((o, i) => (
          <BannerButton
            key={o.id}
            primary={i === 0}
            shortcut={i + 1}
            disabled={!o.available}
            title={o.available ? undefined : o.reason}
            testid={T.encounterOption(i)}
            onClick={() => onCommand({ type: "resolveEncounterChoice", index: i })}
          >
            {o.label}
          </BannerButton>
        ))}
      </div>
      {choices.some((o) => !o.available) && (
        <p className="mt-2 text-center text-xs text-ink-dim">
          {choices.find((o) => !o.available)?.reason}
        </p>
      )}
    </BannerShell>
  );
}

// ── 体力耗竭(AwaitingExhaustion,#130)──
// label=选项原文(「城名」降 1 级 / 失去城池),available 恒 true(失去选项排除都城由引擎口径保证)。
// 选项下标 = snapshot.choices 数组下标(resolveExhaustionChoice 按此结算)。
export function ExhaustionChoiceScroll({
  choices,
  onCommand,
}: {
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // G-19 同口径:数字键 1..n 直选
  useNumberShortcuts(
    choices.map((o, i) => () => {
      if (o.available) onCommand({ type: "resolveExhaustionChoice", index: i });
    }),
  );
  // #729:二选一钮钉底(壳 footer 槽),说明留正文井——耗竭说明 + 双钮在矮横屏
  // 同样曾被推出视口,同构迁移
  return (
    <BannerShell
      title="体力耗竭"
      testid={T.exhaustionScroll}
      footer={
        <div className="flex flex-col gap-2.5">
          {choices.map((o, i) => (
            <BannerButton
              key={o.id}
              primary={i === 0}
              shortcut={i + 1}
              disabled={!o.available}
              title={o.available ? undefined : o.reason}
              testid={T.exhaustionOption(i)}
              onClick={() => onCommand({ type: "resolveExhaustionChoice", index: i })}
            >
              {o.label}
            </BannerButton>
          ))}
        </div>
      }
    >
      <p className="m-1 mb-3.5 text-center text-sm text-ink-dim font-wenkai">
        体力耗竭,倒地不起!择一座城池弃之苟活:降 1 级,或失去整座。歇罢这阵,体力自会回满。
      </p>
    </BannerShell>
  );
}

// ── 购地抉择(AwaitingDecision + PropertyAvailable)──
export function BuyDecisionScroll({
  tileName,
  regionLabel,
  property,
  cash,
  choices,
  onCommand,
}: {
  tileName: string;
  /** 地域行标签(分组名恒显+异名追加州名,单源在 DecisionScrollLayer)。 */
  regionLabel: string;
  property: {
    purchasePrice: number;
    maxLevel: number;
    valueByLevel: number[];
    tradeMult: number[];
    tradeAdd: number[];
    resupplyPerLevel: number;
  };
  cash: number;
  /** 当前相位选项集(快照透出):buy 项的 available/reason 单源引擎注册表。 */
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // 选项集单源(spec #107 C1 / ADR-0013):可购与否与原因只读引擎注册表产出
  // (「无委任状」/「银两不足」,委任优先报),UI 不再重推 cash/warrants 判定——
  // 旧手抄「委任状不足」与引擎「无委任状」的文案漂移在此绝根。选项缺失 = 相位与
  // 注册表不符(数据 bug),非空断言让其抛(零兜底)。
  const buy = choices.find((o) => o.id === "buy")!;
  // G-20:买不起时价值表默认折叠(决策已不可行,全表只是噪音);可点开查看
  const [showValues, setShowValues] = useState(buy.available);
  // G-19:1=购地(不可购时无效)2=不取
  useNumberShortcuts([
    () => {
      if (buy.available) onCommand({ type: "buyProperty" });
    },
    () => onCommand({ type: "endDecision" }),
  ]);
  // G-20:资产行 —— 一眼看清持有/需付/差额(付得起记「余」,缺口记「差」红字;
  // formatMoney 只收非负数,缺口取绝对值,负值会被钳成「0 两」)
  const diff = cash - property.purchasePrice;
  // #729:拍板两钮钉底(壳 footer 槽)——说明文段/差额行/等级表/不可购原因留正文井,
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
            title={buy.available ? undefined : buy.reason}
            shortcut={1}
            testid={TESTIDS.actionButton("buy")}
            onClick={() => onCommand({ type: "buyProperty" })}
          >
            购地 {formatMoney(property.purchasePrice)}·1委任
          </BannerButton>
          <BannerButton
            shortcut={2}
            testid={TESTIDS.actionButton("skip")}
            onClick={() => onCommand({ type: "endDecision" })}
          >
            不取
          </BannerButton>
        </div>
      }
    >
      <p className="m-1 text-center text-sm text-ink-dim">
        「{tileName}」{regionLabel ? ` · ${regionLabel}` : ""} · 无主 · 购入{" "}
        {formatMoney(property.purchasePrice)} · 耗 1 委任状
      </p>
      <p className="m-1 mb-2.5 text-center text-sm text-ink">
        持有 {formatMoney(cash)} · 需 {formatMoney(property.purchasePrice)} ·{" "}
        {diff >= 0 ? "余" : "差"}{" "}
        <span className={diff < 0 ? "text-danger" : undefined}>{formatMoney(Math.abs(diff))}</span>
      </p>
      {/* 复用城池详情的等级表:买地的权衡核心是这座城往后怎么生钱——交易加成(未来
          坐地卖珍宝的定价参数)与逐级变卖价(破产跑道)。#92:买入即落 Lv.0,高亮购入档 */}
      {showValues ? (
        <ValueTable property={property} second="sell" highlight={{ level: 0, label: "购入档" }} />
      ) : (
        <button
          type="button"
          onClick={() => setShowValues(true)}
          className="mx-auto mb-1 block font-deco text-xs text-gold-deep underline cursor-pointer hover:text-ink"
        >
          查看等级表
        </button>
      )}
      {!buy.available && <p className="mt-2 text-center text-xs text-ink-dim">{buy.reason}</p>}
    </BannerShell>
  );
}

// ── 扩军抉择(AwaitingDecision + OwnProperty;升级免费,由到达己城触发)──
export function UpgradeDecisionScroll({
  tileName,
  level,
  property,
  isCapital,
  choices,
  onCommand,
}: {
  tileName: string;
  level: number;
  property: {
    maxLevel: number;
    valueByLevel: number[];
    tradeMult: number[];
    tradeAdd: number[];
    resupplyPerLevel: number;
  };
  /** 是否城主的都城(#671):都城第二列显示补给、变化行补补给增量(都城不可变卖)。 */
  isCapital: boolean;
  /** 当前相位选项集(快照透传):upgrade 项的 available/reason 单源引擎注册表。 */
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // 选项集单源(spec #107 C1 / ADR-0013):可否扩军与原因(「已满级」)只读引擎注册表
  // 产出,UI 不再重推 level >= maxLevel(升级免费,无银两门槛)。选项缺失 = 相位与
  // 注册表不符(数据 bug),非空断言让其抛(零兜底)。
  const upgrade = choices.find((o) => o.id === "upgrade")!;
  // 变化行 = 当前级 → 下一级(下标 = 等级;直接下标,board-loader 已校验各数组
  // 长度 = maxLevel+1,越界 = 数据 bug 炸出)。#671:等级的真实收益是交易加成上涨
  // (坐地要价变贵)+ 变卖价上涨,都城再+补给上涨——三条都摆出来,别只给变卖价。
  const multNow = property.tradeMult[level];
  const multNext = property.tradeMult[level + 1];
  const addNow = property.tradeAdd[level];
  const addNext = property.tradeAdd[level + 1];
  const valueNow = property.valueByLevel[level];
  const valueNext = property.valueByLevel[level + 1];
  // G-19:1=扩军(不可升时无效)2=按兵不动
  useNumberShortcuts([
    () => {
      if (upgrade.available) onCommand({ type: "upgradeProperty" });
    },
    () => onCommand({ type: "endDecision" }),
  ]);
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
            title={upgrade.available ? undefined : upgrade.reason}
            shortcut={1}
            testid={TESTIDS.actionButton("upgrade")}
            onClick={() => onCommand({ type: "upgradeProperty" })}
          >
            扩军(免费)
          </BannerButton>
          <BannerButton
            shortcut={2}
            testid={TESTIDS.actionButton("skip")}
            onClick={() => onCommand({ type: "endDecision" })}
          >
            按兵不动
          </BannerButton>
        </div>
      }
    >
      <p className="m-1 text-center text-sm text-ink-dim">
        「{tileName}」当前 Lv.{level} · 扩军免费
      </p>
      {upgrade.available ? (
        <>
          <p className="m-1 text-center text-sm text-ink-dim">
            交易加成 ×{multNow} +{formatMoney(addNow)} → ×{multNext} +{formatMoney(addNext)}
          </p>
          <p className="m-1 text-center text-sm text-ink-dim">
            变卖价 {formatMoney(valueNow)} → {formatMoney(valueNext)}
          </p>
          {isCapital && (
            <p className="m-1 text-center text-sm text-ink-dim">
              都城补给 {formatMoney(supplyFor(property.resupplyPerLevel, level))} →{" "}
              {formatMoney(supplyFor(property.resupplyPerLevel, level + 1))}
              (每回合)
            </p>
          )}
        </>
      ) : (
        <p className="m-1 mb-3 text-center text-sm text-ink-dim">({upgrade.reason})</p>
      )}
      {/* #92:扩军权衡也上同一张表,高亮「扩军后」档(当前级+1;满级时下标越界,自然无命中行);
          #671:都城第二列显示补给 */}
      <ValueTable
        property={property}
        second={isCapital ? "supply" : "sell"}
        highlight={{ level: level + 1, label: "扩军后" }}
      />
      {!upgrade.available && (
        <p className="mt-2 text-center text-xs text-ink-dim">{upgrade.reason}</p>
      )}
    </BannerShell>
  );
}
