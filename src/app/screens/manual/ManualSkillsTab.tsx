// 技能签(#1072 T3,spec #1069 决议⑤):SKILLS 全量行直读列表(运行时目录实数权威,计数不落数),无详情层——
// 主动技在前、被动技在后(目录序);一行一技:技名+类型章(主动/被动)+冷却(轮)/
// 目标域小注(主动技才有的两项)+时机小注(被动技)+desc 全文+所属将名 chips
// (扫 HEROES[].skillPool 反查,多将同名技并列)。行形制参照 SkillGlossaryDialog 的
// .skg-row(本票文件集无 CSS 文件位,以 tailwind utilities 等值复刻);颜色全走
// token(禁硬编码 hex)。数据单源 core/skills.ts + core/heroes.ts,零复制。
// 时机小注用中文短名:MOMENT_LABEL 对 GameMoment 全集的 Record(编译期强制穷尽,
// 新时机漏名当场 typecheck 炸出,零兜底),条目措辞随 core/timing.ts 各时机注释。
import type { ActiveSkillDef, SkillDef } from "@core/skills";
import { SKILLS, isActiveSkill, isTriggerSkill } from "@core/skills";
import { HEROES } from "@core/heroes";
import type { GameMoment } from "@core/timing";

/** 主动技目标域中文(§4.8 最短名词;口径随 core/skills.ts ActiveSkillDef.target 注释)。 */
const ACTIVE_TARGET_LABEL: Record<ActiveSkillDef["target"], string> = {
  none: "无目标",
  other: "一名其他诸侯",
  any: "任一诸侯(含己)",
};

/** 时机中文短名(被动技小注;全集 Record,编译期穷尽)。 */
const MOMENT_LABEL: Record<GameMoment, string> = {
  // 生命周期
  GameStart: "对局开始",
  SetupComplete: "选都完成",
  GameOver: "终局判定",
  // 回合与轮
  TurnStart: "回合开始",
  TurnEnd: "回合结束",
  RoundStart: "轮首",
  RoundEnd: "轮末",
  // 掷骰与行军
  BeforeMarch: "行军前",
  BeforeRoll: "掷骰前",
  DieRolled: "掷骰后",
  AfterMarch: "行军后",
  // 落格与路径
  CapitalHalt: "驻跸",
  LandedOnProperty: "落他人城",
  PassedPlayer: "途经他人",
  MarchPassedCity: "途经城池",
  // 城池
  PropertyBought: "购城后",
  PropertyGained: "得城后",
  PropertyUpgraded: "城升级后",
  PropertyDemolished: "城受损",
  PropertyLost: "失城后",
  // 名将珍宝锦囊
  HeroRecruited: "招贤后",
  TreasureGained: "得宝后",
  TreasureSold: "售宝后",
  TreasureLost: "失宝后",
  TradeSettled: "交涉成交",
  JinnangGained: "得锦囊后",
  PeekApplied: "窥探生效",
  JinnangAnnounced: "锦囊宣布",
  // 玩家状态
  CashGained: "得银",
  CashLost: "失银",
  TurnSkipImposed: "被跳回合",
  StaminaChanged: "体力变动",
  ReputationChanged: "声望变动",
  // 破产与终局
  PlayerBankrupt: "破产出局",
  AssetsSeized: "资产被收",
  BankruptcySettle: "破产变卖",
};

/** 类型章(主动/被动):主动=漆金系(卷轴金语义),被动=淡墨系。 */
const TYPE_CLS = (active: boolean) =>
  `flex-none rounded-[3px] border px-1.5 py-px text-[11px] leading-[1.6] tracking-[0.15em] ${
    active ? "border-gold/55 text-gold" : "border-paper-dim/45 text-paper-dim"
  }`;

/** 所属将名 chip:淡墨圆角名牌(多将同名技并列)。 */
const OWNER_CLS =
  "rounded-full border border-paper/25 px-2 py-px text-[11px] leading-[1.6] text-paper-dim";

function SkillRow({ skill }: { skill: SkillDef }) {
  const active = isActiveSkill(skill);
  // 所属将反查(多将同名技并列;技目录条目皆有为将服务的条目,池外孤儿属数据 bug,
  // 由 core 侧数据守卫兜住,展示层不另设防)
  const owners = HEROES.filter((h) => h.skillPool.includes(skill.id));
  return (
    <div className="rounded-[3px] border border-transparent bg-[color-mix(in_srgb,var(--color-paper-hi)_55%,transparent)] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className={TYPE_CLS(active)}>{active ? "主动" : "被动"}</span>
        <span className="font-brush text-[15px] tracking-[0.1em] text-paper">{skill.name}</span>
        <span className="ml-auto text-[12px] text-paper-dim">
          {active
            ? `冷却 ${skill.cooldown} 轮 · ${ACTIVE_TARGET_LABEL[skill.target]}`
            : `时机 · ${MOMENT_LABEL[skill.when]}`}
        </span>
      </div>
      <div className="mt-1 text-[13px] leading-[1.7] text-paper">{skill.desc}</div>
      {owners.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {owners.map((h) => (
            <span key={h.id} className={OWNER_CLS}>
              {h.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 技能签:全量直读,无详情层(spec #1069 决议⑤)。主动在前、被动在后
 *  (各自保持技表目录序)。 */
export default function ManualSkillsTab() {
  const rows = [...SKILLS.filter(isActiveSkill), ...SKILLS.filter(isTriggerSkill)];
  return (
    <div className="mx-auto flex w-[min(720px,94%)] flex-col gap-2.5 pb-2">
      {rows.map((s) => (
        <SkillRow key={s.id} skill={s} />
      ))}
    </div>
  );
}
