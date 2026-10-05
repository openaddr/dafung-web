// 示例名将包全链单测(#378,ADR-0022 验收样例 extensions/hero-taishici):
//  1. 经真实装载通路(loadExtensionPackages)注册后,招贤三选一可选到太史慈;
//  2. 事件序列断言:resolveHeroPick 一批内 heroRecruited → cashChanged(skill 落账)
//     → skillFired(义从击发)——自定义效果 joinGift 经引擎公共方法结算(+100 两);
//  3. 主动技「破阵」:军师幕选项可见、发动后 heroDiceBonus=1、heroSkillActivated 随批产出。
// 引擎布场模式复制 test/hero-skill.test.ts(makeEngine/finishSetup,不 import 测试文件);
// 装载的全局注册态在 afterAll 精确卸载,不向同进程其他测试文件泄漏。
import { describe, it, expect, afterAll } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { HEROES } from "@core/heroes";
import { loadExtensionPackages } from "@core/extension-loader";
import { unregisterExtensionPackage } from "@core/extension-registry";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
import { resolve } from "node:path";

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

// ── 装载示例包(真实 fs 通路;afterAll 卸载防泄漏)──
const loaded = await loadExtensionPackages(resolve(import.meta.dir, "../extensions"));
expect(loaded.map((m) => m.id)).toContain("hero-taishici");
afterAll(() => unregisterExtensionPackage("hero-taishici"));

const taishiciDef = HEROES.find((h) => h.id === "taishici");
if (taishiciDef == null) throw new Error("示例包装载后名将池无 taishici(装载 bug)");

describe("示例名将包·太史慈(#378 全链)", () => {
  it("招贤三选一可选到太史慈;义从随招揽击发:+100 两(事件序 heroRecruited→cashChanged→skillFired)", () => {
    const e = prepared();
    // 种植候选 = 示例包名将(注册面进 HEROES 后,候选对象即真定义,技能随对象入麾下)
    e.offeredHeroes = [taishiciDef!];
    e.turnPhase = "AwaitingHeroPick";
    const p = e.activePlayer;
    const cashBefore = p.cash;
    e.submitCommand({ type: "resolveHeroPick", index: 0 }); // submitCommand 开独立事件批
    expect(p.heroes.map((h) => h.id)).toContain("taishici");
    expect(p.cash).toBe(cashBefore + 100);
    // 事件序列:招贤宣告 → 技能落账(+100)→ 击发宣告(义从,HeroRecruited 时机)
    const kinds = e.gameEvents.map((ev) => ev.kind);
    const recruitedIdx = kinds.indexOf("heroRecruited");
    const cashIdx = kinds.indexOf("cashChanged");
    const firedIdx = kinds.indexOf("skillFired");
    expect(recruitedIdx).toBeGreaterThanOrEqual(0);
    expect(cashIdx).toBeGreaterThan(recruitedIdx); // 落账在招贤宣告之后(效果先执行)
    expect(firedIdx).toBeGreaterThan(cashIdx); // 击发宣告在落账之后(派发器后宣告)
    const recruited = e.gameEvents[recruitedIdx]!;
    const cash = e.gameEvents[cashIdx]!;
    const fired = e.gameEvents[firedIdx]!;
    if (
      recruited.kind !== "heroRecruited" ||
      cash.kind !== "cashChanged" ||
      fired.kind !== "skillFired"
    )
      throw new Error("事件类型漂移(断言锚失真)");
    expect(recruited.heroId).toBe("taishici");
    expect(cash.delta).toBe(100);
    expect(cash.reason).toBe("skill");
    expect(fired.skillId).toBe("taishici-yicong");
    expect(fired.heroId).toBe("taishici");
    // 冷却记账(键=skill.id)与义从参数表一致
    expect(p.heroLastFired["taishici-yicong"]).toBe(e.round);
  });

  it("主动技「破阵」:军师幕选项可见,发动后本回合步数 +1,heroSkillActivated 随批产出", () => {
    const e = prepared();
    const p = e.activePlayer;
    p.heroes.push(taishiciDef!);
    p.jinnangHand = [];
    p.jinnangHandCount = 0;
    e.turnPhase = "AwaitingJinnang";
    // 选项面:扩展开注册面进 choices(选项 id=skill:<主动技 id>)
    const opt = e.choicesFor().find((o) => o.id === "skill:taishici-pozhen");
    expect(opt?.available).toBe(true);
    // 发动(命令通路,独立事件批):warDrum 结算案复用 → 步数加成挂账
    e.submitCommand({ type: "useHeroSkill", skillId: "taishici-pozhen" });
    expect(e.heroDiceBonus).toBe(1);
    expect(p.heroLastFired["taishici-pozhen"]).toBe(e.round);
    const activated = e.gameEvents.find(
      (ev): ev is Extract<typeof ev, { kind: "heroSkillActivated" }> =>
        ev.kind === "heroSkillActivated",
    );
    expect(activated?.skillId).toBe("taishici-pozhen");
    expect(activated?.skillKind).toBe("warDrum");
  });
});
