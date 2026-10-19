// 名下城池清单弹层(#622,规格 #621):席位卡/仪表条城池徽章点开的只读五列清单。
// 一条链(宁缺毋滥):仪表条徽章(自看)开弹层 → 五列字段与引擎数据抽查一致 +
// 行序 = 棋盘 index 序(种一座 index 更大的城验证排序)→ X 关闭;席位卡徽章(对手)
// 标题带国号;开着弹层清空名下 → 空态浮现(顺带证「随 store 实时重渲」)。
// 种植式断言(冻结→种植→点击→断言→恢复,react-solo #421 同口径):字段期望值全部
// 读自引擎 catalog,不落第二事实源。
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

interface Planted {
  capId: string;
  capName: string;
  capLevel: number;
  capMax: number;
  capPrice: number;
  capSell: number;
  capMult: number;
  capAdd: number;
  newId: string;
  newName: string;
  newPrice: number;
  newSell: number;
  newMax: number;
  newMult: number;
  newAdd: number;
}

test("城池徽章点开名下城池清单:自看五列字段/行序、对手国号标题、空态(#622)", async ({ page }) => {
  await quickStart(page);
  // 清掉 quickStart 可能遗留的决策卷轴(有卷轴即有遮罩,会吞徽章点击);有界循环,
  // 语义同 react-solo「加速到胜利」的驱动环。
  for (let i = 0; i < 10 && (await actIfCan(page)); i++);

  await freezeClock(page);
  try {
    // 种第二座城(首座=都城):选一枚棋盘 index 大于都城格的无主城,验证行序=棋盘
    // index 序;字段期望值当场读自引擎 catalog(冻结期数值稳定,不与自走竞速)。
    const planted = await page.evaluate<Planted>(
      /* js */ () => {
        const e = (window as any).__dafung.getEngine();
        const me = e.players[0];
        const cap = me.properties.find(
          (h: any) => h.propertyId === e.board.at(me.capitalIndex).propertyId,
        );
        const capDef = e.catalog.get(cap.propertyId);
        const capTile = e.board.tiles.find((t: any) => t.propertyId === cap.propertyId);
        const tile = e.board.tiles.find(
          (t: any) => t.propertyId && t.index > capTile.index && e.findOwner(t.propertyId) == null,
        );
        const def = e.catalog.get(tile.propertyId);
        me.properties.push({
          propertyId: tile.propertyId,
          level: 1,
          group: def.group,
          maxLevel: def.maxLevel,
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
          newId: tile.propertyId,
          newName: tile.name,
          newPrice: def.purchasePrice,
          newSell: def.valueByLevel[1],
          newMax: def.maxLevel,
          newMult: def.tradeMult[1],
          newAdd: def.tradeAdd[1],
        };
      },
    );
    // 引擎直写后须 sync 灌回 store(force 助手同法):弹层与 snap 读的是 store 快照,
    // 不灌则种植城不可见(首轮实录:漏 sync,行序断言 -1)。
    await page.evaluate(() => (window as any).__dafung.controller().sync());

    // ── 自看入口:仪表条城池徽章 ──
    await page.getByTestId("dash-attr-city").click();
    const modal = page.getByTestId("city-ledger");
    await expect(modal).toBeVisible();
    await expect(modal.getByText("本方名下城池")).toBeVisible();
    await expect(page.getByTestId("dash-attr-city")).toHaveAttribute("aria-expanded", "true");

    // 行序 = 棋盘 index 序:都城格在前,种植城(index 更大)在后;行数=名下城数。
    const rowIds = await modal
      .locator('[data-testid^="city-ledger-row-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    const s = await snap(page);
    expect(rowIds).toHaveLength(s.players[0].properties.length);
    expect(rowIds.indexOf(`city-ledger-row-${planted.capId}`)).toBeGreaterThanOrEqual(0);
    expect(rowIds.indexOf(`city-ledger-row-${planted.newId}`)).toBeGreaterThan(
      rowIds.indexOf(`city-ledger-row-${planted.capId}`),
    );

    // 五列字段抽查(城名/Lv.N/max/购入价/变卖价/交易加成),期望值=引擎现值。
    const capRow = modal.getByTestId(`city-ledger-row-${planted.capId}`);
    await expect(capRow).toContainText(planted.capName);
    await expect(capRow).toContainText(`Lv.${planted.capLevel}/${planted.capMax}`);
    await expect(capRow).toContainText(fmtMoney(planted.capPrice));
    await expect(capRow).toContainText(fmtMoney(planted.capSell));
    await expect(capRow).toContainText(`×${planted.capMult} +${fmtMoney(planted.capAdd)}`);
    const newRow = modal.getByTestId(`city-ledger-row-${planted.newId}`);
    await expect(newRow).toContainText(planted.newName);
    await expect(newRow).toContainText("Lv.1/" + planted.newMax);
    await expect(newRow).toContainText(fmtMoney(planted.newPrice));
    await expect(newRow).toContainText(fmtMoney(planted.newSell));
    await expect(newRow).toContainText(`×${planted.newMult} +${fmtMoney(planted.newAdd)}`);
    await expect(modal.getByText("坐地要价 = 指导价 × 系数 + 加成")).toBeVisible();

    // ── 关闭:X 钮 ──
    await page.getByTestId("modal-close").click();
    await expect(modal).toBeHidden();
    await expect(page.getByTestId("dash-attr-city")).toHaveAttribute("aria-expanded", "false");

    // ── 对手入口:席位卡城池徽章(标题带国号)──
    await page.getByTestId("seat-attr-city-1").click();
    await expect(modal).toBeVisible();
    await expect(modal.getByText(`${s.players[1].guohao}名下城池`)).toBeVisible();
    await expect(page.getByTestId("seat-attr-city-1")).toHaveAttribute("aria-expanded", "true");

    // ── 空态:开着弹层清空名下(不关弹层),空态随即浮现=随 store 实时重渲 ──
    await force(page, `e.players[1].properties.splice(0);`);
    await expect(page.getByTestId("city-ledger-empty")).toHaveText("名下暂无城池");
    await expect(modal.locator('[data-testid^="city-ledger-row-"]')).toHaveCount(0);
    await page.getByTestId("modal-close").click();
    await expect(modal).toBeHidden();
    await expect(page.getByTestId("seat-attr-city-1")).toHaveAttribute("aria-expanded", "false");
  } finally {
    await unfreezeClock(page); // 挂起的到点回调按序补放,对局恢复自走(页面随后 teardown)
  }
});
