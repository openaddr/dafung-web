import { describe, it, expect } from "bun:test";
import { buy, upgrade, settleDebt, sellValueOf } from "@core/economy";
import { createPlayer } from "@core/player";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
const catalog = loadMap(sanguoData).catalog;

const changan = catalog.get("prop-changan")!; // a 组,¥400,等级价值 [20,60,180,500](Lv0-3)

function mk(cash = 1000) {
  return createPlayer({ id: "p", name: "A", guohao: "魏", colorIndex: 0, isBot: false, startingCash: cash });
}

describe("地产交易", () => {
  it("购买:扣现金、获 holding Lv0", () => {
    const p = mk();
    const r = buy(p, changan);
    expect(r.status).toBe("Ok");
    expect(p.cash).toBe(600);
    expect(p.properties).toHaveLength(1);
    expect(p.properties[0].level).toBe(0);
    expect(p.properties[0].purchasePrice).toBe(400);
  });

  it("现金不足拒绝购买", () => {
    const p = mk(300);
    expect(buy(p, changan).status).toBe("InsufficientFunds");
    expect(p.cash).toBe(300);
    expect(p.properties).toHaveLength(0);
  });

  it("升级:免费,L+1(无升级费)", () => {
    const p = mk();
    buy(p, changan);
    const r = upgrade(p, changan);
    expect(r.status).toBe("Ok");
    expect(r.newLevel).toBe(1);
    expect(p.cash).toBe(600); // 升级免费,现金不变
  });

  it("满级拒绝升级(等级 0..maxLevel = 3,共 4 级)", () => {
    const p = mk(100000);
    buy(p, changan);
    upgrade(p, changan); // Lv1
    upgrade(p, changan); // Lv2
    upgrade(p, changan); // Lv3
    expect(upgrade(p, changan).status).toBe("AlreadyMaxLevel");
    expect(p.properties[0].level).toBe(3);
    expect(changan.valueByLevel).toHaveLength(4);
  });

  it("变卖价 = 各等级城池价值(valueByLevel 显式定义)", () => {
    const p = mk(100000);
    buy(p, changan);
    expect(sellValueOf(changan, 0)).toBe(20);
    expect(sellValueOf(changan, 1)).toBe(60);
    expect(sellValueOf(changan, 2)).toBe(180);
    expect(sellValueOf(changan, 3)).toBe(500);
  });
});

describe("破产裁决", () => {
  it("现金足够:不破产,债主收款", () => {
    const a = mk(500);
    const b = mk(0);
    const bankrupt = settleDebt(a, b, 200);
    expect(bankrupt).toBe(false);
    expect(a.cash).toBe(300);
    expect(b.cash).toBe(200);
  });

  it("现金不足:破产,资产(地产+珍宝)转移债主", () => {
    const a = mk(1000);
    const b = mk(0);
    buy(a, changan); // a 有地产(现金 600)
    a.treasures.push({ id: "seal", name: "玉玺", level: 10, count: 1, desc: "" });
    a.cash = 100; // 模拟现金耗尽
    const bankrupt = settleDebt(a, b, 500);
    expect(bankrupt).toBe(true);
    expect(a.isBankrupt).toBe(true);
    expect(a.cash).toBe(0);
    expect(a.properties).toHaveLength(0);
    expect(a.treasures).toHaveLength(0); // 珍宝转移
    expect(b.cash).toBe(100); // a 的现金给 b
    expect(b.properties).toHaveLength(1); // 地产转移
    expect(b.treasures).toHaveLength(1); // 珍宝转移
  });

  it("无债主(税/关税):现金不足破产,资产销毁", () => {
    const a = mk(100);
    buy(a, changan);
    const bankrupt = settleDebt(a, null, 500);
    expect(bankrupt).toBe(true);
    expect(a.properties).toHaveLength(0);
  });
});
