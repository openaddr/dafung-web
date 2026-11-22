// 战报抽屉(#255,布局重构收口;#700 全浮层骨架:入口降级):右缘抽屉渲染对局日志,
// 开合态归消费方(GameScreen;入口=设置弹层「战报›」行,常收不挂载零占位)——
// 旧右缘竖把手(.log-tab)随仪表条退役;抽屉壳走 ui/sheet 底件(Base UI:焦点陷阱/
// Esc/点外关白拿,挂载不夺焦),本件只出条目。
// 条目 = 快照 log 的玩法事件(中文 brief,ADR-0014):倒序呈现(最新在上,免自动
// 滚屏);header/cmd/room/final 是机读/审计行,不入战报(事件史按需可查,从简)。
// Danmaku 式镜像不做(原型走查拍板,二期再议)。
//
// 打开时只渲染最新一窗，按需加载更早。离开顶部后保留正在浏览的范围，
// 让新条目可以插到上方而不挤掉旧条目；行身份稳定，由滚动容器锚定当前位置。
//
// 未读角标(#495)随把手退役,未读表达由 #768 接棒:⚙ 设置钮右上金点,账本=
// GameScreen 本地已读游标(打开抽屉即清账,不进快照),条目总数经本件
// warEntriesOf 单源过滤。条目玩家色(#495):条目首 6px 竖条取行动方玩家色
// (LogEvent.player 国号 → 快照席位 colorIndex,国号局内唯一由 setup-flow 保证;
// 无主行为/开局空国号不出条,不造假)。
import { memo, useState } from "react";
import type { LogEvent } from "@dafung/core/engine/model";
import { playerColor, rgba } from "@dafung/core/engine/theme";
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
  "halt",
  "setup",
  "skill",
  "system",
  "victory",
]);

/** 战报条目过滤单源(#768):抽屉本体与未读金点(GameScreen 已读游标对比)共用
 *  同一白名单口径,防两处各写一份 filter 漂移。 */
export function warEntriesOf(snapshot: GameSnapshot): LogEvent[] {
  return snapshot.log.filter((e) => WAR_CATEGORIES.has(e.category));
}

/** 战报每次加载的条数。 */
const WAR_WINDOW = 100;

/** 值等(#1140 渲染税):战报条目唯一增长键=logCount(#1081 值语义依赖,log 只增
 *  前提下长度变化 ⇔ 内容变化)——条目窗/色表全由 log 与 players(值等复用引用)
 *  派生;onClose 不入比较(setState 驱动,行为恒定)。抽屉开着时演出期的每次 sync
 *  在此 bail out,不再重渲百行条目树。 */
function warReportEqual(a: { snapshot: GameSnapshot }, b: { snapshot: GameSnapshot }): boolean {
  return a.snapshot.logCount === b.snapshot.logCount;
}

export const WarReportDrawer = memo(function WarReportDrawer({
  snapshot,
  onClose,
}: {
  snapshot: GameSnapshot;
  onClose: () => void;
}) {
  const [windowSize, setWindowSize] = useState(WAR_WINDOW);
  const [readingStart, setReadingStart] = useState<number | null>(null);
  const [expandedAll, setExpandedAll] = useState(false);

  // 开着才算条目(旧→新);窗口化见头注(挂载即开,常收零占位由调用方条件挂载承担)。
  // 过滤单源 warEntriesOf(未读金点同口径,#768)。
  const filtered = warEntriesOf(snapshot);
  const total = filtered.length;
  const windowStart = expandedAll ? 0 : Math.max(0, total - windowSize);
  const visibleStart = readingStart == null ? windowStart : Math.min(windowStart, readingStart);
  const entries = filtered.slice(visibleStart).reverse();

  // 行动方国号 → 玩家色(#495):国号局内唯一(setup-flow 非空校验),开局未定国号的
  // 空串不建键;查不到(无主行为 player=null)条目不出色条,不造假。
  const colorByGuohao = new Map(
    snapshot.players
      .filter((p) => p.guohao !== "")
      .map((p) => [p.guohao, rgba(playerColor(p.colorIndex))]),
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
                // key 用过滤序的稳定下标(log 只增,下标不漂);倒序后同刻条目相对次序稳定
                <li
                  key={total - 1 - i}
                  className={"war-item" + (roundHead && i > 0 ? " war-head" : "")}
                >
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
}, warReportEqual);
