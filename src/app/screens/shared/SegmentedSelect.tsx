// 分段选择器(X10 #29):受限档位单选,替代原生 select——全程无原生下拉,主题不破功。
// 语义:role="group" + 每钮 aria-pressed(与选图面板 S-9 同口径:切换语义不用 aria-selected);
// 选中态对齐国号字盘(border-gold bg-gold/25);按钮原生 Tab/Enter,键盘可控,触达 ≥40px。
// data-testid 契约:每个选项 = `${testid}-${value}`(e2e 直点选项,不再 selectOption)。
import type { ReactNode } from "react";

export interface SegmentedOption<T> {
  value: T;
  label: ReactNode;
}

export function SegmentedSelect<T extends string | number>({
  testid,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  testid: string;
  /** 组的可及名(原生 select 时代由外层 label 隐式关联,分段器需显式给)。 */
  ariaLabel: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            data-testid={`${testid}-${o.value}`}
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            className={
              "min-h-[40px] rounded border px-3 font-deco text-sm cursor-pointer transition-colors " +
              (selected
                ? "border-gold bg-gold/25 font-bold text-ink"
                : "border-ink/25 bg-bg/60 text-ink-dim hover:border-gold/60 hover:text-ink")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
