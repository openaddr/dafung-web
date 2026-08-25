// 对局日志导出(ADR-0014,替代旧 L48 战报导出):胜利屏「导出日志」把该局完整 jsonl
// (含局头行)落成文件 dafung-log-<gameId>.jsonl。数据源优先单机 IndexedDB 归档
// (gameLogArchive.ts);无归档记录(联机局/老局)按内存 log 导出——局头缺失如实缺,不造。
import type { GameSnapshot } from "@app/store/gameStore";
import { loadArchive } from "@app/gameLogArchive";

export async function exportGameLog(snapshot: GameSnapshot): Promise<void> {
  const archived = await loadArchive(snapshot.gameId);
  // 归档优先,但只在不落后于内存 log 时采用(归档写队列异步,可能缺最后一两行);
  // 无记录/落后(联机局、老局、写入未落)按内存 log 导出——局头缺失如实缺,不造。
  const lines = archived && archived.lines.length >= snapshot.log.length ? archived.lines : snapshot.log;
  const blob = new Blob([lines.map((l) => JSON.stringify(l)).join("\n") + "\n"], {
    type: "application/x-ndjson",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `dafung-log-${snapshot.gameId}.jsonl`;
  a.click();
  URL.revokeObjectURL(a.href);
}
