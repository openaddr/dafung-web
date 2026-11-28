// 组件收口细则见 docs/design/组件收口.md。
// 对局屏:全幅棋盘、顶左设置/详情、顶中知会槽、席位格列、底缘手牌区与右下三圆钮。
// 本屏持有设置/战报开合态,战报入口在设置内;PileButtons 自持珍宝/名将藏品弹层。
// 出牌阶段与反应窗提供选牌、目标与命令，HandRack、动作条及 SeatRail/BoardView 接线。
// 触发技在手牌架边缘呈现。
// gameStore.snapshot 驱动渲染,useCapitalPick 持有选都/详情流程,棋盘取景恒为地图总览。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BoardView } from "@app/components/board/BoardView";
import { useGameStore, useStablePlayers, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { getController, getControllerContext } from "@app/controllers/registry";
import type { GameController } from "@app/controllers/controller";
import { returnHome } from "@app/screens/shared/return-home";
import { OnlineController } from "@app/controllers/online";
import type { GameCommand } from "@dafung/core/engine/authority";
import type { SeatIntent, SeatInteractionView } from "@dafung/core/protocol/seat-interaction";
import {
  readSeatBoard,
  readSeatDetails,
  readWarReport,
  type SeatBoardMap,
} from "@dafung/core/protocol/seat-queries";
import { skillBookLearners } from "@dafung/core/engine/roster";
import { skillById } from "@dafung/core/engine/skills";
import { isSkillBook } from "@dafung/core/engine/treasures";
import { DiceOverlay } from "@app/fx/DiceOverlay";
import { FxLayer } from "@app/fx/FxLayer";
import { useFxStore } from "@app/fx/fxStore";
import type { GameDiagnosticControl } from "@app/game-diagnostic-timeline";
import {
  checkpointGameDiagnostics,
  mountGameDiagnostics,
  observeGameDiagnosticControls,
} from "@app/game-diagnostics";
import { VERSION } from "../../../version";
import { HandRack, JinnangDetailSheet, type RackInspection } from "./HandRack";
import { HandZone } from "./HandZone";
import { SkillGlossaryDialog } from "./SkillGlossaryDialog";
import { SkillBookLearnModal } from "./SkillBookLearnModal";
import { ReactionBanner, useReactionReminder } from "./ReactionBanner";
import { SkillChoiceBanner } from "./SkillChoiceBanner";
import { GameTopBar } from "./GameTopBar";
import { SeatRail } from "./SeatRail";
import { WarlordsOverview } from "./WarlordsOverview";
import { PileButtons } from "./PileButtons";
import { SettingsDialog } from "./SettingsDialog";
import { ActionBar } from "./ActionBar";
import { jinnangPlay } from "./jinnang-play";
import { turnScope, useReactionPlay } from "./reaction-play";
import { useReactionTargets } from "./target-selection";
import { NoticeBanner } from "./NoticeBanner";
import { WarReportDrawer } from "./WarReportDrawer";
import { PeekModal } from "./PeekModal";
import {
  DecisionScrollLayer,
  decisionScrollIdentity,
  TileDetail,
} from "./scroll/DecisionScrollLayer";
import { DialogPeekContext, DialogPeekInspection } from "@app/hooks/dialog-stack";
import { RestoreGameDialog, useGameDialogPeek } from "./dialog-peek";
import { useCapitalPick } from "./useCapitalPick";
import { HintBar } from "@app/screens/shared/HintBar";
import {
  ConnectionBanner,
  CONN_BANNER_BODY_H,
  useConnDown,
} from "@app/screens/shared/ConnectionBanner";
import { TESTIDS } from "./testids";

function diagnosticControl(visible: boolean, available: boolean): GameDiagnosticControl {
  return !visible ? "hidden" : available ? "available" : "locked";
}

type GameEntryProps = {
  preparing?: boolean;
  onFirstPaint?: (error?: string) => void;
};

export function GameScreen({ preparing, onFirstPaint }: GameEntryProps = {}) {
  const seatView = useGameStore((s) => s.seatView);
  const controller = getController();
  // 静态上下文由 registry 提供,门卫确认快照与地图均已就位。
  const context = getControllerContext();
  if (!seatView || seatView.seat < 0 || !context || !controller) {
    // 数据缺失时显式展示返回入口;GameScreenLive 就位后才挂载,两分支不共享 hooks。
    const back = useGameStore.getState().setScreen;
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg p-6">
        <div className="rounded-lg border-2 border-gold/60 bg-panel px-10 py-8 text-center shadow">
          <div className="font-title text-3xl text-paper tracking-widest">尚未开局</div>
          <div className="mt-2 font-deco text-sm text-paper-dim">对局数据不存在或已丢失</div>
          <button
            type="button"
            data-testid={TESTIDS.notStartedBack}
            onClick={() => back("setup")}
            className="ink-btn mt-6 rounded-[5px] px-8 py-3 font-brush text-xl tracking-[0.3em] "
          >
            回到首页
          </button>
        </div>
      </div>
    );
  }
  return (
    <GameScreenLive
      key={seatView.snapshot.gameId}
      seatView={seatView}
      map={context}
      controller={controller}
      preparing={preparing}
      onFirstPaint={onFirstPaint}
    />
  );
}

/** 竖屏手机「请横屏」提示层:移动端只做横屏形态。
 *  常驻 DOM,显隐全交 layout.css 媒询(orientation: portrait + max-width: 700px +
 *  pointer: coarse 才全屏接管挡住对局)。 */
function RotateHintOverlay() {
  return (
    <div className="rotate-hint" data-testid={TESTIDS.rotateHint}>
      {/* 旋转示意:竖放手机 + 顺时针弧箭头(纯内联 SVG,零资源;符号不进字体栈,
          Sym 同款口径) */}
      <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <rect
          x="15"
          y="9"
          width="18"
          height="30"
          rx="3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <line
          x1="21"
          y1="34.5"
          x2="27"
          y2="34.5"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M 5 24 A 19 19 0 0 1 43 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M 43 24 l -4.5 -4 M 43 24 l 4.5 -4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <span>请横屏游玩</span>
    </div>
  );
}

/** 已开局主体;快照与静态地图由 GameScreen 门卫注入,所有对局 hooks 在此挂载。 */
function GameScreenLive({
  seatView,
  map,
  controller,
  preparing,
  onFirstPaint,
}: GameEntryProps & {
  seatView: SeatInteractionView<GameSnapshot>;
  map: SeatBoardMap;
  controller: GameController;
}) {
  const { snapshot, interactive, seat: viewSeat, autopilotOn, ownsJinnangPhase } = seatView;
  // 本座位动作在途(「行军中…」提示源):与 interactive 同拍由控制器写入,
  // WaitingBar 与按钮同源消费——亮一起亮、灰一起灰。
  const selfPresenting = useGameStore((s) => s.selfPresenting);
  const hint = useGameStore((s) => s.hint);
  const hintLevel = useGameStore((s) => s.hintLevel);
  useEffect(() => {
    const discardPresentation = () => controller.discardPresentation();
    document.addEventListener("visibilitychange", discardPresentation);
    return () => document.removeEventListener("visibilitychange", discardPresentation);
  }, [controller]);
  // 联机态最小订阅:对局屏消费面仅「是否联机」——selector 收窄成
  // 布尔(zustand 按 Object.is 比对),联机每条事件批(座位广播/重连进度/
  // eventBatchSeq 递增)不再触发整屏重渲。
  const online = useNetStore((s) => s.roomId !== "");
  // 断线横幅与知会槽/hint/选都提示共用顶中区域,--conn-h 统一下发让位偏移。
  const connDown = useConnDown();
  const selfSeat = viewSeat;
  // 内容不变时复用座位状态和查询结果，供沙盘和查阅弹层共用。
  const players = useStablePlayers(snapshot.players);
  const seatBoard = useMemo(() => readSeatBoard(players, map), [players, map]);
  const { board } = map;
  // 挂载时已入座;座位缺位表示快照与座位表不一致,直取使接线错误暴露。
  const selfPlayer = players[selfSeat];
  const { warlords, hand } = useMemo(() => readSeatDetails(players, selfSeat), [players, selfSeat]);
  const activeSeat = snapshot.phase === "Playing" ? snapshot.activeIndex : null;
  const gameOver = snapshot.phase === "GameOver";
  const dialogPeek = useGameDialogPeek(!gameOver);
  const { peeking } = dialogPeek;
  const decisionKey =
    seatView.capital === null ? decisionScrollIdentity(snapshot, viewSeat) : seatView.decisionPoint;
  const [warlordsOpen, setWarlordsOpen] = useState(false);
  const [warlordsInspection, setWarlordsInspection] = useState(false);
  const openWarlords = useCallback(() => {
    if (peeking) setWarlordsInspection(true);
    else setWarlordsOpen(true);
  }, [peeking]);
  const closeWarlords = useCallback(() => setWarlordsOpen(false), []);
  const closeWarlordsInspection = useCallback(() => setWarlordsInspection(false), []);
  const parkedDecision =
    decisionKey !== null && dialogPeek.decision === decisionKey && !autopilotOn;
  // 行军接管的棋子:fxStore.marching → BoardView.skipTokenIds,
  // 行军期间 React 声明式定位让位给 useMarch 的逐段命令式动画。
  const marching = useFxStore((s) => s.marching);
  // 设置弹层与战报抽屉开合态;战报从设置内打开
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [warReportOpen, setWarReportOpen] = useState(false);
  // 摘要换日志引用，普通尾段推进公开行数；两者都可能改变当前战报。
  const warReport = useMemo(() => readWarReport(snapshot.log), [snapshot.log, snapshot.logCount]);
  const [warReadOffset, setWarReadOffset] = useState(-1);
  const warUnread = useMemo(() => {
    const readIndex = warReport.findIndex(({ offset }) => offset === warReadOffset);
    return warReport.length - readIndex - 1;
  }, [warReport, warReadOffset]);
  // null=随内容自动显隐;手动开/收只保持至下一次回合或决策窗边界。
  const [rackManualHidden, setRackManualHidden] = useState<boolean | null>(null);
  const [rackInspection, setRackInspection] = useState<RackInspection | null>(null);
  const closeRackInspection = useCallback(() => setRackInspection(null), []);
  const act = useCallback(
    (intent: SeatIntent) => controller.dispatchIntent(intent, seatView.decisionPoint),
    [controller, seatView.decisionPoint],
  );
  const { offeredCapitals, selectableTiles, onTileClick, tileDetail, inspection, closeInspection } =
    useCapitalPick({ seatView, readOnly: peeking, act });
  useLayoutEffect(() => {
    if (!peeking) {
      closeInspection();
      closeWarlordsInspection();
    }
  }, [peeking, closeInspection, closeWarlordsInspection]);

  const dispatchCommand = useCallback(
    (cmd: GameCommand) => controller.dispatchCommand(cmd),
    [controller],
  );
  const jinnang = jinnangPlay(seatView, act);
  const {
    identity: reactionIdentity,
    scope: reactionScope,
    window: reaction,
    readDiagnosticChoices,
  } = useReactionPlay({
    snapshot,
    seat: selfSeat,
    board,
    autopilotOn,
    choices: seatView.reaction,
    respond: act,
  });
  const reactionTargets = useReactionTargets(
    reaction?.targetStep ?? null,
    seatView.reaction?.canRespond === true,
  );
  const jinnangTargets = jinnang?.targetStep ?? null;
  const targetStep = jinnangTargets ?? reaction?.targetStep ?? null;
  const targets = jinnangTargets ?? reactionTargets;
  const pickTarget = (id: number) => {
    if (jinnangTargets !== null) act({ type: "toggleTarget", id });
    else reactionTargets.toggle(id);
  };
  const cityTargeting = targetStep?.domain === "city";
  const seatTargeting = targetStep?.domain === "seat";
  const showSeatReason = (seat: number, reason: string) => {
    if (jinnangTargets !== null) pickTarget(seat);
    else reactionTargets.reportUnavailable(players[seat].guohao, reason);
  };
  const handleTileClick = (tileIndex: number) => {
    if (cityTargeting && !peeking) {
      pickTarget(tileIndex);
      return;
    }
    onTileClick(tileIndex);
  };

  // 回到主页:弃局离屏——销毁控制器(LocalController 释放时钟/
  // 行军会话,OnlineController 断 WS),本屏随 screen 切换卸载;新开局由各屏流程
  // 重新 setController(registry 换局销毁契约不变)。
  const goHome = returnHome;
  const reconnect = () => {
    if (!(controller instanceof OnlineController)) throw new Error("恢复横幅缺少联机控制器");
    controller.reconnect();
  };
  // 设置弹层开合回调:引用稳定化同上(SettingsDialog memo 前提)。
  const openSettings = useCallback(() => {
    if (!peeking) setSettingsOpen(true);
  }, [peeking]);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setWarReportOpen(false);
  }, []);
  const closeWarReport = useCallback(() => setWarReportOpen(false), []);
  const openWarReport = useCallback(() => {
    setWarReadOffset(warReport.at(-1)?.offset ?? -1);
    setWarReportOpen(true);
  }, [warReport]);

  const bookPlayScope = jinnang?.targetStep === null ? turnScope(snapshot) : null;
  const bookPlayReady = interactive && !peeking && bookPlayScope !== null;
  const playableBooks = useMemo(
    () =>
      bookPlayScope === null
        ? []
        : selfPlayer.treasures.flatMap((book) => {
            if (!isSkillBook(book)) return [];
            const learners = skillBookLearners(selfPlayer, book.skillId);
            return learners.length > 0 ? [{ book, learners }] : [];
          }),
    [bookPlayScope, selfPlayer],
  );
  const rackBooks = useMemo(() => playableBooks.map(({ book }) => book), [playableBooks]);
  const [bookPick, setBookPick] = useState<{ bookId: string; scope: string } | null>(null);
  const bookToRead =
    bookPick !== null && bookPick.scope === bookPlayScope
      ? playableBooks.find(({ book }) => book.id === bookPick.bookId)
      : undefined;
  useEffect(() => {
    if (bookToRead === undefined && bookPick !== null) setBookPick(null);
  }, [bookToRead, bookPick]);
  const readDiagnosticDecisions = useCallback(
    (state: GameSnapshot, seat: number, canAct: boolean) => ({
      capitalChoices:
        controller.seatView.capital?.options.map((option) => option.tileIndex) ?? null,
      reaction: readDiagnosticChoices(state, seat, canAct),
    }),
    [controller, readDiagnosticChoices],
  );
  useReactionReminder(
    reactionIdentity,
    interactive && !connDown && !preparing && !peeking ? (reaction?.deadlineAt ?? null) : null,
  );
  const noticeOccupied = jinnang != null || reaction != null;
  useLayoutEffect(() => {
    const { setNoticeSlotOccupied } = useFxStore.getState();
    setNoticeSlotOccupied(noticeOccupied);
    return () => setNoticeSlotOccupied(false);
  }, [noticeOccupied]);
  const [playNudge, setPlayNudge] = useState(0);

  const { skillChoice } = seatView;
  const rackSkillQuestionId = skillChoice === null ? null : seatView.decisionPoint;
  const skillBanner = (() => {
    if (skillChoice === null || !interactive) return null;
    const { decision, targets, canConfirm, canPass } = skillChoice;
    const { skillId, ownerSeat, fixedTargetSeat } = decision;
    const targetText = fixedTargetSeat === null ? "" : `,目标 ${players[fixedTargetSeat].guohao}`;
    const text = `${players[ownerSeat].guohao}「${skillById(skillId).name}」可达发动条件${targetText}`;
    return (
      <SkillChoiceBanner
        key={rackSkillQuestionId}
        text={text}
        seats={targets?.available.map(({ id, label }) => ({ seat: id, label })) ?? []}
        pickedSeat={targets?.selected[0] ?? null}
        onPickSeat={(id) => act({ type: "toggleTarget", id })}
        confirmEnabled={canConfirm}
        onConfirm={() => act({ type: "confirm" })}
        declineEnabled={canPass}
        onDecline={() => act({ type: "pass" })}
      />
    );
  })();

  // 自动状态实时随内容变化;灰置锦囊仍算有内容,主动技只计实际在架的卡牌段选项。
  // 触发技继续由手牌架边缘承载；锦囊反应条独立置顶。
  const myTurnUp = snapshot.phase === "Playing" && snapshot.activeIndex === selfSeat;
  const windowUp = noticeOccupied || skillBanner != null;
  const hasRackContent =
    hand.length > 0 || jinnang?.hasSkillCards === true || playableBooks.length > 0;
  const autoRackHidden = cityTargeting || !((myTurnUp || windowUp) && hasRackContent);
  const rackHidden = rackManualHidden === null ? autoRackHidden : rackManualHidden;
  const toggleRackHidden = useCallback(
    () => setRackManualHidden((manual) => !(manual === null ? autoRackHidden : manual)),
    [autoRackHidden],
  );
  // 只在回合/本座实际窗态边界撤销手动控制;命令在途的交互锁不算关窗。
  useEffect(() => {
    setRackManualHidden(null);
  }, [
    selfSeat,
    snapshot.phase,
    snapshot.activeIndex,
    snapshot.turnNumber,
    ownsJinnangPhase,
    cityTargeting,
    reactionScope,
    rackSkillQuestionId,
  ]);
  // 窗态+收起的两处派生(呼吸金光/banner-only 形态,消费点见下渲染段):一次推导。
  const rackBreathe = rackHidden && windowUp;
  const rackBannerOnly = rackHidden && skillBanner != null;

  // 选都引导区分当前行动者与本座,剩余人数按 capitalIndex < 0 统计(与 TokenLayer 同口径)。
  const setupHint = (() => {
    if (snapshot.phase !== "Setup" || snapshot.setupPhase !== "PickCapital") return null;
    const cur = snapshot.players[snapshot.currentSetupPlayerIndex];
    const pending = snapshot.players.filter((p) => p.capitalIndex < 0).length;
    if (seatView.capital !== null) return `轮到你定都:点选一座候选城(余 ${pending} 人未定)`;
    return `「${cur.guohao}」正在定都(尚余 ${pending} 人)…`;
  })();

  const jinnangAction = !peeking && jinnang != null ? jinnang.action : null;
  const jinnangActionCollapsed = rackHidden && jinnang?.targetStep === null;
  const reactionAction = !peeking && reaction != null ? reaction.actionFor(reactionTargets) : null;
  const showReactionAction = reactionAction != null;
  const decisionScrollInteractive = interactive && !peeking;
  const diagnosticCapital = diagnosticControl(
    !preparing && !peeking && selectableTiles !== undefined,
    !connDown && !autopilotOn && !controller.diagnosticInteraction.pending,
  );
  const diagnosticJinnang = diagnosticControl(
    !preparing && jinnangAction != null && !jinnangActionCollapsed,
    interactive,
  );
  const reactionControl = useRef<GameDiagnosticControl>("hidden");
  const onReactionLockChange = useCallback(
    (locked: boolean) => {
      const reaction = locked ? "locked" : "available";
      reactionControl.current = reaction;
      observeGameDiagnosticControls(controller, snapshot.gameId, { reaction });
    },
    [controller, snapshot.gameId],
  );
  const diagnosticSkillChoice = diagnosticControl(
    !preparing && skillBanner !== null,
    !peeking && interactive,
  );
  const decisionScrollControl = useRef<GameDiagnosticControl>("hidden");
  const onDecisionVisibilityChange = useCallback(
    (visible: boolean) => {
      const decisionScroll = visible ? "available" : "hidden";
      decisionScrollControl.current = decisionScroll;
      observeGameDiagnosticControls(controller, snapshot.gameId, { decisionScroll });
    },
    [controller, snapshot.gameId],
  );
  const diagnosticTarget = preparing || peeking || targetStep === null ? null : targetStep.domain;
  useLayoutEffect(
    () =>
      mountGameDiagnostics(controller, snapshot.gameId, VERSION, readDiagnosticDecisions, {
        capital: diagnosticCapital,
        jinnang: diagnosticJinnang,
        reaction: !preparing && showReactionAction ? reactionControl.current : "hidden",
        skillChoice: diagnosticSkillChoice,
        decisionScroll: preparing ? "hidden" : decisionScrollControl.current,
        target: diagnosticTarget,
        peeking,
        preparing: preparing === true,
      }),
    [
      controller,
      snapshot.gameId,
      readDiagnosticDecisions,
      diagnosticCapital,
      diagnosticJinnang,
      showReactionAction,
      diagnosticSkillChoice,
      diagnosticTarget,
      peeking,
      preparing,
    ],
  );

  const restoreLocked =
    parkedDecision &&
    snapshot.phase === "Playing" &&
    snapshot.decisionOwner === viewSeat &&
    !interactive;

  const game = (
    <>
      <DiceOverlay />
      <div
        className="game-layout relative h-full w-full overflow-hidden bg-bg text-paper"
        /* 断线让位:--conn-h = 断线横幅体高(在场)/0(不在场),知会槽
            (notice-banner.css)与下方 +8/+56 hint 行按同一变量整列下移。恒置
            (0px 也在)——消费方无兜底回退,变量缺失即布局坏出来。 */
        style={{ ["--conn-h" as string]: connDown ? `${CONN_BANNER_BODY_H}px` : "0px" }}
      >
        {/* 棋盘区全幅垫底(id="board-wrap":FxLayer 的逻辑坐标→容器像素换算锚点)。
          computeFitView 推导总览 viewBox,preserveAspectRatio meet 使整盘等比适配容器。 */}
        <div id="board-wrap" className="board-area">
          {/* 断线横幅:z-20 压过 hint,断线是对局中优先级最高的状态反馈 */}
          <ConnectionBanner onReconnect={reconnect} onExit={goHome} />
          <BoardView
            board={board}
            seatBoard={seatBoard}
            onFirstPaint={onFirstPaint}
            /* 视角玩家 id 透传——自己棋子加玩家色微光圈(棋盘侧「我是谁」锚点) */
            viewSeat={selfPlayer.id}
            /* 点格相位路由(Playing 详情 / Setup 选都 / 灰城 hint)在 useCapitalPick;
               城目标段在窗时改选格路由
               (候选格=选格,handleTileClick) */
            onTileClick={handleTileClick}
            selectableTiles={peeking ? undefined : selectableTiles}
            /* 目标段选城:候选金环呼吸(选都 crown 同通路)+ 选中实金停持环;
               候选集/选中格从快照 choices 城选项派生,非城域恒 undefined/null */
            cityTargetTiles={
              cityTargeting && !peeking
                ? new Set(targets.available.map((option) => option.id))
                : undefined
            }
            cityPickedTileIndex={cityTargeting && !peeking ? (targets.selected[0] ?? null) : null}
            /* 候选集全座位透传——非决策席也见静态金圈与壹贰叁序号印 */
            candidateTiles={offeredCapitals ?? undefined}
            pawnTargets={
              seatTargeting && !peeking
                ? {
                    available: new Set(
                      targets.available.map((option) => seatBoard.seats[option.id].id),
                    ),
                    selected: new Set(targets.selected.map((seat) => seatBoard.seats[seat].id)),
                    locked: !interactive,
                    onPick: (id) =>
                      pickTarget(seatBoard.seats.findIndex((player) => player.id === id)),
                  }
                : undefined
            }
            activeTileIndex={activeSeat === null ? null : seatBoard.seats[activeSeat].position}
            /* 当前回合方:活跃棋子金呼吸环(与常驻回合胶囊双锚点「谁在打」) */
            activePlayerId={activeSeat === null ? undefined : seatBoard.seats[activeSeat].id}
            isSetupPhase={snapshot.phase === "Setup"}
            skipTokenIds={marching}
          />
          {/* 浮字/铜钱雨/印章由表现 store 驱动;知会内容由 NoticeBanner 承载。 */}
          <FxLayer />
          {setupHint && (
            // 选都期知会槽为空,引导驻顶中 +8 行;统一 hint 在第二行,断线时同随 --conn-h 下移。
            <div
              data-testid={TESTIDS.hint}
              className="pointer-events-none absolute top-[calc(var(--safe-top)+8px+var(--conn-h))] left-1/2 -translate-x-1/2 rounded-[3px] border border-lacquer-gold/30 bg-panel/95 px-4 py-1 font-title text-lg shadow-sm"
            >
              {setupHint}
            </div>
          )}
          {/* hint 驻第二行,与知会槽同随 --conn-h 下移。 */}
          <HintBar
            hint={hint}
            level={hintLevel}
            overlayTopClass="top-[calc(var(--safe-top)+56px+var(--conn-h))]"
          />
          {/* 决策卷轴路由:按相位弹招贤/珍宝/破产/胜利/城池详情。
            容器 pointer-events-none:无弹层时不挡棋盘;各弹层自带遮罩(z-30)接管交互。
            选都/详情流程只下发一个窄 props(tileDetail,状态机在 useCapitalPick)。 */}
          <div id="scroll-layer" className="pointer-events-none absolute inset-0">
            {!preparing && (
              <DecisionScrollLayer
                snapshot={snapshot}
                seatBoard={seatBoard}
                viewSeat={viewSeat}
                interactive={decisionScrollInteractive}
                decisionKey={decisionKey}
                parked={parkedDecision}
                tileDetail={tileDetail}
                onDecisionVisibilityChange={onDecisionVisibilityChange}
              />
            )}
            {inspection !== null && (
              <DialogPeekInspection.Provider value={closeInspection}>
                <TileDetail
                  seatBoard={seatBoard}
                  players={players}
                  viewSeat={viewSeat}
                  request={inspection}
                />
              </DialogPeekInspection.Provider>
            )}
          </div>
        </div>
        {/* 顶左设置/详情两钮,顶中留给知会槽。 */}
        <GameTopBar
          warUnread={warUnread}
          onOpenSettings={openSettings}
          settingsDisabled={peeking}
          overviewOpen={peeking ? warlordsInspection : warlordsOpen}
          onOpenOverview={openWarlords}
        />
        {peeking && (
          <RestoreGameDialog
            decision={parkedDecision}
            locked={restoreLocked}
            buttonRef={dialogPeek.restoreButton}
            onRestore={dialogPeek.restore}
          />
        )}
        {!gameOver && warlordsOpen && (
          <WarlordsOverview
            warlords={warlords}
            seatBoard={seatBoard}
            selfSeat={selfSeat}
            activeSeat={activeSeat}
            round={snapshot.round}
            onClose={closeWarlords}
          />
        )}
        {peeking && warlordsInspection && (
          <DialogPeekInspection.Provider value={closeWarlordsInspection}>
            <WarlordsOverview
              warlords={warlords}
              seatBoard={seatBoard}
              selfSeat={selfSeat}
              activeSeat={activeSeat}
              round={snapshot.round}
              onClose={closeWarlordsInspection}
            />
          </DialogPeekInspection.Provider>
        )}
        {/* 顶中知会槽承载回合胶囊/都城停条带/等待条,瞬态知会优先,由 fxStore 槽泵排队互斥。 */}
        <NoticeBanner
          occupied={noticeOccupied}
          snapshot={snapshot}
          interactive={interactive}
          selfPresenting={selfPresenting}
          viewSeat={viewSeat}
          online={online}
        />
        <SeatRail
          warlords={warlords}
          selfSeat={selfSeat}
          activeSeat={activeSeat}
          winner={snapshot.isOver ? snapshot.winner : null}
          onOpenOverview={openWarlords}
          targets={
            seatTargeting && !peeking
              ? {
                  bySeat: new Map(
                    players.map((_, seat) => {
                      const candidate = targetStep.candidates.find((choice) => choice.id === seat);
                      const firstPick = targetStep.firstSeat?.id === seat;
                      return [
                        seat,
                        {
                          available: candidate?.available === true,
                          selected: firstPick || targets.selected.includes(seat),
                          reason: firstPick
                            ? "已选为第一位，点「上一步」可更改"
                            : candidate == null
                              ? "不在本次影响范围"
                              : candidate.reason,
                        },
                      ];
                    }),
                  ),
                  locked: !interactive,
                  onPick: pickTarget,
                  onUnavailable: showSeatReason,
                }
              : undefined
          }
        />
        {/* 收架时仅待决触发技保留手牌区入口。 */}
        {!gameOver && (!rackHidden || skillBanner != null) && (
          <HandZone
            inert={peeking}
            snapshot={snapshot}
            player={selfPlayer}
            autopilotOn={autopilotOn}
            showDiceFace={hasRackContent && !rackBannerOnly}
            children={
              <HandRack
                key={`${selfSeat}:${selfPlayer.id}`}
                hand={hand}
                heroes={warlords[selfSeat].heroes}
                nudgePulse={playNudge}
                bannerOnly={rackBannerOnly}
                detailKey={rackInspection?.kind === "jinnang" ? rackInspection.key : null}
                onInspect={setRackInspection}
                skillBooks={rackBooks}
                onReadBook={
                  bookPlayReady && bookPlayScope !== null && jinnang != null
                    ? (bookId) => {
                        jinnang.hand.onSelect(null);
                        setBookPick({ bookId, scope: bookPlayScope });
                      }
                    : undefined
                }
                junshi={jinnang?.hand}
                reaction={reaction?.hand}
                skillBanner={skillBanner}
              />
            }
          />
        )}
        {/* 详情跟随对局，跨过回合边界自动收架后仍可继续查阅。 */}
        {!gameOver && rackInspection?.kind === "jinnang" && (
          <JinnangDetailSheet cardId={rackInspection.cardId} onClose={closeRackInspection} />
        )}
        {!gameOver && rackInspection?.kind === "skill" && (
          <SkillGlossaryDialog target={rackInspection.target} onClose={closeRackInspection} />
        )}
        {bookToRead !== undefined && (
          <SkillBookLearnModal
            bookName={bookToRead.book.name}
            skillId={bookToRead.book.skillId}
            learners={bookToRead.learners}
            locked={!bookPlayReady}
            onConfirm={(heroId) => {
              if (!bookPlayReady) return;
              setBookPick(null);
              dispatchCommand({ type: "useBookSkill", treasureId: bookToRead.book.id, heroId });
            }}
            onClose={() => setBookPick(null)}
          />
        )}
        {/* 锦囊钮控制牌架显隐,收架且有决策窗时呼吸提示;珍宝/名将弹层由 PileButtons 自持。 */}
        {!gameOver && (
          <PileButtons
            inert={peeking}
            player={selfPlayer}
            rackVisible={!rackHidden}
            breathe={rackBreathe}
            nudgePulse={rackHidden ? playNudge : undefined}
            onToggleRack={toggleRackHidden}
            dismissReady={
              // 遣散窗口:本地决策+对局中+自己回合
              interactive &&
              snapshot.phase === "Playing" &&
              snapshot.activeIndex === selfSeat &&
              snapshot.turnPhase !== "AwaitingBankruptcySettle"
            }
            onDismiss={(heroId) => {
              dispatchCommand({ type: "dismissHero", heroId });
            }}
          />
        )}
        {/* 设置弹层提供战报、托管、音效、诊断与回主页等入口。 */}
        {!gameOver && settingsOpen && (
          <SettingsDialog
            onClose={closeSettings}
            onOpenWarReport={openWarReport}
            warReport={
              warReportOpen && (
                <WarReportDrawer report={warReport} warlords={warlords} onClose={closeWarReport} />
              )
            }
            onGoHome={goHome}
            onCaptureDiagnostic={checkpointGameDiagnostics}
          />
        )}
        {jinnangAction != null && (
          <ActionBar
            {...jinnangAction}
            collapsed={jinnangActionCollapsed}
            locked={!interactive}
            onBlockedAttempt={() => setPlayNudge((n) => n + 1)}
          />
        )}
        {reactionAction != null && (
          <ReactionBanner
            key={reactionScope}
            {...reactionAction}
            rackHidden={rackHidden}
            locked={seatView.reaction?.canRespond !== true}
            onLockChange={preparing ? undefined : onReactionLockChange}
          />
        )}
        {/* 窥探弹层:军情密探即时窥探的 viewer-only 演出——开关态单源 fxStore
          (peekApplied 表现事件驱动,关闭即清),组件按 viewerSeat===本座自门。 */}
        {!preparing && !gameOver && <PeekModal selfSeat={selfSeat} />}
        {/* 竖屏手机「请横屏」提示层:常驻 DOM,显隐在 layout.css 媒询。 */}
        <RotateHintOverlay />
      </div>
    </>
  );
  return <DialogPeekContext.Provider value={dialogPeek.context}>{game}</DialogPeekContext.Provider>;
}
