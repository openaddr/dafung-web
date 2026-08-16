// 侧栏·战报区(对照旧 renderWarlog):诸侯紧凑条 + 日志(简报/详情双 tab)。
// React 声明式下无需旧版的增量断点渲染,直接渲染最近 N 条(300,与旧 DOM 上限一致)。
import { useState } from "react";
import { formatMoney } from "@core/money";
import type { GameSnapshot } from "@app/store/gameStore";
import { OthersPanel } from "./OthersPanel";
import { TESTIDS } from "./testids";
// 印章盖入动画定义在 scroll.css(Vite 全局生效,与卷轴动画同处便于统一维护)
import "./scroll/scroll.css";

/** 战报保留条数(与旧版 DOM 节点上限一致,防长局爆炸)。 */
const MAX_LOG = 300;

/* ── W1:emoji → 单字小方章 ──
   为什么要换:旧 emoji(🎲💸💎…)是现代扁平风,与全局毛笔/水墨体系割裂;
   换成"盖在战报上的小印"后,与棋盘印章/毛笔标题同一笔墨语言。
   配色语义:朱砂(规则/买卖/胜负等主动事件)、黛青(收入/补给等正向事件)、墨色(系统记录)。 */
type SealTone = "cinnabar" | "indigo" | "ink";

interface SealDef {
  /** 印面单字。 */
  char: string;
  tone: SealTone;
}

/** 三色印描边+字色(集中定义,简报/详情两 tab 同源)。 */
const TONE_CLASS: Record<SealTone, string> = {
  // 朱砂:正红偏沉(直接用 danger token,与破产线同源色)
  cinnabar: "border-danger text-danger",
  // 黛青:青黑偏蓝绿(收入/正向;已收编 theme.ts seal-qing token)
  indigo: "border-seal-qing text-seal-qing",
  // 墨色:系统记录,弱化存在感
  ink: "border-ink-dim text-ink-dim",
};

/** 日志分类 → 印章(对照旧 LOG_ICON 的 12 类,一色一字)。 */
const LOG_SEAL: Record<string, SealDef> = {
  roll: { char: "掷", tone: "cinnabar" }, // 掷骰
  buy: { char: "置", tone: "cinnabar" }, // 置产买地
  upgrade: { char: "扩", tone: "cinnabar" }, // 扩建城池
  rent: { char: "税", tone: "indigo" }, // 收付租税
  supply: { char: "济", tone: "indigo" }, // 粮饷补给
  branch: { char: "通", tone: "indigo" }, // 通汇分舵
  halt: { char: "禁", tone: "ink" }, // 止步/禁锢
  treasure: { char: "宝", tone: "indigo" }, // 珍宝入手
  trade: { char: "卖", tone: "cinnabar" }, // 珍宝交涉售出
  victory: { char: "胜", tone: "cinnabar" }, // 胜负手
  system: { char: "纪", tone: "ink" }, // 系统记录
  setup: { char: "天", tone: "ink" }, // 开局天命
};

/** 单字小方章:20×20、1.5px 描边、圆角 2、字 11px、歪 -4°(手盖章的不正感)。 */
function Seal({ char, tone }: SealDef) {
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 rotate-[-4deg] items-center justify-center rounded-[2px] border-[1.5px] align-[-4px] text-[11px] leading-none ${TONE_CLASS[tone]}`}
    >
      {char}
    </span>
  );
}

export function WarlogPanel({ snapshot }: { snapshot: GameSnapshot }) {
  const [mode, setMode] = useState<"brief" | "detail">("brief");
  const recent = snapshot.log.slice(-MAX_LOG);
  return (
    <section data-testid={TESTIDS.warlogPanel} className="flex min-h-0 flex-[1.4] flex-col px-3 pb-2">
      {/* W5:tab 点击区扩到 ≥40px(items-baseline→center + 按钮 py-2.5,视觉字号不变);
          高度增量由标题栏自身吸收,不挤压日志区 */}
      <h3 className="flex items-center gap-2 py-1 font-brush text-base">
        诸侯 · 战报
        <span className="ml-auto flex gap-1 text-xs">
          {(["brief", "detail"] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={m === "brief" ? TESTIDS.warlogTabBrief : TESTIDS.warlogTabDetail}
              onClick={() => setMode(m)}
              className={`py-2.5 ${mode === m ? "border-b border-gold text-gold" : "text-ink-dim"} hover:text-ink`}
            >
              {m === "brief" ? "简报" : "详情"}
            </button>
          ))}
        </span>
      </h3>
      <OthersPanel snapshot={snapshot} />
      {/* 新日志在尾部:列表整体 flex-col-reverse,新条目自然贴底可见(等价旧 scrollTop 行为) */}
      <div className="mt-1 flex min-h-0 flex-1 flex-col-reverse gap-0.5 overflow-y-auto">
        {[...recent].reverse().map((e, i) => {
          const seal = LOG_SEAL[e.category] ?? { char: "纪", tone: "ink" as SealTone };
          return (
            <div key={recent.length - 1 - i} data-testid={TESTIDS.warlogItem} className="text-xs leading-5">
              {/* 只给最新一条(i===0)挂盖入动画:见 scroll.css 里 warlog-stamp-in 的注释 */}
              <span className={`mr-1 inline-block ${i === 0 ? "warlog-seal-anim" : ""}`}>
                <Seal {...seal} />
              </span>
              {mode === "brief" ? e.brief : e.detail}
              {e.amount != null && (
                <span className={e.amount >= 0 ? "text-money" : "text-danger"}>
                  {" "}
                  ({e.amount >= 0 ? "+" : "−"}
                  {formatMoney(Math.abs(e.amount))})
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
