import { seatDecisionPointOf } from "@dafung/core/room/player-submissions";
import type { RoomRegistry, RoomSession } from "@dafung/core/room/room";

/** 仅给其他领域的房间测试准备开局前态，选都行为由认证连接验收。 */
export async function submitCapitalForSetup(
  registry: RoomRegistry,
  roomId: string,
  seat: number,
  tileIndex: number,
  onUpdate?: (room: RoomSession) => void,
): Promise<void> {
  const decisionPoint = seatDecisionPointOf(registry.get(roomId)!, seat);
  if (decisionPoint === null) throw new Error(`座位 ${seat} 当前无法选都`);
  const result = await registry.submitFromSeat(
    roomId,
    seat,
    {
      roomId,
      seat,
      decisionPoint,
      submissionId: `setup-${seat}`,
      cmd: { type: "pickCapital", tileIndex },
    },
    onUpdate,
  );
  if (result.outcome === "rejected") throw new Error(result.reason);
}
