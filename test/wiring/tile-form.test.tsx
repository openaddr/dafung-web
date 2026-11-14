// 城池档位→建筑形制分支(#916/ADR-0042 决策 1/5)组件级断言:四档 SSR 标记两两不同
// =形制分支存活(奇城不再回落郡形、县/郡/名/奇各走各画);名城瓦面锚钉住共享琉璃
// 渐变单源(StaticLayers defs,勿逐城内联)。可辨性 aesthetics(844×390 总览并排)
// 走 shot.mjs 截图自证,自动化不管美学;宁缺毋滥口径:本用例守住「tier→形制分支不回归」。
import { describe, it, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CityTier } from "@core/economy";
import type { TileDef } from "@core/board";
import { Tile } from "@app/components/board/Tile";

const tile = (): TileDef => ({
  index: 3,
  type: "Property",
  name: "测试城",
  position: { x: 0, y: 0 },
  propertyId: "prop-test",
  isCapitalEligible: true,
});

const IDLE_STATE = {
  ownerColorIndex: null,
  ownerGuohao: null,
  level: 0,
  capitalColorIndex: null,
  capitalGuohao: null,
  isActive: false,
  isTaken: false,
  isSelectable: false,
  capitalCandidateOrder: null,
  isCityTarget: false,
  isCityPicked: false,
  defense: null, // 无主锚定(必填联合,null=不渲染盾排)
};

const markupOf = (tier: CityTier): string =>
  renderToStaticMarkup(<Tile tile={tile()} tier={tier} maxLevel={3} state={IDLE_STATE} />);

describe("城池档位→建筑形制(#916/ADR-0042)", () => {
  const tiers: CityTier[] = ["县", "郡", "奇", "名"];

  it("四档形制两两不同(分支存活)", () => {
    const marks = new Map(tiers.map((t) => [t, markupOf(t)] as const));
    for (let i = 0; i < tiers.length; i++) {
      for (let j = i + 1; j < tiers.length; j++) {
        expect(marks.get(tiers[i]), `${tiers[i]} vs ${tiers[j]}`).not.toBe(marks.get(tiers[j]));
      }
    }
  });

  it("名城瓦面走共享琉璃渐变,其余三档不走(StaticLayers 单源 defs)", () => {
    expect(markupOf("名")).toContain("bv-glazed-roof-grad");
    expect(markupOf("郡")).not.toContain("bv-glazed-roof-grad");
    expect(markupOf("县")).not.toContain("bv-glazed-roof-grad");
    expect(markupOf("奇")).not.toContain("bv-glazed-roof-grad");
  });
});
