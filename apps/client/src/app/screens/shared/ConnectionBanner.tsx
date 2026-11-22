// 组件收口:器物级恢复横幅直接用 Base UI Button 行为层。
// #1421:底层 open 仍处于 calibrating,权威摘要校准完成才撤横幅;恢复动作只调
// 调用方提供的控制器公共行为。渲染/让位共用 useConnDown 与固定体高,不读 token。
import { Button } from "@base-ui/react/button";
import { useNetStore } from "@app/store/netStore";
import { TESTIDS } from "@app/screens/game/testids";

/** 横幅渲染与两屏让位的共同单源:仅未入座/校准完成时不在场。 */
export function useConnDown(): boolean {
  const connection = useNetStore((s) => s.connection);
  return connection !== "idle" && connection !== "open";
}

/** 不含 safe-top:上下各 8px + 44px 主行动;各态同高,让位不随文案抖动。 */
export const CONN_BANNER_BODY_H = 60;

interface ConnectionBannerProps {
  onReconnect: () => void;
  /** 沿所在屏现有离开通路;不宣称服务器释放座位。 */
  onExit: () => void;
}

export function ConnectionBanner({ onReconnect, onExit }: ConnectionBannerProps) {
  const connection = useNetStore((s) => s.connection);
  const reconnect = useNetStore((s) => s.reconnect);
  const failure = useNetStore((s) => s.connectionFailure);
  const connDown = useConnDown();
  if (!connDown) return null;
  const gaveUp = connection === "gaveUp";
  const retryable = gaveUp || connection === "failed";
  const message =
    connection === "calibrating"
      ? "连接已建立，正在校准局面…"
      : connection === "connecting"
        ? "正在建立连接…"
        : connection === "failed"
          ? failure
          : gaveUp
            ? "自动重连已耗尽"
            : `连接中断，自动重连中…${reconnect ? `（第 ${reconnect.attempt}/${reconnect.max} 次）` : ""}`;
  return (
    <div
      data-testid={TESTIDS.connectionBanner}
      aria-busy={!retryable}
      className="absolute top-0 z-20 flex items-center justify-center gap-3 rounded-b border border-danger/60 bg-panel font-wenkai text-sm text-paper shadow-lg"
      style={{
        // 顶左设置/详情两钮保留通路;右缘按所在屏棋盘/卡片容器收边。
        left: "calc(var(--safe-left) + 96px)",
        right: "max(var(--safe-right), 8px)",
        height: `calc(var(--safe-top) + ${CONN_BANNER_BODY_H}px)`,
        padding: "calc(var(--safe-top) + 8px) 12px 8px",
      }}
    >
      <span className="min-w-0" role="status">
        {message}
      </span>
      <Button
        data-testid={TESTIDS.connectionRetry}
        disabled={!retryable}
        onClick={onReconnect}
        className="ink-btn min-h-[44px] shrink-0 px-3 font-brush"
      >
        重新连接
      </Button>
      <Button
        data-testid={TESTIDS.connectionExit}
        onClick={onExit}
        className="note-btn min-h-[40px] shrink-0 px-3 font-brush"
      >
        返回首页
      </Button>
    </div>
  );
}
