// 名将卡面组件(#360,spec #357 T3):武将卡归一单源——招贤三选一/军师幕确认/
// 府库详情同一组件两档装配,全游戏一张名将卡面。视觉基线 proto/treasure/r5.html
// 节三(r4 形制 + 五轮被动技名):满幅立绘打底(stage)+ 右侧竖排名(m-name,
// 毛笔大字漆金带)+ 右上称号竖排纸签(m-title)+ 左上朱砂「将」章(j-seal)+
// 底部半透明纸底技能区(skz)。
//
// 器物豁免类(同 JinnangCardFace 口径):纯展示零交互状态、不套 shadcn;交互语义
// (选中/确认/点击)全部归消费方,testid/aria/title 经 ...rest 挂根,本组件不持有。
// 选中/灰置交互态(sel 上浮金描边 / off 下沉置灰 / .reason 原因印条)复用
// jinnang-card.css 的牌面交互态单源(选择器同批覆盖 .hface),本文件不另写一份。
//
// 数据单源:core/heroes.ts HEROES——组件按 heroId 回查目录(同 JinnangCardFace 的
// jinnangCardOf 口径);技名渲染走 TriggerSkill.name(#358 T1)+ ActiveSkillDef.name,
// 主动加「冷却 N 轮」。目录外 id 直接抛错(零兜底:目录外名将不允许存在)。
// 画像缺失(image="")或加载失败:显式「像」占位(现行 onError 语言,可感知不静默;
// 空 src 浏览器不发请求、不触发 onError,必须一并判——华佗 image:"" 实拍翻车教训)。
//
// 尺寸:卡基 --u 锚定(absolute 定位元素一律 calc(N * var(--u)),不落 em——em 解析
// 到自身字号,r4 原型同法);档默认 detail 13px / compact 10px / pick 7.6px,消费方
// 经 --hface-base 覆写(手牌架随架体 em 基注入,见 hand-rack.css / layout.css)。
import { useState, type HTMLAttributes } from "react";
import { HEROES, type HeroDef } from "@core/heroes";
import { extensionHeroFlagOf } from "@app/extensions/registry";
import "./hero-card.css";

/** 按名将 id 查目录(目录外 id = 数据 bug,抛错不兜底)。 */
export function heroDefOf(heroId: string): HeroDef {
  const def = HEROES.find((h) => h.id === heroId);
  if (!def) throw new Error(`名将目录外 id:${heroId}(core/heroes.ts HEROES 无此 id)`);
  return def;
}

/** 按主动技 id 反查名将 id(军师窗态技卡消费:choices 选项只带 skillId)。 */
export function heroIdByActiveSkillId(skillId: string): string {
  const hero = HEROES.find((h) => h.active?.id === skillId);
  if (!hero) throw new Error(`主动技不在名将目录:${skillId}`);
  return hero.id;
}

/** 装配/尺寸档(r4 节三两档 + 招贤同槽位档):
 *  - detail:技能全文(技名牌+desc 全文,13px 基)——府库详情档;
 *  - compact:技名 chips + desc 两行截断(10px 基)——军师幕确认;
 *  - pick:紧凑装配的招贤档(7.6px 基,与手牌槽位同档)——招贤三选一并排。 */
export type HeroCardFaceSize = "detail" | "compact" | "pick";

export interface HeroCardFaceProps extends HTMLAttributes<HTMLDivElement> {
  heroId: string;
  size?: HeroCardFaceSize;
}

/** 满幅画像位:object-cover 裁满立绘区;空路径/加载失败显「像」占位(显式不静默)。 */
function Lihui({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !src) {
    return (
      <div className="lihui is-ph">
        <span className="ph-xiang" aria-hidden="true">
          像
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

/** 详情档技能区:●被动(TriggerSkill.name + 名将 desc 全文)/ ◆主动(ActiveSkillDef
 *  .name + 「冷却 N 轮」+ desc 全文),行间虚线分隔。 */
function SkillRows({ def }: { def: HeroDef }) {
  return (
    <>
      {(def.skills ?? []).map((s) => (
        <div className="sk" key={s.id}>
          <div className="shead">
            <i className="fu fu-dot" aria-hidden="true" />
            <span className="sming">{s.name}</span>
          </div>
          <div className="sdesc">{def.desc}</div>
        </div>
      ))}
      {def.active && (
        <div className="sk">
          <div className="shead">
            <i className="fu fu-dia" aria-hidden="true" />
            <span className="sming">{def.active.name}</span>
            <span className="cd">冷却 {def.active.cooldown} 轮</span>
          </div>
          <div className="sdesc">{def.active.desc}</div>
        </div>
      )}
    </>
  );
}

/** 紧凑档技能区:●/◆ 技名 chips 一行 + 名将 desc 两行截断(全文留 title 浮签,
 *  消费方口径)。 */
function SkillChips({ def }: { def: HeroDef }) {
  return (
    <>
      <div className="bd-row">
        {(def.skills ?? []).map((s) => (
          <span className="bd" key={s.id}>
            <i className="fu fu-dot" aria-hidden="true" />
            {s.name}
          </span>
        ))}
        {def.active && (
          <span className="bd">
            <i className="fu fu-dia" aria-hidden="true" />
            {def.active.name}
          </span>
        )}
      </div>
      <div className="sdesc">{def.desc}</div>
    </>
  );
}

/** 名将卡面:立绘/名带/称号签/将章/技能区五件套,两档同源换装配。
 *  children 透传到卡面末尾——不可用态的原因印条(<span className="reason">,
 *  样式见 jinnang-card.css)由消费方这样挂入(同 JinnangCardFace 口径)。 */
export function HeroCardFace({
  heroId,
  size = "detail",
  className,
  children,
  ...rest
}: HeroCardFaceProps) {
  const def = heroDefOf(heroId);
  const flag = extensionHeroFlagOf(heroId); // 扩展将旗(#378 渲染 hook):null = 无旗,卡面维持现状
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
      <div className="stage">
        <Lihui src={def.image} name={def.name} />
        <div className="veil" aria-hidden="true" />
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
      </div>
      <div className="skz">
        {size === "detail" ? <SkillRows def={def} /> : <SkillChips def={def} />}
      </div>
      {children}
    </div>
  );
}
