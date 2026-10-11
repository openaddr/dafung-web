// 房间记录与水合(#427 单源):RoomRecord 落盘形状 + 「记录 → 引擎」重建纯逻辑,
// 全仓唯一实现(此前 room-persistence.ts 的死拷贝与 room.ts 的本地等价在此收口)。
// 零 node 依赖、零 fs——浏览器进程内单机通路(src/app/controllers/local.ts)可直接 import;
// 地图经 mapProvider 注入、骰子由 config.seed 经 core createDice 构造,无任何默认图/全局兜底:
// 快照存在而缺 mapId 或加载器 = 记录损坏,当场抛(恢复期由 RoomRegistry.restoreAll
// 的「跳过不可恢复房间」接住并告警移除)。持久化介质(FileRoomPersistence/内存)归
// room-persistence.ts,房间编排归 room.ts,两者同源消费本模块。
import { GameEngine } from "../src/core/authority";
import type { AiDifficulty, EngineConfig, SeatConfig } from "../src/core/authority";
import type { EncounterConfig } from "../src/core/encounters";
import type { LoadedMap } from "../src/core/board-loader";
import { createDice } from "../src/core/dice";

export interface HostConfig {
  seed?: number;
  target?: number;
  difficulty?: AiDifficulty;
}

/** 持久化的座位:去掉运行时的 WebSocket 句柄等不可序列化字段。 */
export interface PersistedSeat {
  kind: "human" | "bot";
  token: string | null;
  /** 加入者预设国号(旧记录无此字段 → null);重名前缀在开局时统一分配。 */
  guohao: string | null;
}

/** 落盘的房间记录:RoomSession 的纯数据投影。 */
export interface RoomRecord {
  roomId: string;
  seatCount: number;
  seats: PersistedSeat[];
  hostSeat: number;
  takeover: number[];
  /** 自助托管(座位 → 速度);与 takeover 分离,重连不清除。 */
  autoPilot: { seat: number; speed: "fast" | "slow" }[];
  hostConfig: HostConfig;
  /** 房间所选地图 id;null=未选图。恢复时据此重新加载对应地图。 */
  mapId: string | null;
  /** 本局机遇配置(#135);null/缺省(旧记录)=机遇关。恢复引擎时传回构造 config。 */
  encounter?: EncounterConfig | null;
  snapshot: ReturnType<GameEngine["snapshot"]> | null;
}

/** 全新引擎(引擎构造三行;调用点恒显式传图,无默认图分支)。 */
export function createEngine(config: EngineConfig, doDraft: boolean, map: LoadedMap): GameEngine {
  const engine = new GameEngine(map.board, map.catalog, createDice(config.seed), config);
  if (doDraft) engine.doDraftRoll();
  return engine;
}

/** 持久化座位 → 构造座位壳(水合重建引擎用;引擎按快照覆盖,名字仅占位)。 */
function dummySeats(n: number): SeatConfig[] {
  return Array.from({ length: n }, (_, i) => ({ name: `座 ${i + 1}`, isBot: false }));
}

/** RoomRecord 快照 → 引擎(唯一实现)。null = Lobby 态(未开局)。
 *  mapProvider:按 mapId 返回 LoadedMap(恢复时用对应地图重建引擎,而非全局默认图)。
 *  reactionWindowMs(#284):registry 的 env 覆盖值随恢复透传(>0 才生效),重启后
 *  新开的反应窗与重启前同长(已挂起窗的 windowMs 在快照内保真,不经此)。 */
export function engineFromRecord(
  rec: RoomRecord,
  mapProvider?: (mapId: string) => LoadedMap,
  reactionWindowMs?: number,
): GameEngine | null {
  if (!rec.snapshot) return null;
  if (!rec.mapId || !mapProvider)
    throw new Error(`房间 ${rec.roomId}:快照存在但缺地图 id 或加载器(记录损坏)`);
  const map = mapProvider(rec.mapId);
  const engine = createEngine(
    {
      seats: dummySeats(rec.seatCount),
      ...rec.hostConfig,
      // #135:机遇配置随房间记录恢复(缺省 = 机遇关,与历史记录行为一致)
      ...(rec.encounter ? { encounter: rec.encounter } : {}),
      // #284:反应窗时长覆盖随恢复透传(缺省走 core 常量表)
      ...(reactionWindowMs != null && reactionWindowMs > 0 ? { reactionWindowMs } : {}),
    },
    false,
    map,
  );
  engine.restoreFromSnapshot(rec.snapshot);
  return engine;
}
