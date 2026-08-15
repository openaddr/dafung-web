// 侧栏·回合状态区(对照旧 renderStatusBar):回合号 + 当前活跃玩家大卡。
// 快照里已有派生 netWorth(serializeGame 算好),这里只读不重算(避免口径漂移)。
import { rgba, playerColor } from "@core/theme";
import { formatMoney } from "@core/money";
import type { GameSnapshot } from "@app/store/gameStore";
import { TESTIDS } from "./testids";

export function StatusBar({ snapshot }: { snapshot: GameSnapshot }) {
  // 三种态:开局布阵 / 终局称帝 / 常规回合大卡(与旧 renderStatusBar 逐分支对齐)
  let body: React.ReactNode;
  if (snapshot.phase === "Setup") {
    body = <div className="px-2 py-1 text-sm text-ink-dim">开局布阵中…</div>;
  } else if (snapshot.phase === "GameOver") {
    const w = snapshot.players.find((p) => p.id === snapshot.winner);
    body = (
      <div data-testid={TESTIDS.statusCard} className="px-2 py-1 font-brush text-xl text-gold">
        {w ? `「${w.guohao}」称帝` : "终局"}
      </div>
    );
  } else {
    const p = snapshot.players[snapshot.activeIndex];
    body = (
      <div
        data-testid={TESTIDS.statusCard}
        // 玩家色沿用旧的 CSS 变量注入模式(--player-color),子元素用任意值类取色
        style={{ ["--player-color" as string]: rgba(playerColor(p.colorIndex)) }}
        className="mt-1 flex items-center gap-2 rounded border-l-4 bg-panel-hi px-2 py-1.5"
      >
        <span
          data-testid={TESTIDS.statusGuohao}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--player-color) font-brush text-xl text-white"
        >
          {p.guohao || "?"}
        </span>
        <div className="min-w-0">
          <div className="font-brush text-lg leading-tight">{p.guohao} 的回合</div>
          <div data-testid={TESTIDS.statusMeta} className="truncate text-xs text-ink-dim">
            {formatMoney(p.cash)} · 委任 {p.warrants} · 身价 {formatMoney(p.netWorth)}
          </div>
        </div>
      </div>
    );
  }
  return (
    <section data-testid={TESTIDS.statusBarPanel} className="border-b border-gold/40 px-3 py-2">
      <h3 className="flex items-baseline justify-between font-brush text-base">
        回合
        <span data-testid={TESTIDS.roundInfo} className="text-xs text-ink-dim">
          第 {snapshot.round} 轮
        </span>
      </h3>
      {body}
    </section>
  );
}
