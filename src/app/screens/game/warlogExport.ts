// 战报导出(L48):战报不再在对局内展示,胜利屏「导出战报」把引擎快照里的完整
// log(snapshot.log 零删减,含 brief/detail/amount/category)落成 JSON 文件,
// 供 AI/人工复盘定位对局问题。实现对照 EditorScreen 导出(Blob + a[download])。
// 数据源仍是快照:调试钩子 window.__dafung.snapshot().log 随时可取,导出只是 UI 入口。
import type { GameSnapshot } from "@app/store/gameStore";

/** 导出文件名:dafung-warlog-<UTC 时间戳>.json(单文件自包含,免重名覆盖)。 */
function warlogFilename(now: Date): string {
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14); // YYYYMMDDHHmmss
  return `dafung-warlog-${stamp}.json`;
}

export function exportWarlog(snapshot: GameSnapshot): void {
  // 文件头带对局摘要(轮次/终局玩家面板),AI 读日志时不用反推上下文
  const payload = {
    exportedAt: new Date().toISOString(),
    round: snapshot.round,
    turnNumber: snapshot.turnNumber,
    isOver: snapshot.isOver,
    winner: snapshot.winner,
    players: snapshot.players.map((p) => ({
      id: p.id,
      guohao: p.guohao,
      isBot: p.isBot,
      isBankrupt: p.isBankrupt,
      cash: p.cash,
      netWorth: p.netWorth,
      warrants: p.warrants,
      properties: p.properties,
      treasures: p.treasures,
      heroes: p.heroes.map((h) => h.id),
    })),
    log: snapshot.log,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = warlogFilename(new Date());
  a.click();
  URL.revokeObjectURL(a.href);
}
