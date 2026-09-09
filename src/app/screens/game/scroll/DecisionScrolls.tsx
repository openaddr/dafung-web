// 三个常规决策卷轴(岔口/购地/扩军):从旧侧栏 ActionInline 迁入卷轴体系。
// 交互重构原则:所有需要玩家权衡的选择一律走卷轴弹层,侧栏手牌区不再有决策按钮;
// 卷轴轮到即自动弹出(DecisionScrollLayer 按相位路由),且无可关 ×——决策相位必须选择。
// 按钮 testid 沿用旧 action-* 命名(action-buy/…),文案与语义不变,
// 只是位置从侧栏搬进卷轴,e2e 断言零语义变化。
// (经过都城必停后「驻跸或行进」卷轴已删:引擎直接结算,无玩家抉择。)
// spec #107 C1(UI 半边选项集消费缝):三个卷轴的可用性/不可用原因一律从快照
// choices(choices.ts 注册表产出,ADR-0013)读取,UI 不再重推 canBuy/maxed/reason
// ——全游戏不可购原因只有引擎一处口径。
import { useEffect, useRef, useState } from "react";
import type { GameCommand } from "@core/types";
import type { ChoiceOption } from "@core/choices";
import { formatMoney } from "@core/money";
import { ScrollShell, ScrollButton } from "./ScrollShell";
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

// ── 锦囊卷轴(AwaitingJinnang,#122/T2)──
// 选项=手牌逐张(available/reason 单源引擎注册表)+「今不用」;牌面文案/标签随
// choices 载荷过网(UI 不回查目录——持有人内容本就在自己快照里,但口径与机遇卷轴
// 一致:卷轴只消费 choices)。灰置牌照列(暗置博弈:看见自己有什么、为何不能用)。
export function JinnangScroll({
  choices,
  onCommand,
}: {
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  return (
    <ScrollShell title="锦囊" testid={T.jinnangScroll}>
      <p className="m-1 mb-3.5 text-center text-sm text-ink-dim font-wenkai">
        计上心头。此刻可用一计,或留待来日——掷骰之前,且慢行军。
      </p>
      <div className="flex max-h-[46vh] flex-col items-stretch gap-2 overflow-y-auto px-1">
        {choices
          .filter((o) => o.id !== "pass")
          .map((o, i) => (
            <ScrollButton
              key={o.id}
              testid={T.jinnangOption(o.id)}
              disabled={!o.available}
              title={o.reason ?? o.cardText}
              shortcut={i + 1}
              onClick={() => onCommand({ type: "useJinnang", cardId: o.id })}
            >
              <span className="inline-flex items-center gap-2">
                <span className="inline-flex h-5 w-5 shrink-0 rotate-[-4deg] items-center justify-center rounded-[2px] bg-danger font-brush text-[11px] leading-none text-[#f6ead6]">
                  {o.cardTags?.[0] ?? "计"}
                </span>
                <span className="font-wenkai">{o.label}</span>
                {o.cardTags && o.cardTags.length > 1 && (
                  <span className="text-[10px] text-ink-dim">{o.cardTags.join("")}</span>
                )}
              </span>
            </ScrollButton>
          ))}
        <ScrollButton
          testid={T.jinnangPass}
          onClick={() => onCommand({ type: "useJinnang", cardId: null })}
        >
          今不用
        </ScrollButton>
      </div>
    </ScrollShell>
  );
}

// ── 驿道岔口(AwaitingBranch)──
export function BranchDecisionScroll({
  choices,
  onCommand,
}: {
  /** 当前相位选项集(快照透出):走大路/入辅路的 available/reason 单源引擎注册表。 */
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // 选项集消费缝(spec #107 C1):两选当前恒可用,可用性仍只读注册表产出——未来技能
  // 改动选项可用性时卷轴随之,UI 不私自判定。选项缺失 = 相位与注册表不符(数据 bug),
  // 非空断言让其抛(零兜底,与 Layer 对 catalog 的断言同款)。
  const main = choices.find((o) => o.id === "main")!;
  const branch = choices.find((o) => o.id === "branch")!;
  // G-19:1=大路 2=辅路(不可选的选项按键无效,与购地卷轴口径一致)
  useNumberShortcuts([
    () => { if (main.available) onCommand({ type: "selectBranch", kind: "Main" }); },
    () => { if (branch.available) onCommand({ type: "selectBranch", kind: "Branch" }); },
  ]);
  return (
    <ScrollShell title="驿道岔口" testid={T.branchScroll}>
      {/* A4(#51):事件描述正文用霞鹜文楷(font-wenkai,接入点示意) */}
      <p className="m-1 mb-3.5 text-center text-sm text-ink-dim font-wenkai">
        驿道至此分岔:大路平坦快捷,辅路僻静多机。入辅路者本回合就此扎营,来日掷骰进发。
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <ScrollButton
          primary
          shortcut={1}
          disabled={!main.available}
          title={main.available ? undefined : main.reason}
          testid={TESTIDS.actionButton("main")}
          onClick={() => onCommand({ type: "selectBranch", kind: "Main" })}
        >
          走大路
        </ScrollButton>
        <ScrollButton
          shortcut={2}
          disabled={!branch.available}
          title={branch.available ? undefined : branch.reason}
          testid={TESTIDS.actionButton("branch")}
          onClick={() => onCommand({ type: "selectBranch", kind: "Branch" })}
        >
          入辅路
        </ScrollButton>
      </div>
    </ScrollShell>
  );
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
    <ScrollShell title={`机遇 · ${encounterId}`} testid={T.encounterScroll}>
      {/* 机遇文段:事件描述正文用霞鹜文楷(与岔口卷轴同款) */}
      <p className="m-1 mb-3.5 text-center text-sm text-ink-dim font-wenkai">{encounterText}</p>
      <div className="flex flex-col gap-2.5">
        {choices.map((o, i) => (
          <ScrollButton
            key={o.id}
            primary={i === 0}
            shortcut={i + 1}
            disabled={!o.available}
            title={o.available ? undefined : o.reason}
            testid={T.encounterOption(i)}
            onClick={() => onCommand({ type: "resolveEncounterChoice", index: i })}
          >
            {o.label}
          </ScrollButton>
        ))}
      </div>
      {choices.some((o) => !o.available) && (
        <p className="mt-2 text-center text-xs text-ink-dim">
          {choices.find((o) => !o.available)?.reason}
        </p>
      )}
    </ScrollShell>
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
  return (
    <ScrollShell title="体力耗竭" testid={T.exhaustionScroll}>
      <p className="m-1 mb-3.5 text-center text-sm text-ink-dim font-wenkai">
        体力耗竭,倒地不起!择一座城池弃之苟活:降 1 级,或失去整座。歇罢这阵,体力自会回满。
      </p>
      <div className="flex flex-col gap-2.5">
        {choices.map((o, i) => (
          <ScrollButton
            key={o.id}
            primary={i === 0}
            shortcut={i + 1}
            disabled={!o.available}
            title={o.available ? undefined : o.reason}
            testid={T.exhaustionOption(i)}
            onClick={() => onCommand({ type: "resolveExhaustionChoice", index: i })}
          >
            {o.label}
          </ScrollButton>
        ))}
      </div>
    </ScrollShell>
  );
}

// ── 购地抉择(AwaitingDecision + PropertyAvailable)──
export function BuyDecisionScroll({
  tileName,
  region,
  property,
  cash,
  choices,
  onCommand,
}: {
  tileName: string;
  region: string;
  property: { purchasePrice: number; maxLevel: number; valueByLevel: number[] };
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
    () => { if (buy.available) onCommand({ type: "buyProperty" }); },
    () => onCommand({ type: "endDecision" }),
  ]);
  // G-20:资产行 —— 一眼看清持有/需付/差额(负差红字)
  const diff = cash - property.purchasePrice;
  return (
    <ScrollShell title="购地抉择" testid={T.buyScroll}>
      <p className="m-1 text-center text-sm text-ink-dim">
        「{tileName}」{region ? ` · ${region}` : ""} · 无主 · 购入 {formatMoney(property.purchasePrice)} · 耗 1 委任状
      </p>
      <p className="m-1 mb-2.5 text-center text-sm text-ink">
        持有 {formatMoney(cash)} · 需 {formatMoney(property.purchasePrice)} · 差{" "}
        <span className={diff < 0 ? "text-danger" : undefined}>{formatMoney(diff)}</span>
      </p>
      {/* 复用城池详情的等级价值表:买地的权衡核心是逐级价值(升级免费,Lv0 起逐级升)。
          #92:买入即落 Lv.0(升级由到达免费触发),高亮购入档 */}
      {showValues ? (
        <ValueTable property={property} highlight={{ level: 0, label: "购入档" }} />
      ) : (
        <button
          type="button"
          onClick={() => setShowValues(true)}
          className="mx-auto mb-1 block font-deco text-xs text-gold-deep underline cursor-pointer hover:text-ink"
        >
          查看等级价值
        </button>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <ScrollButton
          primary
          disabled={!buy.available}
          title={buy.available ? undefined : buy.reason}
          shortcut={1}
          testid={TESTIDS.actionButton("buy")}
          onClick={() => onCommand({ type: "buyProperty" })}
        >
          购地 {formatMoney(property.purchasePrice)}·1委任
        </ScrollButton>
        <ScrollButton
          shortcut={2}
          testid={TESTIDS.actionButton("skip")}
          onClick={() => onCommand({ type: "endDecision" })}
        >
          不取
        </ScrollButton>
      </div>
      {!buy.available && <p className="mt-2 text-center text-xs text-ink-dim">{buy.reason}</p>}
    </ScrollShell>
  );
}

// ── 扩军抉择(AwaitingDecision + OwnProperty;升级免费,由到达己城触发)──
export function UpgradeDecisionScroll({
  tileName,
  level,
  property,
  choices,
  onCommand,
}: {
  tileName: string;
  level: number;
  property: { maxLevel: number; valueByLevel: number[] };
  /** 当前相位选项集(快照透出):upgrade 项的 available/reason 单源引擎注册表。 */
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // 选项集单源(spec #107 C1 / ADR-0013):可否扩军与原因(「已满级」)只读引擎注册表
  // 产出,UI 不再重推 level >= maxLevel(升级免费,无银两门槛)。选项缺失 = 相位与
  // 注册表不符(数据 bug),非空断言让其抛(零兜底)。
  const upgrade = choices.find((o) => o.id === "upgrade")!;
  // 价值变化 = 当前级 → 下一级城池价值(下标 = 等级)
  const valueNow = property.valueByLevel[level] ?? 0;
  const valueNext = upgrade.available ? property.valueByLevel[level + 1] ?? valueNow : valueNow;
  // G-19:1=扩军(不可升时无效)2=按兵不动
  useNumberShortcuts([
    () => { if (upgrade.available) onCommand({ type: "upgradeProperty" }); },
    () => onCommand({ type: "endDecision" }),
  ]);
  return (
    <ScrollShell title="扩军抉择" testid={T.upgradeScroll}>
      <p className="m-1 text-center text-sm text-ink-dim">
        「{tileName}」当前 Lv.{level} · 扩军免费
      </p>
      <p className="m-1 mb-3 text-center text-sm text-ink-dim">
        城池价值:{formatMoney(valueNow)} →{" "}
        {upgrade.available ? formatMoney(valueNext) : `(${upgrade.reason})`}
      </p>
      {/* #92:扩军权衡也上同一张表,高亮「扩军后」档(当前级+1;满级时下标越界,自然无命中行) */}
      <ValueTable property={property} highlight={{ level: level + 1, label: "扩军后" }} />
      <div className="flex flex-wrap items-center justify-center gap-3">
        <ScrollButton
          primary
          disabled={!upgrade.available}
          title={upgrade.available ? undefined : upgrade.reason}
          shortcut={1}
          testid={TESTIDS.actionButton("upgrade")}
          onClick={() => onCommand({ type: "upgradeProperty" })}
        >
          扩军(免费)
        </ScrollButton>
        <ScrollButton
          shortcut={2}
          testid={TESTIDS.actionButton("skip")}
          onClick={() => onCommand({ type: "endDecision" })}
        >
          按兵不动
        </ScrollButton>
      </div>
      {!upgrade.available && (
        <p className="mt-2 text-center text-xs text-ink-dim">{upgrade.reason}</p>
      )}
    </ScrollShell>
  );
}
