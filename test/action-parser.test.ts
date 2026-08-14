import { describe, it, expect } from "vitest";
import { parseAction } from "@render/action-parser";

/** action-string 解析收口(ADR-0006:解析共用)。纯函数,无 DOM/WS。
 *  覆盖:全部生产端动作(client-controller 卷轴构建器 + renderActionInline)+ 未识别输入。 */
describe("parseAction(action-string → 结构化)", () => {
  // ── 常规内嵌动作(renderActionInline)──
  it("halt/continue → 驻跸抉择", () => {
    expect(parseAction("halt")).toEqual({ kind: "command", command: { type: "haltAtCapital" } });
    expect(parseAction("continue")).toEqual({ kind: "command", command: { type: "continueMove" } });
  });

  it("main/branch → 辅路入口抉择", () => {
    expect(parseAction("main")).toEqual({ kind: "command", command: { type: "selectBranch", kind: "Main" } });
    expect(parseAction("branch")).toEqual({ kind: "command", command: { type: "selectBranch", kind: "Branch" } });
  });

  it("buy/upgrade/skip → 地产决策", () => {
    expect(parseAction("buy")).toEqual({ kind: "command", command: { type: "buyProperty" } });
    expect(parseAction("upgrade")).toEqual({ kind: "command", command: { type: "upgradeProperty" } });
    expect(parseAction("skip")).toEqual({ kind: "command", command: { type: "endDecision" } });
  });

  // ── 招贤纳士 ──
  it("heropick-N → 招贤三选一(索引)", () => {
    expect(parseAction("heropick-0")).toEqual({ kind: "command", command: { type: "resolveHeroPick", index: 0 } });
    expect(parseAction("heropick-2")).toEqual({ kind: "command", command: { type: "resolveHeroPick", index: 2 } });
  });

  // ── 珍宝交涉 ──
  it("treasure-skip → 不交易命令", () => {
    expect(parseAction("treasure-skip")).toEqual({
      kind: "command",
      command: { type: "resolveTreasureOwner", action: { type: "skip" } },
    });
  });

  it("treasure-back / treasure-mode-* → 纯 UI 跳步(不进引擎)", () => {
    expect(parseAction("treasure-back")).toEqual({ kind: "ui", ui: "treasure-back" });
    expect(parseAction("treasure-mode-fair")).toEqual({ kind: "ui", ui: { type: "treasure-mode", mode: "fair" } });
    expect(parseAction("treasure-mode-premium")).toEqual({ kind: "ui", ui: { type: "treasure-mode", mode: "premium" } });
  });

  it("treasure-fair-X / treasure-premium-X → 交涉命令(珍宝 id 含连字符)", () => {
    expect(parseAction("treasure-fair-lychee-3")).toEqual({
      kind: "command",
      command: { type: "resolveTreasureOwner", action: { type: "fair", treasureId: "lychee-3" } },
    });
    expect(parseAction("treasure-premium-seal-0")).toEqual({
      kind: "command",
      command: { type: "resolveTreasureOwner", action: { type: "premium", treasureId: "seal-0" } },
    });
  });

  // ── 破产清算 ──
  it("bk-confirm → 结算命令", () => {
    expect(parseAction("bk-confirm")).toEqual({ kind: "command", command: { type: "confirmBankruptcySettle" } });
  });

  it("bk-treasure-X / bk-prop-X / bk-hero-X → 变卖命令(id 含连字符)", () => {
    expect(parseAction("bk-treasure-edict-1")).toEqual({
      kind: "command",
      command: { type: "sellTreasureBankruptcy", treasureId: "edict-1" },
    });
    expect(parseAction("bk-prop-prop-changan")).toEqual({
      kind: "command",
      command: { type: "sellPropertyBankruptcy", propId: "prop-changan" },
    });
    expect(parseAction("bk-hero-zhouyu")).toEqual({
      kind: "command",
      command: { type: "cashHeroBankruptcy", heroId: "zhouyu" },
    });
  });

  // ── 未识别 ──
  it("未知动作 → null(调用方忽略)", () => {
    expect(parseAction("nonexistent")).toBeNull();
    expect(parseAction("treasure-mode-bogus")).toBeNull();
    expect(parseAction("bk-unknown-verb-x")).toBeNull();
    expect(parseAction("treasure-foo")).toBeNull();
    expect(parseAction("")).toBeNull();
  });
});
