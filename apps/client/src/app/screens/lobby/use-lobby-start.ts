import { useLayoutEffect, useRef, useState } from "react";

export type LobbyStartState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "syncing" }
  | { kind: "failed"; message: string };

const IDLE: LobbyStartState = { kind: "idle" };

export function isLobbyStartPending(state: LobbyStartState): boolean {
  return state.kind === "requesting" || state.kind === "syncing";
}

export function useLobbyStart(hostRoomId: string | null) {
  const activeHost = useRef<{ roomId: string; pending: boolean } | null>(null);
  const [progress, setProgress] = useState<{ roomId: string; state: LobbyStartState } | null>(null);

  useLayoutEffect(() => {
    activeHost.current = hostRoomId === null ? null : { roomId: hostRoomId, pending: false };
    setProgress(null);
    return () => {
      activeHost.current = null;
    };
  }, [hostRoomId]);

  function submit(request: () => Promise<void>): void {
    const host = activeHost.current;
    if (host === null || host.roomId !== hostRoomId || host.pending) return;
    // React 提交禁用态前，同一帧的再次点击也只能提交一次。
    host.pending = true;
    setProgress({ roomId: host.roomId, state: { kind: "requesting" } });
    void (async () => {
      try {
        await request();
        if (activeHost.current === host) {
          // REST 只确认开局请求，现有首份棋局切屏会卸载大厅并结束等待。
          setProgress({ roomId: host.roomId, state: { kind: "syncing" } });
        }
      } catch (error) {
        if (activeHost.current !== host) return;
        host.pending = false;
        const message = error instanceof Error ? error.message : String(error);
        setProgress({ roomId: host.roomId, state: { kind: "failed", message } });
      }
    })();
  }

  const state = progress !== null && progress.roomId === hostRoomId ? progress.state : IDLE;
  return { state, pending: isLobbyStartPending(state), submit };
}
