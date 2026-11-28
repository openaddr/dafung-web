// wire 协议编解码单源(#429):一条上行消息长什么样、如何分发、失败怎么回报,
// 一条下行消息如何构造,全部收口本模块——server.ts(联机 WS)与 local.ts(单机内存
// 双工)两侧逐 type 双写与「注释互指同契约」就此退役。
//
// 单机客户端和联机服务器共用。只导入包内的引擎和房间类型。
//
// 契约:
// - 上行包括带决策点的玩家提交、普通游戏命令和托管。dispatchInbound 一次完成
//   解析 + 分发,**错误回报是返回值的一部分**(InboundResult),任何失败都不抛出到
//   传输层之外——传输面(adapter)只负责把失败送到各自通道:WS = error 消息下行,
//   内存 = pushHint(结构性失败在内存面属自身 bug,adapter 自行抛出,零兜底)。
// - 下行(ServerMsg):lobby / snapshot / gameLog 由 seat-projection 装配,
//   events / commandResult / submissionResult / dismissed / error 由本模块封装。redaction 归属在 seat-projection。
// - 穷尽纪律:dispatch 对 InboundMsg 穷尽 switch(新增消息类型漏分支 = 编译红,
//   default 收 never),与 seat-projection redactEvents 同机器。
import type { GameCommand } from "../engine/authority";
import type { ChoiceOption } from "../engine/choices";
import type { GameEvent } from "../engine/game-events";
import type { PendingHeroSkill, PendingJinnang } from "../engine/jinnang-execution";
import type { LogEvent } from "../engine/model";
import type { CapitalOption } from "../engine/setup-flow";
import type { ActiveSkillCommand } from "../room/active-skill-decisions";
import {
  isBankruptcyDecisionCommand,
  type BankruptcyDecision,
  type BankruptcyDecisionCommand,
} from "../room/bankruptcy-decisions";
import {
  isLandDecisionCommand,
  type LandDecision,
  type LandDecisionCommand,
} from "../room/land-decisions";
import type { RecruitmentDecision } from "../room/recruitment-decisions";
import type { LobbyView, SeatSnapshot } from "../room/seat-projection";
import type { SkillChoiceCommand, SkillChoiceDecision } from "../room/skill-choice-decisions";
import type { TreasureDecision, TreasureOwnerCommand } from "../room/treasure-decisions";
import type { ReactionDecision } from "./reaction-choices";

export type { CapitalOption } from "../engine/setup-flow";
export {
  isLandDecisionCommand,
  type LandDecisionCommand,
  type LandDecisionOption,
} from "../room/land-decisions";
export type { RecruitmentOption } from "../room/recruitment-decisions";

export type PlayerCommand = GameCommand | { type: "pickCapital"; tileIndex: number };

/** 一次玩家提交始终携带首次操作时的座位和决策点。requestId 仅用于单次传输诊断。 */
export interface PlayerSubmission {
  roomId: string;
  seat: number;
  submissionId: string;
  decisionPoint: string;
  cmd:
    | Extract<
        PlayerCommand,
        { type: "pickCapital" | "useJinnang" | "respondReaction" | "resolveHeroPick" }
      >
    | LandDecisionCommand
    | TreasureOwnerCommand
    | BankruptcyDecisionCommand
    | SkillChoiceCommand
    | ActiveSkillCommand;
}

/** 没有公开日志行的操作仍有受理回执。 */
type AcceptedCommand = { outcome: "accepted" } | { outcome: "accepted"; logOffset: number };

export interface PlayerSubmissionRejection {
  outcome: "rejected";
  reason: string;
  reasonCode?:
    | "wrongSeat"
    | "staleDecisionPoint"
    | "invalidCandidate"
    | "insufficientFunds"
    | "submissionIdConflict";
}

export type PlayerSubmissionResult = AcceptedCommand | PlayerSubmissionRejection;

export type SubmissionResultMsg = {
  type: "submissionResult";
  submissionId: string;
  requestId?: number;
} & PlayerSubmissionResult;

export function requiresPlayerSubmission(cmd: PlayerCommand): cmd is PlayerSubmission["cmd"] {
  return (
    cmd.type === "pickCapital" ||
    cmd.type === "useJinnang" ||
    cmd.type === "useHeroSkill" ||
    cmd.type === "respondReaction" ||
    cmd.type === "respondSkillChoice" ||
    cmd.type === "resolveHeroPick" ||
    cmd.type === "resolveTreasureOwner" ||
    isBankruptcyDecisionCommand(cmd) ||
    isLandDecisionCommand(cmd)
  );
}

// ──────────────────────────── 上行:union + 编码 ────────────────────────────
/** 上行消息(线上形状):autoPilot 只载开关(#580 速度分档已删,无归一)。 */
export type InboundMsg = (
  | { type: "cmd"; cmd: GameCommand }
  | { type: "submit"; submission: PlayerSubmission }
  | { type: "autoPilot"; on: boolean }
) & { requestId?: number };

/** 上行编码(客户端发送端单源;手写判别字面量 = 双写复辟)。 */
export function cmdMsg(cmd: GameCommand, requestId?: number): string {
  return JSON.stringify({ type: "cmd" as const, cmd, requestId });
}
export function submissionMsg(submission: PlayerSubmission, requestId?: number): string {
  return JSON.stringify({ type: "submit", submission, requestId });
}
export function autoPilotMsg(on: boolean, requestId?: number): string {
  return JSON.stringify({ type: "autoPilot" as const, on, requestId });
}

// ──────────────────────────── 下行:union + 构造 ────────────────────────────
export type JinnangDecisionOptions = {
  kind: "playJinnang";
  choices: readonly ChoiceOption[];
  pendingJinnang: PendingJinnang | null;
  pendingSkill: PendingHeroSkill | null;
};

export type DecisionOptions =
  | { kind: "pickCapital"; options: readonly CapitalOption[] }
  | JinnangDecisionOptions
  | LandDecision
  | RecruitmentDecision
  | TreasureDecision
  | BankruptcyDecision
  | ReactionDecision
  | SkillChoiceDecision;

/** 选项随决策点只发给有权操作的座位。 */
export interface SeatDecision {
  decisionPoint: string | null;
  decisionOptions?: DecisionOptions;
}

/** 事件批携带本席的操作权。只有授权变化时，events 可以为空。 */
export interface EventBatchMsg extends SeatDecision {
  type: "events";
  events: GameEvent[];
  reactionTiming?: ReactionTiming;
}

/** 传输时刻的剩余时长，按权威窗号绑定。 */
export interface ReactionTiming {
  seq: number;
  remainingMs: number;
}

/** 对局诊断的公开日志尾段。offset 是首行在同局公开日志中的零基下标。 */
export interface GameLogMsg {
  type: "gameLog";
  gameId: string;
  offset: number;
  lines: LogEvent[];
  capturedAt: number;
}

/** 权威处理编号命令的诊断回执。明确拒绝沿带编号的 error 下行。 */
export type CommandProcessing =
  | AcceptedCommand
  | { outcome: "warning"; logOffset: number; reason: string }
  | { outcome: "unprocessed"; reason: string };

export type ReportCommandProcessing = (result: CommandProcessing) => void;

export type CommandResultMsg = { type: "commandResult"; requestId: number } & CommandProcessing;

/** lobby/snapshot 共带的房间字段(产出单源 seat-projection 的 clientView/lobbyView;
 *  客户端 netStore 的 NetRoomFields 从此别名投影,不再手抄同形接口)。 */
export interface WireRoomFields {
  roomId: string;
  host: number;
  started: boolean;
  mapId: string | null;
  seats: LobbyView["seats"];
}

/** 开局摘要含房间字段和接收座位可见的局面。 */
export type SnapshotMsg = {
  type: "snapshot";
  reactionTiming?: ReactionTiming;
} & WireRoomFields &
  SeatDecision &
  SeatSnapshot;

/** 下行消息 union(线上形状单源;客户端 online.ts/local.ts 从此 import)。 */
export type ServerMsg =
  | LobbyView
  | SnapshotMsg
  | EventBatchMsg
  | GameLogMsg
  | CommandResultMsg
  | SubmissionResultMsg
  | { type: "dismissed"; roomId: string }
  | { type: "error"; error: string; requestId?: number };

/** 事件批消息构造(flush 下行;per-seat 脱敏在装配单口 assembleDownlinkShot 内部
 *  完成——#431 起 redaction 是装配必经步,本构造函数只管已装配批的封装)。 */
export function eventsMsg(
  events: GameEvent[],
  reactionTiming?: ReactionTiming,
  decisionPoint: string | null = null,
  decisionOptions?: DecisionOptions,
): string {
  return encodeDownlink({ type: "events", events, reactionTiming, decisionPoint, decisionOptions });
}
/** 错误回报可按请求号配对。玩家提交的权威结果由 submissionResult 确认。 */
export function errorMsg(error: string, requestId?: number): string {
  return encodeDownlink({ type: "error", error, requestId });
}
/** 房间解散消息构造。 */
export function dismissedMsg(roomId: string): string {
  return JSON.stringify({ type: "dismissed" as const, roomId });
}
/** 下行封装单口:lobby/snapshot 等已成形的 union 成员原样序列化。 */
export function encodeDownlink(msg: ServerMsg): string {
  return JSON.stringify(msg);
}

// ──────────────────────────── 上行:parse + dispatch ────────────────────────────
/** 上行执行面:每族消息一个执行器(传输面注入,绑定各自的房间/座位/广播回调;
 *  RoomRegistry 公共入口在两侧是同一份,差异只在绑定参数)。 */
export interface InboundOps {
  cmd(cmd: GameCommand, report?: ReportCommandProcessing): Promise<unknown> | unknown;
  submit?(submission: PlayerSubmission): Promise<PlayerSubmissionResult>;
  setAutoPilot(on: boolean, report?: ReportCommandProcessing): Promise<unknown> | unknown;
}

/** 上行分发结果——错误回报是返回值的一部分,不抛到传输层之外:
 *  - badJson:帧不是合法 JSON(文本 "bad json");
 *  - unknownShape:JSON 合法但不是 InboundMsg 任一成员(缺省文案给 WS 面的
 *    「期望形状」引导;对局未开始的房间由 WS 面覆写 unknownShapeText);
 *  - rejected:ops 执行抛错(房间编排 RoomError / 引擎零兜底 TypeError 等,
 *    文本原样透传给发送者)。 */
export type InboundResult =
  | { ok: true; requestId?: number }
  | { ok: false; reason: "badJson"; message: string }
  | { ok: false; reason: "unknownShape"; message: string }
  | { ok: false; reason: "rejected"; message: string; requestId?: number };

/** unknownShape 缺省文案(对局已开时的期望形状引导;原 server.ts else 分支同款)。 */
const UNKNOWN_SHAPE_TEXT = "expected {type:'cmd',cmd:...}";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlayerSubmission(value: unknown): value is PlayerSubmission {
  if (!isRecord(value) || !isRecord(value.cmd)) return false;
  const { roomId, seat, submissionId, decisionPoint, cmd } = value;
  if (
    typeof roomId !== "string" ||
    !roomId ||
    !Number.isSafeInteger(seat) ||
    typeof submissionId !== "string" ||
    !submissionId ||
    typeof decisionPoint !== "string" ||
    !decisionPoint
  )
    return false;
  if (cmd.type === "pickCapital") return Number.isSafeInteger(cmd.tileIndex);
  if (isLandDecisionCommand(cmd)) return Object.keys(cmd).length === 1;
  if (cmd.type === "resolveHeroPick")
    return (
      Object.keys(cmd).length === 2 &&
      (Number.isSafeInteger(cmd.index) || cmd.action === "seekBook" || cmd.action === "skip")
    );
  if (cmd.type === "resolveTreasureOwner") {
    const { action } = cmd;
    if (!isRecord(action) || Object.keys(cmd).length !== 2) return false;
    if (action.type === "skip") return Object.keys(action).length === 1;
    return (
      (action.type === "fair" || action.type === "premium") &&
      typeof action.treasureId === "string" &&
      action.treasureId.length > 0 &&
      Object.keys(action).length === 2
    );
  }
  if (cmd.type === "declareBankruptcy") return Object.keys(cmd).length === 1;
  if (cmd.type === "confirmBankruptcySettle")
    return (
      Object.keys(cmd).length === 2 &&
      Array.isArray(cmd.assets) &&
      cmd.assets.every(
        (asset: unknown) =>
          isRecord(asset) &&
          (asset.kind === "treasure" || asset.kind === "property") &&
          typeof asset.id === "string" &&
          asset.id.length > 0 &&
          Object.keys(asset).length === 2,
      )
    );
  if (cmd.type === "respondSkillChoice")
    return (
      Number.isSafeInteger(cmd.seat) &&
      typeof cmd.use === "boolean" &&
      (cmd.targetSeat === undefined || Number.isSafeInteger(cmd.targetSeat)) &&
      Object.keys(cmd).length === (cmd.targetSeat === undefined ? 3 : 4)
    );
  if (cmd.type === "useHeroSkill")
    return (
      typeof cmd.heroId === "string" &&
      cmd.heroId.length > 0 &&
      typeof cmd.skillId === "string" &&
      cmd.skillId.length > 0 &&
      (cmd.targets === undefined ||
        (Array.isArray(cmd.targets) && cmd.targets.every(Number.isSafeInteger))) &&
      (cmd.cancel === undefined || typeof cmd.cancel === "boolean")
    );
  if (cmd.type === "useJinnang")
    return (
      (cmd.cardId === null || typeof cmd.cardId === "string") &&
      (cmd.handIndex === undefined || Number.isSafeInteger(cmd.handIndex)) &&
      (cmd.targets === undefined ||
        (Array.isArray(cmd.targets) && cmd.targets.every(Number.isSafeInteger))) &&
      (cmd.cancel === undefined || typeof cmd.cancel === "boolean") &&
      (cmd.back === undefined || typeof cmd.back === "boolean")
    );
  return (
    cmd.type === "respondReaction" &&
    Number.isSafeInteger(cmd.seat) &&
    typeof cmd.use === "boolean" &&
    (cmd.use
      ? typeof cmd.cardId === "string" && Number.isSafeInteger(cmd.handIndex)
      : (cmd.cardId === undefined || typeof cmd.cardId === "string") &&
        (cmd.handIndex === undefined || Number.isSafeInteger(cmd.handIndex))) &&
    (cmd.target === undefined ||
      (isRecord(cmd.target) &&
        (cmd.target.kind === "city" || cmd.target.kind === "seat") &&
        Number.isSafeInteger(cmd.target.id)))
  );
}

/** 线上形状 → InboundMsg(逐族校验与归一;不匹配返回 null)。 */
function parseInboundMsg(m: unknown): InboundMsg | null {
  if (typeof m !== "object" || m === null) return null;
  const r = m as Record<string, unknown>;
  const { requestId } = r;
  if (
    requestId !== undefined &&
    (typeof requestId !== "number" || !Number.isSafeInteger(requestId) || requestId < 1)
  )
    return null;
  if (r.type === "cmd" && r.cmd) {
    return { type: "cmd", cmd: r.cmd as GameCommand, requestId };
  }
  if (r.type === "submit" && isPlayerSubmission(r.submission)) {
    return { type: "submit", submission: r.submission, requestId };
  }
  if (r.type === "autoPilot" && typeof r.on === "boolean") {
    return { type: "autoPilot", on: r.on, requestId };
  }
  return null;
}

/** 解析 + 分发一条上行消息(单机/联机两侧消息处理器的唯一本体):
 *  逐族进 ops,执行抛错(含异步拒绝)捕获为 rejected——非法命令→错误回报值,
 *  不抛到传输层外(#428 口径收编为 codec 契约,漏 catch 无处藏身)。 */
export async function dispatchInbound(
  raw: string,
  ops: InboundOps,
  opts?: { unknownShapeText?: string; sendCommandResult?: (raw: string) => void },
): Promise<InboundResult> {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "badJson", message: "bad json" };
  }
  const msg = parseInboundMsg(m);
  if (!msg) {
    return {
      ok: false,
      reason: "unknownShape",
      message: opts?.unknownShapeText ?? UNKNOWN_SHAPE_TEXT,
    };
  }
  const { requestId } = msg;
  const request = requestId === undefined ? {} : { requestId };
  const sendCommandResult = opts?.sendCommandResult;
  const report: ReportCommandProcessing | undefined =
    requestId !== undefined && sendCommandResult !== undefined
      ? (outcome) => {
          // 内存上行同步，回执等发送端返回后再交付，与 WS 收发顺序一致。
          queueMicrotask(() =>
            sendCommandResult(encodeDownlink({ type: "commandResult", requestId, ...outcome })),
          );
        }
      : undefined;
  try {
    switch (msg.type) {
      case "submit": {
        if (!ops.submit || !sendCommandResult) throw new Error("此连接缺少玩家提交或回执通道");
        const outcome = await ops.submit(msg.submission);
        sendCommandResult(
          encodeDownlink({
            type: "submissionResult",
            submissionId: msg.submission.submissionId,
            requestId,
            ...outcome,
          }),
        );
        break;
      }
      case "cmd":
        await ops.cmd(msg.cmd, report);
        break;
      case "autoPilot":
        await ops.setAutoPilot(msg.on, report);
        break;
      default: {
        // 穷尽机器:InboundMsg 新增成员漏分支 = 编译红(default 收 never)。
        const _exhaustive: never = msg;
        throw new Error(`wire:未分发的上行消息:${String(_exhaustive)}`);
      }
    }
  } catch (err) {
    return {
      ok: false,
      reason: "rejected",
      message: err instanceof Error ? err.message : String(err),
      ...request,
    };
  }
  return { ok: true, ...request };
}
