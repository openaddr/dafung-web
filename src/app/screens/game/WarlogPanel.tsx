// 侧栏·战报区(对照旧 renderWarlog):诸侯紧凑条 + 日志(简报/详情双 tab)。
// React 声明式下无需旧版的增量断点渲染,直接渲染最近 N 条(300,与旧 DOM 上限一致)。
// G-12:条目前置玩家国号色徽(数据映射:LogEvent.player 存的是国号文本,按 guohao
//       匹配 snapshot.players;映射不到不加徽,宁缺勿错)。
// G-13:按轮插「—第X轮—」分隔(轮界=轮锚点玩家开启新 turn,见 buildLogItems);
//       上滚离底时显示「回最新 ▾」浮标(flex-col-reverse 下底部=scrollTop 0)。
import { useRef, useState } from "react";
import { formatMoney } from "@core/money";
import { rgba, playerColor } from "@core/theme";
import type { GameSnapshot } from "@app/store/gameStore";
import type { LogEvent } from "@core/types";
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

/** G-12 玩家色徽:与 OthersPanel 诸侯条同款(国号字 + playerColor 圆底)。 */
function PlayerBadge({ guohao, colorIndex }: { guohao: string; colorIndex: number }) {
  return (
    <span
      className="mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-brush text-[11px] leading-none text-white align-[-4px]"
      style={{ background: rgba(playerColor(colorIndex)) }}
    >
      {guohao}
    </span>
  );
}

/** 渲染项:日志条 or 轮次分隔(G-13)。 */
type LogItem = { kind: "sep"; round: number; key: string } | { kind: "log"; entry: LogEvent; key: string };

/** G-13 构造带轮次分隔的渲染序列(时间正序)。
 *  轮界推导:引擎在轮锚点玩家(roundAnchor 座位,不随破产漂移)endTurn 时 round+1,
 *  所以「锚点玩家开启新 turn 的那条日志」= 新一轮的起点;最后一个轮界的轮号就是
 *  snapshot.round,更早的轮界逐个递减。锚点玩家若中途破产换锚,历史轮界会漏计
 *  (换锚仅发生在锚点破产,罕见;分隔是视觉锚点,误差可接受,不影响数据)。 */
function buildLogItems(log: LogEvent[], snapshot: GameSnapshot): LogItem[] {
  const anchorGuohao = snapshot.players[snapshot.roundAnchor]?.guohao;
  if (!anchorGuohao) {
    return log.map((entry, i) => ({ kind: "log", entry, key: `log-${i}` }));
  }
  // 轮界下标(含 0 = 切片起点,首段可能是被 MAX_LOG 截断的残轮)。
  const starts: number[] = [0];
  for (let i = 1; i < log.length; i++) {
    if (log[i].turn !== log[i - 1].turn && log[i].player === anchorGuohao) starts.push(i);
  }
  // 各轮界轮号:最后一个轮界 = snapshot.round,向前逐个递减。
  const roundAt = new Map<number, number>();
  starts.forEach((s, k) => roundAt.set(s, snapshot.round - (starts.length - 1 - k)));
  const items: LogItem[] = [];
  for (let i = 0; i < log.length; i++) {
    const r = roundAt.get(i);
    if (r != null && r >= 1) items.push({ kind: "sep", round: r, key: `sep-${i}` });
    items.push({ kind: "log", entry: log[i], key: `log-${i}` });
  }
  return items;
}

export function WarlogPanel({ snapshot }: { snapshot: GameSnapshot }) {
  const [mode, setMode] = useState<"brief" | "detail">("brief");
  // G-13:上滚离底标记(flex-col-reverse 下底部 = scrollTop 0,离底 = scrollTop > 60)。
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const recent = snapshot.log.slice(-MAX_LOG);
  const items = buildLogItems(recent, snapshot);
  // G-12:国号 → 玩家映射(LogEvent.player 存国号文本;见文件头注释)。
  const byGuohao = new Map(snapshot.players.map((p) => [p.guohao, p]));
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
      {/* 新日志在尾部:列表整体 flex-col-reverse,新条目自然贴底可见(等价旧 scrollTop 行为);
          外层 relative 承载「回最新」浮标(G-13)。 */}
      <div className="relative mt-1 flex min-h-0 flex-1 flex-col">
        <div
          ref={listRef}
          onScroll={(e) => setAwayFromLatest(e.currentTarget.scrollTop > 60)}
          className="flex min-h-0 flex-1 flex-col-reverse gap-0.5 overflow-y-auto"
        >
          {[...items].reverse().map((item, i) => {
            if (item.kind === "sep") {
              return (
                <div
                  key={item.key}
                  className="py-0.5 text-center font-deco text-[10px] tracking-widest text-ink-dim/80"
                >
                  —第{item.round}轮—
                </div>
              );
            }
            const e = item.entry;
            const seal = LOG_SEAL[e.category] ?? { char: "纪", tone: "ink" as SealTone };
            // G-12:国号匹配到玩家才加色徽(宁缺勿错;system 类 player=null 自然无徽)。
            const owner = e.player != null ? byGuohao.get(e.player) : undefined;
            return (
              <div key={item.key} data-testid={TESTIDS.warlogItem} className="text-xs leading-5">
                {/* 只给最新一条(i===0)挂盖入动画:见 scroll.css 里 warlog-stamp-in 的注释 */}
                <span className={`mr-1 inline-block ${i === 0 ? "warlog-seal-anim" : ""}`}>
                  <Seal {...seal} />
                </span>
                {owner && <PlayerBadge guohao={owner.guohao} colorIndex={owner.colorIndex} />}
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
        {/* G-13:上滚离底 → 「回最新」浮标钉在日志区底边内侧,点击滚回底部(scrollTop=0)。 */}
        {awayFromLatest && (
          <button
            type="button"
            onClick={() => listRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded border border-gold/60 bg-panel/95 px-2 py-0.5 font-deco text-[11px] text-gold shadow hover:bg-panel-hi"
          >
            回最新 ▾
          </button>
        )}
      </div>
    </section>
  );
}
