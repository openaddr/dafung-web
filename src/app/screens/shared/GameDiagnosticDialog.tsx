// 组件收口:ui/dialog、ui/scroll-area 与 Base UI 单选及按钮，沿用水墨皮。
import { Button } from "@base-ui/react/button";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { ScrollArea } from "@app/components/ui/scroll-area";
import { buildDiagPerfText, copyDiagText, exportDiagnostics } from "@app/diagExport";
import {
  gameArchiveFailureText,
  type ArchivedGameSummary,
  type GameArchiveFailure,
} from "@app/game-diagnostic-record";
import {
  latestGameArchiveFailure,
  listArchivedGames,
  waitForGameArchive,
} from "@app/gameLogArchive";
import { DialogDragHandle } from "@app/hooks/use-dialog-drag";
import { InkBreathe, SealEmpty } from "./ArtifactEmpty";
import { RoundClose } from "./RoundClose";
import { GAME_DIAG_TID } from "./testids";

export interface CurrentDiagnosticGame {
  gameId: string;
  captureError: Promise<string | null>;
}

interface GameDiagnosticDialogProps {
  current?: CurrentDiagnosticGame;
  onClose: () => void;
  onBack?: () => void;
}

type ActionState =
  | { phase: "idle" | "saving" | "copying" }
  | { phase: "done" | "error"; message: string };

const playedAtFormat = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "medium",
  hour12: false,
});

export function GameDiagnosticDialog({ current, onClose, onBack }: GameDiagnosticDialogProps) {
  const [games, setGames] = useState<ArchivedGameSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [unarchivedFailures, setUnarchivedFailures] = useState<readonly GameArchiveFailure[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [checkedArchive, setCheckedArchive] = useState<{
    gameId: string;
    failures: readonly GameArchiveFailure[];
  } | null>(null);
  const [action, setAction] = useState<ActionState>({ phase: "idle" });
  const busy = action.phase === "saving" || action.phase === "copying";
  const selected = games?.find((game) => game.gameId === selectedGameId);
  const archiveFailures = checkedArchive?.gameId === selectedGameId ? checkedArchive.failures : [];
  const reportedCapture = archiveFailures.some(
    (failure) => failure.kind === "capture" && failure.message === captureError,
  );

  useEffect(() => {
    let alive = true;
    const readHistory = async () => {
      const captureFailure = await current?.captureError;
      if (!alive) return;
      if (captureFailure != null) setCaptureError(captureFailure);
      try {
        const [summaries, latestFailure] = await Promise.all([
          listArchivedGames(),
          current === undefined ? latestGameArchiveFailure() : null,
        ]);
        if (!alive) return;
        setGames(summaries);
        if (
          latestFailure !== null &&
          !summaries.some((game) => game.gameId === latestFailure.gameId)
        ) {
          setUnarchivedFailures(latestFailure.failures);
        }
        // 局中缺当前局时留空选择，让玩家明确点选历史局。
        setSelectedGameId(current === undefined ? (summaries[0]?.gameId ?? null) : current.gameId);
      } catch (error: unknown) {
        if (alive) setLoadError(error instanceof Error ? error.message : String(error));
      }
    };
    void readHistory();
    return () => {
      alive = false;
    };
  }, [current]);

  useEffect(() => {
    if (selectedGameId === null) return;
    let alive = true;
    void waitForGameArchive(selectedGameId).then((failures) => {
      if (alive) setCheckedArchive({ gameId: selectedGameId, failures });
    });
    return () => {
      alive = false;
    };
  }, [selectedGameId]);

  const saveFile = async (gameId: string): Promise<void> => {
    setAction({ phase: "saving" });
    try {
      const result = await exportDiagnostics(gameId);
      if (result === null) setAction({ phase: "idle" });
      else setAction({ phase: "done", message: `已保存至 ${result.path}` });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setAction({ phase: "error", message: `保存失败：${detail}` });
    } finally {
      const failures = await waitForGameArchive(gameId);
      setCheckedArchive({ gameId, failures });
    }
  };

  const copyPerf = async (gameId: string): Promise<void> => {
    setAction({ phase: "copying" });
    try {
      await copyDiagText(await buildDiagPerfText(gameId));
      setAction({ phase: "done", message: "帧诊已复制。" });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setAction({ phase: "error", message: `复制失败：${detail}` });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid={GAME_DIAG_TID.dialog}
        initialFocus={false}
        className="w-[min(92vw,520px)] gap-2.5 px-5 pt-3 pb-4"
      >
        <DialogDragHandle aria-hidden="true" className="absolute inset-x-0 top-0 h-11" />
        <DialogTitle data-dialog-heading className="shrink-0 min-h-10 pr-12">
          对局诊断
        </DialogTitle>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-2 py-1 pr-3 font-wenkai text-sm">
            {captureError !== null && !reportedCapture && (
              <p role="alert" className="break-words text-danger">
                当前局现场采集失败：{captureError}
              </p>
            )}
            {archiveFailures.map((failure) => (
              <p key={failure.kind} role="alert" className="break-words text-danger">
                {gameArchiveFailureText(failure)}
              </p>
            ))}
            {unarchivedFailures.map((failure) => (
              <p key={failure.kind} role="alert" className="break-words text-danger">
                最近一局 · {gameArchiveFailureText(failure)}
              </p>
            ))}
            {loadError !== null && (
              <p role="alert" className="break-words text-danger">
                读取对局诊断失败：{loadError}
              </p>
            )}
            {games === null && loadError === null && <InkBreathe title="正在读取对局诊断" />}
            {games?.length === 0 && (
              <SealEmpty char="空" title="暂无对局诊断记录" note="暂无对局诊断记录" />
            )}
            {games !== null && games.length > 0 && (
              <>
                {selected === undefined && (
                  <p className="text-paper-dim">当前局暂无诊断记录，可选择历史对局。</p>
                )}
                <RadioGroup
                  aria-label="选择对局"
                  value={selectedGameId}
                  disabled={busy}
                  onValueChange={(gameId) => {
                    setSelectedGameId(gameId);
                    setAction({ phase: "idle" });
                  }}
                  className="grid gap-1.5"
                >
                  {games.map((game) => (
                    <Radio.Root
                      key={game.gameId}
                      value={game.gameId}
                      data-testid={GAME_DIAG_TID.game(game.gameId)}
                      className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded border border-[var(--hairline)] px-3 py-1.5 focus-visible:outline-gold data-[checked]:border-gold data-[checked]:bg-gold/15 "
                    >
                      <span className="grid gap-0.5">
                        <time
                          className="tabular-nums"
                          dateTime={new Date(game.lastPlayedAt).toISOString()}
                        >
                          {playedAtFormat.format(game.lastPlayedAt)}
                        </time>
                        <span className="break-words text-xs text-paper-dim">
                          {game.mode === "solo" ? "单机" : "联机"} ·{" "}
                          {game.mapId === null ? "地图未记录" : game.mapId}
                          {game.gameId === current?.gameId && " · 当前局"}
                        </span>
                      </span>
                      <span className="text-right text-xs text-paper-dim tabular-nums">
                        {game.logCount === 0 ? "暂无日志" : `${game.logCount} 条日志`}
                      </span>
                    </Radio.Root>
                  ))}
                </RadioGroup>
              </>
            )}
          </div>
        </ScrollArea>
        <div className="shrink-0 border-t border-[var(--hairline)] pt-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onBack !== undefined && (
              <Button
                className="note-btn mr-auto min-h-10 rounded px-3 font-brush focus-visible:outline-gold"
                onClick={onBack}
              >
                返回设置
              </Button>
            )}
            <Button
              disabled={selected === undefined || busy}
              className="note-btn min-h-10 rounded px-3 font-brush focus-visible:outline-gold disabled:opacity-50"
              onClick={() => {
                if (selected !== undefined) void copyPerf(selected.gameId);
              }}
            >
              {action.phase === "copying" ? "复制中…" : "复制帧诊"}
            </Button>
            <Button
              data-testid={GAME_DIAG_TID.save}
              disabled={selected === undefined || busy}
              className="ink-btn min-h-11 rounded px-4 font-brush focus-visible:outline-gold "
              onClick={() => {
                if (selected !== undefined) void saveFile(selected.gameId);
              }}
            >
              {action.phase === "saving" ? "保存中…" : "保存文件"}
            </Button>
          </div>
          {(action.phase === "done" || action.phase === "error") && (
            <p
              role={action.phase === "error" ? "alert" : "status"}
              className={`mt-1 max-h-12 overflow-y-auto font-wenkai text-xs [overflow-wrap:anywhere] ${action.phase === "error" ? "text-danger" : "text-paper-dim"}`}
            >
              {action.message}
            </p>
          )}
        </div>
        <RoundClose />
      </DialogContent>
    </Dialog>
  );
}
