import type { GameEngine, TurnPhase } from "./authority";
import { openSkillChoice, type PendingSkillChoice } from "./choices";
import { EFFECTS } from "./effects";
import {
  resumeEncounterStamina,
  resumeExhaustion,
  resumeStaminaDamage,
  type EncounterStaminaContinuation,
  type ExhaustionContinuation,
  type StaminaDamageContinuation,
} from "./encounter-flow";
import { emitGameEvent, noteMomentEvent } from "./game-events";
import { heroById } from "./heroes";
import type { HeroSlot } from "./roster";
import { isTriggerSkill, skillById, type TriggerSkill } from "./skills";
import { MOMENT_STAGES, type GameMoment, type MomentCtx, type MomentStage } from "./timing";
import { resumeTurnEnd, type TurnEndContinuation } from "./turn-end";

export type MomentContinuation =
  | EncounterStaminaContinuation
  | ExhaustionContinuation
  | StaminaDamageContinuation
  | TurnEndContinuation
  | { kind: "staminaUpdated" };

interface MomentSkill {
  ownerSeat: number;
  slotIndex: number;
  heroId: string;
  skillId: string;
}

/** 保存已排好阶段顺序的技能及下一项游标。应答期间的效果不会改变原时机的顺序。 */
export interface PendingMoment {
  moment: GameMoment;
  ctx: MomentCtx;
  turnPhase: TurnPhase;
  skills: MomentSkill[];
  nextSkillIndex: number;
  continuation: MomentContinuation;
}

/** 座位序 × 麾下槽位序 × 槽内已授技序，各阶段独立沿用同一顺序。 */
function skillsForMoment(g: GameEngine, moment: GameMoment): MomentSkill[] {
  const stages: Record<MomentStage, MomentSkill[]> = { before: [], during: [], after: [] };
  for (let ownerSeat = 0; ownerSeat < g.players.length; ownerSeat++) {
    const owner = g.players[ownerSeat];
    if (owner.isBankrupt) continue;
    for (const [slotIndex, slot] of owner.heroes.entries()) {
      for (const skillId of slot.skillIds) {
        const skill = skillById(skillId);
        if (!isTriggerSkill(skill) || skill.when !== moment) continue;
        stages[skill.stage].push({ ownerSeat, slotIndex, heroId: slot.heroId, skillId });
      }
    }
  }
  return MOMENT_STAGES.flatMap((stage) => stages[stage]);
}

export function startMoment(
  g: GameEngine,
  moment: GameMoment,
  ctx: MomentCtx,
  continuation?: MomentContinuation,
): void {
  const skills = skillsForMoment(g, moment);
  runMoment(g, moment, ctx, skills, 0, continuation);
}

export function resumePendingMoment(g: GameEngine): void {
  const pending = g.pendingMoment;
  if (pending == null) throw new Error("时机续接缺少待决状态");
  const { moment, ctx, turnPhase, skills, nextSkillIndex, continuation } = pending;
  g.pendingMoment = null;
  g.turnPhase = turnPhase;
  if (runMoment(g, moment, ctx, skills, nextSkillIndex, continuation) === "suspended") return;
  switch (continuation.kind) {
    case "encounterStamina":
      resumeEncounterStamina(g, ctx, continuation);
      break;
    case "exhaustion":
      resumeExhaustion(g, ctx.subject, continuation);
      break;
    case "staminaDamage":
      resumeStaminaDamage(g, ctx, continuation);
      break;
    case "staminaUpdated":
      break;
    case "turnEnd":
    case "roundEnd":
    case "cityIncome":
      resumeTurnEnd(g, continuation);
      break;
  }
}

function runMoment(
  g: GameEngine,
  moment: GameMoment,
  ctx: MomentCtx,
  skills: MomentSkill[],
  from: number,
  continuation?: MomentContinuation,
): "settled" | "suspended" {
  if (g.momentDispatchDepth >= 2) throw new Error(`时机派发嵌套超过 2 层(${moment})`);
  g.momentDispatchDepth += 1;
  try {
    if (from === 0) noteMomentEvent(g, moment, ctx);
    for (let i = from; i < skills.length; i++) {
      const choice = fireMomentSkill(g, moment, ctx, skills[i]);
      if (choice != null) {
        if (continuation == null) throw new Error(`时机 ${moment} 的待决选择缺少续接操作`);
        if (g.pendingMoment != null) throw new Error(`时机 ${moment} 内已有待决时机`);
        g.pendingMoment = {
          moment,
          ctx,
          turnPhase: g.turnPhase,
          skills,
          nextSkillIndex: i + 1,
          continuation,
        };
        openSkillChoice(g, choice);
        return "suspended";
      }
    }
    return "settled";
  } finally {
    g.momentDispatchDepth -= 1;
  }
}

function fireMomentSkill(
  g: GameEngine,
  moment: GameMoment,
  ctx: MomentCtx,
  entry: MomentSkill,
): PendingSkillChoice | undefined {
  const { ownerSeat, heroId, skillId } = entry;
  const owner = g.players[ownerSeat];
  // 等待应答时遣散其他名将会移动原槽位。
  const originalSlot = owner.heroes[entry.slotIndex];
  const slot =
    originalSlot?.heroId === heroId
      ? originalSlot
      : owner.heroes.find((candidate) => candidate.heroId === heroId);
  if (owner.isBankrupt || slot == null || !slot.skillIds.includes(skillId)) return;
  const skill = skillById(skillId);
  if (!isTriggerSkill(skill)) throw new Error(`时机 ${moment} 的技能 ${skillId} 不是触发技`);
  if (!scopePasses(g, skill.scope, ctx.subject, ownerSeat) || !skillReady(g, slot, skill)) return;

  const effect = EFFECTS[skill.effect];
  if (effect == null)
    throw new Error(`未知效果 EffectId "${skill.effect}"(技能 ${skillId}):注册表查不到=数据 bug`);
  const canOfferChoice = "choiceMoment" in effect;
  if (canOfferChoice && effect.choiceMoment !== moment)
    throw new Error(`待决效果 ${skill.effect} 只允许时机 ${effect.choiceMoment}，收到 ${moment}`);
  const params = skill.params ?? {};
  const fired = effect(
    g,
    { ...ctx, moment, owner: ownerSeat, skillId, slotHeroId: heroId },
    params,
  );
  if (!canOfferChoice && typeof fired !== "boolean")
    throw new Error(`同步效果 ${skill.effect} 须返回布尔值`);
  if (fired === false) return;
  slot.lastFired[skillId] = g.round;
  emitGameEvent(g, ownerSeat, { kind: "skillFired", heroId, skillId, moment });
  g.logEvent(
    "skill",
    owner.guohao,
    `${owner.guohao} 名将「${heroById(heroId).name}」触发时机 ${moment}`,
    `skillFire owner=${owner.id} hero=${heroId} skill=${skillId} moment=${moment} subject=${g.players[ctx.subject].id} die=${ctx.die ?? "-"} amount=${ctx.amount ?? "-"} params=${JSON.stringify(params)}`,
  );
  return fired === true ? undefined : fired;
}

function scopePasses(
  g: GameEngine,
  scope: TriggerSkill["scope"],
  subject: number,
  ownerSeat: number,
): boolean {
  switch (scope ?? "self") {
    case "self":
      return ownerSeat === subject;
    case "others":
      return ownerSeat !== subject;
    case "actor":
      return subject === g.activeIndex;
    case "any":
      return true;
  }
}

function skillReady(g: GameEngine, slot: HeroSlot, skill: TriggerSkill): boolean {
  if (!skill.cooldown) return true;
  const last = slot.lastFired[skill.id] ?? -Infinity;
  return g.round - last >= skill.cooldown;
}
