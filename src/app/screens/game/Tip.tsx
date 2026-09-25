// 属性浮签(#253 布局骨架):席位卡/仪表条全部图标与体力血条的名词+一句话释义。
// 行为口径(原型 .proto-tip 及其内联 JS):桌面 hover 与移动端长按(400ms)同效;
// 贴右缘(浮签 240px 放不下)自动翻到图标左侧垂直居中,其余在图标下方居中。
// 交互语义全部收口 shadcn Tooltip 底件(ui/tooltip.tsx,Base UI:定位/碰撞/无障碍
// 关联白拿,不自写浮层定位);本件只补两件事:
//   ① 长按通路——复用 use-long-press.ts 单源(400ms,位移超容差自动取消),触发后
//      fired 抑制随后的合成 click(无动作,只为防误触穿透);
//   ② 翻面判定——开签瞬间量触发元 getBoundingClientRect,右缘放不下即 side="left"。
// tip 文案:「名词|一句话」单字符串,与规则页口径对齐(docs/reference/rules/)。
import { useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTitle, TooltipTrigger } from "@app/components/ui/tooltip";
import { useLongPress } from "@app/hooks/use-long-press";
import { TESTIDS } from "./testids";

/** 触发元右缘距视口右边的预留量:浮签 max-w 240 + 双侧安全边。 */
const FLIP_RESERVE_PX = 248;

/** 长按判定窗:原型 400ms(触屏长按阈值;桌面 hover 即开,不受此值影响)。 */
const LONG_PRESS_MS = 400;

/** 属性浮签文案单源(#253):「名词|一句话释义」,口径对齐 docs/reference/rules/ 规则页
 *  (委任/城=04 地产经济,手牌=06 锦囊,声望/体力=07 声望与机遇,名将=08,现金=01 总览)。
 *  席位卡与仪表条两处共用,勿散落组件。 */
export const ATTR_TIPS = {
  cash: "现金|身价=仅现金;攒够目标身价即胜",
  warrant: "委任状|进驻城池时消耗;每过都城 +2",
  city: "城池|名下城池数;到达己城可免费扩军",
  hand: "锦囊手牌|暗置,只有本人可见",
  rep: "声望|首次越过 +30/+60/+90,各获赠锦囊一张",
  gem: "珍宝|可交易变卖;破产时按指导价抵债",
  hero: "名将|上限 3 名;被动技能常驻生效",
  stamina: "体力|机遇增减;归 0 耗竭,处置城池歇一回合后回满",
  sign: "签面|本回合掷骰点数(一~六)",
} as const;

export interface TipProps {
  /** 「名词|一句话释义」(竖线分隔;无竖线 = 整串为名词)。 */
  tip: string;
  /** 触发元内容(图标/血条)。 */
  children: ReactNode;
  /** 触发元附加类(徽章排版类挂这里)。 */
  className?: string;
  /** 触发元挂点(e2e 断言用;挂 trigger 本体,不嵌套)。 */
  testId?: string;
  /** 触发元可达名(默认 = 名词;徽章在此带上数值,如「委任状 2」)。 */
  ariaLabel?: string;
  /** 点击动作(#255 expandPile:珍宝/名将徽章点开展开/收起明细);缺省 = 纯浮签触发元
   *  (点击无动作,光标保持 help;有动作时转 pointer)。长按开签后的合成 click 照旧吞掉。 */
  onClick?: () => void;
  /** 展开态(aria-expanded;视觉提亮由调用方经 className 叠 .open,§4.6 状态即 UI)。 */
  ariaExpanded?: boolean;
}

export function Tip({ tip, children, className, testId, ariaLabel, onClick, ariaExpanded }: TipProps) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"bottom" | "left">("bottom");
  const press = useLongPress();

  const openToward = (el: Element) => {
    const rect = el.getBoundingClientRect();
    setSide(rect.right > window.innerWidth - FLIP_RESERVE_PX ? "left" : "bottom");
    setOpen(true);
  };

  const sep = tip.indexOf("|");
  const title = sep < 0 ? tip : tip.slice(0, sep);
  const desc = sep < 0 ? "" : tip.slice(sep + 1);

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
        aria-label={ariaLabel ?? title}
        data-testid={testId}
        aria-expanded={ariaExpanded}
        className={
          (onClick ? "cursor-pointer " : "cursor-help ") +
          "border-0 bg-transparent p-0 text-left [font:inherit] outline-offset-2 " +
          (className ?? "")
        }
        onPointerEnter={(e: ReactPointerEvent<HTMLElement>) => {
          if (e.pointerType === "mouse") openToward(e.currentTarget);
        }}
        onPointerLeave={() => setOpen(false)}
        onFocus={(e) => openToward(e.currentTarget)}
        onBlur={() => setOpen(false)}
        onPointerDown={(e) => press.start(e, () => openToward(e.currentTarget), LONG_PRESS_MS)}
        onPointerMove={(e) => press.move(e)}
        onPointerUp={(e) => {
          press.cancel();
          if (e.pointerType !== "mouse") setOpen(false); // 触屏抬起即收(原型 touchend 口径)
        }}
        onPointerCancel={() => {
          press.cancel();
          setOpen(false);
        }}
        onContextMenu={(e) => e.preventDefault()} // 长按不出系统菜单(HandRack 同口径)
        onClick={() => {
          if (press.fired.current) {
            press.fired.current = false; // 长按刚开过签,吃掉合成 click
            return;
          }
          onClick?.();
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={8} data-testid={TESTIDS.attrTip}>
        <TooltipTitle>{title}</TooltipTitle>
        {desc !== "" && <span className="block text-[rgba(246,236,217,0.85)]">{desc}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
