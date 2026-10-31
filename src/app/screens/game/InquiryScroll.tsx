// 定制问询弹层(#424,ADR-0022 交互 handler 的客户端半边):扩展问询的 UI 消费挂点。
// 数据单源快照(AwaitingInquiry 相位的选项集,引擎 PHASE_CHOICES 注册条目产出,选项盖
// inquiryId 章——ADR-0013 单通道,本层不重算不旁路);命令 = resolveInquiry(optionId),
// 与其他决策命令同经 controller 下发。呈现意图(app/extensions/registry
// ExtensionInquiryPresentation)声明式定制「怎么画」:title 题名 / blindCards 牌背盲选;
// 无定制走通用笺钮列表。弹层壳复用横幅制式家族(BannerShell/BannerButton,组件收口
// 登记在案的 FocusScope 惯用法):「不夺焦」「决策必须选、无关闭钮」口径与既有决策弹层
// 一致;「弹层⇔选项集≥2」由引擎分流保证(≤1 可用已在 askInquiry 自动执行/作废,不进相位)。
// 路由归 GameScreen(#scroll-layer 槽,与 DecisionScrollLayer 平级——本组件不进 scroll/
// 目录,该目录属并行票 #417 所有);AwaitingInquiry 与既有决策相位互斥,无同帧双弹层。
import { useEffect, useRef } from "react";
import type { GameCommand } from "@core/authority";
import type { ChoiceOption } from "@core/choices";
import type { GameSnapshot } from "@app/store/gameStore";
import { getController } from "@app/controllers/registry";
import { extensionInquiryPresentationOf } from "@app/extensions/registry";
import { JinnangCardBack } from "@app/components/card/JinnangCardFace";
import { BannerShell, BannerButton } from "./scroll/BannerShell";
import { TESTIDS } from "./testids";

/** G-19 数字快捷键(1..n 直选可用项;与 DecisionScrolls 各卷轴同口径,本文件自持——
 *  scroll/ 目录禁入不共享其私有 hook,语义一致两份小实现是收口边界内的代价)。 */
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

/** 问询弹层路由(#424):AwaitingInquiry + interactive 门控(联机 pending 期间不弹,
 *  与既有决策卷轴同口径);问询 id 从快照选项盖章读(引擎注册条目保证非空——挂起问询
 *  却无盖章选项 = 接线/状态机 bug,非空断言当场炸出,零兜底)。 */
export function InquiryLayer({
  snapshot,
  interactive,
}: {
  snapshot: GameSnapshot;
  interactive: boolean;
}) {
  if (
    !interactive ||
    snapshot.phase !== "Playing" ||
    snapshot.turnPhase !== "AwaitingInquiry" ||
    snapshot.pendingInquiry == null
  ) {
    return null;
  }
  const head = snapshot.choices.find((o) => o.inquiryId === snapshot.pendingInquiry!.id);
  if (head == null)
    throw new Error(
      `问询弹层:挂起问询「${snapshot.pendingInquiry.id}」的选项集无盖章选项(choices 断链)`,
    );
  const intent = extensionInquiryPresentationOf(head.inquiryId!);
  const dispatch = (cmd: GameCommand) => getController()?.dispatchCommand(cmd);
  return (
    <InquiryScroll
      title={intent?.title}
      blindCards={intent?.blindCards ?? false}
      choices={snapshot.choices}
      onCommand={dispatch}
    />
  );
}

/** 问询弹层本体:题名随呈现意图(缺省「问询」);blindCards 意图 → 牌背+序号钮
 *  (复用 JinnangCardBack,盲选脱敏:选项 label 是序号不是牌面);通用 → 笺钮列表。
 *  available/reason 单源引擎选项集,disabled+title 呈现,UI 不自行判定。 */
export function InquiryScroll({
  title,
  blindCards,
  choices,
  onCommand,
}: {
  title?: string;
  blindCards: boolean;
  /** 当前相位选项集(快照透出):全部携带同一 inquiryId 章,含不可用项。 */
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // G-19 同口径:数字键 1..n 直选(不可选的选项按键无效)
  useNumberShortcuts(
    choices.map((o) => () => {
      if (o.available) onCommand({ type: "resolveInquiry", optionId: o.id });
    }),
  );
  return (
    <BannerShell title={title ?? "问询"} testid={TESTIDS.inquiryScroll}>
      {blindCards ? (
        <div className="flex flex-wrap items-center justify-center gap-4 py-1">
          {choices.map((o, i) => (
            <button
              key={o.id}
              type="button"
              data-testid={TESTIDS.inquiryOption(i)}
              disabled={!o.available}
              title={o.available ? o.label : (o.reason ?? o.label)}
              onClick={() => onCommand({ type: "resolveInquiry", optionId: o.id })}
              className="relative cursor-pointer rounded-[5px] transition-transform hover:-translate-y-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
            >
              <JinnangCardBack>
                {/* 序号落牌背下幅(避让居中的「锦囊」朱印;漆金同牌面回纹色) */}
                <span className="absolute inset-x-0 top-[66%] flex justify-center font-brush text-[38px] leading-none text-[rgba(217,185,92,0.8)]">
                  {i + 1}
                </span>
              </JinnangCardBack>
              <span className="mt-1.5 block text-center font-wenkai text-xs text-paper-dim">
                {o.label}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {choices.map((o, i) => (
            <BannerButton
              key={o.id}
              primary={i === 0}
              disabled={!o.available}
              title={o.available ? undefined : o.reason}
              testid={TESTIDS.inquiryOption(i)}
              onClick={() => onCommand({ type: "resolveInquiry", optionId: o.id })}
            >
              {o.label}
            </BannerButton>
          ))}
        </div>
      )}
      {choices.some((o) => !o.available) && (
        <p className="mt-2 text-center text-xs text-paper-dim">
          {choices.find((o) => !o.available)?.reason}
        </p>
      )}
    </BannerShell>
  );
}
