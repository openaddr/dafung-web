// 反应窗全回路单测(#281,ADR-0017):识破自保/AOE 按份拆/连环计缺角作废+座位序/
// 拦检平局与拦停/bot 即席代答口径/越权拒绝/快照往返/出牌指示线留痕。
// 缝约定同 test/jinnang.test.ts:只测引擎公共面(构造/公共方法/snapshot/log/presentation)。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice, type Dice } from "@core/dice";
import type { TurnPhase } from "@core/authority";
import { HEROES } from "@core/heroes";
import { REACTION_WINDOW_MS } from "@core/constants";
import { botReactionDecision } from "@core/bot";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(sanguoData);

const SEATS2: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: false, guohao: "蜀" },
];
const SEATS3: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: false, guohao: "蜀" },
  { name: "C", isBot: false, guohao: "吴" },
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
    if (e.players[idx].isBot) e.aiSetupStep();
    else e.pickCapital(idx, e.firstAvailableCapitalIndex());
  }
}

/** 开好局并清掉开局锦囊卷轴,返回可测态。 */
function prepared(seed?: number, seats?: SeatConfig[]) {
  const e = makeEngine(seed, seats);
  finishSetup(e);
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return e;
}

function setHand(e: GameEngine, seat: number, cards: string[]) {
  const p = e.players[seat];
  p.jinnangHand = [...cards];
  p.jinnangHandCount = cards.length;
}

/** 给活跃座位发牌并摆进锦囊相位(resolveJinnang 的前置态;同 jinnang.test armJinnang 口径)。 */
function armUser(e: GameEngine, seat: number, cards: string[]) {
  setHand(e, seat, cards);
  e.turnPhase = "AwaitingJinnang";
}

/** 骰子替身:rollDie 按脚本出点、roll 出固定骰面、nextFloat 恒 0.99(dice 字段 readonly
 *  只挡编译,测试注入走断言,同 test/bot-jinnang.test.ts stubDice 口径)。 */
function scriptDice(e: GameEngine, opts: { die?: number; rollDies?: number[] }) {
  let di = 0;
  const dice: Dice = {
    roll: () => ({ die: opts.die ?? 1 }),
    rollDie: () => opts.rollDies?.[di++] ?? 1,
    nextFloat: () => 0.99,
    getRngState: () => 0,
    setRngState: () => {},
  };
  (e as unknown as { dice: Dice }).dice = dice;
}

/** 给 seat 一座非都城房产(拦检/火烧布场),capitalIndex 挪出路径格。 */
function grantCity(e: GameEngine, seat: number, propertyId: string) {
  e.players[seat].properties.push({
    propertyId,
    group: "a",
    purchasePrice: 1000,
    level: 2,
    maxLevel: 3,
  });
}

/** 测试预期当前挂起的是识破窗,窄化返回公告载荷(窄化失败=测试预期落空,红出来)。 */
function jinnangView(e: GameEngine) {
  const v = e.pendingReaction?.view;
  if (!v || v.kind !== "jinnang") throw new Error("测试预期识破窗挂起,实际无窗/非识破窗");
  return v;
}

/** 布场:行人(active)摆到格 9(江夏),城主持格 10(武昌)城,掷 2 点途经 10、落 11(赤壁)。
 *  路径格上的既有持仓清走(选都落点不确定)、都城索引挪到 0/3,避免必停/途经都城干扰。
 *  返回(引擎,行人座,城主座,城主)。 */
function marchUp(opts: { ownerCards: string[]; ownerTreasure?: boolean; ownerBot?: boolean }) {
  const e = prepared();
  const mover = e.activePlayer;
  const moverSeat = e.players.indexOf(mover);
  const ownerSeat = moverSeat === 0 ? 1 : 0;
  const owner = e.players[ownerSeat];
  const pathProps = ["prop-jiangxia", "prop-wuchang", "prop-chibi"];
  for (const p of e.players) {
    p.properties = p.properties.filter((h) => !pathProps.includes(h.propertyId));
  }
  mover.position = 9;
  mover.capitalIndex = 0; // 路径 9→10→11,都城挪出路径
  owner.capitalIndex = 3;
  if (opts.ownerBot) owner.isBot = true; // bot 城主:开窗即席代答(ADR-0017 §3)
  grantCity(e, ownerSeat, "prop-wuchang"); // 格 10 武昌,城主城
  setHand(e, ownerSeat, opts.ownerCards);
  if (opts.ownerTreasure) owner.treasures.push({ id: "t1", name: "和氏璧", level: 3 });
  e.turnPhase = "Roll";
  scriptDice(e, { die: 2 });
  return { e, mover, moverSeat, ownerSeat, owner };
}

describe("反应窗配置表(#281/constants)", () => {
  it("键=挂点时机,默认 3000ms;权威侧读取,E2E 缩放由消费方处理", () => {
    expect(REACTION_WINDOW_MS.JinnangAnnounced).toBe(3000);
    expect(REACTION_WINDOW_MS.MarchPassedCity).toBe(3000);
    expect(Object.keys(REACTION_WINDOW_MS).sort()).toEqual(["JinnangAnnounced", "MarchPassedCity"]);
  });
});

describe("识破诡计(JinnangAnnounced 反应窗)", () => {
  it("识破自保生效:火烧连营指定→识破→计对这份失效(目标城防原样,双牌皆耗)", () => {
    const e = prepared();
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const victimSeat = userSeat === 0 ? 1 : 0;
    const victim = e.players[victimSeat];
    armUser(e, userSeat, ["火烧连营"]);
    setHand(e, victimSeat, ["识破诡计"]);
    const capId = e.board.at(victim.capitalIndex)?.propertyId;
    victim.properties = [
      { propertyId: capId!, group: "a", purchasePrice: 1000, level: 2, maxLevel: 3 },
    ];
    e.resolveJinnang("火烧连营"); // 入目标段
    e.resolveJinnang("火烧连营", [victimSeat]); // 宣布 → 反应窗挂起
    expect(e.turnPhase).toBe("AwaitingReaction");
    expect(e.pendingReaction?.view).toEqual({
      kind: "jinnang",
      cardId: "火烧连营",
      userSeat,
      targetSeats: [victimSeat],
      queriedBySeat: [victimSeat],
      windowMs: REACTION_WINDOW_MS.JinnangAnnounced, // #284:开窗时长随 view 走
    });
    expect(e.pendingReaction!.seq).toBeGreaterThan(0); // #284:窗实例号单调分配
    expect(victim.properties[0].level).toBe(2); // 挂起中未结算
    e.respondReaction(victimSeat, true, "识破诡计", victimSeat);
    // 结算:识破生效,这份失效
    expect(e.pendingReaction).toBeNull();
    expect(victim.properties[0].level).toBe(2); // 城防原样
    expect(user.jinnangHand).toEqual([]); // 火烧连营已耗(识破只护份,不退牌)
    expect(victim.jinnangHand).toEqual([]); // 识破诡计已耗
    expect(e.jinnangDiscard).toContain("火烧连营");
    expect(e.jinnangDiscard).toContain("识破诡计");
    expect(e.turnPhase).toBe("Roll"); // 军师幕收卷
    expect(e.log.some((l) => l.detail.includes("reactionCounter"))).toBe(true);
  });

  it("不用/无人识破:锦囊照常结算(城防被降)", () => {
    const e = prepared();
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const victimSeat = userSeat === 0 ? 1 : 0;
    const victim = e.players[victimSeat];
    armUser(e, userSeat, ["火烧连营"]);
    setHand(e, victimSeat, ["识破诡计"]);
    const capId = e.board.at(victim.capitalIndex)?.propertyId;
    victim.properties = [
      { propertyId: capId!, group: "a", purchasePrice: 1000, level: 2, maxLevel: 3 },
    ];
    e.resolveJinnang("火烧连营");
    e.resolveJinnang("火烧连营", [victimSeat]);
    e.respondReaction(victimSeat, false); // 不用(超时代发的同款命令)
    expect(victim.properties[0].level).toBe(1); // 照常结算
    expect(victim.jinnangHand).toEqual(["识破诡计"]); // 没用牌,仍在手
    expect(e.turnPhase).toBe("Roll");
  });

  it("AOE 按份拆(多持牌者各拆各份):横征暴敛各持牌者各保一份,征不到银", () => {
    const e = prepared(42, SEATS3);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const others = [0, 1, 2].filter((i) => i !== userSeat);
    armUser(e, userSeat, ["横征暴敛"]);
    for (const seat of others) {
      setHand(e, seat, ["识破诡计"]);
      e.players[seat].cash = 500;
    }
    e.resolveJinnang("横征暴敛"); // 全体域:宣布即入窗
    expect(e.turnPhase).toBe("AwaitingReaction");
    expect(jinnangView(e).targetSeats.sort()).toEqual([...others].sort());
    const userCashBefore = user.cash;
    for (const seat of others) e.respondReaction(seat, true, "识破诡计", seat); // 各保各份
    expect(e.pendingReaction).toBeNull();
    for (const seat of others) expect(e.players[seat].cash).toBe(500); // 各份失效
    expect(user.cash).toBe(userCashBefore); // 征不到银(无进账)
    expect(e.turnPhase).toBe("Roll");
  });

  it("AOE 同份多张识破:座位序第一张生效,其余原样退回不消耗(替他人拆招同份)", () => {
    const e = prepared(42, SEATS3);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const others = [0, 1, 2].filter((i) => i !== userSeat);
    const [low, high] = others; // 座位序 low < high
    armUser(e, userSeat, ["横征暴敛"]);
    setHand(e, low, ["识破诡计"]);
    setHand(e, high, ["识破诡计"]);
    e.players[low].cash = 500;
    e.players[high].cash = 500;
    e.resolveJinnang("横征暴敛");
    // 两张都拆 low 那份:座位序 low 生效,high 原样收回
    e.respondReaction(high, true, "识破诡计", low);
    e.respondReaction(low, true, "识破诡计", low);
    expect(e.pendingReaction).toBeNull();
    expect(e.players[low].cash).toBe(500); // low 的份被保下
    expect(e.players[high].cash).toBe(300); // high 照缴 200(他的识破去保 low 了)
    expect(e.players[low].jinnangHand).toEqual([]); // 生效者耗牌
    expect(e.players[high].jinnangHand).toEqual(["识破诡计"]); // 被顶替者原样退回
    expect(e.log.some((l) => l.detail.includes("reactionCounterReturn"))).toBe(true);
  });

  it("连环计:任意一张识破即全计作废(缺角);双人应答按座位序第一张生效、其余退回", () => {
    const e = prepared(42, SEATS3);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const others = [0, 1, 2].filter((i) => i !== userSeat);
    const [a, b] = others; // a < b
    armUser(e, userSeat, ["连环计"]);
    setHand(e, a, ["识破诡计"]);
    setHand(e, b, ["识破诡计"]);
    e.players[a].cash = 1000;
    e.players[b].cash = 1000;
    e.resolveJinnang("连环计"); // two-a
    e.resolveJinnang("连环计", [a]);
    e.resolveJinnang("连环计", [b]); // two-b → 宣布 → 窗
    expect(e.turnPhase).toBe("AwaitingReaction");
    expect(jinnangView(e).targetSeats.sort()).toEqual([a, b].sort());
    e.respondReaction(b, true, "识破诡计"); // 连环计 shareSeat 可省略(任意一张即全计作废)
    e.respondReaction(a, true, "识破诡计");
    expect(e.pendingReaction).toBeNull();
    expect(e.log.some((l) => l.detail.includes("jinnangDuel"))).toBe(false); // 全计作废,拼点未发生
    expect(e.players[a].jinnangHand).toEqual([]); // 座位序第一张生效耗牌
    expect(e.players[b].jinnangHand).toEqual(["识破诡计"]); // 其余退回
    expect(e.jinnangDiscard).toContain("连环计"); // 使用者的计已扣账(被识破也不回手)
    expect(e.turnPhase).toBe("Roll");
  });

  it("respondReaction 越权/重复/错牌拒绝,不占应答名额;挂起态随快照往返并续答收窗", () => {
    const e = prepared(42, SEATS3);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const others = [0, 1, 2].filter((i) => i !== userSeat);
    const [x, y] = others;
    armUser(e, userSeat, ["火烧连营"]);
    setHand(e, x, ["识破诡计"]);
    setHand(e, y, ["识破诡计"]);
    const capId = e.board.at(e.players[x].capitalIndex)?.propertyId;
    e.players[x].properties = [
      { propertyId: capId!, group: "a", purchasePrice: 1000, level: 2, maxLevel: 3 },
    ];
    e.resolveJinnang("火烧连营");
    e.resolveJinnang("火烧连营", [x]); // 双持牌者同窗:queried=[x,y]
    expect(e.turnPhase).toBe("AwaitingReaction");
    expect(e.pendingReaction!.answers).toEqual([]);
    e.respondReaction(userSeat, true, "识破诡计", x); // 越权:使用者非被询问者
    expect(e.pendingReaction!.answers).toEqual([]);
    e.respondReaction(x, true, "火烧连营"); // 错牌:非反应牌
    expect(e.pendingReaction!.answers).toEqual([]);
    e.respondReaction(x, true, "识破诡计", x); // x 生效应答
    expect(e.pendingReaction!.answers.length).toBe(1);
    e.respondReaction(x, false); // 重复应答:拒绝
    expect(e.pendingReaction!.answers.length).toBe(1);
    expect(e.turnPhase).toBe("AwaitingReaction"); // 窗仍挂起(y 未答)
    // 快照往返:挂起态(公告/应答/续结算载荷)保真
    const snap = e.snapshot();
    const e2 = makeEngine(1, SEATS3); // 恢复引擎座位表须与快照一致
    e2.restoreFromSnapshot(snap);
    expect(e2.turnPhase).toBe("AwaitingReaction");
    expect(e2.pendingReaction).toEqual(e.pendingReaction);
    expect(e2.snapshot().reaction).toEqual(snap.reaction);
    // 恢复端续答收窗:识破生效,x 的城防原样
    e2.respondReaction(y, true, "识破诡计", x);
    expect(e2.pendingReaction).toBeNull();
    expect(e2.players[x].properties[0].level).toBe(2);
  });
});

describe("半路杀出(MarchPassedCity 反应窗)", () => {
  it("城主持半路杀出:途经即开拦检窗;拦检胜=行人止步拦检城、照常落格结算(可被交涉)", () => {
    const { e, mover, moverSeat, ownerSeat } = marchUp({
      ownerCards: ["半路杀出"],
      ownerTreasure: true,
    });
    e.rollAndMove();
    expect(e.turnPhase).toBe("AwaitingReaction");
    expect(e.pendingReaction?.view).toEqual({
      kind: "march",
      cardId: "半路杀出",
      userSeat: moverSeat,
      ownerSeat,
      windowMs: REACTION_WINDOW_MS.MarchPassedCity, // #284:开窗时长随 view 走
    });
    expect(mover.position).toBe(9); // 挂起中未落位
    scriptDice(e, { rollDies: [5, 3] }); // 拼点:城主 5 > 行人 3
    e.respondReaction(ownerSeat, true, "半路杀出");
    expect(e.pendingReaction).toBeNull();
    expect(mover.position).toBe(10); // 止步拦检城
    expect(e.turnPhase).toBe("AwaitingTreasureOwner"); // 照常落格:城主有珍宝 → 交涉
    expect(e.jinnangDiscard).toContain("半路杀出");
    expect(e.players[ownerSeat].jinnangHand).toEqual([]);
  });

  it("拦检平局:牌白耗,行人照常续走落原点", () => {
    const { e, mover, ownerSeat } = marchUp({ ownerCards: ["半路杀出"] });
    e.rollAndMove();
    expect(e.turnPhase).toBe("AwaitingReaction");
    scriptDice(e, { rollDies: [4, 4] }); // 平局
    e.respondReaction(ownerSeat, true, "半路杀出");
    expect(e.pendingReaction).toBeNull();
    expect(mover.position).toBe(11); // 落原点(赤壁)
    expect(e.turnPhase).toBe("AwaitingDecision"); // 照常落格:无主可购卷轴
    expect(e.jinnangDiscard).toContain("半路杀出"); // 平局牌白耗
  });

  it("拦检落败:城主骰输,牌白耗,行人照常续走落原点", () => {
    const { e, mover, ownerSeat } = marchUp({ ownerCards: ["半路杀出"] });
    e.rollAndMove();
    expect(e.turnPhase).toBe("AwaitingReaction");
    scriptDice(e, { rollDies: [2, 6] }); // 城主 2 < 行人 6
    e.respondReaction(ownerSeat, true, "半路杀出");
    expect(e.pendingReaction).toBeNull();
    expect(mover.position).toBe(11); // 落原点(赤壁)
    expect(e.turnPhase).toBe("AwaitingDecision"); // 照常落格:无主可购卷轴
    expect(e.jinnangDiscard).toContain("半路杀出"); // 落败牌白耗
  });

  it("城主不用:行人照常续走;无牌城主不开窗直接走完", () => {
    const a = marchUp({ ownerCards: ["半路杀出"] });
    a.e.rollAndMove();
    a.e.respondReaction(a.ownerSeat, false);
    expect(a.mover.position).toBe(11);
    expect(a.e.jinnangDiscard).not.toContain("半路杀出"); // 不用不耗牌
    expect(a.e.turnPhase).toBe("AwaitingDecision");

    const b = marchUp({ ownerCards: [] }); // 无牌:全程无感(不开窗)
    b.e.rollAndMove();
    expect(b.e.turnPhase).not.toBe("AwaitingReaction");
    expect(b.e.pendingReaction).toBeNull();
    expect(b.mover.position).toBe(11);
  });

  it("拦停成功即止:同程多座己城,拦停后后续城不再问(窗只开一次)", () => {
    const { e, mover, ownerSeat } = marchUp({ ownerCards: ["半路杀出"] });
    grantCity(e, ownerSeat, "prop-chibi"); // 格 11(落点)也是城主城
    e.rollAndMove();
    expect(e.turnPhase).toBe("AwaitingReaction");
    scriptDice(e, { rollDies: [5, 3] });
    e.respondReaction(ownerSeat, true, "半路杀出");
    expect(mover.position).toBe(10); // 止步第一座拦检城
    expect(e.log.filter((l) => l.detail.includes("reactionWindow")).length).toBe(1);
    // 止步落格结算:格 10 城主无珍宝 → 无事发生收尾
    expect(e.turnPhase).toBe("Roll");
  });
});

describe("bot 即席代答(ADR-0017 §3:bot 持牌即时代答不等满)", () => {
  it("bot 持识破自保:横征暴敛宣布即被拆,窗不同外显(bot 座位现金原样)", () => {
    const e = prepared(42, [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: true, guohao: "蜀" },
    ]);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const botSeat = userSeat === 0 ? 1 : 0;
    armUser(e, userSeat, ["横征暴敛"]);
    setHand(e, botSeat, ["识破诡计"]);
    e.players[botSeat].cash = 500;
    const userCashBefore = user.cash;
    e.resolveJinnang("横征暴敛");
    // bot 即席代答:窗在同调用内收掉,相位不外显
    expect(e.turnPhase).not.toBe("AwaitingReaction");
    expect(e.pendingReaction).toBeNull();
    expect(e.players[botSeat].cash).toBe(500); // bot 自保拆掉自己那份
    expect(user.cash).toBe(userCashBefore);
    expect(e.jinnangDiscard).toContain("识破诡计");
  });

  it("bot 不替他人拆招:锦囊指定别人,bot 持识破也不用(照常结算)", () => {
    const e = prepared(42, [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: true, guohao: "吴" },
    ]);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const others = [0, 1, 2].filter((i) => i !== userSeat);
    const [victimSeat, botSeat] = others; // 人类受害者 + bot 持牌者
    armUser(e, userSeat, ["火烧连营"]);
    setHand(e, botSeat, ["识破诡计"]);
    const capId = e.board.at(e.players[victimSeat].capitalIndex)?.propertyId;
    e.players[victimSeat].properties = [
      { propertyId: capId!, group: "a", purchasePrice: 1000, level: 2, maxLevel: 3 },
    ];
    e.resolveJinnang("火烧连营");
    e.resolveJinnang("火烧连营", [victimSeat]);
    // bot 即席「不用」:窗收掉,火烧照常结算
    expect(e.pendingReaction).toBeNull();
    expect(e.players[victimSeat].properties[0].level).toBe(1);
    expect(e.players[botSeat].jinnangHand).toEqual(["识破诡计"]); // bot 不替他人拆招
  });

  it("bot 拦检启发:行人现金全场第一才拦(确定性),否则不用续走", () => {
    // 行人现金第一 → 即席拦检(骰脚本:城主胜)
    const a = marchUp({ ownerCards: ["半路杀出"], ownerBot: true });
    a.e.players[a.moverSeat].cash = 99999; // 行人现金第一
    scriptDice(a.e, { die: 2, rollDies: [5, 3] });
    a.e.rollAndMove();
    expect(a.e.turnPhase).not.toBe("AwaitingReaction"); // bot 即席应答+结算
    expect(a.mover.position).toBe(10); // 拦停成功
    expect(a.owner.jinnangHand).toEqual([]);

    // 行人现金非第一 → 不拦,窗不开(即席不用),照常落原点
    const b = marchUp({ ownerCards: ["半路杀出"], ownerBot: true });
    b.e.players[b.ownerSeat].cash = 99999; // 城主更富,行人非第一
    b.e.rollAndMove();
    expect(b.e.turnPhase).not.toBe("AwaitingReaction");
    expect(b.mover.position).toBe(11);
    expect(b.owner.jinnangHand).toEqual(["半路杀出"]); // 牌未耗
  });
});

describe("主动技不可被识破(#229/#281 口径)", () => {
  it("火攻不经反应窗:受害者持识破也拦不住,牌不耗", () => {
    const e = prepared();
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const victimSeat = userSeat === 0 ? 1 : 0;
    const victim = e.players[victimSeat];
    setHand(e, userSeat, []); // 使用者清手:技后收卷不被 dealt 牌拽回军师幕
    setHand(e, victimSeat, ["识破诡计"]);
    const capId = e.board.at(victim.capitalIndex)?.propertyId;
    victim.properties = [
      { propertyId: capId!, group: "a", purchasePrice: 1000, level: 2, maxLevel: 3 },
    ];
    const zhouyu = HEROES.find((h) => h.id === "zhouyu");
    if (!zhouyu) throw new Error("HEROES 表缺 zhouyu(数据 bug)");
    user.heroes = [zhouyu];
    e.turnPhase = "AwaitingJinnang";
    e.resolveHeroSkill("zhouyu-huogong"); // 入目标段
    e.resolveHeroSkill("zhouyu-huogong", [victimSeat]);
    expect(e.pendingReaction).toBeNull(); // 不开窗
    const phaseAfter = e.turnPhase as TurnPhase; // 断言收窄:结算收卷相位
    expect(phaseAfter).toBe("Roll");
    expect(victim.properties[0].level).toBe(1); // 火攻照常结算
    expect(victim.jinnangHand).toEqual(["识破诡计"]); // 牌留手
  });
});

describe("出牌指示线留痕(#281/P2-E)", () => {
  it("锦囊生效点+识破生效点各留一条;破坏性读一次取尽", () => {
    const e = prepared();
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const victimSeat = userSeat === 0 ? 1 : 0;
    const victim = e.players[victimSeat];
    armUser(e, userSeat, ["火烧连营"]);
    setHand(e, victimSeat, ["识破诡计"]);
    const capId = e.board.at(victim.capitalIndex)?.propertyId;
    victim.properties = [
      { propertyId: capId!, group: "a", purchasePrice: 1000, level: 2, maxLevel: 3 },
    ];
    e.resolveJinnang("火烧连营");
    e.resolveJinnang("火烧连营", [victimSeat]);
    e.respondReaction(victimSeat, true, "识破诡计", victimSeat);
    const plays = e.presentation.drainJinnangPlays();
    expect(plays).toEqual([
      { userSeat, targetSeats: [victimSeat], cardId: "火烧连营" }, // 宣布点
      { userSeat: victimSeat, targetSeats: [victimSeat], cardId: "识破诡计" }, // 识破生效点
    ]);
    expect(e.presentation.drainJinnangPlays()).toEqual([]); // 一次取尽
  });

  it("lastJinnangPlay 联机信号源(#284):批形状/seq 单调、与窗实例号同计数器、随快照往返", () => {
    const e = prepared();
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const victimSeat = userSeat === 0 ? 1 : 0;
    armUser(e, userSeat, ["横征暴敛"]);
    setHand(e, victimSeat, ["识破诡计"]);
    e.resolveJinnang("横征暴敛"); // 宣布留痕 + 开窗(各取一号)
    const announceSeq = e.lastJinnangPlay!.seq;
    const windowSeq = e.pendingReaction!.seq;
    expect(announceSeq).toBeGreaterThan(0);
    expect(windowSeq).toBe(announceSeq + 1); // 同一计数器顺序取号
    e.respondReaction(victimSeat, true, "识破诡计", victimSeat); // 识破留痕:未封批 → 并入同批(AOE 多留痕不丢)
    expect(e.lastJinnangPlay!.seq).toBe(announceSeq);
    expect(e.lastJinnangPlay!.plays).toEqual([
      { userSeat, targetSeats: [victimSeat], cardId: "横征暴敛" },
      { userSeat: victimSeat, targetSeats: [victimSeat], cardId: "识破诡计" },
    ]);
    // 封批(权威侧产快照前调):下一批重新取号
    e.sealJinnangPlayBatch();
    // 快照往返:留痕保真(深拷贝),恢复端 seq 计数器推回到快照见过的最大号
    const snap = e.snapshot();
    const e2 = makeEngine(1);
    e2.restoreFromSnapshot(snap);
    expect(e2.lastJinnangPlay).toEqual(e.lastJinnangPlay);
  });
});

describe("botReactionDecision 纯决策口径(#281)", () => {
  /** 直接摆一个识破窗(公开字段直设,同相位摆位口径),返回可断言的引擎。 */
  function armCounterWindow(
    seats: SeatConfig[],
    view: { cardId: string; userSeat: number; targetSeats: number[] },
  ) {
    const e = makeEngine(42, seats);
    finishSetup(e);
    e.pendingReaction = {
      seq: 1, // #284:测试摆位给一个占位实例号(真实分配在 openReactionWindow)
      view: {
        kind: "jinnang",
        cardId: view.cardId,
        userSeat: view.userSeat,
        targetSeats: view.targetSeats,
        queriedBySeat: [],
        windowMs: REACTION_WINDOW_MS.JinnangAnnounced,
      },
      answers: [],
      payload: { kind: "jinnang", userSeat: view.userSeat, cardId: view.cardId, targets: [] },
    };
    return e;
  }

  it("hold/conservative 永不出反应牌(代驾不花牌,#148/#229)", () => {
    const e = armCounterWindow(SEATS3, { cardId: "横征暴敛", userSeat: 0, targetSeats: [1, 2] });
    setHand(e, 1, ["识破诡计"]);
    e.players[1].cash = 500;
    expect(botReactionDecision(e, 1, { conservative: true })).toEqual({ use: false });
    expect(botReactionDecision(e, 1, { skills: "hold" })).toEqual({ use: false });
  });

  it("识破只自保:指定自己且净值划算才拆(shareSeat=自己);指定他人不拆", () => {
    const e = armCounterWindow(SEATS3, { cardId: "横征暴敛", userSeat: 0, targetSeats: [1, 2] });
    setHand(e, 1, ["识破诡计"]);
    e.players[1].cash = 500;
    expect(botReactionDecision(e, 1)).toEqual({ use: true, cardId: "识破诡计", shareSeat: 1 });
    // 不落自己头上的份:不拆
    const e2 = armCounterWindow(SEATS3, { cardId: "火烧连营", userSeat: 0, targetSeats: [2] });
    setHand(e2, 1, ["识破诡计"]);
    expect(botReactionDecision(e2, 1)).toEqual({ use: false });
  });

  it("净值贪心:无损失/低损失不拆(军情密探情报无用)", () => {
    const e = armCounterWindow(SEATS3, { cardId: "军情密探", userSeat: 0, targetSeats: [1] });
    setHand(e, 1, ["识破诡计"]);
    expect(botReactionDecision(e, 1)).toEqual({ use: false });
  });

  it("半路杀出:行人现金严格全场第一才拦;并列第一不拦", () => {
    const e = makeEngine(42, SEATS3);
    finishSetup(e);
    e.pendingReaction = {
      seq: 1, // #284:测试摆位给一个占位实例号(真实分配在 openReactionWindow)
      view: {
        kind: "march",
        cardId: "半路杀出",
        userSeat: 2,
        ownerSeat: 1,
        windowMs: REACTION_WINDOW_MS.MarchPassedCity,
      },
      answers: [],
      payload: {
        kind: "march",
        moverSeat: 2,
        tileIndex: 10,
        stepsToTile: 3,
        totalTiles: 5,
        resumeTiles: [11],
        landIndex: 11,
        fromPos: 9,
        steps: 2,
        wasOnBranch: false,
      },
    };
    setHand(e, 1, ["半路杀出"]);
    e.players[2].cash = 20000; // 行人第一
    e.players[1].cash = 10000;
    e.players[0].cash = 10000;
    expect(botReactionDecision(e, 1)).toEqual({ use: true, cardId: "半路杀出" });
    e.players[0].cash = 20000; // 并列第一:不拦
    expect(botReactionDecision(e, 1)).toEqual({ use: false });
  });
});
