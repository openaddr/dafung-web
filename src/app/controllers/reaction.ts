// 反应窗查询助手(app 层单源,#284 卫生清理):被询问集公式原本在 controllers/local.ts、
// controllers/online.ts、screens/game/ReactionBanner.tsx 三处各持一份手抄,收口于此。
// 公式与引擎 reactionQueriedOf(src/core/authority.ts)、传输层镜像 reactionQueriedSeats
// (scripts/room.ts)同一份语义,四处属层界各自保留、注释互指——core 不反向依赖 app,
// scripts 不吃 app(层界红线),故不做跨层物理单源。
// jinnang 窗=公告询问集(联机投影后每人只看到「自己是否被询问」,ADR-0016);
// march 窗=[城主]。
import type { ReactionView } from "@core/reaction-window";

/** 反应窗被询问座位集(view 单源)。 */
export function reactionQueriedSeats(view: ReactionView): number[] {
  return view.kind === "jinnang" ? view.queriedBySeat : [view.ownerSeat];
}

/** 该座位是否被当前反应窗询问。 */
export function reactionQueriesSeat(view: ReactionView, seat: number): boolean {
  return reactionQueriedSeats(view).includes(seat);
}
