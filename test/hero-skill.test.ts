// 名将主动技 + 出牌阶段合并窗单测(#188 档 3):冷却闸门、目标校验(复用 #226 守卫)、
// 三技结算、快照往返、bot 决策(策略/看门狗/托管)。缝约定同 test/bot-jinnang.test.ts
// (makeEngine/finishSetup/armJinnang 模式复制,不 import 测试文件;只测引擎公共面)。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { HEROES } from "@core/heroes";
import { armHero, testEngine } from "@core/testing";
import { rollGrantedSkills } from "@core/roster";
import { heroById } from "@core/heroes";
import { skillById } from "@core/skills";
import { SKILLS } from "@core/skills";
import { hasUsableJinnang, isSkillOption, skillOptionId } from "@core/choices";
import { botAct, heroSkillIntent } from "@core/bot";
import { fullDefenseOf } from "@core/defense";
import { grantProperty, placePlayer, setDefense } from "@core/planter";
import type { GameMoment, MomentCtx } from "@core/timing";
import guanzhongData from "../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(guanzhongData);

const SEATS2: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: true },
];

function makeEngine(seed = 42, seats: SeatConfig[] = SEATS2): GameEngine {
  const cfg: EngineConfig = {
    seats,
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  };
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

/** 把引擎摆到「当前玩家持 hero、只授 skillId 一技、停在出牌阶段」的测试态,返回主动玩家。
 *  池收窄到受试主动技一条(ADR-0036 共享池的其余技由各自机制用例自布,防互扰:
 *  如周瑜共享池的擂鼓会留住出牌窗、张星彩共享池的疾行会改行军步数)。
 *  手牌清空:技单项场景不掺起手锦囊变量(需要牌的用例自布)。 */
function armSkill(e: GameEngine, heroId: string, skillId: string) {
  const hero = HEROES.find((h) => h.id === heroId);
  if (hero == null || !hero.skillPool.includes(skillId))
    throw new Error(`测试布场:${heroId} 池内无技 ${skillId}(数据 bug)`);
  const p = e.activePlayer;
  armHero(e, p, { ...hero, skillPool: [skillId] });
  p.jinnangHand = [];
  p.jinnangHandCount = 0;
  e.turnPhase = "AwaitingJinnang";
  return p;
}

/** 技实例选项(#817 实例形状):id 拼接走 choices.skillOptionId 单源,勿手写 `skill:` 字面量。 */
const skillOpt = (e: GameEngine, heroId: string, skillId: string) =>
  e.choicesFor().find((o) => o.id === skillOptionId(heroId, skillId));

const seatOpt = (e: GameEngine, seat: number) => e.choicesFor().find((o) => o.id === `t${seat}`);

/** 城目标段候选选项(#1388):按提交通道 tileIndex 取候选。 */
const cityOpt = (e: GameEngine, tileIndex: number) =>
  e.choicesFor().find((o) => o.targetTileIndex === tileIndex);

/** 把一座无主普通城授给 seat 并拉到指定等级(种植件 grantProperty,防御随等级回满)。
 *  anchorTileIndex/maxDist:只在锚点 maxDist 格内选城(火攻射程布景用);选不中当场炸。 */
function grantCityNear(
  e: GameEngine,
  seat: number,
  level: number,
  anchorTileIndex: number,
  maxDist = 5,
): { propertyId: string; tileIndex: number } {
  const taken = new Set(e.players.flatMap((p) => p.properties.map((h) => h.propertyId)));
  const tile = e.board.tiles.find(
    (t) =>
      t.event == null &&
      t.propertyId != null &&
      !taken.has(t.propertyId) &&
      e.board.distance(anchorTileIndex, t.index) <= maxDist,
  );
  if (tile == null || tile.propertyId == null)
    throw new Error(`测试布场:锚点 ${anchorTileIndex} ${maxDist} 格内无空闲普通城`);
  grantProperty(e, seat, tile.propertyId, level);
  return { propertyId: tile.propertyId, tileIndex: tile.index };
}

/** 派发时机记录(同 test/timing.test.ts recordMomentCtx 缝约定):spy 不改行为只记账。 */
function recordMomentKinds(e: GameEngine): string[] {
  const kinds: string[] = [];
  const orig = e.dispatchMoment.bind(e);
  (e as { dispatchMoment: (m: GameMoment, ctx: MomentCtx) => void }).dispatchMoment = (m, ctx) => {
    kinds.push(m);
    return orig(m, ctx);
  };
  return kinds;
}

describe("出牌阶段:主动技选项集(#188 档 3)", () => {
  it("无目标技就绪 → 实例选项就绪(id=skill:<heroId>:<skillId>,携实例定位),发动后冷却中灰置,过冷却轮复活", () => {
    const e = prepared();
    armSkill(e, "zhangxingcai", "leigu");
    const opt = skillOpt(e, "zhangxingcai", "leigu");
    expect(opt?.id).toBe("skill:zhangxingcai:leigu");
    expect(opt?.skillHeroId).toBe("zhangxingcai");
    expect(opt?.skillHero).toBe("张星彩");
    expect(opt?.available).toBe(true);
    expect(opt?.skillText).toContain("擂鼓");
    expect(hasUsableJinnang(e)).toBe(true);
    // 发动:冷却记账 + 无目标域直接结算(直落本实例槽内账)
    e.resolveHeroSkill("zhangxingcai", "leigu");
    expect(e.activePlayer.heroes[0].lastFired["leigu"]).toBe(e.round);
    expect(e.heroDiceBonus).toBe(2);
    expect(e.turnPhase).toBe("Roll"); // 唯一技进冷却 → 收卷(零可用静默跳过口径)
    // 冷却闸门:重开窗口 → 灰置带剩余轮数;跨过冷却轮 → 复活
    e.turnPhase = "AwaitingJinnang";
    const cd = skillOpt(e, "zhangxingcai", "leigu");
    expect(cd?.available).toBe(false);
    expect(cd?.reason).toContain("冷却");
    expect(hasUsableJinnang(e)).toBe(false);
    e.round += 4;
    expect(skillOpt(e, "zhangxingcai", "leigu")?.available).toBe(true);
  });

  it("同名技多槽:每实例一选项各携实例(#817 翻案 #806 去重权宜,#815 拍板);各自发动各落各自实例冷却,互不串账", () => {
    const e = prepared();
    const p = e.activePlayer;
    // 同玩家两槽同名技(生产形:周瑜+诸葛亮共享火攻——#1390 周瑜池换血后擂鼓改张星彩
    // 单属,共享主动技现役唯火攻;城目标域发动需合法目标,布一座射程内的他人 Lv 城)
    armSkill(e, "zhouyu", "huogong");
    armSkill(e, "zhugeliang", "huogong");
    const otherSeat = (e.players.indexOf(p) + 1) % e.players.length;
    const target = grantCityNear(e, otherSeat, 1, p.position);
    const opts = e.choicesFor().filter((o) => isSkillOption(o) && o.skillId === "huogong");
    expect(opts).toHaveLength(2); // 一实例一选项:不合并,卡面属主各随各槽
    expect(opts.map((o) => o.id)).toEqual(["skill:zhouyu:huogong", "skill:zhugeliang:huogong"]); // 选项 id 携实例(拼接单源 skillOptionId,此处对拍字面量钉形状)
    expect(opts.map((o) => o.skillHero)).toEqual(["周瑜", "诸葛亮"]);
    expect(opts.every((o) => o.available)).toBe(true);
    // 实例一(周瑜)发动:直落周瑜槽,诸葛亮实例不受扰(互不串账)
    e.resolveHeroSkill("zhouyu", "huogong");
    e.resolveHeroSkill("zhouyu", "huogong", [target.tileIndex]); // 城目标域:提交目标城
    expect(p.heroes[0].lastFired["huogong"]).toBe(e.round);
    expect(p.heroes[1].lastFired["huogong"]).toBeUndefined();
    // 冷却中的实例灰置报本槽剩余轮数;就绪实例仍可用
    e.turnPhase = "AwaitingJinnang";
    const zy = skillOpt(e, "zhouyu", "huogong");
    const zgl = skillOpt(e, "zhugeliang", "huogong");
    expect(zy?.available).toBe(false);
    expect(zy?.reason).toContain("冷却");
    expect(zgl?.available).toBe(true);
    // 实例二(诸葛亮)发动:落诸葛亮槽,周瑜冷却账未被改写
    e.resolveHeroSkill("zhugeliang", "huogong");
    e.resolveHeroSkill("zhugeliang", "huogong", [target.tileIndex]);
    expect(p.heroes[0].lastFired["huogong"]).toBe(e.round);
    expect(p.heroes[1].lastFired["huogong"]).toBe(e.round);
    // 双实例全冷却:两选项各自灰置
    e.turnPhase = "AwaitingJinnang";
    expect(skillOpt(e, "zhouyu", "huogong")?.available).toBe(false);
    expect(skillOpt(e, "zhugeliang", "huogong")?.available).toBe(false);
    expect(hasUsableJinnang(e)).toBe(false);
  });

  it("费用技(赈济)银两不足灰置「银两不足」;作罢不记冷却", () => {
    const e = prepared();
    const p = armSkill(e, "huatuo", "zhenji");
    p.cash = 50; // 付不起 100
    expect(skillOpt(e, "huatuo", "zhenji")?.available).toBe(false);
    expect(skillOpt(e, "huatuo", "zhenji")?.reason).toBe("银两不足");
    // 付得起 → 入目标段;any 域含自己
    p.cash = 5000;
    e.resolveHeroSkill("huatuo", "zhenji");
    expect(e.pendingSkill).toEqual({ heroId: "huatuo", skillId: "zhenji" });
    expect(seatOpt(e, 0)?.available).toBe(true); // 自己(any 域)
    e.resolveHeroSkill("huatuo", "zhenji", undefined, true); // 作罢:不记冷却
    expect(e.pendingSkill).toBe(null);
    expect(e.activePlayer.heroes[0].lastFired["zhenji"]).toBeUndefined();
  });
});

describe("主动技结算(#188 档 3)", () => {
  it("赈济:付 100 为目标 +30 体力(clamp 上限)", () => {
    const e = prepared();
    e.turnPhase = "AwaitingJinnang";
    const hua = armSkill(e, "huatuo", "zhenji");
    hua.cash = 1000;
    e.players[1].stamina = 90;
    e.resolveHeroSkill("huatuo", "zhenji"); // 入目标段
    e.resolveHeroSkill("huatuo", "zhenji", [1]); // 提交目标
    expect(hua.cash).toBe(900); // 付 100
    expect(e.players[1].stamina).toBe(100); // 90 + 30 → clamp 100
  });

  it("擂鼓:本回合掷骰步数 +2(骰面不变),行军后清零;快照往返:冷却/目标段/加成保真", () => {
    const e = prepared();
    const p = armSkill(e, "zhangxingcai", "leigu");
    e.resolveHeroSkill("zhangxingcai", "leigu");
    expect(e.heroDiceBonus).toBe(2);
    // 快照往返(发动与掷骰之间被广播/落盘的场 面)
    const snap = e.snapshot();
    const mirror = makeEngine(1);
    mirror.restoreFromSnapshot(snap);
    // 槽位全量随快照走(#785):布场时已收窄到受试技,镜像端原样还原,无需再收窄
    expect(mirror.heroDiceBonus).toBe(2);
    expect(mirror.activePlayer.heroes[0].lastFired["leigu"]).toBe(e.round);
    expect(mirror.turnPhase).toBe("Roll");
    // 行军消费:steps = die + 2(与 board.computePath 期望落点一致),加成清零
    // (先抓行军者引用:落点若是税关等自动收尾格,rollAndMove 后回合已推进,activePlayer 易主)
    const mover = mirror.activePlayer;
    const startPos = mover.position;
    mirror.rollAndMove();
    const die = mirror.presentation.lastRoll!.die;
    const path = mirror.board.computePath(startPos, die + 2, mover.capitalIndex);
    const expected =
      path.passedCapital && path.landIndex !== mover.capitalIndex
        ? mover.capitalIndex
        : path.landIndex;
    expect(mover.position).toBe(expected);
    expect(mirror.heroDiceBonus).toBe(0);
    expect(
      mirror.log.some((l) => l.detail.includes(`steps=${die + 2}`) && l.detail.includes("bonus=2")),
    ).toBe(true);
    void p;
  });

  it("快照往返:技能目标段载荷(携实例定位)随快照走,镜像端可继续选人/选城结算", () => {
    const e = prepared();
    armSkill(e, "huatuo", "zhenji");
    e.resolveHeroSkill("huatuo", "zhenji"); // 入目标段
    expect(e.pendingSkill).toEqual({ heroId: "huatuo", skillId: "zhenji" });
    const mirror = makeEngine(1);
    mirror.restoreFromSnapshot(e.snapshot());
    expect(mirror.pendingSkill).toEqual({ heroId: "huatuo", skillId: "zhenji" }); // 实例定位往返保真(#817)
    expect(JSON.stringify(mirror.choicesFor())).toBe(JSON.stringify(e.choicesFor()));
    // 镜像端续推:目标段提交照常结算(载荷已在快照里,无需再入段)
    const staminaBefore = mirror.players[1].stamina;
    mirror.resolveHeroSkill("huatuo", "zhenji", [1]);
    expect(mirror.players[1].stamina).toBe(Math.min(100, staminaBefore + 30));
    expect(mirror.pendingSkill).toBe(null);
    // 城目标域(#1388):载荷形状同一对,候选清单随攻方位置派生、往返逐字一致,镜像端可继续点城结算
    const e3 = prepared();
    armSkill(e3, "zhouyu", "huogong");
    const me3 = e3.activeIndex;
    const granted = grantCityNear(e3, 1 - me3, 1, e3.players[me3].position);
    placePlayer(e3, me3, granted.tileIndex);
    e3.resolveHeroSkill("zhouyu", "huogong");
    expect(e3.pendingSkill).toEqual({ heroId: "zhouyu", skillId: "huogong" });
    const mirror3 = makeEngine(1);
    mirror3.restoreFromSnapshot(e3.snapshot());
    expect(mirror3.pendingSkill).toEqual({ heroId: "zhouyu", skillId: "huogong" });
    expect(JSON.stringify(mirror3.choicesFor())).toBe(JSON.stringify(e3.choicesFor()));
    mirror3.resolveHeroSkill("zhouyu", "huogong", [granted.tileIndex]);
    expect(
      mirror3.players[1 - me3].properties.find((h) => h.propertyId === granted.propertyId)?.defense,
    ).toBe(fullDefenseOf(1) - 1);
  });
});

describe("出牌阶段 bot 决策(#188 档 3)", () => {
  it("strategy:无牌有就绪技 → 裸调出技(擂鼓发动);代驾(接管/托管)同走本入口按策略出技(#580)", () => {
    const e = prepared();
    armSkill(e, "zhangxingcai", "leigu");
    botAct(e);
    expect(e.heroDiceBonus).toBe(2);
    expect(e.turnPhase).toBe("Roll");
  });

  it("strategy:中途停在技能目标段 → 裸调续推目标段不卡死(#580 同款入口)", () => {
    const e2 = prepared();
    armSkill(e2, "huatuo", "zhenji");
    e2.resolveHeroSkill("huatuo", "zhenji"); // 入目标段
    botAct(e2);
    expect(e2.pendingSkill).toBe(null);
    expect(e2.turnPhase).toBe("Roll");
  });
});

// ── 火攻定向化(#1388 T2 城目标域,规格 #1386)──
describe("火攻定向化(#1388 T2 城目标域)", () => {
  it("射程门(#1386 双向距离):5 格内城入候选(携城名/城主/距离/城 id),6 格外拒;段内改位后越权提交被引擎复验拒绝", () => {
    const e = prepared();
    armSkill(e, "zhouyu", "huogong");
    const me = e.activeIndex;
    const foeSeat = 1 - me;
    const { propertyId, tileIndex } = grantCityNear(e, foeSeat, 1, e.players[me].position);
    const n = e.board.count;
    placePlayer(e, me, (tileIndex - 5 + n) % n); // 距离恰 5(布景距离用 placePlayer,#1295)
    expect(skillOpt(e, "zhouyu", "huogong")?.available).toBe(true);
    e.resolveHeroSkill("zhouyu", "huogong"); // 入目标段
    const cand = cityOpt(e, tileIndex);
    expect(cand?.id).toBe(`c${tileIndex}`); // 候选 id 拼接单源 choices.cityTargetOptionId
    expect(cand?.label).toBe(e.board.at(tileIndex).name);
    expect(cand).toMatchObject({
      targetPropertyId: propertyId,
      targetOwnerSeat: foeSeat,
      targetDistance: 5,
      targetTileIndex: tileIndex,
    });
    // 段内攻方改位到 6 格外(客户端陈旧载荷场景):提交越权目标被选项集复验拒绝——不结算不记冷却
    placePlayer(e, me, (tileIndex - 6 + n) % n);
    e.resolveHeroSkill("zhouyu", "huogong", [tileIndex]);
    expect(e.pendingSkill).toEqual({ heroId: "zhouyu", skillId: "huogong" }); // 段未消费
    expect(e.activePlayer.heroes[0].lastFired["huogong"]).toBeUndefined();
    expect(e.players[foeSeat].properties.find((h) => h.propertyId === propertyId)?.defense).toBe(
      fullDefenseOf(1),
    ); // 满值未动
    e.resolveHeroSkill("zhouyu", "huogong", undefined, true); // 作罢出段(不记冷却)
    e.turnPhase = "AwaitingJinnang";
    expect(skillOpt(e, "zhouyu", "huogong")?.available).toBe(false);
    expect(skillOpt(e, "zhouyu", "huogong")?.reason).toBe("射程内无可烧之城");
  });

  it("目标门:0 级城(含 0 级都城)拒/己城拒/无主城不计入;都城等级>0 即合法(可降级)", () => {
    const e = prepared();
    armSkill(e, "zhouyu", "huogong");
    const me = e.activeIndex;
    const foeSeat = 1 - me;
    const myCapTile = e.players[me].capitalIndex;
    const foeCapTile = e.players[foeSeat].capitalIndex;
    const foeCap = e.board.at(foeCapTile).propertyId!;
    // 开局全场 0 级:站上对手都城格(距离 0)也无城可选——等级门与「0 级都城拒」一拍双证
    placePlayer(e, me, foeCapTile);
    expect(skillOpt(e, "zhouyu", "huogong")?.available).toBe(false);
    expect(skillOpt(e, "zhouyu", "huogong")?.reason).toBe("射程内无可烧之城");
    // 己城拉 Lv1 + 对手获一座射程内 Lv1 城;站己城格——候选恰一座:己城(距离 0)拒、
    // 射程内其余无主城/0 级城一律不计入
    grantProperty(e, me, e.board.at(myCapTile).propertyId!, 1);
    const nearTile = e.board.tiles.find(
      (t) =>
        t.event == null &&
        t.propertyId != null &&
        e.board.distance(myCapTile, t.index) <= 5 &&
        e.findOwner(t.propertyId) == null,
    );
    if (nearTile == null || nearTile.propertyId == null)
      throw new Error("测试布场:己都城 5 格内无无主城(换种子)"); // 零兜底
    grantProperty(e, foeSeat, nearTile.propertyId, 1);
    placePlayer(e, me, myCapTile);
    e.resolveHeroSkill("zhouyu", "huogong"); // 入目标段:候选=合法城清单(#1388 城目标段形制)
    const cands = e.choicesFor().filter((o) => o.targetTileIndex != null);
    expect(cands.map((o) => o.targetPropertyId)).toEqual([nearTile.propertyId]);
    // 都城合法:对手都城拉 Lv1、防御压到 1;段仍开着(候选随攻方位置重算),段内指定都城
    grantProperty(e, foeSeat, foeCap, 1);
    setDefense(e, foeSeat, foeCap, 1);
    placePlayer(e, me, foeCapTile);
    e.resolveHeroSkill("zhouyu", "huogong", [foeCapTile]); // 指定都城
    const capH = e.players[foeSeat].properties.find((h) => h.propertyId === foeCap)!;
    expect(capH.level).toBe(0); // 都城降 1 级(可降)
    expect(capH.defense).toBe(fullDefenseOf(0)); // 回满新等级满值(resetToFull 单口)
    expect(e.findOwner(foeCap)).not.toBe(null); // 都城不失(失城通路不在火攻)
  });

  it("结算·absorbed:防御值 4→3 纯扣防,战报「主动技【火攻】…防御值降至 N」;作罢不记冷却;冷却在账(5 轮)", () => {
    const e = prepared();
    armSkill(e, "zhouyu", "huogong");
    const me = e.activeIndex;
    const foeSeat = 1 - me;
    const { propertyId, tileIndex } = grantCityNear(e, foeSeat, 1, e.players[me].position);
    placePlayer(e, me, tileIndex); // 站上目标城格(距离 0 ≤ 5)
    // 作罢不记冷却(既有 PendingHeroSkill 口径)
    e.resolveHeroSkill("zhouyu", "huogong");
    expect(e.pendingSkill).toEqual({ heroId: "zhouyu", skillId: "huogong" });
    e.resolveHeroSkill("zhouyu", "huogong", undefined, true);
    expect(e.pendingSkill).toBe(null);
    expect(e.activePlayer.heroes[0].lastFired["huogong"]).toBeUndefined();
    // 提交目标城(tileIndex 载荷)→ absorbed
    e.turnPhase = "AwaitingJinnang";
    e.resolveHeroSkill("zhouyu", "huogong");
    e.resolveHeroSkill("zhouyu", "huogong", [tileIndex]);
    const h = e.players[foeSeat].properties.find((x) => x.propertyId === propertyId)!;
    expect(h.defense).toBe(fullDefenseOf(1) - 1); // 4→3 纯扣防未归零
    expect(h.level).toBe(1); // 不降级
    expect(e.activePlayer.heroes[0].lastFired["huogong"]).toBe(e.round); // 发动记冷却
    const line = e.log.find((l) => l.detail.includes("heroFire"));
    expect(line?.brief).toContain("主动技【火攻】");
    expect(line?.brief).toContain(`「${e.board.at(tileIndex).name}」`);
    expect(line?.brief).toContain("防御值降至 3");
    // 冷却在账:冷却期灰置报剩余轮数,过 5 轮复活
    e.turnPhase = "AwaitingJinnang";
    e.round += 4;
    const cd = skillOpt(e, "zhouyu", "huogong");
    expect(cd?.available).toBe(false);
    expect(cd?.reason).toContain("冷却");
    e.round += 1;
    expect(skillOpt(e, "zhouyu", "huogong")?.available).toBe(true);
  });

  it("结算·demolished:防御打空降 1 级回满,战报「城防降为 N 级」;技路不派 PropertyDemolished/Lost 时机(#457 现状钉)", () => {
    const e = prepared();
    armSkill(e, "zhouyu", "huogong");
    const me = e.activeIndex;
    const foeSeat = 1 - me;
    const { propertyId, tileIndex } = grantCityNear(e, foeSeat, 2, e.players[me].position);
    setDefense(e, foeSeat, propertyId, 1); // 2 级城防御压到 1:一烧归零
    placePlayer(e, me, tileIndex);
    const dispatched = recordMomentKinds(e);
    e.resolveHeroSkill("zhouyu", "huogong");
    e.resolveHeroSkill("zhouyu", "huogong", [tileIndex]);
    const h = e.players[foeSeat].properties.find((x) => x.propertyId === propertyId)!;
    expect(h.level).toBe(1); // 归零降 1 级
    expect(h.defense).toBe(fullDefenseOf(1)); // 回满新等级满值
    const line = e.log.find((l) => l.detail.includes("heroFire"));
    expect(line?.brief).toContain("城防降为 1 级");
    // 现状拍板钉(#457):城损时机只挂锦囊路调用侧,火攻技路不派
    expect(dispatched.filter((m) => m === "PropertyDemolished" || m === "PropertyLost")).toEqual(
      [],
    );
  });

  it("heroSkillIntent 打分链(统一原则):等级最高→购价最高→tileIndex 小;无合法城不出技", () => {
    const e = prepared();
    armSkill(e, "zhouyu", "huogong");
    const me = e.activeIndex;
    const foeSeat = 1 - me;
    const anchor = e.players[me].position;
    const low = grantCityNear(e, foeSeat, 1, anchor);
    const highA = grantCityNear(e, foeSeat, 2, anchor);
    const highB = grantCityNear(e, foeSeat, 2, anchor);
    // 等级最高:两个 Lv2 候选胜出,低级城垫底
    const intent = heroSkillIntent(e, "zhouyu", "huogong");
    expect(intent.use).toBe(true);
    expect(intent.targets![intent.targets!.length - 1]).toBe(low.tileIndex);
    // 平手取购价最高(目录现读),再平手取 tileIndex 小
    const price = (pid: string) => e.catalog.get(pid)!.purchasePrice;
    const expected =
      price(highA.propertyId) !== price(highB.propertyId)
        ? price(highA.propertyId) > price(highB.propertyId)
          ? highA
          : highB
        : highA.tileIndex < highB.tileIndex
          ? highA
          : highB;
    expect(intent.targets![0]).toBe(expected.tileIndex);
    // 无合法城不出技(全场 0 级基线)
    const e2 = prepared();
    armSkill(e2, "zhouyu", "huogong");
    expect(heroSkillIntent(e2, "zhouyu", "huogong")).toEqual({ use: false, targets: [] });
  });

  it("strategy:bot 同 seed 定向出技——择射程内最高级城;无合法城不出技(与人类同参数,#580 行为单源)", () => {
    const seats = (guohao: string): SeatConfig[] => [
      { name: "A", isBot: true, guohao },
      { name: "B", isBot: true, guohao: "蜀" },
    ];
    const e = prepared(42, seats("魏"));
    if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
    armSkill(e, "zhouyu", "huogong");
    const me = e.activeIndex;
    const foeSeat = 1 - me;
    const anchor = e.players[me].position;
    const low = grantCityNear(e, foeSeat, 1, anchor, 4);
    const high = grantCityNear(e, foeSeat, 2, anchor, 5);
    botAct(e);
    expect(
      e.players[foeSeat].properties.find((h) => h.propertyId === high.propertyId)?.defense,
    ).toBe(fullDefenseOf(2) - 1); // 最高级城挨烧(2 级防御 3→2)
    expect(
      e.players[foeSeat].properties.find((h) => h.propertyId === low.propertyId)?.defense,
    ).toBe(fullDefenseOf(1)); // 低级城未动
    expect(e.activePlayer.heroes[0].lastFired["huogong"]).toBe(e.round);
    expect(e.turnPhase).toBe("Roll");
    // 无合法城(全场 0 级):不出技,收卷进 Roll,零冷却账
    const e2 = prepared(42, seats("吴"));
    if (e2.turnPhase === "AwaitingJinnang") e2.resolveJinnang(null);
    armSkill(e2, "zhouyu", "huogong");
    botAct(e2);
    expect(e2.turnPhase).toBe("Roll");
    expect(e2.activePlayer.heroes[0].lastFired["huogong"]).toBeUndefined();
  });
});

describe("技能表/名将池数据完整性(ADR-0036)", () => {
  it("钉1:技 id 全局唯一(SKILLS 表自证,被动+主动同表)", () => {
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(SKILLS.length);
  });

  it("钉2:每池 ≥1 技(HEROES 全员;空池 = 招贤浮字/卡面技能区数据 bug)", () => {
    for (const h of HEROES) {
      expect(h.skillPool.length, `${h.id} 空技能池`).toBeGreaterThan(0);
    }
  });

  it("钉3:每池内技 id 互不重复(冷却键=技 id 同池不得相撞;多主动池合法——逐字拍板表周瑜池含火攻+擂鼓双主动,ADR-0036 旧文「主动每池至多一条」已按表勘误,#782)", () => {
    for (const h of HEROES) {
      expect(new Set(h.skillPool).size, `${h.id} 池内 id 重复`).toBe(h.skillPool.length);
    }
  });

  // 全表逐字钉(原钉4)已迁 test/skill-expansion.test.ts 并扩至九将(#1145 四将 + #1142 卧龙,
  // 内置将 4→9;逐字钉与技属主集随表走,归内容包测试文件看守)。

  it("每技 name/desc 非空(#358 技必有名;#604 技必有描述——招贤浮字/卡面/全览弹框的数据依赖)", () => {
    for (const s of SKILLS) {
      expect(s.name.length, `${s.id} name 空`).toBeGreaterThan(0);
      expect(s.desc.length, `${s.id} desc 空`).toBeGreaterThan(0);
    }
  });
});

describe("授技掷骰(#787,ADR-0036)", () => {
  it("rollGrantedSkills:池内子集、至少一技、按池声明序存;同 seed 确定性重放", () => {
    for (const hero of HEROES) {
      // 同 seed 重放逐字节一致(骰流序固定:基数 1 浮点 + Fisher-Yates 池大小-1 浮点)
      const a = rollGrantedSkills(hero.skillPool, createDice(7).nextFloat);
      const b = rollGrantedSkills(hero.skillPool, createDice(7).nextFloat);
      expect(a).toEqual(b);
      expect(a.length, `${hero.id} 至少一技`).toBeGreaterThanOrEqual(1);
      expect(a.length).toBeLessThanOrEqual(hero.skillPool.length);
      // 子集且按池序:过滤池即还原自身
      expect(a, `${hero.id} 池序子集`).toEqual(hero.skillPool.filter((id) => a.includes(id)));
    }
  });

  it("rollGrantedSkills:基数几何衰减——全档可达无空洞,频次单调递减且落宽护栏(#969,ADR-0046)", () => {
    const pool = Array.from({ length: 3 }, (_, i) => `k${i}`);
    const SEEDS = 4000;
    const counts = [0, 0, 0];
    for (let seed = 1; seed <= SEEDS; seed++) {
      counts[rollGrantedSkills(pool, createDice(seed).nextFloat).length - 1]++;
    }
    const freq = counts.map((c) => c / SEEDS);
    // 真值 25/31≈80.6%、5/31≈16.1%、1/31≈3.2%;护栏放宽到 ±3σ 之外,防采样抖动 flake
    expect(freq[0]).toBeGreaterThan(0.75);
    expect(freq[0]).toBeLessThan(0.86);
    expect(freq[1]).toBeGreaterThan(0.12);
    expect(freq[1]).toBeLessThan(0.2);
    expect(freq[2]).toBeGreaterThan(0.01);
    expect(freq[2]).toBeLessThan(0.06);
    expect(freq[0]).toBeGreaterThan(freq[1]);
    expect(freq[1]).toBeGreaterThan(freq[2]);
  });

  it("招贤预掷明牌:候选行各携池序子集(≥1);落定沿用候选行预掷,不重掷", () => {
    const e = makeEngine(11);
    finishSetup(e);
    const picker = e.activePlayer;
    testEngine(e).tryRecruitHero(picker);
    expect(e.turnPhase).toBe("AwaitingHeroPick");
    expect(e.offeredHeroes.length).toBe(3);
    for (const offer of e.offeredHeroes) {
      expect(offer.skillIds.length, `${offer.def.id} 预掷非空`).toBeGreaterThanOrEqual(1);
      expect(offer.skillIds).toEqual(
        offer.def.skillPool.filter((id) => offer.skillIds.includes(id)),
      );
    }
    const picked = e.offeredHeroes[1]!;
    const grantedSnapshot = [...picked.skillIds];
    e.resolveHeroPick(1);
    const slot = picker.heroes.find((s) => s.heroId === picked.def.id);
    expect(slot?.skillIds).toEqual(grantedSnapshot); // 卡面亮的=实际入麾下的
  });

  it("三送将路同一公式单点:盲盒路(求贤令)掷得非空池内子集,战报授已授技名", () => {
    const e = makeEngine(13);
    finishSetup(e);
    const p = e.activePlayer;
    testEngine(e).forceTurnPhase("AwaitingJinnang");
    p.jinnangHand = ["求贤令"];
    p.jinnangHandCount = 1;
    e.submitCommand({ type: "useJinnang", cardId: "求贤令" });
    expect(p.heroes.length).toBe(1);
    const slot = p.heroes[0]!;
    expect(slot.skillIds.length).toBeGreaterThanOrEqual(1);
    expect(slot.skillIds).toEqual(
      heroById(slot.heroId).skillPool.filter((id) => slot.skillIds.includes(id)),
    );
    // 战报=已授技口径:授【技名】…,不再拼接全池被动 desc
    const line = e.log.find((l) => l.detail.includes("heroGrant"));
    expect(line?.brief).toContain(`得「${heroById(slot.heroId).name}」,授`);
    for (const id of slot.skillIds) expect(line?.brief).toContain(`【${skillById(id).name}】`);
  });
});
