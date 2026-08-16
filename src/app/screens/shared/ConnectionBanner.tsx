// F2 断线横幅:读 netStore.connection(全量 socket 状态)——二值 connected 区分不了
// 「还没建连」与「断了正在重连」,前者不该出横幅,所以数据源是三值状态。
// closed = 自动重连中(呼吸动画提示"还在努力");gaveUp = 10 次退避耗尽,只能刷新;
// 重连成功 socket 会再报 open,connection 回 open → 横幅自动消失(无需额外清理)。
import { useNetStore } from "@app/store/netStore";

export function ConnectionBanner() {
  const connection = useNetStore((s) => s.connection);
  if (connection !== "closed" && connection !== "gaveUp") return null;
  // 挂载点:game 屏棋盘区顶部(z-20 压过 hint)、lobby 屏卡片上方,由调用方决定布局。
  const gaveUp = connection === "gaveUp";
  return (
    <div
      data-testid="connection-banner"
      // 呼吸动画(animate-pulse):比静态红条更显眼,传达"正在重连"而非"已死"
      className={
        "absolute inset-x-0 top-0 z-20 flex justify-center bg-danger/90 py-1.5 font-deco text-sm text-white " +
        (gaveUp ? "" : "animate-pulse")
      }
    >
      {gaveUp ? "已断线,请刷新页面" : "连接中断,重连中…"}
    </div>
  );
}
