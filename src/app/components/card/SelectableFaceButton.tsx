// 组件收口:器物豁免(永久)——卡面选择按钮壳,真 button 零皮零自写交互语义;
// 手册与招贤候选共用此壳,交互语义(开合)归消费方:
// props 全透传(testid/title/onClick/style/…),className 追加位点类(如
// confirming 印条锚位的 relative、珍宝签的 text-left),children=卡面纯展示件。
// 圆角 7px 统一口径(#1188 S2):可见焦点轮廓贴合卡角。
// 器物豁免类:裸 button 无新交互语义,不进 shadcn
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
        "block rounded-[7px] border-0 bg-transparent p-0 outline-offset-2 transition " + className
      }
    >
      {children}
    </button>
  );
}
