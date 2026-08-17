// 侧栏·诸侯紧凑条(对照旧 renderOthers):国号徽记 + 银两 + 城数;活跃/破产/胜者高亮。
import { rgba, playerColor } from "@core/theme";
import { formatMoney } from "@core/money";
import type { GameSnapshot } from "@app/store/gameStore";
import { TESTIDS } from "./testids";

export function OthersPanel({ snapshot }: { snapshot: GameSnapshot }) {
  return (
    <div data-testid={TESTIDS.othersPanel} className="px-3 py-1">
      {snapshot.players.map((p, seat) => {
        const isActive = snapshot.phase === "Playing" && seat === snapshot.activeIndex;
        const isWinner = snapshot.isOver && snapshot.winner === p.id;
        return (
          <div
            key={p.id}
            data-testid={TESTIDS.otherPlayer(seat)}
            style={{ ["--player-color" as string]: rgba(playerColor(p.colorIndex)) }}
            className={[
              "flex items-center gap-1.5 rounded px-1 py-0.5 text-xs border-l-[3px]",
              // W3:活跃强调——左侧 3px 金竖条 + bg-gold/25 + 国号加重(三重线索,斜眼可辨;
              // 非活跃也占 3px 透明边,避免状态切换时整行横向跳动)
              isActive ? "bg-gold/25 border-l-gold" : "border-l-transparent",
              p.isBankrupt ? "opacity-40 line-through" : "",
              isWinner ? "text-gold" : "",
            ].join(" ")}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--player-color) font-brush text-white">
              {p.guohao || "?"}
            </span>
            <span className={"truncate" + (isActive ? " font-bold" : "")}>
              {p.guohao || p.name}
              {p.isBot ? " 智" : ""}
            </span>
            {/* S7 核对补漏:胜者原先仅靠 text-gold 金色区分(仅颜色传达信息),
                补「胜」文字标记——与「智」同款单字后缀,颜色之外有明确文字线索 */}
            {isWinner && <span className="shrink-0 font-brush text-gold">胜</span>}
            {/* G-15:现金低于 1000两(危险线)加 ⚠ 并转 danger 色——现金是唯一活钱,
                见底意味着下一步任何支出都可能触发变卖/破产;破产行已划线弱化,不再重复示警 */}
            <span
              className={
                "ml-auto shrink-0 " + (!p.isBankrupt && p.cash < 1000 ? "text-danger" : "text-money")
              }
            >
              {!p.isBankrupt && p.cash < 1000 ? "⚠ " : ""}
              {formatMoney(p.cash)}
            </span>
            {/* G-15:身价小字(netWorth 含地产/珍宝估值,胜负口径;对照现金才有全局财势感) */}
            <span className="shrink-0 text-[10px] text-ink-dim">
              身价{formatMoney(p.netWorth)}
            </span>
            <span className="shrink-0 text-ink-dim">{p.properties.length}城</span>
          </div>
        );
      })}
    </div>
  );
}
