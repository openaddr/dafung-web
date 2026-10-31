// 主数值行(#767 弹窗详情族①「主数值升格」):「持有 / 需 / 余·差」三数从 text-sm
// 摘要行拆出的独立主行——买不买得起 0.5 秒可读。购地抉择(BuyDecisionScroll)与
// 城池详情(TileDetailScroll)共用同一行,两处口径不漂移。
// 数字 20px 霞鹜文楷 tabular-nums;语义色只落在判定上:余=attr-cash 绿、差=danger 红、
// 需=ink 主色(持有/需保持墨色,不与判定抢色)。元信息(地域/持有者/购入价)由调用方
// 的次要行承担,本件只答「这城我买不买得起」。
// formatMoney 只收非负数:差取绝对值展示(负值会被契约炸出,#566 同口径)。
import { formatMoney } from "@core/money";

export function AffordRow({ cash, need }: { cash: number; need: number }) {
  const diff = cash - need;
  return (
    <div className="m-1 mb-2.5 flex items-baseline justify-center gap-x-6 font-wenkai">
      <span className="text-xs text-paper-dim">
        持有 <b className="font-normal text-[20px] text-paper tabular-nums">{formatMoney(cash)}</b>
      </span>
      <span className="text-xs text-paper-dim">
        需 <b className="font-normal text-[20px] text-paper tabular-nums">{formatMoney(need)}</b>
      </span>
      <span className="text-xs text-paper-dim">
        {diff >= 0 ? "余" : "差"}{" "}
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
