import type { RoomRecord } from "./room-record";

/** 房间记录存取契约，由宿主注入实现。 */
export interface RoomPersistence {
  save(rec: RoomRecord): void;
  load(roomId: string): RoomRecord | null;
  remove(roomId: string): void;
  /** 仅检测存在(不做解析,供 newRoomId 冲突检测)。 */
  exists(roomId: string): boolean;
  listIds(): string[];
}
