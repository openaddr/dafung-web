// 令笺(#237 一期 T2):名将主动技的牌面变体——方案 §4 P0-B「技=令笺变体」,
// 视觉基线 = tmp/prototype-jinnang-ui.html 其三(.lingjian/.ji-big/.ji-emblem 形制):
// 无纹样窗、右上金底「技」章(金=技 对 朱=牌标签章,#229 技/牌区分口径)、笺头技名、
// 中段圆形徽记内放技名首字、下方属主名将与技能文案摘要。
//
// #255 收口落位:军师幕弹窗退役(#256)后唯一消费方是手牌架(HandRack 窗态令笺混排),
// 本件从 scroll/ 迁到 screens/game/ 与消费方同住(牌面族「就近」口径);差量样式
// (.jn-lingjian 作用域)同批迁入 hand-rack.css,scroll/ 的军师幕残件一并退役。
//
// 器物豁免类(同 JinnangCardFace 口径):纯展示零状态、不套 shadcn、交互语义零自写
// ——选中/确认都是消费方(HandRack 窗态手势)的普通按钮点击,本件只收 className
// (选中态 sel / 灰置态 off 挂根,复用 jinnang-card.css 的交互态)。
//
// 数据单源:文案随 choices 载荷过网(UI 不回查名将目录,与锦囊牌「牌面回查目录、
// 技能文案走载荷」的口径一致,见 HandRack 注)——hero/name/text 由调用方从
// ChoiceOption 的 skillHero / label(剥「属主·」前缀)/ skillText 取出传入。
// 徽记字 = 技名首字(原型口径);冷却不在此显示(choices 无冷却字段,#188 报缺冷却
// 只在灰置原因里,别臆造)。印字级新文案落 font-brush(小薇有空芯字形,禁 font-deco)。
import type { HTMLAttributes } from "react";

export interface JinnangLingjianProps extends HTMLAttributes<HTMLDivElement> {
  /** 属主名将名(choices.skillHero)。 */
  hero: string;
  /** 技名(choices.label 剥掉「属主·」前缀;笺头与徽记首字同源)。 */
  name: string;
  /** 技能文案摘要(choices.skillText,笺位两行截断,细则归规则页)。 */
  text: string;
}

export function JinnangLingjian({
  hero,
  name,
  text,
  className,
  children,
  ...rest
}: JinnangLingjianProps) {
  return (
    // 基座类复用 jinnang-card.css 的 .jinnang-card(纸面/尺寸/交互态/原因印条全同),
    // 差量样式(金界格线/技章/徽记/摘要区)收口在 hand-rack.css 的 .jn-lingjian 作用域。
    <div
      className={["jinnang-card", "jn-lingjian", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      <div className="tou">
        <span className="jie" />
        <span className={name.length > 3 ? "ming long" : "ming"}>{name}</span>
      </div>
      <span className="ji" aria-hidden="true">
        技
      </span>
      <div className="hui" aria-hidden="true">
        <span>{name.slice(0, 1)}</span>
      </div>
      <div className="zhai">
        <span className="zhai-hero">{hero}</span>
        <span className="jiao">{text}</span>
      </div>
      {children}
    </div>
  );
}
