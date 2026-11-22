import { formatMoney } from "@dafung/core/engine/money";

/** 固定显示原有银两、费用和结算后余额或差额。 */
export function AffordRow({
  cash,
  need,
  purpose,
}: {
  cash: number;
  need: number;
  purpose: "purchase" | "capital";
}) {
  const diff = cash - need;
  return (
    <div className="flex flex-wrap items-baseline justify-center gap-x-4 font-wenkai">
      <span className="text-xs text-paper-dim">
        持有 <b className="font-normal text-[20px] text-paper tabular-nums">{formatMoney(cash)}</b>
      </span>
      <span className="text-xs text-paper-dim">
        {purpose === "capital" ? "建城费" : "购入价"}{" "}
        <b className="font-normal text-[20px] text-paper tabular-nums">{formatMoney(need)}</b>
      </span>
      <span className="text-xs text-paper-dim">
        {diff >= 0 ? "余额" : "还差"}{" "}
        <b
          className={
            "font-normal text-[20px] tabular-nums " + (diff >= 0 ? "text-attr-cash" : "text-danger")
          }
        >
          {formatMoney(Math.abs(diff))}
        </b>
      </span>
    </div>
  );
}
