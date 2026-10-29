// 收口边界事务性(#649):endTurn 入口先拨离 Awaiting* 相位,再进延期问询排空与 TurnEnd
// 时机派发两个同步抛错点。守住什么——域收口范式「清载荷 → endTurn」(宝物交涉 skip /
// 招贤选定,三相位同构)遇入口同步抛错时,引擎不得滞留「已清载荷未拨相位」失配态
// (#640 病灶态的结构性残余,驱动链下一拍连环崩=无声软锁);异常必须照炸(零兜底)。
// 附(#649 附带项):bot 对 AwaitingHeroPick「相位挂着、载荷已空」失配态当场炸,不静默驱过。
import { describe, it, expect, afterEach } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig, TurnPhase } from "@core/authority";
import { createDice } from "@core/dice";
import { botAct } from "@core/bot";
import type { HeroDef } from "@core/heroes";
import { SKILLS, type TriggerSkill } from "@core/skills";
import {
  registerExtensionAuthorityModule,
  unregisterExtensionPackage,
} from "@core/extension-registry";
import type { ExtensionAuthorityModule } from "@core/extension-contract";
import type { ChoiceOption } from "@core/choices";
import { armHero, sweepTestHeroes } from "@core/testing";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(huanyouData);

const SEATS2: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: true },
];

function makeEngine(seed = 42, seats: SeatConfig[] = SEATS2): GameEngine {
  const cfg: EngineConfig = { seats, targetNetWorth: 30000 };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

/** 开好局并清掉开局锦囊卷轴,回到常规相位(范式同 hero-skill/extension-inquiry 测试)。 */
function prepared(seed?: number, seats?: SeatConfig[]) {
  const e = makeEngine(seed, seats);
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
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return e;
}

/** 相位读经函数取值:破除 TS 对 e.turnPhase 的赋值字面量收窄(收窄后 toBe 只收窄字面型)。 */
const phaseOf = (e: GameEngine): TurnPhase => e.turnPhase;

/** 挂一枚 TurnEnd 时机坏技(效果 id 查无注册,派发时当场炸)的名将给座位 0。
 *  坏技先注册进技表(ADR-0036:池引用必须可解析),afterEach 精确清退。 */
const injectedSkills: TriggerSkill[] = [];
afterEach(() => {
  while (injectedSkills.length > 0) {
    const s = injectedSkills.pop()!;
    const idx = SKILLS.indexOf(s);
    if (idx < 0) throw new Error(`测试技 ${s.id} 不在注册表(状态机 bug)`);
    SKILLS.splice(idx, 1);
  }
  sweepTestHeroes(); // 麾下布场的合成名将同步清退(#785 armHero 配对)
});

function armBrokenTurnEndSkill(e: GameEngine): void {
  const skill: TriggerSkill = {
    id: "test-shoukou-boom-skill",
    name: "收口爆",
    desc: "TurnEnd 派发即炸(未知效果 id,测试注入)",
    when: "TurnEnd",
    effect: "no-such-effect",
    scope: "any",
  };
  SKILLS.push(skill);
  injectedSkills.push(skill);
  const hero: HeroDef = {
    id: "test-shoukou-boom",
    name: "测试·收口爆",
    title: "测试",
    image: "",
    skillPool: [skill.id],
  };
  armHero(e, e.players[0], hero); // 合成将登记+入麾下(#785 槽位布场)
}

// ── 假问询包(排空向量注入:唯一可选项自动执行路,resolve 回调抛错;随机唯一 id 防跨文件冲突)──
const seq = Math.random().toString(36).slice(2, 8);
const INQUIRY_ID = `test-boom-inquiry-${seq}`;
const PKG_ID = `test-boom-pkg-${seq}`;

function registerBoomInquiry(): void {
  const mod: ExtensionAuthorityModule = {
    manifest: { id: PKG_ID, name: "炸问询包", version: "0.0.1", entry: "index.js" },
    inquiries: [
      {
        id: INQUIRY_ID,
        askPlayer: (): ChoiceOption[] => [{ id: "only", label: "唯一项", available: true }],
        resolve: () => {
          throw new Error("排空开窗自动执行:resolve 回调炸(测试注入)");
        },
      },
    ],
  };
  registerExtensionAuthorityModule(mod);
}

const loadedPkgs: string[] = [];
afterEach(() => {
  while (loadedPkgs.length > 0) unregisterExtensionPackage(loadedPkgs.pop()!);
});

describe("endTurn 收口边界事务性(#649)", () => {
  it("宝物交涉 skip 收口遇 TurnEnd 派发抛错:异常照炸,相位已拨 EndTurn,不滞留「已清载荷未拨相位」失配态", () => {
    const e = prepared();
    armBrokenTurnEndSkill(e);
    const mover = e.activePlayer;
    const plain = e.board.tiles.findIndex((t) => t.type !== "TreasureCity"); // 落普通格:交涉终端=直 endTurn
    mover.position = plain;
    e.treasureVisitor = { def: MAP.properties[0]!, ownerIdx: e.activeIndex };
    e.turnPhase = "AwaitingTreasureOwner";
    expect(() => e.resolveTreasureOwner({ type: "skip" })).toThrow(/未知效果/);
    expect(e.treasureVisitor).toBeNull(); // 载荷已清(域收口范式原样发生)
    expect(phaseOf(e)).toBe("EndTurn"); // 相位已离场:任一 Awaiting* 均不滞留
  });

  it("入口排空延期问询遇回调抛错:异常照炸,相位已拨 EndTurn,不滞留失配态", () => {
    const e = prepared();
    registerBoomInquiry();
    loadedPkgs.push(PKG_ID);
    // 病灶态布场 = 域收口「清载荷后调 endTurn」一刻:相位挂着、载荷已空,延期队列待排空
    e.treasureVisitor = null;
    e.turnPhase = "AwaitingTreasureOwner";
    e.deferredInquiries.push({ id: INQUIRY_ID, params: {} });
    expect(() => e.endTurn()).toThrow(/resolve 回调炸/);
    expect(phaseOf(e)).toBe("EndTurn");
  });

  it("bot 遇 AwaitingHeroPick 空候选失配态:当场炸,不静默驱过(#649 附带项)", () => {
    const e = prepared();
    e.offeredHeroes = [];
    e.turnPhase = "AwaitingHeroPick";
    expect(() => botAct(e)).toThrow(/状态机不一致/);
    expect(e.turnPhase).toBe("AwaitingHeroPick"); // 炸在读取点,失配态原地暴露
  });
});
