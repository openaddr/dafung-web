// 组件收口:大厅墨钮与笺钮直接用 Base UI Button 行为层。
import { Button } from "@base-ui/react/button";
import { LID } from "./testids";
import { isLobbyStartPending, type LobbyStartState } from "./use-lobby-start";

interface LobbyStartActionsProps {
  state: LobbyStartState;
  shortLandscape: boolean;
  mapSelected: boolean;
  disabled: boolean;
  connectionDown: boolean;
  onSelectMap: () => void;
  onStart: () => void;
}

export function LobbyStartActions({
  state,
  shortLandscape,
  mapSelected,
  disabled,
  connectionDown,
  onSelectMap,
  onStart,
}: LobbyStartActionsProps) {
  const pending = isLobbyStartPending(state);
  const lockActions = disabled || connectionDown || pending;
  const failure = !connectionDown && state.kind === "failed" ? state.message : null;
  let status = null;
  if (!connectionDown) {
    if (state.kind === "requesting") status = "正在开局…";
    else if (state.kind === "syncing") status = "正在同步棋局…";
    else if (state.kind === "idle" && !disabled && !mapSelected) status = "需先选择地图";
  }

  return (
    <div
      className={`flex shrink-0 flex-col gap-1 ${shortLandscape ? "lobby-actions mt-auto" : "mt-3"}`}
    >
      <div
        aria-busy={pending}
        className={`flex items-center gap-3 ${shortLandscape ? "justify-between" : "justify-center"}`}
      >
        <Button
          data-testid={LID.selectMap}
          disabled={lockActions}
          onClick={onSelectMap}
          className="note-btn min-h-[40px] px-4 font-brush text-sm disabled:opacity-40"
        >
          选择地图
        </Button>
        <Button
          data-testid={LID.start}
          disabled={lockActions || !mapSelected}
          onClick={onStart}
          className="ink-btn min-h-[44px] px-4 font-brush disabled:opacity-40"
        >
          开局
        </Button>
      </div>
      <div className="min-h-5 wrap-anywhere text-center font-wenkai text-sm leading-5">
        <p role="status" className={pending ? "text-gold-bright" : "text-paper-dim"}>
          {status}
        </p>
        {failure !== null && (
          <p role="alert" className="text-danger">
            {failure}
          </p>
        )}
      </div>
    </div>
  );
}
