// 卡面选择按钮壳(#1188 S1 单源):§4.6 金描边选择语言的卡面点击壳——真 button、
// 零皮(透明底无边框,视觉全由 children 卡面自承)、hover 金描边光圈表达可选
// (§4.6 UI 状态通道,无文字标牌)。手册三签(名将/锦囊/珍宝)与招贤候选
// (HeroPickScroll)四处逐字重复的壳收编为一处。交互语义(开合)归消费方:
// props 全透传(testid/title/onClick/style/…),className 追加位点类(如
// confirming 印条锚位的 relative、珍宝签的 text-left),children=卡面纯展示件。
// 圆角 7px 统一口径(#1188 S2):壳的 border-radius 只服务 hover 光圈贴卡角,
// 卡面圆角本体在各自 CSS(0.9em×卡基);em 写在壳上会解析到壳自身字号档
// (各站卡基不同),恒 px。器物豁免类:裸 button 无新交互语义,不进 shadcn
// 收口附表(#1188 边界)。
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function SelectableFaceButton({
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={
        "block cursor-pointer rounded-[7px] border-0 bg-transparent p-0 outline-offset-2 transition hover:shadow-[0_0_0_2px_var(--color-gold)] " +
        className
      }
    >
      {children}
    </button>
  );
}
