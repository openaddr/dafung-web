// F2 断线横幅:读 netStore.connection(全量 socket 状态)——二值 connected 区分不了
// 「还没建连」与「断了正在重连」,前者不该出横幅,所以数据源是三值状态。
// closed = 自动重连中(呼吸动画提示"还在努力");gaveUp = 10 次退避耗尽,只能刷新;
// 重连成功 socket 会再报 open,connection 回 open → 横幅自动消失(无需额外清理)。
// #494:重连中附「(第 n/N 次)」真实进度(计数透传自 ReconnectingSocket,经
// netStore.reconnect;非重连态为 null,缺计数时只显示基础文案,不造假进度)。
// W2 包E(审计 A5):断线话术是动态文案,字族迁 wenkai(新文案不落小薇)。
// #853 让位:横幅在场时顶中知会槽/hint 行/game 屏选都提示 chip 整列下移让位
// (--conn-h,GameScreen 消费)——掉线横幅(z-20)与知会横幅槽(z-6)同踞顶中,
// 不让位则上半互压(审计 R6 P2-8 实拍)。在场判定与让位高度由本件单源吐出。
import { useNetStore } from "@app/store/netStore";

/** 断线在场判定(横幅渲染条件与 --conn-h 让位偏移的共同单源):closed = 重连中、
 *  gaveUp = 退避耗尽,两者出横幅;idle/open 不出。 */
export function useConnDown(): boolean {
  const connection = useNetStore((s) => s.connection);
  return connection === "closed" || connection === "gaveUp";
}

/** 横幅体高(px,不含 safe-top):6 上内距 + 20(text-sm 行高)+ 6 下内距。
 *  让位方(GameScreen --conn-h)按此偏移,槽位落横幅底缘下 8px(与常态同距)。 */
export const CONN_BANNER_BODY_H = 32;

export function ConnectionBanner() {
  const connection = useNetStore((s) => s.connection);
  const reconnect = useNetStore((s) => s.reconnect);
  if (connection !== "closed" && connection !== "gaveUp") return null;
  // 挂载点:game 屏棋盘区顶部(z-20 压过 hint)、lobby 屏卡片上方,由调用方决定布局。
  const gaveUp = connection === "gaveUp";
  return (
    <div
      data-testid="connection-banner"
      // 呼吸动画(animate-pulse):比静态红条更显眼,传达"正在重连"而非"已死"
      className={
        "absolute inset-x-0 top-0 z-20 flex justify-center bg-danger/90 font-wenkai text-sm text-white " +
        (gaveUp ? "" : "animate-pulse")
      }
    >
      {/* S3(#36):贴顶横幅在刘海屏横屏下会被刘海切字,垂直内边距吃进 safe-top */}
      <span style={{ paddingTop: "calc(var(--safe-top) + 6px)", paddingBottom: "6px" }}>
        {gaveUp
          ? "已断线,请刷新页面"
          : `连接中断,重连中…${reconnect ? `(第 ${reconnect.attempt}/${reconnect.max} 次)` : ""}`}
      </span>
    </div>
  );
}
