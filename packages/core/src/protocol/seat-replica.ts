import type { GameEngine } from "../engine/authority";
import { SNAPSHOT_FIELDS } from "../engine/snapshot";
import {
  projectSeatReaction,
  redactSnapshotForSeat,
  type SeatSnapshot,
} from "../room/seat-projection";
import type { GameLogMsg } from "./wire";

// 骰流与反应续结算归权威所有。座位的选项和反应公告按下行保存，其余字段与存档共用读写表。
const replicaFields = SNAPSHOT_FIELDS.filter(
  (field) =>
    field.key !== "rngState" &&
    field.key !== "pendingReaction" &&
    field.key !== "reaction" &&
    field.key !== "choices",
);
type ReplicaFields = Omit<SeatSnapshot, "pendingReaction" | "reaction" | "choices">;

interface SeatPresentation {
  pendingReaction: SeatSnapshot["pendingReaction"];
  choices: SeatSnapshot["choices"] | null;
  /** 副本构造时只掌握地图配置，首连后采用房间实际开局参数。 */
  roomConfig: Pick<SeatSnapshot, "targetNetWorth" | "startingCash"> | null;
}

const presentations = new WeakMap<GameEngine, SeatPresentation>();

/** 首连、重连、校准共用同一座位摘要，可直接从其中的已答进度接着折叠。 */
export function hydrateSeatReplica(engine: GameEngine, snapshot: SeatSnapshot): void {
  for (const field of replicaFields) field.write(engine, snapshot);
  snapshot.players.forEach((player, index) => {
    engine.players[index].name = player.name;
  });
  engine.pendingReaction = null;
  engine.lastTransaction = null;
  engine.floaters = [];
  engine.propertyChanges = [];
  presentations.set(engine, {
    pendingReaction: structuredClone(snapshot.pendingReaction),
    choices: structuredClone(snapshot.choices),
    roomConfig: { targetNetWorth: snapshot.targetNetWorth, startingCash: snapshot.startingCash },
  });
}

/** 把已经裁剪的日志尾段接在首连、重连或校准摘要之后，并返回新收到的公开行。 */
export function appendSeatReplicaLog(
  engine: GameEngine,
  { gameId, offset, lines }: GameLogMsg,
): Pick<GameLogMsg, "offset" | "lines"> | null {
  const state = presentations.get(engine);
  if (state === undefined || state.roomConfig === null || gameId !== engine.gameId) {
    throw new Error("收到未校准或非本局的日志增量");
  }
  const expected = engine.log.length;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > expected) {
    throw new Error(`对局日志断档，预期偏移 ${expected}，收到 ${offset}`);
  }
  const added = lines.slice(expected - offset);
  if (added.length === 0) return null;
  for (const line of added) engine.log.push(line);
  return { offset: expected, lines: added };
}

/** 当前席位收到的公告与进度。权威引擎作输入时可指定观察座位，缺省只取公开面。 */
export function seatReactionOf(engine: GameEngine, seat?: number): SeatSnapshot["pendingReaction"] {
  const state = presentations.get(engine);
  if (state === undefined) return projectSeatReaction(engine.pendingReaction, seat ?? -1);
  return seat === undefined
    ? state.pendingReaction
    : projectSeatReaction(state.pendingReaction, seat);
}

/** 事件折叠所需的座位表现态。按批更新选项和反应进度。 */
export function seatPresentationForFold(engine: GameEngine): SeatPresentation {
  const state = presentations.get(engine);
  if (state !== undefined) return state;
  const initial: SeatPresentation = {
    pendingReaction: seatReactionOf(engine),
    choices: null,
    roomConfig: null,
  };
  presentations.set(engine, initial);
  return initial;
}

/** 玩家读口。只有决策座位会取本步选项，尚未入座（-1）也只得到公开局面。 */
export function readSeatReplica(engine: GameEngine, seat: number): SeatSnapshot {
  const state = presentations.get(engine);
  const fields = {} as Record<keyof ReplicaFields, unknown>;
  for (const field of replicaFields) fields[field.key] = field.read(engine);
  const pendingReaction = state === undefined ? engine.pendingReaction : state.pendingReaction;
  const roomConfig = state?.roomConfig;
  return redactSnapshotForSeat(
    {
      ...(fields as ReplicaFields),
      ...roomConfig,
      pendingReaction,
      reaction: pendingReaction?.view ?? null,
      choices: engine.decisionOwner === seat ? (state?.choices ?? engine.choicesFor()) : [],
    },
    seat,
    roomConfig == null ? "authority" : "seat",
  );
}
