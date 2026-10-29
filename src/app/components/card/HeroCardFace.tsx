// 名将卡面组件(#360,spec #357 T3;#511 卡面 B 案改制):武将卡归一单源——招贤
// 三选一/出牌阶段确认/府库详情同一组件两档装配,全游戏一张名将卡面。视觉基线
// proto/treasure/r4.html 节三 → #511 B 案「墨面金框」制式:宣纸纸底 + 金框双线画心
// (立绘 img 只进画心,object-cover 裁满)+ 漆金牌名带(m-name)+ 右上称号竖排纸签
// (m-title)+ 左上朱砂「将」章(j-seal)+ 技角标(j-badge,技数)+ 底部技能区(skz)。
// 缺图回退 = 姓氏朱印(#511 票面口径,白纸画心空底+朱印姓字,显式不静默)。
//
// 器物豁免类(同 JinnangCardFace 口径):纯展示零交互状态、不套 shadcn;交互语义
// (选中/确认/点击)全部归消费方,testid/aria/title 经 ...rest 挂根,本组件不持有。
// 选中/灰置交互态(sel 上浮金描边 / off 下沉置灰 / .reason 原因印条)复用
// jinnang-card.css 的牌面交互态单源(选择器同批覆盖 .hface),本文件不另写一份。
//
// 数据单源:core/heroes.ts HEROES(名将)+ core/skills.ts SKILLS(技表,ADR-0036)——
// 组件按 heroId 回查目录(同 JinnangCardFace 的 jinnangCardOf 口径)。双输入 contract
// (#786):heroId(将定义:立绘/名带/称号)+ skillIds(已授技 id 列表,槽位 skillIds /
// 招贤候选的全池)——技能区只渲染实授技,技对象与技效文案按 id 读技表单源(skills.ts,
// 池序由上游保证:槽位 skillIds 按池声明序存,候选=全池原序)。技 id 查无=数据 bug
// 直接抛错(零兜底:目录外名将/技表外技不允许存在)。
// 画像缺失(image="")或加载失败:显式「姓氏朱印」占位(现行 onError 语言,可感知
// 不静默;空 src 浏览器不发请求、不触发 onError,必须一并判——华佗 image:"" 实拍
// 翻车教训)。
//
// 尺寸:卡基 --u 锚定(absolute 定位元素一律 calc(N * var(--u)),不落 em——em 解析
// 到自身字号,r4 原型同法);档默认 detail 13px / compact 10px / pick 7.6px,消费方
// 经 --hface-base 覆写(手牌架随架体 em 基注入,见 hand-rack.css / layout.css)。
import { useState, type HTMLAttributes } from "react";
import { HEROES, type HeroDef } from "@core/heroes";
import { isActiveSkill, skillById } from "@core/skills";
import { extensionHeroFlagOf } from "@app/extensions/registry";
import "./hero-card.css";

/** 按名将 id 查目录(目录外 id = 数据 bug,抛错不兜底)。 */
export function heroDefOf(heroId: string): HeroDef {
  const def = HEROES.find((h) => h.id === heroId);
  if (!def) throw new Error(`名将目录外 id:${heroId}(core/heroes.ts HEROES 无此 id)`);
  return def;
}

/** 装配/尺寸档(r4 节三两档 + 招贤同槽位档):
 *  - detail:技能全文(技名牌+该技 desc 全文,13px 基)——府库详情档;
 *  - compact:技名 chips 不带描述(10px 基)——出牌阶段确认;点技名开技能全览(#605);
 *  - pick:紧凑装配的招贤档(7.6px 基,与手牌槽位同档)——招贤三选一并排,分流同 #605。 */
export type HeroCardFaceSize = "detail" | "compact" | "pick";

/** 技名 chip 点击判定(#605 消费方分流单源):事件目标落在卡面技名 chip 上则返回
 *  技 id,否则 null。chips 挂 data-skill=技 id(本组件渲染),点谁/开合语义归消费方。 */
export function skillIdFromClick(e: { target: EventTarget | null }): string | null {
  const chip = (e.target as HTMLElement | null)?.closest("[data-skill]");
  return chip?.getAttribute("data-skill") ?? null;
}

export interface HeroCardFaceProps extends HTMLAttributes<HTMLDivElement> {
  heroId: string;
  /** 已授技 id 列表(双输入第二输入,#786):技能区只渲染这份——槽位原生读
   *  (SnapshotPlayer.heroes[].skillIds)或招贤候选的全池;顺序即渲染序(池序由
   *  上游保证)。技对象按 id 读技表单源,查无当场炸(零兜底)。 */
  skillIds: string[];
  size?: HeroCardFaceSize;
}

/** 金框画心立绘位(#511 B 案):object-cover 裁满画心;空路径/加载失败显「姓氏朱印」
 *  占位(#511 票面口径,显式不静默)。 */
function Lihui({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !src) {
    return (
      <div className="lihui is-ph">
        <span className="ph-xiang" aria-hidden="true">
          {name.slice(0, 1)}
        </span>
        <span className="ph-hint">画像未至</span>
      </div>
    );
  }
  return (
    <div className="lihui">
      <img src={src} alt={`${name}画像`} onError={() => setFailed(true)} draggable={false} />
    </div>
  );
}

/** 详情档技能区(实授技逐条,#786 双输入):●被动(TriggerSkill.name + 该技 desc 全文)/
 *  ◆主动(ActiveSkillDef.name + 「冷却 N 轮」+ desc 全文),行间虚线分隔。#604 desc
 *  挂技自带——多被动将逐行各印各的,不再共用名将根描述(太史慈双被动重复印字隐患就此修掉)。 */
function SkillRows({ skillIds }: { skillIds: string[] }) {
  return (
    <>
      {skillIds.map(skillById).map((s) => (
        <div className="sk" key={s.id}>
          <div className="shead">
            <i className={isActiveSkill(s) ? "fu fu-dia" : "fu fu-dot"} aria-hidden="true" />
            <span className="sming">{s.name}</span>
            {isActiveSkill(s) && <span className="cd">冷却 {s.cooldown} 轮</span>}
          </div>
          <div className="sdesc">{s.desc}</div>
        </div>
      ))}
    </>
  );
}

/** 紧凑档技能区(#605):●/◆ 技名 chips 一行(实授技,#786),描述全撤——技效全文走
 *  「点技名→技能全览弹框」。chip 挂 data-skill(技 id):卡面组件维持纯展示零交互豁免
 *  口径,点击分流归消费方(event target closest([data-skill]) 判定,出牌技卡/招贤卡同款)。 */
function SkillChips({ skillIds }: { skillIds: string[] }) {
  return (
    <div className="bd-row">
      {skillIds.map(skillById).map((s) => (
        <span className="bd" key={s.id} data-skill={s.id}>
          <i className={isActiveSkill(s) ? "fu fu-dia" : "fu fu-dot"} aria-hidden="true" />
          {s.name}
        </span>
      ))}
    </div>
  );
}

/** 名将卡面:画心立绘/名带/称号签/将章/技角标/技能区六件套,两档同源换装配。
 *  双输入(#786):heroId 出将定义(立绘/名带/称号),skillIds 出实授技(技能区与
 *  技角标)——本票授技=全池,画面与拆读口前逐字节一致。
 *  children 透传到卡面末尾——不可用态的原因印条(<span className="reason">,
 *  样式见 jinnang-card.css)由消费方这样挂入(同 JinnangCardFace 口径)。 */
export function HeroCardFace({
  heroId,
  skillIds,
  size = "detail",
  className,
  children,
  ...rest
}: HeroCardFaceProps) {
  const def = heroDefOf(heroId);
  const flag = extensionHeroFlagOf(heroId); // 扩展将旗(#378 渲染 hook):null = 无旗,卡面维持现状
  const ji = skillIds.length;
  const classes = [
    "hface",
    size !== "detail" ? "compact" : "",
    size === "pick" ? "pick" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} {...rest}>
      {/* 金框画心:立绘+技角标(角标锚画心内右下角);带/签/章/旗挂卡根——画心高度
          随技能区伸缩,竖排名带若锚在画心内会因可用高度不足换列撑宽(2026-10-14
          实拍翻车:名带盖住称号签),故四件 overlay 全部以卡根为定位上下文 */}
      <div className="stage">
        <Lihui src={def.image} name={def.name} />
        {ji > 0 && (
          <span className="j-badge" aria-label={`技能 ${ji} 个`}>
            技<i>{ji}</i>
          </span>
        )}
      </div>
      <span className="j-seal" aria-hidden="true">
        将
      </span>
      <span className="m-title">{def.title}</span>
      <span className="m-name">{def.name}</span>
      {flag && (
        <img
          className="x-flag"
          data-testid={`hero-flag-${heroId}`}
          src={flag.url}
          alt={flag.alt ?? "将旗"}
          draggable={false}
        />
      )}
      <div className="skz">
        {size === "detail" ? <SkillRows skillIds={skillIds} /> : <SkillChips skillIds={skillIds} />}
      </div>
      {children}
    </div>
  );
}
