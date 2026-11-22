// 房间持久化适配器(ADR-0007):把 Room 的落盘做成可注入接口,
// 让 Room 模块本身零 fs 依赖。默认实现 FileRoomPersistence 落 data/rooms/*.json,
// 与原 server.ts 行为逐字节一致(同一目录、同一文件名、同一 JSON 形状)。
// 测试可注入 InMemory 实现。记录形状(RoomRecord 及子形状)与水合纯逻辑单源在
// room-record.ts(#427);本模块只管介质(fs 落盘/读档),形状消费方直引 room-record.ts。
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RoomPersistence } from "@dafung/core/room/room-persistence";
import type { RoomRecord } from "@dafung/core/room/room-record";

export class FileRoomPersistence implements RoomPersistence {
  private readonly dir: string;

  constructor(dirOrPath?: string) {
    this.dir = resolve(dirOrPath ?? process.env.ROOMS_DIR ?? "./data/rooms");
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
    rmSync(this.path(roomId), { force: true });
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
