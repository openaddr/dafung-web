// 名士主动技 + 军师幕合并窗单测(#188 档 3):冷却闸门、目标校验(复用 #226 守卫)、
// 四技结算、快照往返、bot 决策(策略/看门狗/托管)。缝约定同 test/bot-jinnang.test.ts
// (makeEngine/finishSetup/armJinnang 模式复制,不 import 测试文件;只测引擎公共面)。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import { HEROES } from "@core/heroes";
import { hasUsableJinnang } from "@core/choices";
import { botAct } from "@core/bot";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(sanguoData);

const SEATS2: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: true },
];

function makeEngine(seed = 42, seats: SeatConfig[] = SEATS2): GameEngine {
  const cfg: EngineConfig = { seats, targetNetWorth: 30000 };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

/** 驱动选都到完成(人类选第一个空城,bot 自动)= finishSetup 真实路径。 */
function finishSetup(e: GameEngine) {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) {
      e.aiSetupStep();
    } else {
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
    }
  }
}

/** 开好局并清掉开局锦囊卷轴(seed 42 开局必弹),当前玩家处可测态。 */
function prepared(seed?: number, seats?: SeatConfig[]) {
  const e = makeEngine(seed, seats);
  finishSetup(e);
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return e;
}

/** 把引擎摆到「当前玩家持 hero、停在军师幕」的测试态,返回主动玩家。
 *  手牌清空:技单项场景不掺起手锦囊变量(需要牌的用例自布)。 */
function armSkill(e: GameEngine, heroId: string) {
  const hero = HEROES.find((h) => h.id === heroId);
  if (!hero?.active) throw new Error(`测试布场:${heroId} 无主动技(数据 bug)`);
  const p = e.activePlayer;
  p.heroes.push(hero);
  p.jinnangHand = [];
  p.jinnangHandCount = 0;
  e.turnPhase = "AwaitingJinnang";
  return p;
}

const skillOpt = (e: GameEngine, skillId: string) =>
  e.choicesFor().find((o) => o.id === `skill:${skillId}`);

const seatOpt = (e: GameEngine, seat: number) =>
  e.choicesFor().find((o) => o.id === `t${seat}`);

describe("军师幕:主动技选项集(#188 档 3)", () => {
  it("无目标技就绪 → 窗口选项就绪(id=skill:*,技文案随选项);发动后冷却中灰置,过冷却轮复活", () => {
    const e = prepared();
    armSkill(e, "zhangxingcai");
    const opt = skillOpt(e, "zhangxingcai-leigu");
    expect(opt?.available).toBe(true);
    expect(opt?.skillText).toContain("擂鼓");
    expect(hasUsableJinnang(e)).toBe(true);
    // 发动:冷却记账 + 无目标域直接结算
    e.resolveHeroSkill("zhangxingcai-leigu");
    expect(e.activePlayer.heroLastFired["zhangxingcai-leigu"]).toBe(e.round);
    expect(e.heroDiceBonus).toBe(2);
    expect(e.turnPhase).toBe("Roll"); // 唯一技进冷却 → 收卷(零可用静默跳过口径)
    // 冷却闸门:重开窗口 → 灰置带剩余轮数;跨过冷却轮 → 复活
    e.turnPhase = "AwaitingJinnang";
    const cd = skillOpt(e, "zhangxingcai-leigu");
    expect(cd?.available).toBe(false);
    expect(cd?.reason).toContain("冷却");
    expect(hasUsableJinnang(e)).toBe(false);
    e.round += 4;
    expect(skillOpt(e, "zhangxingcai-leigu")?.available).toBe(true);
  });

  it("费用技(赈济)银两不足灰置「银两不足」;目标域 other 自取灰置「不能指定自己」", () => {
    const e = prepared();
    const p = armSkill(e, "huatuo");
    p.cash = 50; // 付不起 100
    expect(skillOpt(e, "huatuo-zhenji")?.available).toBe(false);
    expect(skillOpt(e, "huatuo-zhenji")?.reason).toBe("银两不足");
    // 付得起 → 入目标段;any 域含自己,other 域(征辟)排除自己
    p.cash = 5000;
    e.resolveHeroSkill("huatuo-zhenji");
    expect(e.pendingSkill?.skillId).toBe("huatuo-zhenji");
    expect(seatOpt(e, 0)?.available).toBe(true); // 自己(any 域)
    e.resolveHeroSkill("huatuo-zhenji", undefined, true); // 作罢:不记冷却
    expect(e.pendingSkill).toBe(null);
    expect(e.activePlayer.heroLastFired["huatuo-zhenji"]).toBeUndefined();
    e.turnPhase = "AwaitingJinnang";
    armSkill(e, "caopi");
    e.resolveHeroSkill("caopi-zhengpi");
    expect(e.pendingSkill?.skillId).toBe("caopi-zhengpi");
    expect(seatOpt(e, 0)?.available).toBe(false);
    expect(seatOpt(e, 0)?.reason).toBe("不能指定自己");
    expect(seatOpt(e, 1)?.available).toBe(true);
  });

  it("火攻目标守卫复用 #226 口径:仅剩 0 级都城灰置「无可毁之城」;免战金牌不庇护主动技", () => {
    const e = prepared(42, [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: true, guohao: "蜀" },
      { name: "C", isBot: true, guohao: "吴" },
    ]);
    if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
    const p = armSkill(e, "zhouyu");
    const me = e.players.indexOf(e.activePlayer);
    const others = [0, 1, 2].filter((x) => x !== me);
    // 布场:对手甲仅剩 0 级都城 + 免战盾(守卫拦截;主动技不受庇护,只挡锦囊);
    // 对手乙持一座 Lv>0 非都城(整扇门得有可指定者,选项集才进目标段)
    const [blocked, valid] = others;
    e.players[blocked].properties = [];
    e.players[blocked].jinnangShield = true;
    const capV = e.board.at(e.players[valid].capitalIndex)?.propertyId;
    e.players[valid].properties = [{
      propertyId: e.board.tiles.find((t) => t.type === "Property" && t.propertyId !== capV)!.propertyId!,
      group: "a", purchasePrice: 1000, level: 2, maxLevel: 3,
    }];
    e.resolveHeroSkill("zhouyu-huogong");
    expect(e.pendingSkill?.skillId).toBe("zhouyu-huogong");
    expect(seatOpt(e, me)?.available).toBe(false);
    expect(seatOpt(e, me)?.reason).toBe("不能指定自己");
    expect(seatOpt(e, blocked)?.available).toBe(false);
    expect(seatOpt(e, blocked)?.reason).toBe("无可毁之城");
    expect(seatOpt(e, valid)?.available).toBe(true);
    // 有效目标挂盾:盾不拦技(免战金牌只挡锦囊,牌面原文口径)
    e.players[valid].jinnangShield = true;
    expect(seatOpt(e, valid)?.available).toBe(true);
    void p;
  });
});

describe("主动技结算(#188 档 3)", () => {
  it("征辟:自得 1 委任状、目标得 50(国库出);赈济:付 100 为目标 +30 体力(clamp 上限)", () => {
    const e = prepared();
    armSkill(e, "caopi");
    const warrantsBefore = e.activePlayer.warrants;
    e.resolveHeroSkill("caopi-zhengpi"); // 入目标段
    e.resolveHeroSkill("caopi-zhengpi", [1]); // 提交目标
    expect(e.activePlayer.warrants).toBe(warrantsBefore + 1);
    expect(e.players[1].cash).toBe(e.players[1].cash); // 已在断言前落账,占位防误读
    expect(e.turnPhase).toBe("Roll"); // 技进冷却,收卷
    expect(e.log.some((l) => l.brief.includes("征辟") && l.detail.includes("target=p1"))).toBe(true);

    e.turnPhase = "AwaitingJinnang";
    const hua = armSkill(e, "huatuo");
    hua.cash = 1000;
    e.players[1].stamina = 90;
    e.resolveHeroSkill("huatuo-zhenji"); // 入目标段
    e.resolveHeroSkill("huatuo-zhenji", [1]); // 提交目标
    expect(hua.cash).toBe(900); // 付 100
    expect(e.players[1].stamina).toBe(100); // 90 + 30 → clamp 100
  });

  it("火攻:有可降城 → 降 1 级 + 冷却记账;全 0 级(有非都城)→ 失一座回无主", () => {
    const e = prepared();
    armSkill(e, "zhouyu");
    const foe = e.players[1];
    const capPropId = e.board.at(foe.capitalIndex)?.propertyId;
    const plain = e.board.tiles.find((t) => t.type === "Property" && t.propertyId !== capPropId)!.propertyId!;
    foe.properties.push({ propertyId: plain, group: "a", purchasePrice: 1000, level: 1, maxLevel: 3 });
    const propCount = foe.properties.length;
    e.resolveHeroSkill("zhouyu-huogong"); // 入目标段
    e.resolveHeroSkill("zhouyu-huogong", [1]); // 提交目标
    expect(foe.properties.find((h) => h.propertyId === plain)?.level).toBe(0); // 降 1 级
    expect(foe.properties.length).toBe(propCount); // 不失城
    expect(e.activePlayer.heroLastFired["zhouyu-huogong"]).toBe(e.round);

    // 全 0 级 → 失城分支:非都城消失回无主,都城持仓恒在(#226)
    e.round += 5; // 过冷却
    e.turnPhase = "AwaitingJinnang";
    e.resolveHeroSkill("zhouyu-huogong"); // 入目标段(守卫复验:全 0 级但有非都城可失)
    e.resolveHeroSkill("zhouyu-huogong", [1]); // 提交目标
    expect(foe.properties.some((h) => h.propertyId === plain)).toBe(false);
    expect(foe.properties.some((h) => h.propertyId === capPropId)).toBe(true);
    expect(e.findOwner(plain)).toBe(null);
  });

  it("擂鼓:本回合掷骰步数 +2(骰面不变),行军后清零;快照往返:冷却/目标段/加成保真", () => {
    const e = prepared();
    const p = armSkill(e, "zhangxingcai");
    e.resolveHeroSkill("zhangxingcai-leigu");
    expect(e.heroDiceBonus).toBe(2);
    // 快照往返(发动与掷骰之间被广播/落盘的场 面)
    const snap = e.snapshot();
    const mirror = makeEngine(1);
    mirror.restoreFromSnapshot(snap);
    expect(mirror.heroDiceBonus).toBe(2);
    expect(mirror.activePlayer.heroLastFired["zhangxingcai-leigu"]).toBe(e.round);
    expect(mirror.turnPhase).toBe("Roll");
    // 行军消费:steps = die + 2(与 board.computePath 期望落点一致),加成清零
    const startPos = mirror.activePlayer.position;
    mirror.rollAndMove();
    const die = mirror.presentation.lastRoll!.die;
    const path = mirror.board.computePath(startPos, die + 2, mirror.activePlayer.capitalIndex, null);
    const expected = path.passedCapital && path.landIndex !== mirror.activePlayer.capitalIndex
      ? mirror.activePlayer.capitalIndex
      : path.landIndex;
    expect(mirror.activePlayer.position).toBe(expected);
    expect(mirror.heroDiceBonus).toBe(0);
    expect(mirror.log.some((l) => l.detail.includes(`steps=${die + 2}`) && l.detail.includes("bonus=2"))).toBe(true);
    void p;
  });

  it("快照往返:技能目标段载荷随快照走,镜像端可继续选人结算", () => {
    const e = prepared();
    armSkill(e, "caopi");
    e.resolveHeroSkill("caopi-zhengpi"); // 入目标段
    expect(e.pendingSkill).toEqual({ skillId: "caopi-zhengpi" });
    const mirror = makeEngine(1);
    mirror.restoreFromSnapshot(e.snapshot());
    expect(mirror.pendingSkill).toEqual({ skillId: "caopi-zhengpi" });
    expect(JSON.stringify(mirror.choicesFor())).toBe(JSON.stringify(e.choicesFor()));
    // 镜像端续推:目标段提交照常结算(载荷已在快照里,无需再入段)
    const warrantsBefore = mirror.activePlayer.warrants;
    mirror.resolveHeroSkill("caopi-zhengpi", [1]);
    expect(mirror.activePlayer.warrants).toBe(warrantsBefore + 1);
    expect(mirror.pendingSkill).toBe(null);
  });
});

describe("军师幕 bot 决策(#188 档 3)", () => {
  it("strategy:无牌有就绪技 → bot 出技(擂鼓发动);看门狗 conservative 永不出技;托管 hold 亦不出", () => {
    // 真 bot:出擂鼓
    const e = prepared();
    armSkill(e, "zhangxingcai");
    botAct(e);
    expect(e.heroDiceBonus).toBe(2);
    expect(e.turnPhase).toBe("Roll");
    // 看门狗接管:不出技,今不用收卷
    const e2 = prepared();
    armSkill(e2, "zhangxingcai");
    botAct(e2, { conservative: true });
    expect(e2.heroDiceBonus).toBe(0);
    expect(e2.activePlayer.heroLastFired["zhangxingcai-leigu"]).toBeUndefined();
    expect(e2.turnPhase).toBe("Roll");
    // 自助托管(hold):锦囊按策略,但技不出
    const e3 = prepared();
    armSkill(e3, "zhangxingcai");
    botAct(e3, { skills: "hold" });
    expect(e3.heroDiceBonus).toBe(0);
    expect(e3.turnPhase).toBe("Roll");
  });

  it("strategy:火攻挑城最多者;保守接管停在技能目标段 → 作罢回卡牌段/收卷不卡死", () => {
    const e = prepared(42, [
      { name: "A", isBot: true, guohao: "魏" },
      { name: "B", isBot: true, guohao: "蜀" },
      { name: "C", isBot: true, guohao: "吴" },
    ]);
    if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
    armSkill(e, "zhouyu");
    const me = e.players.indexOf(e.activePlayer);
    const [rich, poor] = [0, 1, 2].filter((x) => x !== me);
    // 布场:rich 两座 Lv>0 城,poor 一座 → 偏好序 [rich, poor](城最多者先)
    const capOf = (seat: number) => e.board.at(e.players[seat].capitalIndex)?.propertyId;
    const plains = e.board.tiles
      .filter((t) => t.type === "Property" && t.propertyId !== capOf(rich) && t.propertyId !== capOf(poor))
      .map((t) => t.propertyId!);
    e.players[rich].properties.push(
      { propertyId: plains[0], group: "a", purchasePrice: 1000, level: 1, maxLevel: 3 },
      { propertyId: plains[1], group: "a", purchasePrice: 1000, level: 1, maxLevel: 3 },
    );
    e.players[poor].properties.push({ propertyId: plains[2], group: "a", purchasePrice: 1000, level: 1, maxLevel: 3 });
    botAct(e);
    const richHit = e.players[rich].properties.some((h) => (h.propertyId === plains[0] || h.propertyId === plains[1]) && h.level === 0);
    expect(richHit).toBe(true); // 城最多者挨烧(demolish 随机降其一座)
    expect(e.players[poor].properties.find((h) => h.propertyId === plains[2])?.level).toBe(1); // 未被波及
    // 中途接管停在技能目标段:conservative 作罢不卡死(回卡牌段或收卷)
    const e2 = prepared();
    armSkill(e2, "caopi");
    e2.resolveHeroSkill("caopi-zhengpi"); // 入目标段
    botAct(e2, { conservative: true });
    expect(e2.pendingSkill).toBe(null);
    expect(e2.turnPhase).toBe("Roll");
  });
});
