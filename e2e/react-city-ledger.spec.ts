// 名下城池清单弹层(#622+#623,规格 #621):席位卡/仪表条城池徽章点开的只读
// 清单(行首真实格缩略图 + 五列)。
// 一条链(宁缺毋滥):仪表条徽章(自看)开弹层 → 五列字段与引擎数据抽查一致
// (都城/普通城/宝物城三种入列,#622 AC)→ 行序 = 棋盘 index 序(种 index 更大
// 的城验证排序)→ X 关闭;席位卡徽章(对手)标题带国号;开着弹层清空名下 →
// 空态浮现(顺带证「随 store 实时重渲」)。
// 种植式断言(冻结→种植→点击→断言→恢复,react-solo #421 同口径):字段期望值
// 全部读自引擎 catalog,不落第二事实源;选择器一律走 TESTIDS 单源(AGENTS
// 「关键文件」,评审必修项修正:禁硬编码字符串)。
import { test, expect } from "./fixtures";
import {
  quickStart,
  force,
  snap,
  actIfCan,
  fmtMoney,
  freezeClock,
  unfreezeClock,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

interface Planted {
  capId: string;
  capName: string;
  capLevel: number;
  capMax: number;
  capPrice: number;
  capSell: number;
  capMult: number;
  capAdd: number;
  capIdx: number;
  newId: string;
  newName: string;
  newPrice: number;
  newSell: number;
  newMax: number;
  newMult: number;
  newAdd: number;
  newIdx: number;
  trId: string;
  trName: string;
  trPrice: number;
  trSell: number;
  trMax: number;
  trMult: number;
  trAdd: number;
  trIdx: number;
}

test("城池徽章点开名下城池清单:自看五列字段/行序、对手国号标题、空态(#622)", async ({ page }) => {
  await quickStart(page);
  // 清掉 quickStart 可能遗留的决策卷轴(有卷轴即有遮罩,会吞徽章点击);有界循环,
  // 语义同 react-solo「加速到胜利」的驱动环。
  for (let i = 0; i < 10 && (await actIfCan(page)); i++);

  await freezeClock(page);
  try {
    // 种两座城(首座=都城):①一枚棋盘 index 大于都城格的无主普通城,验证行序=
    // 棋盘 index 序;②一枚无主宝物城,验证同权入列(#622 AC;开局确定性地图必有,
    // 缺失=地图/开局变了,当场炸出改种植策略)。字段期望值当场读自引擎 catalog
    // (冻结期数值稳定,不与自走竞速)。
    const planted = await page.evaluate<Planted>(
      /* js */ () => {
        const e = (window as any).__dafung.getEngine();
        const me = e.players[0];
        const cap = me.properties.find(
          (h: any) => h.propertyId === e.board.at(me.capitalIndex).propertyId,
        );
        const capDef = e.catalog.get(cap.propertyId);
        const capTile = e.board.tiles.find((t: any) => t.propertyId === cap.propertyId);
        const trTile = e.board.tiles.find(
          (t: any) =>
            t.type === "TreasureCity" &&
            t.propertyId &&
            e.findOwner(t.propertyId) == null &&
            t.index !== capTile.index,
        );
        if (!trTile) throw new Error("种植失败:无无主宝物城(地图/开局变了)");
        const trDef = e.catalog.get(trTile.propertyId);
        const tile = e.board.tiles.find(
          (t: any) =>
            t.type === "Property" &&
            t.propertyId &&
            t.index > capTile.index &&
            e.findOwner(t.propertyId) == null,
        );
        if (!tile) throw new Error("种植失败:都城后无无主普通城");
        const def = e.catalog.get(tile.propertyId);
        me.properties.push({
          propertyId: tile.propertyId,
          level: 1,
          group: def.group,
          maxLevel: def.maxLevel,
        });
        me.properties.push({
          propertyId: trTile.propertyId,
          level: 0,
          group: trDef.group,
          maxLevel: trDef.maxLevel,
        });
        return {
          capId: cap.propertyId,
          capName: capTile.name,
          capLevel: cap.level,
          capMax: capDef.maxLevel,
          capPrice: capDef.purchasePrice,
          capSell: capDef.valueByLevel[cap.level],
          capMult: capDef.tradeMult[cap.level],
          capAdd: capDef.tradeAdd[cap.level],
          capIdx: capTile.index,
          newId: tile.propertyId,
          newName: tile.name,
          newPrice: def.purchasePrice,
          newSell: def.valueByLevel[1],
          newMax: def.maxLevel,
          newMult: def.tradeMult[1],
          newAdd: def.tradeAdd[1],
          newIdx: tile.index,
          trId: trTile.propertyId,
          trName: trTile.name,
          trPrice: trDef.purchasePrice,
          trSell: trDef.valueByLevel[0],
          trMax: trDef.maxLevel,
          trMult: trDef.tradeMult[0],
          trAdd: trDef.tradeAdd[0],
          trIdx: trTile.index,
        };
      },
    );
    // 引擎直写后须 sync 灌回 store(force 助手同法):弹层与 snap 读的是 store 快照,
    // 不灌则种植城不可见(首轮实录:漏 sync,行序断言 -1)。
    await page.evaluate(() => (window as any).__dafung.controller().sync());

    // ── 自看入口:仪表条城池徽章 ──
    await page.getByTestId(TESTIDS.dashAttr("city")).click();
    const modal = page.getByTestId(TESTIDS.cityLedger);
    await expect(modal).toBeVisible();
    await expect(modal.getByText("本方名下城池")).toBeVisible();
    await expect(page.getByTestId(TESTIDS.dashAttr("city"))).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // 行序 = 棋盘 index 序:三行恰为名下三城,按格索引升序(行集=名下城集,种植物
    // 确定,枚举精确断言;选择器走 TESTIDS 单源,不做前缀模糊匹配)。
    const rowTestId = (id: string) => TESTIDS.cityLedgerRow(id);
    const rowIds = await modal
      .locator(
        `[data-testid="${rowTestId(planted.capId)}"], [data-testid="${rowTestId(planted.newId)}"], [data-testid="${rowTestId(planted.trId)}"]`,
      )
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    const s = await snap(page);
    expect(s.players[0].properties.length).toBe(3);
    const expectedOrder = [
      { idx: planted.capIdx, id: rowTestId(planted.capId) },
      { idx: planted.newIdx, id: rowTestId(planted.newId) },
      { idx: planted.trIdx, id: rowTestId(planted.trId) },
    ]
      .sort((a, b) => a.idx - b.idx)
      .map((r) => r.id);
    expect(rowIds).toEqual(expectedOrder);

    // 五列字段抽查(城名/Lv.N/max/购入价/变卖价/交易加成),期望值=引擎现值。
    const capRow = modal.getByTestId(TESTIDS.cityLedgerRow(planted.capId));
    await expect(capRow).toContainText(planted.capName);
    await expect(capRow).toContainText(`Lv.${planted.capLevel}/${planted.capMax}`);
    await expect(capRow).toContainText(fmtMoney(planted.capPrice));
    await expect(capRow).toContainText(fmtMoney(planted.capSell));
    await expect(capRow).toContainText(`×${planted.capMult} +${fmtMoney(planted.capAdd)}`);
    const newRow = modal.getByTestId(TESTIDS.cityLedgerRow(planted.newId));
    await expect(newRow).toContainText(planted.newName);
    await expect(newRow).toContainText("Lv.1/" + planted.newMax);
    await expect(newRow).toContainText(fmtMoney(planted.newPrice));
    await expect(newRow).toContainText(fmtMoney(planted.newSell));
    await expect(newRow).toContainText(`×${planted.newMult} +${fmtMoney(planted.newAdd)}`);
    const trRow = modal.getByTestId(TESTIDS.cityLedgerRow(planted.trId));
    await expect(trRow).toContainText(planted.trName);
    await expect(trRow).toContainText(`Lv.0/${planted.trMax}`);
    await expect(trRow).toContainText(fmtMoney(planted.trPrice));
    await expect(trRow).toContainText(fmtMoney(planted.trSell));
    await expect(trRow).toContainText(`×${planted.trMult} +${fmtMoney(planted.trAdd)}`);
    await expect(modal.getByText("坐地要价 = 指导价 × 系数 + 加成")).toBeVisible();

    // 行首缩略图(#623):每行行首挂真实格 svg 壳,壳内是真 .bv-tile(与棋盘同源
    // 复用)且 pointer-events:none(纯展示不可命中,无 hover/点击通路)。
    for (const id of [planted.capId, planted.newId, planted.trId]) {
      const thumb = modal.getByTestId(TESTIDS.cityLedgerThumb(id));
      await expect(thumb).toBeVisible();
      await expect(thumb.locator(".bv-tile")).toHaveCount(1);
      expect(await thumb.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    }

    // ── 关闭:X 钮 ──
    await page.getByTestId(TESTIDS.modalClose).click();
    await expect(modal).toBeHidden();
    await expect(page.getByTestId(TESTIDS.dashAttr("city"))).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    // ── 对手入口:席位卡城池徽章(标题带国号)──
    await page.getByTestId(TESTIDS.seatAttr(1, "city")).click();
    await expect(modal).toBeVisible();
    await expect(modal.getByText(`${s.players[1].guohao}名下城池`)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.seatAttr(1, "city"))).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // ── 空态:开着弹层清空名下(不关弹层),空态随即浮现=随 store 实时重渲 ──
    await force(page, `e.players[1].properties.splice(0);`);
    await expect(page.getByTestId(TESTIDS.cityLedgerEmpty)).toHaveText("名下暂无城池");
    for (const id of [planted.capId, planted.newId, planted.trId]) {
      await expect(modal.getByTestId(TESTIDS.cityLedgerRow(id))).toHaveCount(0);
    }
    await page.getByTestId(TESTIDS.modalClose).click();
    await expect(modal).toBeHidden();
    await expect(page.getByTestId(TESTIDS.seatAttr(1, "city"))).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  } finally {
    await unfreezeClock(page); // 挂起的到点回调按序补放,对局恢复自走(页面随后 teardown)
  }
});
