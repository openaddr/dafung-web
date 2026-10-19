// 对局日志现金对账不变量(#617):amount 只记现金收付(+收入/-支出),任何玩家的
// 现金变动当且仅当恰有带 amount 的日志行对应;非现金事件(得宝估价/escrow 资产交割)
// amount 必须缺省。脚本化一段三人对局,覆盖得宝、直付成交(fair+premium)、清算成交、
// 破产成交四条路径,断言逐玩家 Σamount == 引擎观测的现金净变动——场景内除四路径外
// 无其他现金流(机遇缺省关闭;不落自己都城故无补给;锦囊全部放行不出)。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { TREASURE_PRICE } from "@core/treasures";
import type { TreasureDef } from "@core/treasures";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "@core/board-loader";
import { testEngine } from "@core/testing";

const MAP = loadMap(huanyouData);
const START_CASH = 300; // 压低起手金:让清算/破产路径在无直写 cash 的情况下自然触发

function makeEngine(): GameEngine {
  const seats: SeatConfig[] = [
    { name: "A", isBot: false, guohao: "魏" },
    { name: "B", isBot: false, guohao: "蜀" },
    { name: "C", isBot: false, guohao: "吴" },
  ];
  const cfg: EngineConfig = { seats, startingCash: START_CASH, targetNetWorth: 30000 };
  return new GameEngine(MAP.board, MAP.catalog, createDice(7), cfg);
}

function finishSetup(e: GameEngine) {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) {
      e.aiSetupStep();
      continue;
    }
    e.pickCapital(idx, e.offeredCapitals[0]!);
  }
}

/** 放行出牌阶段(endTurn 后下家停在 AwaitingJinnang,不放牌零现金流)。 */
function passJinnang(e: GameEngine): GameEngine {
  while (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return e;
}

const tr = (id: string, level: number): TreasureDef => ({
  id,
  name: `宝·${id}`,
  level,
  count: 1,
  desc: "",
});

/** 置交涉窗口:当前活跃玩家(买家)对 ownerIdx 卖家就 defId 城交涉。
 *  #619 起 resolveTreasureOwner 断言「城主必持城」(交涉只由有主城落城触发)——白盒把
 *  defId 持有关系归位到 ownerIdx(在他手则整体移交、等级随持,无则种植 Lv0),零现金流
 *  不污染对账窗口;本测试的等级敏感断言仅 S3 premium,发生在任何 fair 升级之前。 */
function forceVisit(e: GameEngine, defId: string, ownerIdx: number) {
  const owner = e.players[ownerIdx];
  for (const p of e.players) {
    if (p === owner) continue;
    const idx = p.properties.findIndex((h) => h.propertyId === defId);
    if (idx >= 0) p.properties.splice(idx, 1);
  }
  if (!owner.properties.some((h) => h.propertyId === defId)) {
    const def = e.catalog.get(defId)!;
    owner.properties.push({
      propertyId: defId,
      group: def.group,
      level: 0,
      maxLevel: def.maxLevel,
    });
  }
  e.treasureVisitor = { def: e.catalog.get(defId)!, ownerIdx };
  testEngine(e).forceTurnPhase("AwaitingTreasureOwner");
}

const rowOf = (e: GameEngine, prefix: string, need: string, from = 0) =>
  e.log.find((l, i) => i >= from && l.detail.startsWith(prefix) && l.detail.includes(need))!;

describe("对局日志现金对账(#617)", () => {
  it("一段对局:得宝/直付 fair+premium/清算成交/破产成交,逐玩家 Σamount == 现金净变动", () => {
    const e = makeEngine();
    finishSetup(e);
    passJinnang(e);
    const [wei, shu, wu] = e.players;
    expect(wei.guohao).toBe("魏"); // 座位序锚点,防后续断言张冠李戴
    const mark = e.log.length;
    const cash0 = e.players.map((p) => p.cash);

    // S1(魏回):落无主宝物城,无委任状 → 自动不购 → 链尾探宝,Lv1 拼点恒成得宝(无现金流)
    wei.warrants = 0;
    e.treasureDeck = [tr("probe-t", 1)];
    const tTile = e.board.tiles.find(
      (t) => t.type === "TreasureCity" && !e.takenCapitalIndices.has(t.index),
    )!;
    testEngine(e).landActiveAt(tTile.index);
    passJinnang(e); // 探宝自带 endTurn → 蜀
    expect(wei.treasures.map((t) => t.id)).toEqual(["probe-t"]);
    const gain = rowOf(e, "treasureGain", "probe-t");
    expect(gain.amount).toBeUndefined(); // 得宝=资产入册,估价不入现金账
    expect(gain.detail.endsWith(`value=${TREASURE_PRICE[1]}`)).toBe(true); // 指导价降为 detail 估价
    wei.treasures = []; // 拼点所得与后续路径无关,摘除以免沦为 S7 破产判定的可变卖资产

    // S2(蜀回):蜀向魏公道买卖 t1(Lv1,价 100)——直付 fair
    wei.treasures.push(tr("t1", 1));
    forceVisit(e, "prop-luoyang", 0);
    e.resolveTreasureOwner({ type: "fair", treasureId: "t1" });
    passJinnang(e); // → 吴
    expect(rowOf(e, "treasureFair", "treasure=t1").amount).toBe(100); // 卖家实收 +
    expect(rowOf(e, "treasureFair", "treasure=t1").player).toBe("魏");
    expect(rowOf(e, `treasureBuy buyer=${shu.id}`, "treasure=t1").amount).toBe(-100); // 买家实付 -
    expect(rowOf(e, "escrowDeliver", "treasure=t1").amount).toBeUndefined(); // 资产交割不挂 amount

    // S3(吴回):吴坐地起价购蜀 t2(成都 Lv0 乘法城,价 200)——直付 premium
    shu.treasures.push(tr("t2", 1));
    forceVisit(e, "prop-chengdu", 1);
    e.resolveTreasureOwner({ type: "premium", treasureId: "t2" });
    passJinnang(e); // → 魏
    expect(rowOf(e, "treasurePremium", "treasure=t2").amount).toBe(200);
    expect(rowOf(e, "treasurePremium", "treasure=t2").player).toBe("蜀");
    expect(rowOf(e, `treasureBuy buyer=${wu.id}`, "treasure=t2").amount).toBe(-200);

    // S4(魏回):魏公道买卖购蜀 t5(Lv5,价 600 > 现金 400)→ 变卖旧藏(200)自救清偿——清算成交
    wei.treasures.push(tr("spare-t", 2));
    shu.treasures.push(tr("t5", 5));
    forceVisit(e, "prop-chengdu", 1);
    e.resolveTreasureOwner({ type: "fair", treasureId: "t5" });
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    const awaiting = rowOf(e, "awaitingBankruptcy", `player=${wei.id}`);
    expect(awaiting.amount).toBeUndefined(); // 挂起行非现金收付
    e.sellTreasureBankruptcy("spare-t"); // +200(bkSellTreasure 自带正确 amount)
    expect(rowOf(e, "bkSellTreasure", "treasure=spare-t").amount).toBe(200);
    e.confirmBankruptcySettle();
    passJinnang(e); // → 蜀
    expect(rowOf(e, "bkConfirm", `player=${wei.id}`).amount).toBe(-600); // 清偿=买家现金支出
    const s4Seller = rowOf(e, "treasureFair", "treasure=t5"); // 清算路径补卖家收款行
    expect(s4Seller.amount).toBe(600);
    expect(s4Seller.player).toBe("蜀");
    expect(s4Seller.detail).toContain("bankrupt=false");
    expect(rowOf(e, "escrowDeliver", "treasure=t5").amount).toBeUndefined();

    // S5(蜀回):蜀向魏公道买卖买回 t5(Lv5,价 600)——直付 fair(魏作为卖家清空手中珍宝)
    const mark5 = e.log.length;
    forceVisit(e, "prop-chengdu", 0);
    e.resolveTreasureOwner({ type: "fair", treasureId: "t5" });
    passJinnang(e); // → 吴
    expect(rowOf(e, "treasureFair", "treasure=t5", mark5).amount).toBe(600);
    expect(rowOf(e, `treasureBuy buyer=${shu.id}`, "treasure=t5", mark5).amount).toBe(-600);

    // S6(吴回):不交易跳过(无现金流)
    forceVisit(e, "prop-luoyang", 0);
    e.resolveTreasureOwner({ type: "skip" });
    passJinnang(e); // → 魏
    expect(rowOf(e, "treasureSkip", `owner=${wei.id}`).amount).toBeUndefined();

    // S7(魏回):魏(现金 600,无珍宝/名将/非都城地产=无可变卖资产)公道买卖购蜀 t8
    // (Lv8,价 1600)→ 直接破产,余现金 600 扫账给卖家,托管 t8 退回蜀——破产成交
    // (无可变卖资产在 #619 前由「holding 恒空」隐含成立;现白盒种植过 洛阳/成都,显式摘除)
    wei.properties = [];
    shu.treasures.push(tr("t8", 8));
    forceVisit(e, "prop-chengdu", 1);
    e.resolveTreasureOwner({ type: "fair", treasureId: "t8" });
    expect(wei.isBankrupt).toBe(true);
    const s7Seller = rowOf(e, "treasureFair", "treasure=t8");
    expect(s7Seller.amount).toBe(600); // 破产扫账:实收=买家余现金,非成交价 1600
    expect(s7Seller.player).toBe("蜀");
    expect(s7Seller.detail).toContain("price=1600");
    expect(s7Seller.detail).toContain("bankrupt=true");
    const s7Buyer = rowOf(e, `treasureBuy buyer=${wei.id}`, "treasure=t8");
    expect(s7Buyer.amount).toBe(-600);
    expect(s7Buyer.detail).toContain("bankrupt=true");
    expect(rowOf(e, "escrowReturn", "treasure=t8").amount).toBeUndefined(); // 退回=资产转移
    expect(wei.cash).toBe(0);

    // 总不变量:逐玩家 Σamount == 引擎观测现金净变动(窗口内除四路径外无其他现金流)
    const cashEnd = e.players.map((p) => p.cash);
    for (let i = 0; i < e.players.length; i++) {
      const sum = e.log
        .slice(mark)
        .reduce(
          (s, l) => (l.player === e.players[i].guohao && l.amount !== undefined ? s + l.amount : s),
          0,
        );
      expect(sum).toBe(cashEnd[i] - cash0[i]);
    }

    // 非现金事件 amount 必须缺省(iff 的另一半:无现金变动不得挂 amount)
    const cashless = e.log
      .slice(mark)
      .filter((l) =>
        /^(treasureGain|treasureMiss|escrowDeliver|escrowReturn|treasureSkip)/.test(l.detail),
      );
    expect(cashless.length).toBeGreaterThan(0);
    expect(
      cashless.filter((l) => l.amount !== undefined).map((l) => `${l.category}:${l.detail}`),
    ).toEqual([]);
  });
});
