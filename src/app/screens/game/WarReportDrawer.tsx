// 战报抽屉(#255,布局重构收口):仪表条上缘右角竖把手 + 右缘抽屉渲染对局日志。
// 常收零占位——收起时只有把手(原型 .log-tab 制式);抽屉壳走 ui/sheet 底件
// (Base UI:焦点陷阱/Esc/点外关白拿,挂载不夺焦),本件只出把手与条目。
// 条目 = 快照 log 的玩法事件(中文 brief,ADR-0014):倒序呈现(最新在上,免自动
// 滚屏);header/cmd/room/final 是机读/审计行,不入战报(事件史按需可查,从简)。
// Danmaku 式镜像不做(原型走查拍板,二期再议)。
import { useState } from "react";
import type { LogEvent } from "@core/types";
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
  "branch",
  "halt",
  "setup",
  "skill",
  "system",
  "victory",
]);

export function WarReportDrawer({ snapshot }: { snapshot: GameSnapshot }) {
  const [open, setOpen] = useState(false);
  // 打开时才算条目(倒序 = 最新在上);log 只增,重渲染重算是小列表,不值得缓存。
  const entries = open
    ? snapshot.log
        .filter((e) => WAR_CATEGORIES.has(e.category))
        .slice()
        .reverse()
    : [];

  return (
    <>
      {/* 竖把手:常收零占位的唯一在场所(样式 layout.css .log-tab,原型右缘战报签移植) */}
      <button
        type="button"
        data-testid={TESTIDS.logTab}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="log-tab"
      >
        战报
      </button>
      {open && (
        <Sheet open onOpenChange={(next) => !next && setOpen(false)}>
          <SheetContent
            data-testid={TESTIDS.logDrawer}
            side="right"
            aria-label="战报"
            className="w-[21rem]"
          >
            <SheetHeader>
              <SheetTitle>战报</SheetTitle>
              <SheetDescription>对局事件史,新在上;关后零占位。</SheetDescription>
            </SheetHeader>
            <ul className="war-list">
              {entries.map((e, i) => (
                // 倒序后同刻条目的相对次序仍稳定(稳定排序;key 用正序下标防重)
                <li key={snapshot.log.length - 1 - i} className="war-item">
                  <span className="war-round">轮{e.round}</span>
                  <span className="war-brief">{e.brief}</span>
                </li>
              ))}
            </ul>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
