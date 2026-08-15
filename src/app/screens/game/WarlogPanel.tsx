// 侧栏·战报区(对照旧 renderWarlog):诸侯紧凑条 + 日志(简报/详情双 tab)。
// React 声明式下无需旧版的增量断点渲染,直接渲染最近 N 条(300,与旧 DOM 上限一致)。
import { useState } from "react";
import { formatMoney } from "@core/money";
import type { GameSnapshot } from "@app/store/gameStore";
import { OthersPanel } from "./OthersPanel";
import { TESTIDS } from "./testids";

/** 战报保留条数(与旧版 DOM 节点上限一致,防长局爆炸)。 */
const MAX_LOG = 300;

// 日志分类 → 图标(对照旧 LOG_ICON;emoji 保留,统一 ink-dim 着色)
const LOG_ICON: Record<string, string> = {
  roll: "🎲",
  buy: "🏠",
  upgrade: "⬆",
  rent: "💸",
  supply: "🌾",
  branch: "⇄",
  halt: "🏯",
  treasure: "💎",
  trade: "💎",
  victory: "👑",
  system: "·",
  setup: "·",
};

export function WarlogPanel({ snapshot }: { snapshot: GameSnapshot }) {
  const [mode, setMode] = useState<"brief" | "detail">("brief");
  const recent = snapshot.log.slice(-MAX_LOG);
  return (
    <section data-testid={TESTIDS.warlogPanel} className="flex min-h-0 flex-[1.4] flex-col px-3 pb-2">
      <h3 className="flex items-baseline gap-2 py-2 font-brush text-base">
        诸侯 · 战报
        <span className="ml-auto flex gap-2 text-xs">
          {(["brief", "detail"] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={m === "brief" ? TESTIDS.warlogTabBrief : TESTIDS.warlogTabDetail}
              onClick={() => setMode(m)}
              className={`${mode === m ? "border-b border-gold text-gold" : "text-ink-dim"} hover:text-ink`}
            >
              {m === "brief" ? "简报" : "详情"}
            </button>
          ))}
        </span>
      </h3>
      <OthersPanel snapshot={snapshot} />
      {/* 新日志在尾部:列表整体 flex-col-reverse,新条目自然贴底可见(等价旧 scrollTop 行为) */}
      <div className="mt-1 flex min-h-0 flex-1 flex-col-reverse gap-0.5 overflow-y-auto">
        {[...recent].reverse().map((e, i) => (
          <div key={recent.length - 1 - i} data-testid={TESTIDS.warlogItem} className="text-xs leading-5">
            <span className="mr-1 text-ink-dim">{LOG_ICON[e.category] ?? "·"}</span>
            {mode === "brief" ? e.brief : e.detail}
            {e.amount != null && (
              <span className={e.amount >= 0 ? "text-money" : "text-danger"}>
                {" "}
                ({e.amount >= 0 ? "+" : "−"}
                {formatMoney(Math.abs(e.amount))})
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
