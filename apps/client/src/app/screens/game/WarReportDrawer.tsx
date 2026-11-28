// 战报条目和公开行号由座位查询提供，抽屉按最新优先呈现。
// 用户离开列表顶部后保留浏览范围，新条目插在上方，旧条目沿公开行号保留身份。
import { memo, useState } from "react";
import { playerColor, rgba } from "@dafung/core/engine/theme";
import type { WarReportEntry, WarlordDetails } from "@dafung/core/protocol/seat-queries";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@app/components/ui/sheet";
import { TESTIDS } from "./testids";

/** 战报每次加载的条数。 */
const WAR_WINDOW = 100;

export const WarReportDrawer = memo(function WarReportDrawer({
  report,
  warlords,
  onClose,
}: {
  report: readonly WarReportEntry[];
  warlords: readonly WarlordDetails[];
  onClose: () => void;
}) {
  const [windowSize, setWindowSize] = useState(WAR_WINDOW);
  const [readingStart, setReadingStart] = useState<number | null>(null);
  const [expandedAll, setExpandedAll] = useState(false);

  const total = report.length;
  const windowStart = expandedAll ? 0 : Math.max(0, total - windowSize);
  const visibleStart = readingStart == null ? windowStart : Math.min(windowStart, readingStart);
  const entries = report.slice(visibleStart).reverse();

  // 行动方国号 → 玩家色(#495):国号局内唯一(setup-flow 非空校验),开局未定国号的
  // 空串不建键;查不到(无主行为 player=null)条目不出色条,不造假。
  const colorByGuohao = new Map(
    warlords.filter((p) => p.guohao !== "").map((p) => [p.guohao, rgba(playerColor(p.colorIndex))]),
  );

  const loadEarlier = () => {
    const nextStart = Math.max(0, visibleStart - WAR_WINDOW);
    setWindowSize(total - nextStart);
    if (readingStart != null) setReadingStart(nextStart);
    if (nextStart === 0) setExpandedAll(true);
  };

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        data-testid={TESTIDS.logDrawer}
        side="right"
        aria-label="战报"
        className="w-[21rem]"
      >
        <SheetHeader>
          <SheetTitle>战报</SheetTitle>
          <SheetDescription>对局事件史,新在上。</SheetDescription>
        </SheetHeader>
        {entries.length === 0 ? (
          // 空态(#768 空态器物化):空白笺+虚线格——「一行小字」退役,一张待墨的
          // 空笺(三道虚线空行)表达「尚无战况」;语义走 role=status,视觉零文字。
          <div className="war-blank" role="status" aria-label="战报尚无条目">
            <i />
            <i />
            <i />
          </div>
        ) : (
          <ul
            className="war-list"
            data-peek-scroll
            onScroll={(event) => {
              const reading = event.currentTarget.scrollTop > 0;
              setReadingStart((start) => (reading ? (start ?? visibleStart) : null));
            }}
          >
            {entries.map((e, i) => {
              const actorColor = e.player ? colorByGuohao.get(e.player) : undefined;
              // 回合分组锚(#556):倒序呈现下组首=该轮最新一条。仅组首显轮签,
              // 其余条目轮签位留空(列宽不塌);组首与上条的轮界由 .war-head
              // 上缘加重 hairline 承担(layout.css),首条无上界。
              const roundHead = i === 0 || entries[i - 1].round !== e.round;
              return (
                <li key={e.offset} className={"war-item" + (roundHead && i > 0 ? " war-head" : "")}>
                  {actorColor && <i className="war-color" style={{ background: actorColor }} />}
                  <span className="war-round">{roundHead ? `轮${e.round}` : ""}</span>
                  <span className="war-brief">{e.brief}</span>
                </li>
              );
            })}
          </ul>
        )}
        {visibleStart > 0 && (
          <button
            type="button"
            data-testid={TESTIDS.logEarlier}
            onClick={loadEarlier}
            className="war-earlier"
          >
            加载更早
          </button>
        )}
      </SheetContent>
    </Sheet>
  );
});
