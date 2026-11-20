// 组件收口细则见 docs/design/组件收口.md。
// 对局屏:全幅棋盘、顶左设置/详情、顶中知会槽、席位格列、底缘手牌区与右下三圆钮。
// 本屏持有设置/战报开合态,战报入口在设置内;PileButtons 自持珍宝/名将藏品弹层。
// 出牌窗由 AwaitingJinnang、interactive 与 choices 派生:HandRack 选牌,ActionBar 确认,
// SeatRail/BoardView 选择目标;命令经 registry 当前控制器下发。反应窗共用动作条，触发技在架缘。
// gameStore.snapshot 驱动渲染,useCapitalPick 持有选都/详情流程,棋盘取景恒为地图总览。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BoardView } from "@app/components/board/BoardView";
import {
  useGameStore,
  useLocalPlayer,
  useStablePlayers,
  type GameSnapshot,
} from "@app/store/gameStore";
import { useNetStore, useAutopilotOn } from "@app/store/netStore";
import { getController, getControllerContext } from "@app/controllers/registry";
import type { GameController } from "@app/controllers/controller";
import { returnHome } from "@app/screens/shared/return-home";
import { OnlineController } from "@app/controllers/online";
import type { Board } from "@core/board";
import type { GameCommand } from "@core/authority";
import { isSkillOption } from "@core/choices";
import { jinnangCardOf, SINGLE_TARGET, TARGET_DOMAIN_STAGES } from "@core/jinnang";
import type { ReactionView } from "@core/reaction-window";
import { formatMoney } from "@core/money";
import { isActiveSkill, skillById } from "@core/skills";
import { getAudio } from "@app/fx/audio";
import { reactionChoicesForSeat } from "@app/controllers/reaction";
import { AudioProvider } from "@app/fx/AudioProvider";
import { DiceOverlay } from "@app/fx/DiceOverlay";
import { FxLayer } from "@app/fx/FxLayer";
import { useFxStore } from "@app/fx/fxStore";
import { checkpointGameDiagnostics, mountGameDiagnostics } from "@app/game-diagnostics";
import { VERSION } from "../../../version";
import { HandRack, type RackCardSelection } from "./HandRack";
import { HandZone } from "./HandZone";
import { ReactionBanner } from "./ReactionBanner";
import { SkillChoiceBanner } from "./SkillChoiceBanner";
import { reactionMuteEngage, reactionMuted, type ReactionMuteState } from "./reaction-mute";
import { GameTopBar } from "./GameTopBar";
import { SeatRail } from "./SeatRail";
import { WarlordsOverview } from "./WarlordsOverview";
import { PileButtons } from "./PileButtons";
import { SettingsDialog } from "./SettingsDialog";
import { ActionBar } from "./ActionBar";
import { targetCandidates, useTargetSelection, type TargetSelectionStep } from "./target-selection";
import { NoticeBanner } from "./NoticeBanner";
import { WarReportDrawer, warEntriesOf } from "./WarReportDrawer";
import { PeekModal } from "./PeekModal";
import { DecisionScrollLayer } from "./scroll/DecisionScrollLayer";
import { selectableCapitalTiles, useCapitalPick } from "./useCapitalPick";
import { HintBar } from "@app/screens/shared/HintBar";
import {
  ConnectionBanner,
  CONN_BANNER_BODY_H,
  useConnDown,
} from "@app/screens/shared/ConnectionBanner";
import { TESTIDS } from "./testids";

function reactionAnnouncement(
  view: ReactionView,
  seatLabel: (seat: number) => string,
  cityName: (tileIndex: number) => string,
) {
  const user = seatLabel(view.userSeat);
  if (view.kind === "march") {
    return {
      text: `${user} 行军途经`,
      range: `${seatLabel(view.ownerSeat)} 的「${cityName(view.tileIndex)}」`,
    };
  }
  const text = `${user} 用「${view.cardId}」`;
  if (view.counter != null) {
    const { rootCardId, rootUserSeat, protects } = view.counter;
    const label = jinnangCardOf(rootCardId).targetDomain === "one-city" ? cityName : seatLabel;
    const objects = view.targetSeats.map(label).join("、");
    const root = `${seatLabel(rootUserSeat)} 的「${rootCardId}」`;
    return {
      text,
      range: `${protects ? "拆解" : "恢复"} ${root}${objects ? ` · ${objects}` : ""}`,
    };
  }
  const domain = jinnangCardOf(view.cardId).targetDomain;
  if (domain === "one-city") {
    return {
      text,
      range:
        view.targetSeats.length > 0
          ? `受击城 ${view.targetSeats.map(cityName).join("、")}`
          : "无受击城",
    };
  }
  if (domain === "all-others") return { text, range: `影响 ${view.targetSeats.length} 位诸侯` };
  return {
    text,
    range: domain === "self" ? "影响自身" : `影响 ${view.targetSeats.map(seatLabel).join("、")}`,
  };
}

function reactionTurnScope(snapshot: GameSnapshot): string {
  return JSON.stringify([snapshot.gameId, snapshot.turnNumber, snapshot.activeIndex]);
}

export function GameScreen() {
  const snapshot = useGameStore((s) => s.snapshot);
  const controller = getController();
  // 静态上下文由 registry 提供,门卫确认快照与地图均已就位。
  const context = getControllerContext();
  if (!snapshot || !context || !controller) {
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
  return <GameScreenLive snapshot={snapshot} board={context.board} controller={controller} />;
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
  snapshot,
  board,
  controller,
}: {
  snapshot: GameSnapshot;
  board: Board;
  controller: GameController;
}) {
  const interactive = useGameStore((s) => s.interactive);
  const reactionDeadlineAt = useGameStore((s) => s.reactionDeadlineAt);
  // 本座位动作在途(「行军中…」提示源):与 interactive 同拍由控制器写入,
  // WaitingBar 与按钮同源消费——亮一起亮、灰一起灰。
  const selfPresenting = useGameStore((s) => s.selfPresenting);
  const viewSeat = useGameStore((s) => s.viewSeat);
  const hint = useGameStore((s) => s.hint);
  const hintLevel = useGameStore((s) => s.hintLevel);
  const localPlayer = useLocalPlayer();
  // 联机态最小订阅:对局屏消费面仅「是否联机」——selector 收窄成
  // 布尔(zustand 按 Object.is 比对),联机每条事件批(座位广播/重连进度/
  // eventBatchSeq 递增)不再触发整屏重渲。
  const online = useNetStore((s) => s.roomId !== "");
  // 断线横幅与知会槽/hint/选都提示共用顶中区域,--conn-h 统一下发让位偏移。
  const connDown = useConnDown();
  // 自局身份须稳定:单机 viewSeat 随决策方轮转,真人固定座位 0;联机取本座。
  // 席位格、手牌架与藏品钮均使用此身份,不跟随 bot 决策视角。
  const selfSeat = online ? viewSeat : 0;
  // 内容不变时复用玩家引用,供棋盘宿主与手牌/藏品组件 memo;BoardView 只读其结构子集。
  const players = useStablePlayers(snapshot.players);
  // 挂载时已入座;座位缺位表示快照与座位表不一致,直取使接线错误暴露。
  const selfPlayer = players[selfSeat];
  const [warlordsOpen, setWarlordsOpen] = useState(false);
  const openWarlords = useCallback(() => setWarlordsOpen(true), []);
  const closeWarlords = useCallback(() => setWarlordsOpen(false), []);
  // 入手音按手牌多重集差量播放,不跟随牌架挂载;同名牌逐张记账,收架期间照响。
  // 账本只活在本屏,换局重挂即重开。
  const prevHandRef = useRef<string[]>([]);
  useEffect(() => {
    const prev = [...prevHandRef.current];
    const gained = selfPlayer.jinnangHand.filter((id) => {
      const at = prev.indexOf(id);
      if (at < 0) return true;
      prev.splice(at, 1);
      return false;
    });
    prevHandRef.current = [...selfPlayer.jinnangHand];
    for (let i = 0; i < gained.length; i++) getAudio().play("jinnangDraw");
  }, [selfPlayer.jinnangHand]);
  // 托管态单源取值收口 useAutopilotOn(netStore):联机已入座=座位广播,单机=控制器本地
  // 标记(托管以在座为前提,未入座恒 false)。
  const autopilotOn = useAutopilotOn(controller);
  // 行军接管的棋子:fxStore.marching → BoardView.skipTokenIds,
  // 行军期间 React 声明式定位让位给 useMarch 的逐段命令式动画。
  const marching = useFxStore((s) => s.marching);
  // 设置弹层与战报抽屉开合态;战报从设置内打开
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [warReportOpen, setWarReportOpen] = useState(false);
  // 战报未读账:本地已读游标=打开抽屉那一刻的战报条数,不进快照——联机/
  // 恢复场景由既有日志通路自然重建(对局屏重挂=游标归零,存量全量记未读,金点即亮)。
  const [warReadCount, setWarReadCount] = useState(0);
  // log 由引擎原地 push,引用恒定;memo 依赖值语义 logCount,不能依赖 log 引用。
  // 日志只增,长度变化即内容变化;换局/恢复重灌也更新计数。过滤单源为 warEntriesOf,
  // 若其增加其他快照字段依赖,此处须同步调整。
  const warTotal = useMemo(() => warEntriesOf(snapshot).length, [snapshot.logCount]);
  // 游标越过总数 = 日志账本已换(换图重开一类):旧游标作废,现有条目全量记未读。
  // 这是游标语义本身(日志只增,变短即新账本),非容错分支。
  const warUnread = warReadCount > warTotal ? warTotal : warTotal - warReadCount;
  // null=随内容自动显隐;手动开/收只保持至下一次回合或决策窗边界。
  const [rackManualHidden, setRackManualHidden] = useState<boolean | null>(null);
  // 选都/详情流程状态机(useCapitalPick 单文件持有):选都候选派生 +
  // onTileClick 相位路由 + 详情/定都确认时序。
  const { offeredCapitals, selectableTiles, onTileClick, tileDetail } = useCapitalPick({
    snapshot,
  });

  // 决策归属与命令在途分开：锁住操作期间继续显示这一步的选择。
  const junshiWindowUp =
    snapshot.phase === "Playing" &&
    snapshot.turnPhase === "AwaitingJinnang" &&
    snapshot.decisionOwner === selfSeat &&
    snapshot.choices.some((o) => o.id === "pass" || o.id === "cancel");
  const junshiUp = junshiWindowUp && !autopilotOn && !selfPlayer.isBot;
  const junshiPendingCard = junshiUp ? snapshot.pendingJinnang : null;
  const junshiPendingSkill = junshiUp ? snapshot.pendingSkill : null;
  const junshiTargeting = junshiPendingCard != null || junshiPendingSkill != null;
  const [junshiSelection, setJunshiSelection] = useState<
    (RackCardSelection & { scope: string }) | null
  >(null);
  const junshiOptions =
    junshiUp && !junshiTargeting
      ? snapshot.choices.filter((o) => o.id !== "pass" && o.id !== "cancel")
      : [];
  // 同名牌渲染次序变化时，旧 key 无法继续定位原来的那张牌。
  const junshiScope = JSON.stringify([
    snapshot.gameId,
    snapshot.turnNumber,
    selfSeat,
    selfPlayer.id,
    junshiOptions.map((o) => [o.id, o.available]),
  ]);
  useEffect(() => setJunshiSelection(null), [junshiScope, junshiTargeting, junshiUp]);
  const junshiSelected =
    junshiSelection != null && junshiSelection.scope === junshiScope
      ? junshiOptions.find((o) => o.id === junshiSelection.optionId && o.available)
      : undefined;
  const selectedSkill =
    junshiSelected != null && isSkillOption(junshiSelected)
      ? skillById(junshiSelected.skillId)
      : null;
  const pendingSkill = junshiPendingSkill != null ? skillById(junshiPendingSkill.skillId) : null;
  const pendingCard = junshiPendingCard != null ? jinnangCardOf(junshiPendingCard.cardId) : null;
  const selectionRule = useMemo(() => {
    if (pendingCard != null) {
      const flow = TARGET_DOMAIN_STAGES[pendingCard.targetDomain];
      if (flow.stages === 0) throw new Error(`锦囊【${pendingCard.id}】没有目标段`);
      return flow.selection;
    }
    if (pendingSkill == null) return null;
    if (!isActiveSkill(pendingSkill) || pendingSkill.target === "none") {
      throw new Error(`技能【${pendingSkill.name}】没有目标段`);
    }
    const domain = pendingSkill.target === "city" ? "city" : "seat";
    return { domain, ...SINGLE_TARGET } as const;
  }, [pendingCard, pendingSkill]);
  const targetStep = useMemo(
    () =>
      selectionRule && {
        ...selectionRule,
        candidates: targetCandidates(snapshot.choices, selectionRule.domain),
      },
    [selectionRule, snapshot.choices],
  );
  const targetScope = junshiTargeting
    ? JSON.stringify([
        junshiScope,
        junshiPendingCard?.cardId,
        junshiPendingCard?.stage,
        junshiPendingSkill,
      ])
    : null;
  const targets = useTargetSelection(
    targetScope,
    targetStep,
    junshiPendingCard?.stage === "two-a" ? junshiPendingCard.picked : undefined,
  );
  const junshiCityTargeting = targetStep?.domain === "city";
  // 与 DecisionScrollLayer.dispatch 同款可选拍点(registry 未就绪时不发;GameScreenLive
  // 只在 controller/map 就位后挂载,正常流到不了 null)。
  const dispatchCommand = (cmd: GameCommand) => controller?.dispatchCommand(cmd);

  // 回到主页:弃局离屏——销毁控制器(LocalController 释放时钟/
  // 行军会话,OnlineController 断 WS),本屏随 screen 切换卸载;新开局由各屏流程
  // 重新 setController(registry 换局销毁契约不变)。
  const goHome = returnHome;
  const reconnect = () => {
    if (!(controller instanceof OnlineController)) throw new Error("恢复横幅缺少联机控制器");
    controller.reconnect();
  };
  // 设置弹层开合回调:引用稳定化同上(SettingsDialog memo 前提)。
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openWarReport = useCallback(() => {
    // 打开抽屉即清账:条数取点击拍当下快照(getState 读,不闭包捕获渲染拍)。
    setWarReadCount(warEntriesOf(useGameStore.getState().snapshot!).length);
    setWarReportOpen(true);
  }, []);

  const junshiConfirm = () => {
    if (!interactive) return;
    if (targetStep != null) {
      if (!targets.canConfirm) return;
      if (junshiPendingCard?.stage !== "two-a") getAudio().play("stamp");
      if (junshiPendingSkill != null) {
        dispatchCommand({ type: "useHeroSkill", ...junshiPendingSkill, targets: targets.selected });
      } else {
        dispatchCommand({
          type: "useJinnang",
          cardId: junshiPendingCard!.cardId,
          targets: targets.selected,
        });
      }
      return;
    }
    if (junshiSelected == null) return;
    if (!selectedNeedsTarget) getAudio().play("stamp");
    dispatchCommand(
      isSkillOption(junshiSelected)
        ? {
            type: "useHeroSkill",
            heroId: junshiSelected.skillHeroId,
            skillId: junshiSelected.skillId,
          }
        : { type: "useJinnang", cardId: junshiSelected.id },
    );
  };
  const junshiPass = () => {
    if (!interactive) return;
    if (junshiPendingSkill != null) {
      dispatchCommand({ type: "useHeroSkill", ...junshiPendingSkill, cancel: true });
    } else if (junshiPendingCard != null) {
      dispatchCommand({ type: "useJinnang", cardId: junshiPendingCard.cardId, cancel: true });
    } else {
      dispatchCommand({ type: "useJinnang", cardId: null });
    }
  };
  const junshiBack =
    junshiPendingCard?.stage === "two-b"
      ? () => dispatchCommand({ type: "useJinnang", cardId: junshiPendingCard.cardId, back: true })
      : undefined;
  const selectedNeedsTarget =
    selectedSkill != null
      ? isActiveSkill(selectedSkill) && selectedSkill.target !== "none"
      : junshiSelected != null &&
        TARGET_DOMAIN_STAGES[jinnangCardOf(junshiSelected.id).targetDomain].stages > 0;
  const junshiTitle = pendingCard?.id ?? pendingSkill?.name ?? junshiSelected?.label ?? "出牌阶段";
  const stepHint = junshiCityTargeting
    ? "在地图上选一座城"
    : junshiPendingCard?.stage === "two-a"
      ? "在右侧席位区选第一位诸侯"
      : junshiPendingCard?.stage === "two-b"
        ? "在右侧席位区选第二位诸侯"
        : "在右侧席位区选一位诸侯";
  const chosenLabels = targets.selected.map(
    (id) => targetStep!.candidates.find((candidate) => candidate.id === id)!.label,
  );
  if (junshiPendingCard?.stage === "two-b") {
    chosenLabels.unshift(players[junshiPendingCard.picked[0]].guohao);
  }
  const levy = junshiSelected?.levy;
  const junshiDetail = junshiTargeting
    ? [stepHint, ...(chosenLabels.length > 0 ? [`已选 ${chosenLabels.join("、")}`] : [])].join(
        " · ",
      )
    : levy != null
      ? `对其余 ${levy.affectedSeats.length} 位诸侯各征至多 ${formatMoney(levy.maxPerSeat)}`
      : undefined;
  const junshiPrimaryLabel =
    junshiPendingCard?.stage === "two-a"
      ? "下一步"
      : pendingSkill != null || (selectedSkill != null && !selectedNeedsTarget)
        ? "发动"
        : junshiTargeting || (junshiSelected != null && !selectedNeedsTarget)
          ? "出牌"
          : "选目标";

  const reactionChoices = reactionChoicesForSeat(snapshot, selfSeat);
  const reactionUp =
    reactionChoices != null && reactionChoices.asked && !reactionChoices.answered && !autopilotOn;
  const reactionScope = reactionUp
    ? JSON.stringify([snapshot.gameId, selfSeat, snapshot.pendingReaction!.seq])
    : null;
  const turnScope = reactionTurnScope(snapshot);
  const [reactMute, setReactMute] = useState<{ scope: string; state: ReactionMuteState } | null>(
    null,
  );
  const reactMuted =
    reactMute?.scope === turnScope && reactionMuted(reactMute.state, snapshot.activeIndex);
  useEffect(
    () =>
      mountGameDiagnostics(controller, snapshot.gameId, VERSION, (state, seat, canAct) => {
        const choices = reactionChoicesForSeat(state, seat);
        const muted =
          reactMute?.scope === reactionTurnScope(state) &&
          reactionMuted(reactMute.state, state.activeIndex);
        const canDecline =
          choices !== null && choices.asked && !choices.answered && !muted && canAct;
        return {
          capitalChoices: selectableCapitalTiles(state, seat),
          reaction:
            choices === null
              ? null
              : { ...choices, muted, canDecline, playable: canDecline ? choices.playable : [] },
        };
      }),
    [controller, snapshot.gameId, reactMute],
  );
  const lastMutedAnswer = useRef<string | null>(null);
  useEffect(() => {
    if (
      !interactive ||
      !reactMuted ||
      reactionScope == null ||
      lastMutedAnswer.current === reactionScope
    )
      return;
    lastMutedAnswer.current = reactionScope;
    controller.dispatchCommand({ type: "respondReaction", seat: selfSeat, use: false });
  }, [controller, interactive, reactionScope, reactMuted, selfSeat]);

  const reaction = reactionUp && !reactMuted ? snapshot.reaction : null;
  const noticeOccupied = junshiUp || reaction != null;
  useLayoutEffect(() => {
    const { setNoticeSlotOccupied } = useFxStore.getState();
    setNoticeSlotOccupied(noticeOccupied);
    return () => setNoticeSlotOccupied(false);
  }, [noticeOccupied]);
  const [reactSelection, setReactSelection] = useState<
    (RackCardSelection & { scope: string }) | null
  >(null);
  useEffect(() => {
    setReactSelection((selected) => (selected?.scope === reactionScope ? selected : null));
  }, [reactionScope]);
  const selectedReaction =
    reaction != null &&
    reactSelection?.scope === reactionScope &&
    reactionChoices!.playable.includes(reactSelection.optionId)
      ? reactSelection
      : null;
  const reactCardId = selectedReaction?.optionId;
  const seatLabelOf = (seat: number) => players[seat].guohao;
  const cityNameOf = (tileIndex: number) => board.at(tileIndex).name;
  const reactDomain =
    reaction?.kind === "jinnang" ? jinnangCardOf(reaction.cardId).targetDomain : null;
  const reactTargetStep: TargetSelectionStep | null =
    reaction?.kind === "jinnang" &&
    selectedReaction != null &&
    (reactDomain === "all-others" || reactDomain === "one-city")
      ? {
          domain: reactDomain === "one-city" ? "city" : "seat",
          ...SINGLE_TARGET,
          candidates: reaction.targetSeats.map((id) => ({
            id,
            label: reactDomain === "one-city" ? cityNameOf(id) : seatLabelOf(id),
            available: true,
          })),
        }
      : null;
  const reactTargetScope =
    reactTargetStep != null ? JSON.stringify([reactionScope, selectedReaction!.key]) : null;
  const reactTargets = useTargetSelection(reactTargetScope, reactTargetStep);
  const activeTargetStep = reactTargetStep ?? targetStep;
  const activeTargetScope = reactTargetScope ?? targetScope;
  const activeTargets = reactTargetStep != null ? reactTargets : targets;
  const cityTargeting = activeTargetStep?.domain === "city";
  const cityOptions = cityTargeting ? activeTargetStep.candidates.filter((o) => o.available) : [];
  const seatOptions = activeTargetStep?.domain === "seat" ? activeTargetStep.candidates : [];
  const [blockedSeat, setBlockedSeat] = useState<{ scope: string; text: string } | null>(null);
  const seatReason = blockedSeat?.scope === activeTargetScope ? blockedSeat.text : undefined;
  useEffect(() => {
    setBlockedSeat(null);
  }, [activeTargetScope]);
  const seatTargetPick = useCallback(
    (seat: number) => {
      if (!interactive) return;
      setBlockedSeat(null);
      activeTargets.toggle(seat);
    },
    [interactive, activeTargets.toggle],
  );
  const showSeatReason = useCallback(
    (seat: number, reason: string) => {
      if (activeTargetScope != null) {
        setBlockedSeat({ scope: activeTargetScope, text: `${players[seat].guohao} · ${reason}` });
      }
    },
    [activeTargetScope, players],
  );
  const handleTileClick = (tileIndex: number) => {
    if (cityTargeting) {
      if (interactive) activeTargets.toggle(tileIndex);
      return;
    }
    onTileClick(tileIndex);
  };
  const reactionShare = reactTargets.selected[0];
  const reactRespond = (use: boolean) => {
    if (!interactive) return;
    if (use) getAudio().play("stamp");
    dispatchCommand({
      type: "respondReaction",
      seat: selfSeat,
      use,
      ...(use ? { cardId: reactCardId, shareSeat: reactionShare } : {}),
    });
  };
  const reactionNotice =
    reaction != null ? reactionAnnouncement(reaction, seatLabelOf, cityNameOf) : null;
  const [playNudge, setPlayNudge] = useState(0);

  // ── 「你可」选择闸窗态:快照 pendingSkillChoices 首问驱动 ──
  // 相位单属主(decisionOwner=挂问属主,引擎 getter;interactive 经 canAct 主分支
  // 已门控:决策方=本座×非 bot×未托管×演出落定)。真人经触发卡应答:发动(放逐
  // 先点候选笺选目标;行殇目标既定直发)/暂不发,命令=respondSkillChoice(seat
  // 显式携带,反应窗同款 selfSeat 通路)。非属主座位零渲染(公开信息=战报行);
  // bot/托管座位由驱动链代答,不进窗态。快照 canonicalization:相位在窗而队列键
  // 缺席 = 状态机 bug,`!` 直取当场炸出(零兜底,同 pendingReaction 口径)。
  const skillWindowUp =
    snapshot.phase === "Playing" && snapshot.turnPhase === "AwaitingSkillChoice";
  const skillUp = interactive && skillWindowUp;
  const skillPending = skillWindowUp ? snapshot.pendingSkillChoices![0] : null;
  // 技定义按 id 查询 core/skills;choices 挂问时已保证触发技,非法 id 在 skillById 暴露。
  const skillDef = skillPending != null ? skillById(skillPending.skillId) : null;
  // 问身份(队列续问时区分前后两问:选中目标随问清空,组件 key 同源此串)。
  const skillQuestionId =
    skillPending != null
      ? `${skillPending.skillId}:${skillPending.heroId}:${skillPending.subjectSeat}:${skillPending.targetSeat ?? "-"}`
      : null;
  // 目标段选中(候选笺首点选中/再点同笺取消;进新问即清空重选)。
  const [skillTarget, setSkillTarget] = useState<number | null>(null);
  useEffect(() => {
    setSkillTarget(null);
  }, [skillQuestionId]);
  // 目标候选笺(ADR-0013 唯一口径=快照 choices:available 候选才入列;行殇目标
  // 既定=免选,笺行不挂,文案带目标括注)。
  const skillSeatOptions =
    skillPending != null && skillPending.targetSeat == null
      ? snapshot.choices.filter(
          (o): o is (typeof snapshot.choices)[number] & { targetSeat: number } =>
            o.targetSeat != null && o.available,
        )
      : [];
  const skillText =
    skillPending != null && skillDef != null
      ? `${snapshot.players[skillPending.ownerSeat].guohao}「${skillDef.name}」可达发动条件${
          skillPending.targetSeat != null
            ? `,目标 ${snapshot.players[skillPending.targetSeat].guohao}`
            : ""
        }`
      : "";
  const skillBanner =
    skillUp && skillPending != null && skillDef != null ? (
      <SkillChoiceBanner
        // key 挂问身份:队列续问(前后两问)即重挂,选中态随组件重置。
        key={`skill-choice-${skillQuestionId}`}
        text={skillText}
        seats={skillSeatOptions.map((o) => ({
          seat: o.targetSeat,
          label: snapshot.players[o.targetSeat].guohao,
        }))}
        pickedSeat={skillTarget}
        onPickSeat={(seat) => setSkillTarget((cur) => (cur === seat ? null : seat))} // 首点选中/再点取消
        confirmEnabled={skillPending.targetSeat != null || skillTarget != null}
        onConfirm={() => {
          const target = skillPending.targetSeat ?? skillTarget;
          if (target == null) return; // 放逐未选目标:确认钮禁用态,到不了这(自门控)
          getAudio().play("stamp"); // 落印音
          dispatchCommand({
            type: "respondSkillChoice",
            seat: selfSeat,
            use: true,
            targetSeat: target,
          });
        }}
        onDecline={() =>
          dispatchCommand({ type: "respondSkillChoice", seat: selfSeat, use: false })
        }
      />
    ) : null;

  // 自动状态实时随内容变化;灰置锦囊仍算有内容,主动技只计实际在架的卡牌段选项。
  // 触发技继续由手牌架边缘承载；锦囊反应条独立置顶。
  const myTurnUp = snapshot.phase === "Playing" && snapshot.activeIndex === selfSeat;
  const windowUp = junshiUp || reaction != null || skillBanner != null;
  const hasRackContent = selfPlayer.jinnangHand.length > 0 || junshiOptions.some(isSkillOption);
  const autoRackHidden = cityTargeting || !((myTurnUp || windowUp) && hasRackContent);
  const rackHidden = rackManualHidden === null ? autoRackHidden : rackManualHidden;
  const toggleRackHidden = useCallback(
    () => setRackManualHidden((manual) => !(manual === null ? autoRackHidden : manual)),
    [autoRackHidden],
  );
  const rackJunshiWindowUp = junshiWindowUp;
  const rackSkillQuestionId =
    skillWindowUp && snapshot.decisionOwner === selfSeat ? skillQuestionId : null;
  // 只在回合/本座实际窗态边界撤销手动控制;命令在途的交互锁不算关窗。
  useEffect(() => {
    setRackManualHidden(null);
  }, [
    selfSeat,
    snapshot.phase,
    snapshot.activeIndex,
    snapshot.turnNumber,
    rackJunshiWindowUp,
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
    const myTurn =
      snapshot.currentSetupPlayerIndex ===
      (useNetStore.getState().roomId !== "" ? useNetStore.getState().mySeat : 0);
    if (myTurn) return `轮到你定都:点选一座候选城(余 ${pending} 人未定)`;
    return `「${cur.guohao}」正在定都(尚余 ${pending} 人)…`;
  })();

  if (reaction != null && reactionDeadlineAt == null)
    throw new Error(`反应窗 ${snapshot.pendingReaction!.seq} 缺少截止时刻`);

  return (
    <AudioProvider>
      {/* 掷骰签演出宿主与 AudioProvider 同挂在对局屏,生命周期为一局。 */}
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
            players={players}
            /* 视角玩家 id 透传——自己棋子加玩家色微光圈(棋盘侧「我是谁」锚点) */
            viewSeat={localPlayer.id}
            /* 点格相位路由(Playing 详情 / Setup 选都 / 灰城 hint)在 useCapitalPick;
               城目标段在窗时改选格路由
               (候选格=选格,handleTileClick) */
            onTileClick={handleTileClick}
            selectableTiles={selectableTiles}
            /* 目标段选城:候选金环呼吸(选都 crown 同通路)+ 选中实金停持环;
               候选集/选中格从快照 choices 城选项派生,非城域恒 undefined/null */
            cityTargetTiles={cityTargeting ? new Set(cityOptions.map((o) => o.id)) : undefined}
            cityPickedTileIndex={cityTargeting ? (activeTargets.selected[0] ?? null) : null}
            /* 候选集全座位透传——非决策席也见静态金圈与壹贰叁序号印 */
            candidateTiles={offeredCapitals ?? undefined}
            /* 目标段:可用候选席位的棋子金虚线环呼吸(与席位格金圈同步) */
            targetedPlayerIds={
              activeTargetStep?.domain === "seat"
                ? new Set(seatOptions.filter((o) => o.available).map((o) => players[o.id].id))
                : undefined
            }
            activeTileIndex={
              snapshot.phase === "Playing" ? players[snapshot.activeIndex].position : null
            }
            /* 当前回合方:活跃棋子金呼吸环(与常驻回合胶囊双锚点「谁在打」) */
            activePlayerId={
              snapshot.phase === "Playing" ? players[snapshot.activeIndex].id : undefined
            }
            isSetupPhase={snapshot.phase === "Setup"}
            skipTokenIds={marching}
          />
          {/* 进屏压暗叠罩使用 opacity 合成,避免 SVG filter 逐帧整板重栅;样式见 screen-transition.css。 */}
          <div className="board-dim-in" aria-hidden="true" />
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
            <DecisionScrollLayer
              key={snapshot.gameId}
              snapshot={snapshot}
              viewSeat={viewSeat}
              interactive={interactive}
              tileDetail={tileDetail}
            />
          </div>
        </div>
        {/* 顶左设置/详情两钮,顶中留给知会槽。 */}
        <GameTopBar
          warUnread={warUnread}
          onOpenSettings={openSettings}
          overviewOpen={warlordsOpen}
          onOpenOverview={openWarlords}
        />
        {warlordsOpen && (
          <WarlordsOverview
            key={snapshot.gameId}
            players={players}
            selfSeat={selfSeat}
            activeSeat={snapshot.phase === "Playing" ? snapshot.activeIndex : null}
            round={snapshot.round}
            onClose={closeWarlords}
          />
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
          snapshot={snapshot}
          selfSeat={selfSeat}
          onOpenOverview={openWarlords}
          targets={
            activeTargetStep?.domain === "seat"
              ? {
                  bySeat: new Map(
                    players.map((_, seat) => {
                      const option = seatOptions.find((o) => o.id === seat);
                      const firstPick =
                        reactTargetStep == null &&
                        junshiPendingCard?.stage === "two-b" &&
                        junshiPendingCard.picked.includes(seat);
                      return [
                        seat,
                        {
                          available: option?.available === true,
                          selected: firstPick || activeTargets.selected.includes(seat),
                          reason: firstPick
                            ? "已选为第一位，点「上一步」可更改"
                            : option == null
                              ? "不在本次影响范围"
                              : option.reason,
                        },
                      ];
                    }),
                  ),
                  locked: !interactive,
                  onPick: seatTargetPick,
                  onUnavailable: showSeatReason,
                }
              : undefined
          }
        />
        {/* 收架时仅待决触发技保留手牌区入口。 */}
        {(!rackHidden || skillBanner != null) && (
          <HandZone
            snapshot={snapshot}
            player={selfPlayer}
            autopilotOn={autopilotOn}
            showDiceFace={hasRackContent && !rackBannerOnly}
            children={
              /* 手牌架使用稳定自局玩家,只承载牌面与窗态;banner-only 只渲横幅。 */
              <HandRack
                key={`${selfSeat}:${selfPlayer.id}`}
                player={selfPlayer}
                nudgePulse={playNudge}
                bannerOnly={rackBannerOnly}
                junshi={
                  junshiUp
                    ? {
                        options: junshiOptions,
                        pendingCardId: junshiPendingCard?.cardId ?? null,
                        pendingSkillId: junshiPendingSkill?.skillId ?? null,
                        selectedKey: junshiSelected != null ? junshiSelection!.key : null,
                        onSelect: (selection) => {
                          if (interactive) {
                            setJunshiSelection(
                              selection != null ? { ...selection, scope: junshiScope } : null,
                            );
                          }
                        },
                      }
                    : undefined
                }
                reaction={
                  reaction != null
                    ? {
                        reactiveIds: reactionChoices!.playable,
                        seq: snapshot.pendingReaction!.seq,
                        selection: selectedReaction,
                        onSelect: (selection) => {
                          if (!interactive) return;
                          if (selectedReaction?.key === selection.key) {
                            setReactSelection(null);
                            return;
                          }
                          getAudio().play("jinnangSelect");
                          setReactSelection({ ...selection, scope: reactionScope! });
                        },
                      }
                    : undefined
                }
                skillBanner={skillBanner}
              />
            }
          />
        )}
        {/* 锦囊钮控制牌架显隐,收架且有决策窗时呼吸提示;珍宝/名将弹层由 PileButtons 自持。 */}
        <PileButtons
          player={selfPlayer}
          rackVisible={!rackHidden}
          breathe={rackBreathe}
          nudgePulse={rackHidden ? playNudge : undefined}
          onToggleRack={toggleRackHidden}
          bookPlayReady={interactive && junshiUp && !junshiTargeting} // 己方出牌阶段卡牌段可用技能书
          onUseBook={(treasureId, heroId) => {
            getAudio().play("stamp");
            dispatchCommand({ type: "useBookSkill", treasureId, heroId });
          }}
          dismissReady={
            // 遣散窗口:本地决策+对局中+自己回合
            interactive &&
            snapshot.phase === "Playing" &&
            snapshot.activeIndex === selfSeat &&
            snapshot.turnPhase !== "AwaitingBankruptcySettle"
          }
          onDismiss={(heroId) => {
            getAudio().play("stamp");
            dispatchCommand({ type: "dismissHero", heroId });
          }}
        />
        {/* 设置弹层提供战报、托管、音效、诊断与回主页等入口。 */}
        {settingsOpen && (
          <SettingsDialog
            onClose={closeSettings}
            onOpenWarReport={openWarReport}
            onGoHome={goHome}
            onCaptureDiagnostic={checkpointGameDiagnostics}
          />
        )}
        {junshiUp && (
          <ActionBar
            title={junshiTitle}
            collapsed={rackHidden && !junshiTargeting}
            detail={seatReason == null ? junshiDetail : `${junshiDetail} · ${seatReason}`}
            primaryLabel={junshiPrimaryLabel}
            cancelLabel={
              junshiPendingSkill != null
                ? "作罢"
                : junshiPendingCard != null
                  ? "取消选牌"
                  : undefined
            }
            canConfirm={junshiTargeting ? targets.canConfirm : junshiSelected != null}
            locked={!interactive}
            onPlay={junshiConfirm}
            onPass={junshiPass}
            onBack={junshiBack}
            onBlockedAttempt={() => setPlayNudge((n) => n + 1)}
          />
        )}
        {reaction != null && reactionNotice != null && (
          <ReactionBanner
            key={reactionScope}
            {...reactionNotice}
            step={
              seatReason ??
              (reactTargetStep != null
                ? `${rackHidden ? `已选 ${selectedReaction!.optionId} · ` : ""}${
                    reactionShare != null
                      ? `保护 ${reactTargetStep.candidates.find((o) => o.id === reactionShare)!.label}`
                      : reactTargetStep.domain === "city"
                        ? "在地图上选一座城保护"
                        : "在右侧席位区选一位诸侯保护"
                  }`
                : reactCardId != null
                  ? `已选 ${reactCardId}`
                  : null)
            }
            durationMs={reaction.windowMs}
            deadlineAt={reactionDeadlineAt!}
            confirmEnabled={
              reactCardId != null && (reactTargetStep == null || reactTargets.canConfirm)
            }
            locked={!interactive}
            onConfirm={() => reactRespond(true)}
            onDecline={() => reactRespond(false)}
            onMute={() => {
              lastMutedAnswer.current = reactionScope;
              setReactMute({ scope: turnScope, state: reactionMuteEngage(snapshot.activeIndex) });
              reactRespond(false);
            }}
          />
        )}
        {/* 战报抽屉(入口在设置内):条件挂载,常收零占位。 */}
        {warReportOpen && (
          <WarReportDrawer snapshot={snapshot} onClose={() => setWarReportOpen(false)} />
        )}
        {/* 窥探弹层:军情密探即时窥探的 viewer-only 演出——开关态单源 fxStore
          (peekApplied 表现事件驱动,关闭即清),组件按 viewerSeat===本座自门。 */}
        <PeekModal selfSeat={selfSeat} />
        {/* 竖屏手机「请横屏」提示层:常驻 DOM,显隐在 layout.css 媒询。 */}
        <RotateHintOverlay />
      </div>
    </AudioProvider>
  );
}
