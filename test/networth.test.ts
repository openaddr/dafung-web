import { describe, it, expect } from "bun:test";
import { netWorth } from "@core/networth";
import { buy, upgrade } from "@core/economy";
import { createPlayer } from "@core/player";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
const catalog = loadMap(sanguoData).catalog;

const changan = catalog.get("prop-changan")!; // 经济 v2 购入 4000 分(40 两),升级免费

describe("身价计算", () => {
  it("纯现金身价", () => {
    const p = createPlayer({ id: "p", name: "A", guohao: "魏", colorIndex: 0, isBot: false, startingCash: 2000 });
    expect(netWorth(p)).toBe(2000);
  });

  it("买城只花现金,升级免费不降身价(城池账面不计)", () => {
    const p = createPlayer({ id: "p", name: "A", guohao: "魏", colorIndex: 0, isBot: false, startingCash: 10000 });
    buy(p, changan); // -4000
    upgrade(p, changan); // 免费(到达升级,无升级费)
    expect(netWorth(p)).toBe(6000);
  });

  it("都城建成后不计账面", () => {
    const p = createPlayer({ id: "p", name: "A", guohao: "魏", colorIndex: 0, isBot: false, startingCash: 10000 });
    p.cash -= changan.buildCost;
    p.properties.push({
      propertyId: changan.id,
      group: changan.group,
      purchasePrice: changan.buildCost,
      level: 1,
      maxLevel: changan.maxLevel,
    });
    expect(netWorth(p)).toBe(8000); // 仅剩现金(建城费 2000)
  });
});
