// 战报抽屉(#255,布局重构收口):仪表条上缘右角竖把手 + 右缘抽屉渲染对局日志。
// 常收零占位——收起时只有把手(原型 .log-tab 制式);抽屉壳走 ui/sheet 底件
// (Base UI:焦点陷阱/Esc/点外关白拿,挂载不夺焦),本件只出把手与条目。
// 条目 = 快照 log 的玩法事件(中文 brief,ADR-0014):倒序呈现(最新在上,免自动
// 滚屏);header/cmd/room/final 是机读/审计行,不入战报(事件史按需可查,从简)。
// Danmaku 式镜像不做(原型走查拍板,二期再议)。
//
// 窗口化渲染(2026-09「越玩越卡」排查):抽屉开着时每次引擎 sync 都重渲本件,全量
// 渲染曾使帧尖峰随条数线性涨(n=8000 实测 717ms/帧)——默认只渲最近 WAR_WINDOW 条,
// 「加载更早」每次放开一窗,放到见底后锁定全量(此后新增条目照常入列,不再回收,
// 也不重新出现按钮:用户已表态要读全史,不悄悄缩窗)。关抽屉即重置回一窗。
//
// 把手未读角标(#495):收起时累计战报新增条数,开抽屉即清零——朱砂圆印制式搬
// rack-entry-badge 同族(layout.css .log-tab-badge),零新设计。条目玩家色(#495):
// 条目首 6px 竖条取行动方玩家色(LogEvent.player 国号 → 快照席位 colorIndex,
// 国号局内唯一由 setup-flow 保证;无主行为/开局空国号不出条,不造假)。
import { useEffect, useState } from "react";
import type { LogEvent } from "@core/model";
import { playerColor, rgba } from "@core/theme";
import type { GameSnapshot } from "@app/store/gameStore";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@app/components/ui/sheet";
import { TESTIDS } from "./testids";

/** 入战报的 category 白名单(收口一处):玩法事件;header/cmd/room/final 排除
 *  (局头是重放要素、cmd/room 是审计流、final 是机读终态,均非「战况」叙述)。 */
const WAR_CATEGORIES: ReadonlySet<LogEvent["category"]> = new Set([
  "roll",
  "buy",
  "upgrade",
  "trade",
  "supply",
  "tax",
  "halt",
  "setup",
  "skill",
  "system",
  "victory",
]);

/** 战报默认渲染窗口(条);e2e/react-war-report.spec.ts 有对齐副本。 */
export const WAR_WINDOW = 100;

export function WarReportDrawer({ snapshot }: { snapshot: GameSnapshot }) {
  const [open, setOpen] = useState(false);
  const [extraWindows, setExtraWindows] = useState(0);
  const [expandedAll, setExpandedAll] = useState(false);

  // 战报条目全量数(白名单过滤,关着也要数——未读角标的账本);窗口化只裁渲染不裁此数。
  const totalEntries = snapshot.log.filter((e) => WAR_CATEGORIES.has(e.category)).length;
  // 未读账本(#495):已读数=最近一次开抽屉时刻的条目数;开抽屉即清账。
  // 初值 0=进场已有条目全算未读(把手首亮即提示「有战报可看」,无特判)。
  const [seenCount, setSeenCount] = useState(0);
  useEffect(() => {
    if (open) setSeenCount(totalEntries);
  }, [open, totalEntries]);
  const unread = open ? 0 : totalEntries - seenCount;

  // 打开时才算条目(旧→新);窗口化见头注。
  const filtered = open ? snapshot.log.filter((e) => WAR_CATEGORIES.has(e.category)) : [];
  const total = filtered.length;
  const windowSize = (extraWindows + 1) * WAR_WINDOW;
  const visibleCount = expandedAll ? total : Math.min(total, windowSize);
  const hasMore = !expandedAll && total > windowSize;
  // 倒序 = 最新在上;只对可见窗 reverse,不全量物化。
  const entries = filtered.slice(total - visibleCount).reverse();

  // 行动方国号 → 玩家色(#495):国号局内唯一(setup-flow 非空校验),开局未定国号的
  // 空串不建键;查不到(无主行为 player=null)条目不出色条,不造假。
  const colorByGuohao = new Map(
    snapshot.players
      .filter((p) => p.guohao !== "")
      .map((p) => [p.guohao, rgba(playerColor(p.colorIndex))]),
  );

  const close = () => {
    setOpen(false);
    setExtraWindows(0);
    setExpandedAll(false);
  };
  const loadEarlier = () => {
    const next = extraWindows + 1;
    setExtraWindows(next);
    if (next * WAR_WINDOW >= total) setExpandedAll(true);
  };

  return (
    <>
      {/* 竖把手:常收零占位的唯一在场所(样式 layout.css .log-tab,原型右缘战报签移植);
          未读角标(#495)挂在把手左上角——把手常驻右缘,角印朝屏内不溢出视口 */}
      <button
        type="button"
        data-testid={TESTIDS.logTab}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="log-tab"
      >
        战报
        {unread > 0 && <span className="log-tab-badge">{unread}</span>}
      </button>
      {open && (
        <Sheet open onOpenChange={(next) => !next && close()}>
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
            <ul className="war-list">
              {entries.map((e, i) => {
                const actorColor = e.player ? colorByGuohao.get(e.player) : undefined;
                // 回合分组锚(#556):倒序呈现下组首=该轮最新一条。仅组首显轮签,
                // 其余条目轮签位留空(列宽不塌);组首与上条的轮界由 .war-head
                // 上缘加重 hairline 承担(layout.css),首条无上界。
                const roundHead = i === 0 || entries[i - 1].round !== e.round;
                return (
                  // key 用过滤序的稳定下标(log 只增,下标不漂);倒序后同刻条目相对次序稳定
                  <li
                    key={total - visibleCount + i}
                    className={"war-item" + (roundHead && i > 0 ? " war-head" : "")}
                  >
                    {actorColor && <i className="war-color" style={{ background: actorColor }} />}
                    <span className="war-round">{roundHead ? `轮${e.round}` : ""}</span>
                    <span className="war-brief">{e.brief}</span>
                  </li>
                );
              })}
            </ul>
            {hasMore && (
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
      )}
    </>
  );
}
