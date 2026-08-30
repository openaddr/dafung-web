// 步进器(X10 #29):小范围数值调节(诸侯数 2-8),替代原生 select——
// − / + 夹数字;两钮各 40×40(触达达标),到界禁用 + title 说明原因;
// 按钮原生 Tab/Enter,键盘可控。
// data-testid 契约:数值 = testid,按钮 = `${testid}-minus` / `${testid}-plus`。
export function Stepper({
  testid,
  ariaLabel,
  value,
  min,
  max,
  onChange,
}: {
  testid: string;
  /** 可及名词根:−/+ 的 aria-label = 「减少/增加」+ 它(如「减少诸侯数」)。 */
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const btn =
    "flex h-10 w-10 items-center justify-center rounded border border-ink/25 bg-bg/60 font-deco text-lg leading-none text-ink cursor-pointer transition-colors hover:border-gold/60 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        data-testid={`${testid}-minus`}
        aria-label={`减少${ariaLabel}`}
        disabled={value <= min}
        title={value <= min ? `最少 ${min}` : undefined}
        onClick={() => onChange(value - 1)}
        className={btn}
      >
        −
      </button>
      <span data-testid={testid} className="min-w-10 text-center font-deco text-base font-bold text-ink">
        {value}
      </span>
      <button
        type="button"
        data-testid={`${testid}-plus`}
        aria-label={`增加${ariaLabel}`}
        disabled={value >= max}
        title={value >= max ? `最多 ${max}` : undefined}
        onClick={() => onChange(value + 1)}
        className={btn}
      >
        +
      </button>
    </div>
  );
}
