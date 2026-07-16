import { describe, it, expect } from "vitest";
import { buy, upgrade, computeRent, settleDebt } from "@core/economy";
import { createPlayer } from "@core/player";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
const catalog = loadMap(sanguoData).catalog;

const changan = catalog.get("prop-changan")!; // a 组,¥400,Lv 租 [20,60,...]
const hangu = catalog.get("prop-hangu")!; // a 组,¥200

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

  it("升级:L+1,累计升级费", () => {
    const p = mk();
    buy(p, changan);
    const r = upgrade(p, changan);
    expect(r.status).toBe("Ok");
    expect(r.newLevel).toBe(1);
    expect(p.cash).toBe(400); // 1000-400-200
    expect(p.properties[0].totalUpgradeCost).toBe(200);
  });

  it("满级拒绝升级", () => {
    const p = mk(100000);
    buy(p, changan);
    for (let i = 0; i < 5; i++) upgrade(p, changan);
    expect(upgrade(p, changan).status).toBe("AlreadyMaxLevel");
    expect(p.properties[0].level).toBe(5);
  });

  it("租金:按等级;拥有整组 ×2", () => {
    const owner = mk(100000);
    // 买 a 组全部:长安/函谷关/洛阳/许昌/宛/邺城
    for (const id of catalog.groupMembers("a")) buy(owner, catalog.get(id)!);
    // 拥有整组前先测单城?这里直接整组,租金应 ×2
    const baseRent = computeRent(changan, owner, catalog);
    expect(baseRent).toBe(changan.rentByLevel[0] * 2); // Lv0 ×2

    // 只持有部分:不 ×2
    const owner2 = mk(100000);
    buy(owner2, changan);
    buy(owner2, hangu);
    expect(computeRent(changan, owner2, catalog)).toBe(changan.rentByLevel[0]);
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

  it("现金不足:破产,资产转移债主", () => {
    const a = mk(1000);
    const b = mk(0);
    buy(a, changan); // a 有地产(现金 600)
    a.cash = 100; // 模拟现金耗尽
    const bankrupt = settleDebt(a, b, 500);
    expect(bankrupt).toBe(true);
    expect(a.isBankrupt).toBe(true);
    expect(a.cash).toBe(0);
    expect(a.properties).toHaveLength(0);
    expect(b.cash).toBe(100); // a 的现金给 b
    expect(b.properties).toHaveLength(1); // 地产转移
  });

  it("无债主(税/关税):现金不足破产,资产销毁", () => {
    const a = mk(100);
    buy(a, changan);
    const bankrupt = settleDebt(a, null, 500);
    expect(bankrupt).toBe(true);
    expect(a.properties).toHaveLength(0);
  });
});
