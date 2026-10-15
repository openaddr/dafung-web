// 定制问询流程域(#424,ADR-0022 交互 handler 的引擎消费挂点;ADR-0019 机制域轴):
// 发起(askInquiry)与应答(resolveInquiry)两段式,与机遇/招贤同构(相位 + 命令)。
// 与 choices 通路(ADR-0013)的咬合口径:handler 是选项集的上游生产者之一,不是旁路——
// 选项集计算在 choices.ts(inquiryChoices,PHASE_CHOICES.AwaitingInquiry 注册条目,
// 选项盖 inquiryId 章经 snapshot.choices 单通道透出),本域只管相位进出与应答回灌;
// 回合收口延期语义在 authority.ts endTurn(挂起问询挡收口,应答解挂后补完)。
import type { GameEngine } from "./authority";
import { computeChoices, type ChoiceOption } from "./choices";
import { extensionInquiries } from "./extension-registry";

/** 发起定制问询(#432 置挂起载荷,#424 升格相位入口;扩展效果函数经壳上公共方法调用):
 *  id 查无注册问询 = 调用方 bug(扩展未装载/id 拼写错),当场炸(零兜底)。挂起载荷就位
 *  后按 ADR-0013 口径先算选项集再分流:≥2 可用 → 置 AwaitingInquiry 等应答(弹卷轴⇔
 *  选项集≥2 的单通道语义原样);=1 → 自动执行唯一可用项(战报+浮字,不进相位,先例
 *  enterEncounterPhase);=0 → 问询作废(战报留痕)。自动执行/作废即刻清载荷并保持原相位,
 *  发起方流程无感续跑。 */
export function askInquiry(g: GameEngine, id: string, params: Record<string, number> = {}): void {
  if (!extensionInquiries().some((q) => q.id === id))
    throw new Error(`定制问询:「${id}」无注册问询(扩展未装载或 id 拼写错误)`);
  g.pendingInquiry = { id, params };
  const owner = g.activePlayer;
  const available = computeChoices(g, "AwaitingInquiry").filter((o) => o.available);
  if (available.length >= 2) {
    g.turnPhase = "AwaitingInquiry";
    g.logEvent(
      "system",
      owner.guohao,
      `${owner.guohao} 面临定制问询「${id}」:${available.length} 项抉择`,
      `inquiryAwait player=${owner.id} id=${id} options=${available.length}`,
    );
    return;
  }
  // ≤1 可用:不打扰——唯一项自动执行 / 零项作废,挂起载荷即刻清账
  g.pendingInquiry = null;
  const picked = available[0];
  if (picked == null) {
    g.logEvent(
      "system",
      owner.guohao,
      `${owner.guohao} 的问询「${id}」无可选项,作罢`,
      `inquiryVoid player=${owner.id} id=${id}`,
    );
    return;
  }
  settleInquiryAnswer(g, id, params, picked, true);
}

/** 应答定制问询(命令通路,UI/bot/联机同走;壳上 submitCommand 路由):相位+选项校验
 *  (未知/不可用 warn 拒绝,与 resolveEncounterChoice 同口径)→ 回灌扩展 resolve →
 *  留痕清载荷 → 补完被延期的回合收口(endTurn 入口的问询挡板已随载荷清除而放行)。 */
export function resolveInquiry(g: GameEngine, optionId: string): void {
  if (!g.assertPhase("AwaitingInquiry", "ResolveInquiry")) return;
  const pending = g.pendingInquiry;
  if (pending == null)
    throw new Error("定制问询:AwaitingInquiry 相位无挂起载荷(状态机 bug,不变量破坏)"); // 零兜底
  const opt = computeChoices(g, "AwaitingInquiry").find((o) => o.id === optionId);
  if (opt == null) {
    g.warn(`ResolveInquiry:问询「${pending.id}」无选项「${optionId}」`);
    return;
  }
  if (!opt.available) {
    g.warn(`ResolveInquiry:选项「${optionId}」不可用(${opt.reason ?? "原因不明"})`);
    return;
  }
  settleInquiryAnswer(g, pending.id, pending.params, opt, false);
  g.endTurn();
}

/** 应答结算(自动执行与命令应答同路):回灌扩展 resolve(纯逻辑纪律同 EffectFn,经引擎
 *  公共方法改状态)→ 战报留痕(自动执行加浮字轻提示,ADR-0013 决议 2)→ 清挂起载荷。
 *  命令路的收口续跑(resolveInquiry 的尾端 endTurn)在载荷清除后自然放行。 */
function settleInquiryAnswer(
  g: GameEngine,
  id: string,
  params: Record<string, number>,
  opt: ChoiceOption,
  auto: boolean,
): void {
  const inquiry = extensionInquiries().find((q) => q.id === id);
  if (inquiry == null)
    throw new Error(`定制问询:应答时挂起 id「${id}」查无注册问询(已卸载或注册面 bug)`); // 零兜底
  const seat = g.decisionOwner;
  inquiry.resolve({ engine: g, seat, params }, opt.id);
  const p = g.players[seat];
  g.logEvent(
    "system",
    p.guohao,
    auto
      ? `${p.guohao} 的问询「${id}」唯一可选项自动执行:${opt.label}`
      : `${p.guohao} 应答问询「${id}」:${opt.label}`,
    `inquiryResolve player=${p.id} id=${id} option=${opt.id}${auto ? " auto" : ""}`,
  );
  if (auto) g.pushFloaterText(p, opt.label, p.position);
  g.pendingInquiry = null;
}
