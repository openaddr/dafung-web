// 组件收口:大厅墨钮与笺钮直接用 Base UI Button 行为层。
import { Button } from "@base-ui/react/button";
import type { ReactElement, ReactNode } from "react";
import { LID } from "./testids";
import { isLobbyStartPending, type LobbyStartState } from "./use-lobby-start";

interface LobbyStartActionsProps {
  state: LobbyStartState;
  mapSelected: boolean;
  disabled: boolean;
  connectionDown: boolean;
  onSelectMap: () => void;
  onStart: () => void;
  hint?: ReactElement | null;
  idleNote?: ReactNode;
}

export function LobbyStartActions({
  state,
  mapSelected,
  disabled,
  connectionDown,
  onSelectMap,
  onStart,
  hint,
  idleNote,
}: LobbyStartActionsProps) {
  const pending = isLobbyStartPending(state);
  const lockActions = disabled || connectionDown || pending;
  const failure = !connectionDown && state.kind === "failed" ? state.message : null;
  let status = null;
  if (!connectionDown) {
    if (state.kind === "requesting") status = "正在开局…";
    else if (state.kind === "syncing") status = "正在同步棋局…";
    else if (state.kind === "idle" && !disabled && !mapSelected && hint == null) {
      status = "需先选择地图";
    }
  }

  return (
    <div className="lobby-room-host-actions">
      <div className="lobby-room-message">
        <p role="status" className={pending ? "text-gold-bright" : "text-paper-dim"}>
          {status}
        </p>
        {failure !== null ? (
          <p role="alert" className="text-danger">
            {failure}
          </p>
        ) : (
          !connectionDown && status === null && hint
        )}
        {!connectionDown && state.kind === "idle" && idleNote}
      </div>
      <div aria-busy={pending} className="lobby-room-host-buttons">
        <Button
          data-testid={LID.selectMap}
          disabled={lockActions}
          onClick={onSelectMap}
          className="note-btn min-h-[40px] whitespace-nowrap px-3 font-brush text-sm disabled:opacity-40 sm:px-4"
        >
          选择地图
        </Button>
        <Button
          data-testid={LID.start}
          disabled={lockActions || !mapSelected}
          onClick={onStart}
          className="ink-btn min-h-[44px] whitespace-nowrap px-4 font-brush disabled:opacity-40 sm:min-w-[5.75rem]"
        >
          开局
        </Button>
      </div>
    </div>
  );
}
