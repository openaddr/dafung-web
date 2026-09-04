// 侧栏·诸侯紧凑条(对照旧 renderOthers):国号徽记 + 银两 + 城数;活跃/破产/胜者高亮。
// L48:原寄居 WarlogPanel 标题下,战报区移除后独立成节(标题「诸侯」,钉在珍宝·名士区之后)。
// E6(#18):列表自己内滚——矮视口 8 人局不再把末位诸侯/折叠钮顶出侧栏裁掉。
// R3-A5(#68):本节 shrink-0 不再参与纵向压缩(旧 min-h-0 可收缩,844×390 抽屉里被
// flex 分配成 0 高、遭 aside overflow-hidden 静默裁切),天然高度由列表 max-h-40 封顶,
// 抽屉态溢出交给 aside 整抽屉滚动(见 GameScreen);珍宝·名士区弹性仅在桌面并排生效。
// X13(#32):收 viewSeat,自己行金描边 +「你」印(与 HandPanel 身份头同款章形,
// 8 相似色里斜眼 1s 定位;单机 viewSeat 跟随活跃座位,联机恒为本座,口径与 WaitingBar 一致)。
// R3-B10(#82):自己行非活跃补 bg-gold/10、描边 ring-gold/60→ring-gold、「你」印
// text-[10px]/px-0.5→text-xs/px-1——非活跃态自己行对比太弱,斜眼要 2s+ 才锁定。
import { rgba, playerColor } from "@core/theme";
import { formatMoney } from "@core/money";
import type { GameSnapshot } from "@app/store/gameStore";
import { TESTIDS } from "./testids";

export function OthersPanel({ snapshot, viewSeat }: { snapshot: GameSnapshot; viewSeat: number }) {
  return (
    <section data-testid={TESTIDS.othersPanel} className="flex min-h-0 shrink-0 flex-col px-3 pb-2">
      <h3 className="shrink-0 py-1 font-brush text-base">诸侯</h3>
      <div data-testid={TESTIDS.othersList} className="max-h-40 min-h-0 overflow-y-auto">
      {snapshot.players.map((p, seat) => {
        const isActive = snapshot.phase === "Playing" && seat === snapshot.activeIndex;
        const isWinner = snapshot.isOver && snapshot.winner === p.id;
        const isYou = seat === viewSeat;
        return (
          <div
            key={p.id}
            data-testid={TESTIDS.otherPlayer(seat)}
            style={{ ["--player-color" as string]: rgba(playerColor(p.colorIndex)) }}
            className={[
              "flex items-center gap-1.5 rounded px-1 py-0.5 text-xs border-l-[3px]",
              // W3:活跃强调——左侧 3px 金竖条 + bg-gold/25 + 国号加重(三重线索,斜眼可辨;
              // 非活跃也占 3px 透明边,避免状态切换时整行横向跳动)
              // R3-B10(#82):非活跃自己行补 bg-gold/10——与活跃 bg-gold/25 同族分档,
              // 轮到自己时底色自然加深一档,不新增语义色
              isActive
                ? "bg-gold/25 border-l-gold"
                : isYou
                  ? "bg-gold/10 border-l-transparent"
                  : "border-l-transparent",
              // X13:自己行金描边(与「轮到我」窄条金框同语言;与活跃金条语义不同可叠加)。
              // R3-B10(#82):ring-gold/60 对比太弱,提到全量 ring-gold
              isYou ? "ring-1 ring-gold ring-inset" : "",
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
            {/* X13:「你」印(HandPanel 身份头同款章形,缩小到行内尺寸;「你」是文字
                标记,金色描边之外还有非颜色线索)。放名字后、ml-auto 现金前,不挤右列。
                R3-B10(#82):text-[10px]+px-0.5 太小难辨,提为 text-xs + px-1,
                印章横纵比仍约 1.5:1,章形不破。 */}
            {isYou && (
              <span
                data-testid={TESTIDS.otherPlayerYou}
                title="这是你"
                className="inline-flex shrink-0 rotate-[-4deg] items-center justify-center rounded-[2px] border-[1.5px] border-gold bg-gold/15 px-1 font-brush text-xs leading-none text-gold"
              >
                你
              </span>
            )}
            {/* S7 核对补漏:胜者原先仅靠 text-gold 金色区分(仅颜色传达信息),
                补「胜」文字标记——与「智」同款单字后缀,颜色之外有明确文字线索 */}
            {isWinner && <span className="shrink-0 font-brush text-gold">胜</span>}
            {/* G-15:现金低于 1000两(危险线)加 ⚠ 并转 danger 色——现金是唯一活钱,
                见底意味着下一步任何支出都可能触发变卖/破产;破产行已划线弱化,不再重复示警。
                R3-A6(#69):font-medium + tabular-nums,数字加粗且等宽,与身价列竖向对齐易扫读 */}
            <span
              className={
                "ml-auto shrink-0 font-medium tabular-nums " +
                (!p.isBankrupt && p.cash < 1000 ? "text-danger" : "text-money")
              }
            >
              {!p.isBankrupt && p.cash < 1000 ? "⚠ " : ""}
              {formatMoney(p.cash)}
            </span>
            {/* R3-A6(#69):现金与身价之间竖分隔(沿用行 gap 节奏),两组数字分组更醒目 */}
            <span className="h-3 w-px shrink-0 bg-ink/15" />
            {/* G-15:身价小字(netWorth 含地产/珍宝估值,胜负口径;对照现金才有全局财势感)。
                R3-A6(#69):「身价 」补空格与 HandPanel/StatusBar 同口径;数字 tabular 对齐 */}
            <span className="shrink-0 text-[10px] font-medium tabular-nums text-ink-dim">
              身价 {formatMoney(p.netWorth)} · 声望 {p.reputation}
            </span>
            <span className="shrink-0 text-ink-dim">{p.properties.length}城</span>
          </div>
        );
      })}
      </div>
    </section>
  );
}
