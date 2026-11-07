// 起手珍宝发放(#1100):目录扩容十条 + finishSetup 单池抽取 + 地图必配校验 + 日志。
// 骰流顺序敏感纪律(setup-flow.ts 头注):发放按座位序逐人逐件、每人 count 次 nextFloat,
// 同 seed 构造两次引擎逐人所得必须一致——本文件确定性用例守住它。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { loadMap } from "@core/board-loader";
import type { MapData } from "@core/board-loader";
import guanzhongData from "../public/maps/guanzhong.json";
import zhongyuanData from "../public/maps/zhongyuan.json";
import { TREASURES, createTreasureDeck } from "@core/treasures";

const GUANZHONG = loadMap(guanzhongData);
const ZHONGYUAN = loadMap(zhongyuanData);
const DECK_TOTAL = createTreasureDeck().length; // 32(存量 14 + 起手批 18)
const LEVEL1_POOL = createTreasureDeck().filter((t) => t.level === 1).length; // 17(草帽 1 + 八品种 ×2)

function makeEngine(seed: number, seatCount: number, startingTreasures: number): GameEngine {
  const cfg: EngineConfig = {
    seats: Array.from({ length: seatCount }, (_, i) => ({ name: `座${i + 1}`, isBot: true })),
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures,
  };
  return new GameEngine(GUANZHONG.board, GUANZHONG.catalog, createDice(seed), cfg);
}

/** 跑完开局三段式(全 bot:doDraftRoll + aiSetupStep 连锁,末位选都触发 finishSetup)。 */
function runSetup(e: GameEngine): GameEngine {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 100) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    e.aiSetupStep();
  }
  return e;
}

describe("起手珍宝目录(#1100 扩容十条)", () => {
  it("TREASURES 末尾十条与票面内容终稿逐一一致(id/name/level/count/desc),无画心", () => {
    const batch = TREASURES.slice(-10);
    expect(batch.map((t) => [t.id, t.name, t.level, t.count, t.desc])).toEqual([
      ["zhuojiu", "浊酒", 1, 2, "一壶浊酒,笑谈古今"],
      ["hubing", "胡饼", 1, 2, "灵帝所好、京师争炊的胡饼"],
      ["suanchou", "算筹", 1, 2, "账房先生握了一辈子的竹签"],
      ["pushan", "蒲扇", 1, 2, "夏夜摇来凉风的老蒲扇"],
      ["suoyi", "蓑衣", 1, 2, "一蓑烟雨的老蓑衣"],
      ["qingmei", "青梅", 1, 2, "煮酒论英雄的同款青梅"],
      ["shimo", "石磨", 1, 2, "张飞悬肉压井的石磨"],
      ["doudai", "豆袋", 1, 2, "云长落难时贩豆的袋子"],
      ["duanxian", "断弦琴", 8, 1, "空城城头武侯抚琴的那张琴"],
      ["liangce", "粮册", 4, 1, "管粮官王垕的账册,小斛亏空笔笔在案"],
    ]);
    // 画心落位(#1102):八件已配 webp;算筹/青梅暂回退远山肌理(合法空态,补图后自动入防断链扫描)
    for (const id of ["suanchou", "qingmei"]) {
      const t = TREASURES.find((x) => x.id === id);
      expect(t?.image, `${id} 应缺画心字段`).toBeUndefined();
    }
  });

  it("1 级池 17 件(草帽 1 + 八品种各 2):8 人局发放 16 件后余 1 的盘子", () => {
    expect(LEVEL1_POOL).toBe(17);
  });

  it("真实地图配 startingTreasures: 2(关中/中原)", () => {
    expect(GUANZHONG.startingTreasures).toBe(2);
    expect(ZHONGYUAN.startingTreasures).toBe(2);
  });
});

describe("起手珍宝发放(finishSetup 锦囊发牌之后)", () => {
  it("按座位序每人得 2 件 1 级、不放回、人内不同款;牌堆同步扣减", () => {
    const e = runSetup(makeEngine(42, 2, 2));
    const granted: string[] = [];
    for (const p of e.players) {
      expect(p.treasures.length).toBe(2);
      expect(p.treasures.every((t) => t.level === 1)).toBe(true);
      expect(p.treasures[0]!.name, `${p.guohao} 人内不同款`).not.toBe(p.treasures[1]!.name);
      granted.push(...p.treasures.map((t) => t.id));
    }
    expect(new Set(granted).size).toBe(4); // 不放回:实例唯一
    expect(e.treasureDeck.length).toBe(DECK_TOTAL - 4);
    for (const t of e.treasureDeck) expect(granted).not.toContain(t.id);
  });

  it("同 seed 构造两次引擎,逐人所得一致(联机恢复/重放依赖)", () => {
    const a = runSetup(makeEngine(2026, 4, 2));
    const b = runSetup(makeEngine(2026, 4, 2));
    expect(a.players.map((p) => p.treasures.map((t) => t.id))).toEqual(
      b.players.map((p) => p.treasures.map((t) => t.id)),
    );
  });

  it("8 人局:1 级池 17 件发 16 剩 1,人人 2 件且不同款", () => {
    const e = runSetup(makeEngine(11, 8, 2));
    const granted = e.players.flatMap((p) => p.treasures);
    expect(granted.length).toBe(16);
    expect(granted.every((t) => t.level === 1)).toBe(true);
    for (const p of e.players) expect(p.treasures[0]!.name).not.toBe(p.treasures[1]!.name);
    expect(e.treasureDeck.filter((t) => t.level === 1).length).toBe(1);
  });

  it("发放汇总一条 setup 日志,逐人明细与实际持有一致;位置在「群雄起兵」之后", () => {
    const e = runSetup(makeEngine(5, 3, 2));
    const rows = e.log.filter((l) => l.category === "setup" && l.brief.startsWith("起手珍宝:"));
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    const expected = `起手珍宝:${e.players
      .map((p) => `${p.guohao}得 ${p.treasures.map((t) => t.name).join("、")}`)
      .join(";")}`;
    expect(row.brief).toBe(expected);
    const perSeat = JSON.parse(row.detail.replace(/^startingTreasures perSeat=/, ""));
    expect(perSeat).toEqual(e.players.map((p) => p.treasures.map((t) => t.name)));
    const qunxiong = e.log.findIndex((l) => l.brief.startsWith("群雄起兵"));
    expect(e.log.indexOf(row)).toBeGreaterThan(qunxiong);
    // 发放先于 GameStart 时机:对局已开(进入 Playing)且发放日志先于任何回合行
    expect(e.phase).toBe("Playing");
  });

  it("对局开启 header 行补「珍宝 N 件/人」,结构化字段记 startingTreasures", () => {
    const e = runSetup(makeEngine(7, 2, 2));
    const header = e.log[0]!;
    expect(header.category).toBe("header");
    expect(header.brief).toContain(`珍宝 ${e.startingTreasures} 件/人`);
    expect(JSON.parse(header.detail).startingTreasures).toBe(2);
  });

  it("fixture 配 0:整段跳过,玩家珍宝为空、牌堆零扣减", () => {
    const e = runSetup(makeEngine(7, 2, 0));
    for (const p of e.players) expect(p.treasures).toEqual([]);
    expect(e.treasureDeck.length).toBe(DECK_TOTAL);
    expect(e.log[0]!.brief).toContain("珍宝 0 件/人");
    expect(e.log.some((l) => l.brief.startsWith("起手珍宝:"))).toBe(false);
  });

  it("1 级实例不足:需求量与实际量响亮抛错(8 座 × 每人 3 = 需求 24 > 1 级池 17)", () => {
    const e = makeEngine(3, 8, 3);
    expect(() => runSetup(e)).toThrow(/起手珍宝池不足:1 级实例 17 件 < 需求 24 件/);
  });
});

describe("地图必配校验(startingTreasures)", () => {
  const base = (): MapData => JSON.parse(JSON.stringify(guanzhongData));

  it("缺字段 fail", () => {
    const d = base();
    delete (d as Partial<MapData>).startingTreasures;
    expect(() => loadMap(d)).toThrow(/startingTreasures/);
  });
  it("非整数 fail", () => {
    const d = base();
    d.startingTreasures = 1.5;
    expect(() => loadMap(d)).toThrow(/startingTreasures/);
  });
  it("负数 fail", () => {
    const d = base();
    d.startingTreasures = -1;
    expect(() => loadMap(d)).toThrow(/startingTreasures/);
  });
});
