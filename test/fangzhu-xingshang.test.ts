// 曹丕放逐/行殇引擎结算单测：伤害标记、时机内应答、休整叠加、快照恢复和 bot 应答。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@dafung/core/engine/authority";
import { createDice } from "@dafung/core/engine/dice";
import { armHero, setStamina, setCash, setBot, armPhase } from "@dafung/core/engine/planter";
import { skillMarksOf, heroSlotOf } from "@dafung/core/engine/roster";
import { botAct, botSkillChoiceDecision } from "@dafung/core/engine/bot";
import guanzhongData from "../packages/core/maps/guanzhong.json";
import { loadMap } from "@dafung/core/engine/board-loader";

const MAP = loadMap(guanzhongData);

function makeEngine(seed = 7): GameEngine {
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  });
}

function makeEngine3(seed = 7): GameEngine {
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: false, guohao: "吴" },
    ],
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  });
}

/** 轻量开局:只把相位推到 Playing(同 stamina.test 布景;不断言选都细节)。 */
function finishSetupLite(e: GameEngine) {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) e.aiSetupStep();
    else {
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
    }
  }
  e.players.forEach((p) => {
    p.jinnangHand = [];
    p.jinnangHandCount = 0;
  }); // 锦囊相位 inert(#122)
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
}

/** 座位 0 的放逐槽位(单曹丕布景的唯一定位)。 */
function fangzhuSlot(e: GameEngine) {
  return heroSlotOf(e.players[0], "caopi");
}

describe("放逐攒怒(#1377 AC1):损失攒等值标记,增益不攒", () => {
  it("setStamina 损耗经 StaminaLoss 时机攒等值标记;增益方向零攒", () => {
    const e = makeEngine();
    finishSetupLite(e);
    armHero(e, 0, "caopi", ["fangzhu"]);
    setStamina(e, 0, 60); // 100→60:损失 40
    expect(skillMarksOf(fangzhuSlot(e), "fangzhu")).toBe(40);
    setStamina(e, 0, 59); // 再损 1:40→41(未达 60,无待决)
    expect(skillMarksOf(fangzhuSlot(e), "fangzhu")).toBe(41);
    expect(e.pendingSkillChoices).toHaveLength(0);
    setStamina(e, 0, 90); // 增益 +31：不攒
    expect(skillMarksOf(fangzhuSlot(e), "fangzhu")).toBe(41);
    setStamina(e, 0, 100); // 回满同样是增益:不攒
    expect(skillMarksOf(fangzhuSlot(e), "fangzhu")).toBe(41);
  });

  it("夹紧后实际损失为准:打空最后一笔记实际差非请求差(请求 −50 实落 −30)", () => {
    const e = makeEngine();
    finishSetupLite(e);
    armHero(e, 0, "caopi", ["fangzhu"]);
    setStamina(e, 0, 30); // 100→30:损失 70
    e.respondSkillChoice(0, false);
    setStamina(e, 0, -20); // 请求绝对值 −20(差 −50):夹紧实际 −30(打空最后一笔)
    expect(skillMarksOf(fangzhuSlot(e), "fangzhu")).toBe(100); // 70+30(按实际差)
    expect(e.pendingSkillChoices).toHaveLength(1); // 攒满照常挂问,不影响口径
  });
});

describe("「你可」选择闸(#1377 AC2):达 60 挂待决,发动/放弃", () => {
  it("扣体力当场问放逐，发动后标记归零并继续当前回合", () => {
    const e = makeEngine3();
    finishSetupLite(e);
    armPhase(e, { activeIndex: 0 }); // 布景:座位 0 为活跃(三席局目标取非下家,落账可观察)
    armHero(e, 0, "caopi", ["fangzhu"]);
    setStamina(e, 0, 30); // 损失 70 ≥60:挂待决
    expect(e.pendingSkillChoices).toEqual([
      { skillId: "fangzhu", heroId: "caopi", ownerSeat: 0, subjectSeat: 0 },
    ]);
    expect(e.turnPhase).toBe("AwaitingSkillChoice");
    expect(e.decisionOwner).toBe(0);
    e.respondSkillChoice(0, true, 2); // 发动:罚座位 2(非下家,+1 落账不被即时消费)
    expect(e.players[2].skipTurns).toBe(1);
    expect(skillMarksOf(fangzhuSlot(e), "fangzhu")).toBe(0); // 归零,超出部分舍弃
    expect(e.turnPhase).toBe("Roll");
    expect(e.activeIndex).toBe(0);
  });

  it("放弃保留标记，下笔损失再次询问", () => {
    const e = makeEngine();
    finishSetupLite(e);
    armHero(e, 0, "caopi", ["fangzhu"]);
    setStamina(e, 0, 30); // 70 损失:挂待决
    e.respondSkillChoice(0, false); // 放弃
    expect(skillMarksOf(fangzhuSlot(e), "fangzhu")).toBe(70); // 保留
    expect(e.turnPhase).toBe("Roll");
    expect(e.pendingSkillChoices).toHaveLength(0);
    setStamina(e, 0, 0); // 再损 30 → 100 ≥60:新问
    expect(e.pendingSkillChoices).toHaveLength(1);
    expect(e.turnPhase).toBe("AwaitingSkillChoice");
  });
});

describe("放逐约束(#1377 AC3):不放自己 / 已跳者叠加 / 跨耗竭不清零 / 遣散清零", () => {
  it("发动不能指定自己:警告拒绝不占待决,窗原地保留", () => {
    const e = makeEngine();
    finishSetupLite(e);
    armHero(e, 0, "caopi", ["fangzhu"]);
    setStamina(e, 0, 30);
    e.respondSkillChoice(0, true, 0); // 指自己:拒绝
    expect(e.turnPhase).toBe("AwaitingSkillChoice"); // 窗未走
    expect(e.players[0].skipTurns).toBe(0);
    expect(e.pendingSkillChoices).toHaveLength(1); // 待决未消
    e.respondSkillChoice(0, false); // 放弃收尾
    expect(e.turnPhase).toBe("Roll");
  });

  it("对已在被跳回合中的目标发动:跳过数叠加(缓兵之计同形制)", () => {
    const e = makeEngine();
    finishSetupLite(e);
    armHero(e, 0, "caopi", ["fangzhu"]);
    setStamina(e, 0, 50); // 50 标记,不挂问
    armPhase(e, { activeIndex: 1 });
    expect(e.damageStamina(1, 100, null)).toBe(0);
    expect(e.players[1].skipTurns).toBe(2);
    expect(e.players[1].resting).toBe(true);
    setStamina(e, 0, 10); // 再损 40 → 90，挂待决。
    e.respondSkillChoice(0, true, 1);
    expect(e.players[1].skipTurns).toBe(3);
    e.endTurn();
    e.endTurn();
    expect(e.players[1].stamina).toBe(0);
    e.endTurn();
    expect(e.players[1].skipTurns).toBe(0);
    expect(e.players[1].resting).toBe(false);
    expect(e.players[1].stamina).toBe(100);
  });

  it("耗竭重置体力不清零:标记跨休整周期保留并继续积累", () => {
    const e = makeEngine();
    finishSetupLite(e);
    armPhase(e, { activeIndex: 0 });
    armHero(e, 0, "caopi", ["fangzhu"]);
    e.damageStamina(0, 100, null);
    e.respondSkillChoice(0, false); // 放弃:保留
    expect(skillMarksOf(fangzhuSlot(e), "fangzhu")).toBe(100);
    expect(e.players[0].resting).toBe(true);
    e.endTurn(); // 座位 1 回合毕:座位 0 跳 1(2→1),休整中不回满
    expect(skillMarksOf(fangzhuSlot(e), "fangzhu")).toBe(100); // 跳回合不清零
    e.endTurn(); // 再跳 1(1→0):休整期满回满
    expect(e.players[0].resting).toBe(false);
    expect(e.players[0].stamina).toBe(100); // 重置的是体力,不是标记
    expect(skillMarksOf(fangzhuSlot(e), "fangzhu")).toBe(100);
    setStamina(e, 0, 90); // 再损 10:在保留基数上继续积累
    expect(skillMarksOf(fangzhuSlot(e), "fangzhu")).toBe(110);
  });

  it("遣散随槽清零:整槽弃(标记同弃),再招为全新空账", () => {
    const e = makeEngine();
    finishSetupLite(e);
    armPhase(e, { activeIndex: 0 }); // 遣散命令作用于活跃座位(自己回合随时可点)
    armHero(e, 0, "caopi", ["fangzhu"]);
    setStamina(e, 0, 50); // 50 标记
    e.dismissHero("caopi");
    expect(e.players[0].heroes).toHaveLength(0);
    armHero(e, 0, "caopi", ["fangzhu"]); // 再授=全新槽位
    expect(skillMarksOf(fangzhuSlot(e), "fangzhu")).toBe(0);
    expect(e.pendingSkillChoices).toHaveLength(0);
  });

  it("放逐待决时保留曹丕的麾下槽位直到应答", () => {
    const e = makeEngine();
    finishSetupLite(e);
    armPhase(e, { activeIndex: 0 });
    armHero(e, 0, "caopi", ["fangzhu"]);
    setStamina(e, 0, 30);

    e.submitCommand({ type: "dismissHero", heroId: "caopi" });
    e.submitCommand({ type: "respondSkillChoice", seat: 0, use: true, targetSeat: 1 });
    expect(e.players[1].skipTurns).toBe(1);
    expect(skillMarksOf(fangzhuSlot(e), "fangzhu")).toBe(0);

    e.submitCommand({ type: "dismissHero", heroId: "caopi" });
    expect(e.players[0].heroes).toHaveLength(0);
  });
});

describe("行殇(#1377 AC4):耗竭可选 +1,缓兵之计不触发", () => {
  it("耗竭(基值 2)挂问;发动后休整 2→3,期满回满顺延", () => {
    const e = makeEngine();
    finishSetupLite(e);
    armPhase(e, { activeIndex: 0 });
    armHero(e, 1, "caopi", ["xingshang"]);
    expect(e.damageStamina(0, 100, null)).toBe(0);
    expect(e.players[0].skipTurns).toBe(2);
    expect(e.pendingSkillChoices).toEqual([
      { skillId: "xingshang", heroId: "caopi", ownerSeat: 1, subjectSeat: 0, targetSeat: 0 },
    ]);
    expect(e.turnPhase).toBe("AwaitingSkillChoice");
    expect(e.decisionOwner).toBe(1);
    e.respondSkillChoice(1, true); // 发动:目标=被跳者(载荷既定,免选人)
    expect(e.players[0].skipTurns).toBe(3);
    expect(e.activeIndex).toBe(1);
    expect(e.turnPhase).toBe("AwaitingJinnang");
    // 消费三段跳,期满才回满(2 会提前回满——+1 顺延了休整)
    e.endTurn(); // 座位 0 跳 1(3→2)
    expect(e.players[0].stamina).toBe(0);
    e.endTurn(); // 跳 2(2→1)
    expect(e.players[0].stamina).toBe(0);
    e.endTurn(); // 跳 3(1→0):期满回满
    expect(e.players[0].resting).toBe(false);
    expect(e.players[0].stamina).toBe(100);
  });

  it("放弃=休整保持基值 2", () => {
    const e = makeEngine();
    finishSetupLite(e);
    armPhase(e, { activeIndex: 0 });
    armHero(e, 1, "caopi", ["xingshang"]);
    e.damageStamina(0, 100, null);
    e.respondSkillChoice(1, false);
    expect(e.players[0].skipTurns).toBe(2);
  });

  it("原因过滤:缓兵之计(jinnang)与行殇本笔(xingshang)的被跳不挂问,只认耗竭", () => {
    const e = makeEngine();
    finishSetupLite(e);
    armHero(e, 1, "caopi", ["xingshang"]);
    e.dispatchMoment("TurnSkipImposed", { subject: 0, reason: "jinnang" }); // 缓兵之计写点同因
    expect(e.pendingSkillChoices).toHaveLength(0);
    e.dispatchMoment("TurnSkipImposed", { subject: 0, reason: "xingshang" }); // 行殇本笔(防递归)
    expect(e.pendingSkillChoices).toHaveLength(0);
  });
});

describe("韬光养晦按笔计酬(#1377 AC5):耗竭一笔+行殇一笔=两笔 +100", () => {
  it("被跳者持韬光养晦,行殇追笔同享 +100(设计联动非 bug)", () => {
    const e = makeEngine();
    finishSetupLite(e);
    armPhase(e, { activeIndex: 0 });
    armHero(e, 0, "simayi", ["taoguangyanghui"]);
    armHero(e, 1, "caopi", ["xingshang"]);
    const base = e.players[0].cash;
    e.damageStamina(0, 100, null); // 耗竭笔:TurnSkipImposed(exhaustion)→ +100
    expect(e.players[0].cash).toBe(base + 100);
    e.respondSkillChoice(1, true); // 行殇笔:TurnSkipImposed(xingshang)→ 再 +100
    expect(e.players[0].cash).toBe(base + 200);
    expect(e.players[0].skipTurns).toBe(3);
  });
});

describe("快照序列化(#1377 AC6):标记与待决态往返,空态零扰动", () => {
  it("挂起态+标记经快照往返保真,镜像端可继续应答", () => {
    const e = makeEngine3();
    finishSetupLite(e);
    armPhase(e, { activeIndex: 0 }); // 布景:座位 0 活跃(同 AC2,罚座位 2 落账可观察)
    armHero(e, 0, "caopi", ["fangzhu"]);
    setStamina(e, 0, 30); // 70 标记:挂待决
    const mirror = makeEngine3(1); // 种子无关:恢复覆盖 rngState
    mirror.restoreFromSnapshot(JSON.parse(JSON.stringify(e.snapshot())));
    expect(mirror.turnPhase).toBe("AwaitingSkillChoice");
    expect(mirror.pendingSkillChoices).toEqual(e.pendingSkillChoices);
    expect(skillMarksOf(heroSlotOf(mirror.players[0], "caopi"), "fangzhu")).toBe(70);
    mirror.respondSkillChoice(0, true, 2);
    expect(mirror.players[2].skipTurns).toBe(1);
    expect(skillMarksOf(heroSlotOf(mirror.players[0], "caopi"), "fangzhu")).toBe(0);
    expect(mirror.turnPhase).toBe("Roll");
  });

  it("空态不产键:无待决对局的快照无 pendingSkillChoices 键(摘要指纹零扰动口径)", () => {
    const e = makeEngine();
    finishSetupLite(e);
    const json = JSON.stringify(e.snapshot());
    expect(json.includes("pendingSkillChoices")).toBe(false);
    expect(json.includes('"marks"')).toBe(false); // 无标记槽位同样不产键
  });

  it("空容器往返后仍可写标记:恢复恒置空表(评审修复,不修必挂——原实现恢复后槽无 marks 字段,挨打即炸)", () => {
    const e = makeEngine3();
    finishSetupLite(e);
    armPhase(e, { activeIndex: 0 });
    armHero(e, 0, "caopi", ["fangzhu"]); // 空标记容器入槽(写侧不产键)
    const mirror = makeEngine3(1); // 种子无关:恢复覆盖 rngState
    mirror.restoreFromSnapshot(JSON.parse(JSON.stringify(e.snapshot())));
    const slot = heroSlotOf(mirror.players[0], "caopi");
    expect(slot.marks).toEqual({}); // 三路标记感知构造的第三路:恢复不裸奔
    setStamina(mirror, 0, 90); // 挨打 10:写标记不炸
    expect(skillMarksOf(slot, "fangzhu")).toBe(10);
    expect(mirror.pendingSkillChoices.length).toBe(0); // 10 < 60 不挂待决
  });
});

describe("bot 两策略(#1377 AC7):行殇恒发,放逐满发目标=身价领跑者", () => {
  it("bot 行殇恒发动:开窗下一泵 botAct 即应答,休整 2→3", () => {
    const e = makeEngine();
    finishSetupLite(e);
    armPhase(e, { activeIndex: 0 });
    setBot(e, 1, true);
    armHero(e, 1, "caopi", ["xingshang"]);
    e.damageStamina(0, 100, null);
    expect(e.turnPhase).toBe("AwaitingSkillChoice");
    botAct(e); // 驱动器泵(bot/托管同口)
    expect(e.players[0].skipTurns).toBe(3); // 恒发动
    expect(e.activeIndex).toBe(1);
    expect(e.turnPhase).toBe("AwaitingJinnang");
  });

  it("bot 放逐:满发,目标=净身价领跑者;无合法目标才放弃", () => {
    const e = makeEngine();
    finishSetupLite(e);
    setBot(e, 1, true);
    armHero(e, 1, "caopi", ["fangzhu"]);
    setCash(e, 0, 20000); // 座位 0 为身价领跑者
    setCash(e, 1, 100);
    setStamina(e, 1, 30); // bot 损失 70:攒满挂问
    expect(e.turnPhase).toBe("AwaitingSkillChoice");
    // 决策单源直测:目标=领跑者座位 0
    expect(botSkillChoiceDecision(e, 1)).toEqual({ use: true, targetSeat: 0 });
    botAct(e);
    expect(e.players[0].skipTurns).toBe(1);
    expect(skillMarksOf(heroSlotOf(e.players[1], "caopi"), "fangzhu")).toBe(0);
  });

  it("bot 放逐无合法目标时放弃，保留标记", () => {
    const e = makeEngine();
    finishSetupLite(e);
    setBot(e, 1, true);
    armHero(e, 1, "caopi", ["fangzhu"]);
    e.players[0].isBankrupt = true; // 唯一他座出局(种植件语义:纯布景印)
    setStamina(e, 1, 30);
    expect(e.turnPhase).toBe("AwaitingSkillChoice");
    expect(botSkillChoiceDecision(e, 1)).toEqual({ use: false });
    botAct(e);
    expect(e.turnPhase).toBe("Roll");
    expect(skillMarksOf(heroSlotOf(e.players[1], "caopi"), "fangzhu")).toBe(70);
  });
});
