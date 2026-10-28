// 属性浮签(#253 布局骨架):席位格(#698 重形)/仪表条全部图标与体力条的名词+一句话释义。
// 行为口径(原型 .proto-tip 及其内联 JS):桌面 hover 与移动端长按(400ms)同效;
// 贴右缘(浮签 240px 放不下)自动翻到图标左侧垂直居中,其余在图标下方居中。
// 交互语义全部收口 shadcn Tooltip 底件(ui/tooltip.tsx,Base UI:定位/碰撞/无障碍
// 关联白拿,不自写浮层定位);本件只补两件事:
//   ① 长按通路——useTapOrLongPress 复合手势单源(400ms,位移超容差自动取消);
//   ② 翻面判定——开签瞬间量触发元 getBoundingClientRect,右缘放不下即 side="left"。
//   ③ 开签意图闸——onFocus 只认 :focus-visible(#704):弹层关闭还焦是程序化
//      focus,不算键盘意图,照单全收会把残签复挂在触发元上吃相邻点击。
// (#361:onClick/ariaExpanded 随 expandPile 退役移除——浮签触发元回归纯展示,
// 点击无动作。#622 城池徽章局部翻案:触发元可选装回轻点通道(onTap=开名下城池
// 清单)+ aria-expanded 随弹层开合同步;不传 = 现状纯展示,珍宝/名将/声望/委任
// 徽章行为零变化。轻点/长按不打架由 useTapOrLongPress 单源保证:长按触发后吞掉
// 随后的合成 click,触屏轻点=弹层、长按=浮签并存。)
// tip 文案:结构化 { name, detail }(2026-09-25 评审去重:撤「名词|一句话」打包串的
// 渲染时 indexOf 解析),与规则页口径对齐(docs/reference/rules/)。
import { useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTitle, TooltipTrigger } from "@app/components/ui/tooltip";
import { useTapOrLongPress } from "@app/hooks/use-tap-or-long-press";
import { TESTIDS } from "./testids";

/** 触发元右缘距视口右边的预留量:浮签 max-w 240 + 双侧安全边。 */
const FLIP_RESERVE_PX = 248;

/** 长按判定窗:原型 400ms(触屏长按阈值;桌面 hover 即开,不受此值影响)。 */
const LONG_PRESS_MS = 400;

/** 浮签文案:名词 + 一句话释义(结构化,渲染层零解析)。 */
export interface TipText {
  name: string;
  detail: string;
}

/** 属性浮签文案单源(#253):口径对齐 docs/reference/rules/ 规则页
 *  (委任/城=04 地产经济,手牌=06 锦囊,声望/体力=07 声望与机遇,名将=08,现金=01 总览)。
 *  席位格与仪表条两处共用,勿散落组件。 */
export const ATTR_TIPS = {
  cash: { name: "现金", detail: "身价=仅现金;攒够目标身价即胜" },
  warrant: { name: "委任状", detail: "进驻城池时消耗;每过都城 +2" },
  city: { name: "城池", detail: "名下城池数;到达己城可免费扩军" },
  hand: { name: "锦囊手牌", detail: "暗置,只有本人可见" },
  rep: { name: "声望", detail: "首次越过 +30/+60/+90,各获赠锦囊一张" },
  gem: { name: "珍宝", detail: "可交易变卖;破产时按指导价抵债" },
  hero: { name: "名将", detail: "上限 3 名;被动技能常驻生效" },
  stamina: { name: "体力", detail: "机遇增减;归 0 耗竭,处置城池歇一回合后回满" },
  sign: { name: "签面", detail: "本回合掷骰点数(一~六)" },
} as const satisfies Record<string, TipText>;

export interface TipProps {
  /** 浮签文案(名词+一句话;复合文案在调用方拼 detail,本件不做字符串解析)。 */
  tip: TipText;
  /** 触发元内容(图标/血条)。 */
  children: ReactNode;
  /** 触发元附加类(徽章排版类挂这里)。 */
  className?: string;
  /** 触发元挂点(e2e 断言用;挂 trigger 本体,不嵌套)。 */
  testId?: string;
  /** 触发元可达名(默认 = 名词;徽章在此带上数值,如「委任状 2」)。 */
  ariaLabel?: string;
  /** 轻点动作(#622:城池徽章装回点击,轻点=开名下城池清单;桌面同效)。
   *  不传 = 纯展示现状(click 空转,珍宝/名将等行为零变化);长按仍开浮签。 */
  onTap?: () => void;
  /** 弹层开合态(#622:onTap 装回时随名下城池清单开合同步 aria-expanded;
   *  不传不出该属性——浮签不是弹层,不用此语义)。 */
  ariaExpanded?: boolean;
}

export function Tip({
  tip,
  children,
  className,
  testId,
  ariaLabel,
  onTap,
  ariaExpanded,
}: TipProps) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"bottom" | "left">("bottom");
  const press = useTapOrLongPress({
    onTap,
    onLongPress: (el) => openToward(el),
    ms: LONG_PRESS_MS,
  });

  const openToward = (el: Element) => {
    const rect = el.getBoundingClientRect();
    setSide(rect.right > window.innerWidth - FLIP_RESERVE_PX ? "left" : "bottom");
    setOpen(true);
  };

  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        // hover/聚焦的开关由底件回调统一进受控态;长按通路在 pointer 事件里自行置 true。
        setOpen(next);
      }}
    >
      <TooltipTrigger
        type="button"
        aria-label={ariaLabel ?? tip.name}
        aria-expanded={ariaExpanded}
        data-testid={testId}
        className={
          "cursor-help border-0 bg-transparent p-0 text-left [font:inherit] outline-offset-2 " +
          (className ?? "")
        }
        onPointerEnter={(e: ReactPointerEvent<HTMLElement>) => {
          if (e.pointerType === "mouse") openToward(e.currentTarget);
        }}
        {...press.props}
        onPointerLeave={() => setOpen(false)}
        onFocus={(e) => {
          // 仅键盘意图开签:与底件 useFocus 同一道 :focus-visible 闸。鼠标点击聚焦
          // 不算意图(hover 通路已开);弹层关闭还焦(returnFocus 的程序化 focus)
          // 更不算——否则焦点被送回触发元就把刚收掉的浮签重新挂上,残签面板滞留
          // 锚位盖住相邻命中点(#704 残影真源,探针实录:tipVisible true 全由
          // 关弹层还焦的 onFocus 复挂)。
          if (e.currentTarget.matches(":focus-visible")) openToward(e.currentTarget);
        }}
        onBlur={() => setOpen(false)}
        onPointerUp={(e) => {
          press.cancel();
          if (e.pointerType !== "mouse") setOpen(false); // 触屏抬起即收(原型 touchend 口径)
        }}
        onPointerCancel={() => {
          press.cancel();
          setOpen(false);
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={8} data-testid={TESTIDS.attrTip}>
        <TooltipTitle>{tip.name}</TooltipTitle>
        {tip.detail !== "" && <span className="block text-ink/85">{tip.detail}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
