import { describe, it, expect } from "vitest";
import { netWorth } from "@core/networth";
import { buy, upgrade } from "@core/economy";
import { createPlayer } from "@core/player";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
const catalog = loadMap(sanguoData).catalog;

const changan = catalog.get("prop-changan")!; // 购入 400,升级 200

describe("身价计算", () => {
  it("纯现金身价", () => {
    const p = createPlayer({ id: "p", name: "A", guohao: "魏", colorIndex: 0, isBot: false, startingCash: 2000 });
    expect(netWorth(p)).toBe(2000);
  });

  it("现金 + 地产账面价值(购入+升级)", () => {
    const p = createPlayer({ id: "p", name: "A", guohao: "魏", colorIndex: 0, isBot: false, startingCash: 1000 });
    buy(p, changan); // -400,账面 +400
    upgrade(p, changan); // -200,账面 +200
    // 现金 400 + 账面(400+200)=1000
    expect(netWorth(p)).toBe(1000);
  });

  it("都城计入身价(建城费 + 升级)", () => {
    const p = createPlayer({ id: "p", name: "A", guohao: "魏", colorIndex: 0, isBot: false, startingCash: 2500 });
    // 模拟建都城:建城费 800 作为 holding.purchasePrice
    p.cash -= changan.buildCost;
    p.properties.push({
      propertyId: changan.id,
      group: changan.group,
      purchasePrice: changan.buildCost,
      totalUpgradeCost: 0,
      level: 0,
      maxLevel: changan.maxLevel,
    });
    expect(netWorth(p)).toBe(2500); // 1700 + 800
  });
});
