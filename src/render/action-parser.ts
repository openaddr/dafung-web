// action-string 解析(收口):UI 按钮 data-action / e2e 点击 → 结构化动作。
// 热座(state.ts)与联机(network-client.ts)共用此解析,各自只留"执行"差异
// (ADR-0006:解析共用,执行差异化)。纯函数、零 DOM/WS 依赖,可单测。
//
// 两类产物:GameCommand(直接可执行/可发 WS)与纯客户端 UI 跳步(不进引擎:
// treasure-back 重弹卷轴、treasure-mode-* 切换选择器)。
// 注:珍宝/城池 id 自带连字符(如 lychee-3 / prop-changan),子段用 join("-") 还原。
import type { GameCommand } from "@core/types";

export type ParsedAction =
  | { kind: "command"; command: GameCommand }
  | { kind: "ui"; ui: "treasure-back" | { type: "treasure-mode"; mode: "fair" | "premium" } };

/** 解析 action-string;无法识别返回 null(调用方忽略)。 */
export function parseAction(action: string): ParsedAction | null {
  if (action.startsWith("heropick-")) {
    const index = parseInt(action.slice("heropick-".length), 10);
    return { kind: "command", command: { type: "resolveHeroPick", index } };
  }
  if (action.startsWith("treasure-")) {
    const sub = action.slice("treasure-".length);
    if (sub === "skip") return { kind: "command", command: { type: "resolveTreasureOwner", action: { type: "skip" } } };
    if (sub === "back") return { kind: "ui", ui: "treasure-back" };
    if (sub.startsWith("mode-")) {
      const mode = sub.slice("mode-".length);
      if (mode === "fair" || mode === "premium") return { kind: "ui", ui: { type: "treasure-mode", mode } };
      return null;
    }
    const [verb, ...rest] = sub.split("-");
    const treasureId = rest.join("-");
    if (verb === "fair") return { kind: "command", command: { type: "resolveTreasureOwner", action: { type: "fair", treasureId } } };
    if (verb === "premium") return { kind: "command", command: { type: "resolveTreasureOwner", action: { type: "premium", treasureId } } };
    return null;
  }
  if (action.startsWith("bk-")) {
    const sub = action.slice("bk-".length);
    if (sub === "confirm") return { kind: "command", command: { type: "confirmBankruptcySettle" } };
    const [verb, ...rest] = sub.split("-");
    const id = rest.join("-");
    if (verb === "treasure") return { kind: "command", command: { type: "sellTreasureBankruptcy", treasureId: id } };
    if (verb === "prop") return { kind: "command", command: { type: "sellPropertyBankruptcy", propId: id } };
    if (verb === "hero") return { kind: "command", command: { type: "cashHeroBankruptcy", heroId: id } };
    return null;
  }
  switch (action) {
    case "halt": return { kind: "command", command: { type: "haltAtCapital" } };
    case "continue": return { kind: "command", command: { type: "continueMove" } };
    case "main": return { kind: "command", command: { type: "selectBranch", kind: "Main" } };
    case "branch": return { kind: "command", command: { type: "selectBranch", kind: "Branch" } };
    case "buy": return { kind: "command", command: { type: "buyProperty" } };
    case "upgrade": return { kind: "command", command: { type: "upgradeProperty" } };
    case "skip": return { kind: "command", command: { type: "endDecision" } };
  }
  return null;
}
