// 房间持久化适配器(ADR-0007):把 Room 的落盘做成可注入接口,
// 让 Room 模块本身零 fs 依赖。默认实现 FileRoomPersistence 落 rooms/*.json,
// 与原 server.ts 行为逐字节一致(同一目录、同一文件名、同一 JSON 形状)。
// 测试可注入 InMemory 实现。
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GameEngine } from "../src/core/game";
import type { SeatConfig } from "../src/core/game";
import type { AiDifficulty } from "../src/core/types";
import type { LoadedMap } from "../src/core/board-loader";
import { createEngine, MAP } from "./engine-helpers";

// ──────────────────────────── 共享数据形状(传输层 / 持久化层都用)────────────────────────────
export interface HostConfig {
  seed?: number;
  target?: number;
  difficulty?: AiDifficulty;
}

/** 持久化的座位:去掉运行时的 WebSocket 句柄等不可序列化字段。 */
export interface PersistedSeat {
  kind: "human" | "bot";
  token: string | null;
}

/** 落盘的房间记录:RoomSession 的纯数据投影。 */
export interface RoomRecord {
  roomId: string;
  seatCount: number;
  seats: PersistedSeat[];
  hostSeat: number;
  takeover: number[];
  hostConfig: HostConfig;
  /** 房间所选地图 id;null=未选图。恢复时据此重新加载对应地图。 */
  mapId: string | null;
  snapshot: ReturnType<GameEngine["snapshot"]> | null;
}

// ──────────────────────────── 持久化接口 ────────────────────────────
export interface RoomPersistence {
  save(rec: RoomRecord): void;
  load(roomId: string): RoomRecord | null;
  remove(roomId: string): void;
  /** 仅检测存在(不做解析,供 newRoomId 冲突检测)。 */
  exists(roomId: string): boolean;
  listIds(): string[];
}

// ──────────────────────────── 文件实现(默认,搬自原 server.ts)────────────────────────────
export class FileRoomPersistence implements RoomPersistence {
  private readonly dir: string;

  constructor(dirOrPath?: string) {
    this.dir = resolve(dirOrPath ?? process.env.ROOMS_DIR ?? "./rooms");
    mkdirSync(this.dir, { recursive: true });
  }

  private path(roomId: string): string {
    return join(this.dir, `${roomId}.json`);
  }

  save(rec: RoomRecord): void {
    writeFileSync(this.path(rec.roomId), JSON.stringify(rec, null, 2), "utf-8");
  }

  load(roomId: string): RoomRecord | null {
    const p = this.path(roomId);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf-8")) as RoomRecord;
    } catch (e) {
      console.warn(
        `[room-persistence] 跳过损坏的房间文件 ${roomId}.json:${e instanceof Error ? e.message : e}`,
      );
      return null;
    }
  }

  remove(roomId: string): void {
    try {
      unlinkSync(this.path(roomId));
    } catch {
      /* 忽略:文件不存在视为已删除 */
    }
  }

  exists(roomId: string): boolean {
    return existsSync(this.path(roomId));
  }

  listIds(): string[] {
    const ids: string[] = [];
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const rec = JSON.parse(readFileSync(join(this.dir, f), "utf-8")) as RoomRecord;
        ids.push(rec.roomId);
      } catch (e) {
        console.warn(
          `[room-persistence] 跳过损坏的房间文件 ${f}:${e instanceof Error ? e.message : e}`,
        );
      }
    }
    return ids;
  }
}

// ──────────────────────────── 重建辅助(自外存恢复 RoomSession)────────────────────────────
function dummySeats(n: number): SeatConfig[] {
  return Array.from({ length: n }, (_, i) => ({ name: `座 ${i + 1}`, isBot: false }));
}

/** 从 RoomRecord 重建引擎(若有 snapshot)。null = Lobby 态(未开局)。
 *  mapProvider:按 mapId 返回 LoadedMap(恢复时用对应地图重建引擎,而非全局 sanguo)。
 *  未提供 mapProvider 或 mapId 为空 → 退回默认 MAP(向后兼容旧记录 / 单机 CLI)。 */
export function engineFromRecord(
  rec: RoomRecord,
  mapProvider?: (mapId: string) => LoadedMap,
): GameEngine | null {
  if (!rec.snapshot) return null;
  const map = rec.mapId && mapProvider ? mapProvider(rec.mapId) : MAP;
  const engine = createEngine({ seats: dummySeats(rec.seatCount), ...rec.hostConfig }, false, map);
  engine.restoreFromSnapshot(rec.snapshot);
  return engine;
}

/** 把 RoomRecord 转成 RoomSession 的初始数据(座位不带 conn;takeover 转回 Set)。 */
export function recordToSessionData(
  rec: RoomRecord,
  mapProvider?: (mapId: string) => LoadedMap,
): {
  roomId: string;
  seatCount: number;
  seats: PersistedSeat[];
  hostSeat: number;
  takeover: Set<number>;
  hostConfig: HostConfig;
  mapId: string | null;
  engine: GameEngine | null;
} {
  return {
    roomId: rec.roomId,
    seatCount: rec.seatCount,
    seats: rec.seats.map((s) => ({ ...s })),
    hostSeat: rec.hostSeat ?? 0,
    takeover: new Set(rec.takeover ?? []),
    hostConfig: rec.hostConfig,
    mapId: rec.mapId ?? null,
    engine: engineFromRecord(rec, mapProvider),
  };
}
