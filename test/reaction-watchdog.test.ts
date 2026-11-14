// 反应窗超时看门狗直驱单测(room/watchdogs 编排层,#281/#284,ADR-0017):
// 权威语义面「窗内不应答 → 定时代发『不用』,结算照走,对局不冻结」由 #1181 从浏览器
// e2e 迁入无头层(原承载:e2e/react-reaction.spec.ts「超时兜底」+ e2e/react-reaction-online
// .spec.ts「超时代发」「断线座位」)。落点=registry 直驱(先例 test/online/room.test.ts 停摆
// 看门狗例):ManualClock 手泵零墙钟,断言语义等价——reaction-decline 观测行、
// reactionRespond use=0 对局日志行、结算(份额失效/城防降级)、窗收续推。
// 断线座位同文件(同族):markSeatOffline 是 WS close 的房间编排入口,看门狗武装
// 判定不区分在线/离线(离线冻结座位同样武装,断线者超时即「不用」,ADR-0017 后果节)
// ——真 WS 关闭的传输面接线归 protocol-online(ADR-0055 场景),不在本文件重复。
import { describe, it, expect } from "bun:test";
import { RoomRegistry } from "../scripts/room";
import type { RoomClock } from "../scripts/room";
import type { RoomPersistence } from "../scripts/room-persistence";
import type { RoomRecord } from "../scripts/room-record";
import type { LoadedMap } from "../src/core/board-loader";
import { MAP } from "../scripts/engine-helpers";

/** 测试用最小地图清单与 provider(同 test/online/room.test.ts 口径:零 fs,所有 id 返同一图)。 */
const VALID_MAP_IDS = new Set(["guanzhong", "zhongyuan"]);
const testMapProvider = (_id: string): LoadedMap => MAP;

class InMemoryPersistence implements RoomPersistence {
  private readonly m = new Map<string, RoomRecord>();
  save(rec: RoomRecord): void {
    this.m.set(rec.roomId, rec);
  }
  load(roomId: string): RoomRecord | null {
    return this.m.get(roomId) ?? null;
  }
  remove(roomId: string): void {
    this.m.delete(roomId);
  }
  exists(roomId: string): boolean {
    return this.m.has(roomId);
  }
  listIds(): string[] {
    return [...this.m.keys()];
  }
}

/** 手动时钟(同 test/online/room.test.ts):定时全挂表,fireAll 手动泵,零真实等待。 */
class ManualClock implements RoomClock {
  private readonly pending = new Map<unknown, () => void>();
  setTimeout(cb: () => void, _ms: number): unknown {
    const id = {} as unknown;
    this.pending.set(id, cb);
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.pending.delete(handle);
  }
  fireAll(): void {
    const cbs = [...this.pending.values()];
    this.pending.clear();
    for (const cb of cbs) cb();
  }
  get size(): number {
    return this.pending.size;
  }
}

/** 宏任务让位(同 test/online/room.test.ts):嵌套 await 的链延续先于下一次泵送落地。 */
const macroTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 建一个已开局进 Playing 的三人房(seat0=host 真人 / seat1=guest 真人 / seat2=bot),
 *  ManualClock 注入(看门狗定时全手泵);开局链随 seed 确定性停靠后把挂表排干,
 *  返回干净底座(时钟归零,后续武装只可能来自测试自己驱动的那条链)。 */
async function playingRoom(clock: ManualClock, seed = 42) {
  const events: Record<string, unknown>[] = [];
  const reg = new RoomRegistry(
    new InMemoryPersistence(),
    (_roomId, event) => events.push(event as Record<string, unknown>),
    undefined,
    { clock },
  );
  const created = reg.createRoom({
    seatCount: 3,
    botIdx: new Set([2]),
    hostConfig: { seed },
  });
  const roomId = created.room.roomId;
  reg.joinSeat(roomId); // seat1 真人
  reg.setMap(roomId, "guanzhong", created.token, VALID_MAP_IDS);
  await reg.startGame(roomId, created.token, undefined, testMapProvider);
  const e = reg.get(roomId)!.engine!;
  for (let i = 0; i < 20 && e.phase === "Setup"; i++)
    await reg.pickCapital(roomId, e.currentSetupPlayerIndex, e.offeredCapitals[0]!);
  expect(e.phase).toBe("Playing");
  // 排干开局链残留挂表(autoRoll 等;看门狗到点重校验不过即静默退场):
  for (let i = 0; i < 50 && clock.size > 0; i++) {
    clock.fireAll();
    await macroTick();
  }
  expect(clock.size).toBe(0);
  return { reg, roomId, events, e };
}

describe("反应窗超时看门狗(room/watchdogs 直驱,#281/#284,#1181 迁移)", () => {
  it("窗内不应答:超时到点代发「不用」——份额失效结算照走、窗收、链续推", async () => {
    const clock = new ManualClock();
    const { reg, roomId, events, e } = await playingRoom(clock);
    // 布场:seat0(真人)出横征暴敛(全体域,宣布即入窗,无目标段);seat1 持识破诡计
    // =唯一被询问座位(jinnang 窗询问集=持识破者,引擎单源);清标签名额保出牌可用。
    e.activeIndex = 0;
    e.pendingJinnang = null;
    e.pendingSkill = null;
    e.jinnangUsedTags = [];
    e.turnPhase = "AwaitingJinnang";
    e.players[0].jinnangHand = ["横征暴敛"];
    e.players[0].jinnangHandCount = 1;
    e.players[1].jinnangHand = ["识破诡计"];
    e.players[1].jinnangHandCount = 1;
    const userCashBefore = e.players[0].cash;
    const guestCashBefore = e.players[1].cash;
    const botCashBefore = e.players[2].cash;

    // 命令过公共路径(内部通路):宣布 → 开窗 → 链为待应答真人武装 per-seat 定时器
    await reg.applyCommand(roomId, { type: "useJinnang", cardId: "横征暴敛" });
    expect<string>(e.turnPhase).toBe("AwaitingReaction"); // 显式宽化:赋值窄化不绑架断言
    const view = e.pendingReaction?.view;
    expect(view?.kind === "jinnang" && view.queriedBySeat).toEqual([1]);
    expect(clock.size).toBe(1); // 恰一表项:reactionWait(seat1)已武装,无其他挂表

    // 泵送:窗寿到点 → 看门狗代发「不用」(与玩家手点同一条 respondReaction 命令路径)
    for (let i = 0; i < 4000 && !events.some((ev) => ev.ev === "reaction-decline"); i++) {
      clock.fireAll();
      await macroTick();
    }
    const declines = events.filter((ev) => ev.ev === "reaction-decline");
    expect(declines.length).toBe(1);
    expect(declines[0]!.seat).toBe(1);
    // 权威留痕:引擎对局日志 reactionRespond use=0(同 e2e 线级事件批断言的权威语义)
    expect(
      e.log.some((l) => l.detail.includes("reactionRespond") && l.detail.includes("use=0")),
    ).toBe(true);
    // 结算照走:代发「不用」= 不打识破(被询问份照缴,与 e2e 超时代发 paid 全缴同语义),
    // 未被询问的份额也照常执行——两份各缴 200 归出牌者
    expect(e.players[1].cash).toBe(guestCashBefore - 200); // 被询问但不用 → 照缴
    expect(e.players[2].cash).toBe(botCashBefore - 200);
    expect(e.players[0].cash).toBe(userCashBefore + 400);
    // 窗收:离开反应相位,链已续推(对局不被沉默座位吊死)
    expect(e.pendingReaction).toBeNull();
    expect(e.turnPhase).not.toBe("AwaitingReaction");
  });

  it("断线座位:窗开即断,超时照代发「不用」,结算照走、回合续推不冻结", async () => {
    const clock = new ManualClock();
    const { reg, roomId, events, e } = await playingRoom(clock);
    // 布场:seat2(bot)出火烧连营以 seat1 的城为火源(持识破诡计=被询问者)。出牌者=bot:
    // 窗收后链继续驱动 bot 走完回合 → 回合数前进,「对局不冻结」由此钉死(e2e 原例的
    // advanced 断言面)。
    e.activeIndex = 2;
    e.pendingJinnang = null;
    e.pendingSkill = null;
    e.jinnangUsedTags = [];
    e.turnPhase = "AwaitingJinnang";
    e.players[2].jinnangHand = ["火烧连营"];
    e.players[2].jinnangHandCount = 1;
    e.players[1].jinnangHand = ["识破诡计"];
    e.players[1].jinnangHandCount = 1;
    // seat1 种一座非都城 Lv1 城当火源(城指向域 #1389,提交火源城 tileIndex):
    // 都城挪出落点格防重叠,城从 catalog 取无主格。
    const capId1 = e.board.at(e.players[1].capitalIndex)?.propertyId;
    const lotTile = e.board.tiles.find(
      (t) =>
        t.propertyId != null &&
        t.propertyId !== capId1 &&
        !e.players.some((p) => p.properties.some((h) => h.propertyId === t.propertyId)),
    )!;
    const lot = lotTile.propertyId!;
    for (const p of e.players) p.position = p.capitalIndex; // 全员挪回都城,免开局链余波
    // 起手珍宝波(#1172 连带)布场前提重钉:起手人人 2 件珍宝后,「落他人城」从
    // 无事发生终端(movement-flow:城主无珍宝 → endTurn)变为珍宝交涉窗(城主三选,
    // AwaitingTreasureOwner,choices 单源:永不自动执行)。bot 续推掷骰落 seat1 都城
    // 长沙即挂起等 offline 城主抉择(#118 决策停摆看门狗管辖,本测试 decisionTimeoutMs=0
    // 关闭),「回合续推」断言随之死等。清空两位真人座位珍宝恢复「落他人城=无事发生」
    // 旧前提;bot 自带珍宝不参与(交涉看城主持有,bot 不会落自己城开窗),不影响任何断言。
    e.players[0].treasures = [];
    e.players[1].treasures = [];
    e.players[1].properties.push({
      propertyId: lot,
      group: "a",
      level: 1,
      maxLevel: 3,
      defense: 4,
    });
    const turnBefore = e.turnNumber;

    // 出牌宣布走引擎公共方法(两段:入目标段 → 提交火源城 tileIndex,#1389 城指向),
    // 此刻尚未跑链、未武装
    e.resolveJinnang("火烧连营");
    e.resolveJinnang("火烧连营", [lotTile.index]);
    expect<string>(e.turnPhase).toBe("AwaitingReaction"); // 显式宽化:赋值窄化不绑架断言
    expect(clock.size).toBe(0); // 窗已开但武装只发生在驱动链出口(与生产同:链到窗即停即武装)

    // 窗开即断:markSeatOffline = WS close 的房间编排入口(ADR-0002)→ 离线行落账 +
    // 链重开 → 为离线待应答座位武装(离线冻结座位同样武装,不因断线免answered)
    await reg.markSeatOffline(roomId, 1, new Set([0]));
    expect(clock.size).toBe(1); // reactionWait(seat1)已武装;retentionWindowMs=0 不武装保留窗
    expect(
      e.log.some(
        (l) =>
          l.category === "room" &&
          l.detail.includes('"type":"offline"') &&
          l.detail.includes('"seat":1'),
      ),
    ).toBe(true);

    // 泵送:超时到点 → 代发「不用」(断线者不冻结对局,ADR-0017 后果节)
    for (let i = 0; i < 4000 && !events.some((ev) => ev.ev === "reaction-decline"); i++) {
      clock.fireAll();
      await macroTick();
    }
    expect(events.filter((ev) => ev.ev === "reaction-decline").length).toBeGreaterThanOrEqual(1);
    // 让窗收结算落地(pendingReaction 清空),再断结算与续推
    for (let i = 0; i < 100 && e.pendingReaction != null; i++) {
      clock.fireAll();
      await macroTick();
    }
    expect(e.pendingReaction).toBeNull();
    expect(
      e.log.some((l) => l.detail.includes("reactionRespond") && l.detail.includes("use=0")),
    ).toBe(true);
    // 结算照走:火烧连营执行,seat1 的城挨 1 点火焰伤害(不用不救城):防御 4→3,等级不动
    expect(e.players[1].properties.find((h) => h.propertyId === lot)?.defense).toBe(3);
    expect(e.players[1].properties.find((h) => h.propertyId === lot)?.level).toBe(1);
    // 对局继续推进:链驱动 bot 走完本回合,回合数前进(不冻结在断线座位)
    for (let i = 0; i < 4000 && e.turnNumber <= turnBefore && !e.isOver; i++) {
      clock.fireAll();
      await macroTick();
    }
    expect(e.turnNumber).toBeGreaterThan(turnBefore);
    expect(e.phase).toBe("Playing");
  });
});
