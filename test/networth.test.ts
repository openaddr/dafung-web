import { describe, it, expect } from "bun:test";
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

  it("买城/升级只花现金,不增身价(城池账面不计)", () => {
    const p = createPlayer({ id: "p", name: "A", guohao: "魏", colorIndex: 0, isBot: false, startingCash: 1000 });
    buy(p, changan); // -400
    upgrade(p, changan); // -200
    expect(netWorth(p)).toBe(400); // 仅剩现金(旧会计入 400+200 账面=1000)
  });

  it("都城建成后不计账面", () => {
    const p = createPlayer({ id: "p", name: "A", guohao: "魏", colorIndex: 0, isBot: false, startingCash: 2500 });
    p.cash -= changan.buildCost;
    p.properties.push({
      propertyId: changan.id,
      group: changan.group,
      purchasePrice: changan.buildCost,
      totalUpgradeCost: 0,
      level: 0,
      maxLevel: changan.maxLevel,
    });
    expect(netWorth(p)).toBe(1700); // 仅剩现金(旧会计入 800 账面=2500)
  });
});
