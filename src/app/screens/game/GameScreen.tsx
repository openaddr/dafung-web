// 组件收口细则见 docs/design/组件收口.md。
// 对局屏:全幅棋盘、顶左设置/详情、顶中知会槽、席位格列、底缘手牌区与右下三圆钮。
// 本屏持有设置/战报开合态,战报入口在设置内;PileButtons 自持珍宝/名将藏品弹层。
// 出牌窗由 AwaitingJinnang、interactive 与 choices 派生:HandRack 选牌,ActionBar 确认,
// SeatRail/BoardView 选择目标;命令经 registry 当前控制器下发。反应窗与技能待决另走横幅。
// gameStore.snapshot 驱动渲染,useCapitalPick 持有选都/详情流程,棋盘取景恒为地图总览。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardView } from "@app/components/board/BoardView";
import {
  useGameStore,
  useLocalPlayer,
  useStablePlayers,
  type GameSnapshot,
} from "@app/store/gameStore";
import { useNetStore, useAutopilotOn } from "@app/store/netStore";
import { getController, getControllerContext } from "@app/controllers/registry";
import { returnHome } from "@app/screens/shared/return-home";
import { OnlineController } from "@app/controllers/online";
import type { Board } from "@core/board";
import type { GameCommand } from "@core/authority";
import { isSkillOption } from "@core/choices";
import { jinnangCardOf } from "@core/jinnang";
import { skillById } from "@core/skills";
import { REACTION_EXPECT } from "@core/reaction-window";
import { getAudio } from "@app/fx/audio";
import { scaleReactionMs } from "@app/fx/timings";
import { reactionQueriesSeat } from "@app/controllers/reaction";
import { AudioProvider } from "@app/fx/AudioProvider";
import { DiceOverlay } from "@app/fx/DiceOverlay";
import { FxLayer } from "@app/fx/FxLayer";
import { useFxStore } from "@app/fx/fxStore";
import { startFrameDiag, stopFrameDiag } from "@app/frameDiag";
import { HandRack, type RackCardSelection } from "./HandRack";
import { HandZone } from "./HandZone";
import { ReactionBanner } from "./ReactionBanner";
import { SkillChoiceBanner } from "./SkillChoiceBanner";
import {
  reactionMuteEngage,
  reactionMuteInitial,
  reactionMuteOnActor,
  reactionMuted,
  type ReactionMuteState,
} from "./reaction-mute";
import { GameTopBar } from "./GameTopBar";
import { SeatRail } from "./SeatRail";
import { PileButtons } from "./PileButtons";
import { SettingsDialog } from "./SettingsDialog";
import { ActionBar } from "./ActionBar";
import { NoticeBanner } from "./NoticeBanner";
import { WarReportDrawer, warEntriesOf } from "./WarReportDrawer";
import { PeekModal } from "./PeekModal";
import { DecisionScrollLayer } from "./scroll/DecisionScrollLayer";
import { useCapitalPick } from "./useCapitalPick";
import { HintBar } from "@app/screens/shared/HintBar";
import {
  ConnectionBanner,
  CONN_BANNER_BODY_H,
  useConnDown,
} from "@app/screens/shared/ConnectionBanner";
import { useDigitKeyPick } from "@app/hooks/use-digit-key-pick";
import { TESTIDS } from "./testids";

/** 目标括注按 core/jinnang.targetDomain 装配;targetSeats 在城域存 tileIndex,其余存座位号。
 *  反识破链环的争夺份「(保 X)」在装配点另列,份与目标名单不同。 */
function jinnangTargetNote(
  cardId: string,
  targetSeats: number[],
  nameOf: (seat: number) => string,
  cityNameOf: (tileIndex: number) => string,
): string {
  const domain = jinnangCardOf(cardId).targetDomain;
  if (domain === "all-others") return "(全场)";
  if (domain === "self") return "(自身)";
  const labelOf = domain === "one-city" ? cityNameOf : nameOf;
  return `(对 ${targetSeats.map(labelOf).join("、")})`;
}

export function GameScreen() {
  const snapshot = useGameStore((s) => s.snapshot);
  // 静态上下文由 registry 提供,门卫确认快照与地图均已就位。
  const context = getControllerContext();
  if (!snapshot || !context) {
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
            className="ink-btn mt-6 rounded-[5px] px-8 py-3 font-brush text-xl tracking-[0.3em] cursor-pointer"
          >
            回到首页
          </button>
        </div>
      </div>
    );
  }
  return <GameScreenLive snapshot={snapshot} board={context.board} />;
}

/** 竖屏手机「请横屏」提示层:移动端只做横屏形态。
 *  常驻 DOM,显隐全交 layout.css 媒询(orientation: portrait + max-width: 700px +
 *  pointer: coarse 才全屏接管挡住对局;桌面窄窗口 pointer: fine 不触发)。 */
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
function GameScreenLive({ snapshot, board }: { snapshot: GameSnapshot; board: Board }) {
  // 模块级取控制器(不在 React 状态里:实例含方法/WS,非渲染数据,见 registry.ts 注释)
  const controller = getController();
  const interactive = useGameStore((s) => s.interactive);
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
  const selfHandOrder = JSON.stringify(selfPlayer.jinnangHand);
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
  // 回合/窗态变化时同步显隐:我的回合或决策窗在场则展开,其余收起。
  // 沿间允许锦囊钮临时切换;下次回合/窗态变化重新对齐。
  const [rackHidden, setRackHidden] = useState(false);
  // 回调引用稳定化:settings/锦囊钮弹层族 memo 的前提——闭包体内
  // 经 getState 取当下值,不捕获渲染拍 snapshot,引用恒定。
  const toggleRackHidden = useCallback(() => setRackHidden((v) => !v), []);
  // 选都/详情流程状态机(useCapitalPick 单文件持有):选都候选派生 +
  // onTileClick 相位路由 + 详情/定都确认时序。
  const { offeredCapitals, selectableTiles, onTileClick, tileDetail } = useCapitalPick({
    snapshot,
  });

  // 出牌窗:本件持有选牌/目标态,interactive 由控制器判定,choices 须含 pass/cancel。
  const junshiUp =
    interactive &&
    snapshot.phase === "Playing" &&
    snapshot.turnPhase === "AwaitingJinnang" &&
    snapshot.choices.some((o) => o.id === "pass" || o.id === "cancel");
  // 目标段二态载荷(pendingJinnang=锦囊选人 / pendingSkill=技选人,引擎字段单源)。
  const junshiPendingCard = junshiUp ? snapshot.pendingJinnang : null;
  const junshiPendingSkill = junshiUp ? snapshot.pendingSkill : null;
  const junshiTargeting = junshiPendingCard != null || junshiPendingSkill != null;
  // 卡牌段选中(选中可逆:点它牌换选/再点同牌/右键/长按取消在 HandRack);进目标段
  // 与退窗态即清空重选。
  const [junshiSelection, setJunshiSelection] = useState<
    (RackCardSelection & { scope: string }) | null
  >(null);
  // 席位点击与数字键共用选中态;首点选中、再点取消,执行经动作条确认。进/出目标段清空。
  const [junshiTargetSeat, setJunshiTargetSeat] = useState<number | null>(null);
  // 城目标首点选中、再点取消、点他格改选,执行经动作条确认。进/出目标段清空。
  const [junshiTargetTile, setJunshiTargetTile] = useState<number | null>(null);
  useEffect(() => {
    setJunshiTargetSeat(null);
    setJunshiTargetTile(null);
  }, [junshiTargeting, junshiUp, selfSeat, selfPlayer.id]);
  // 帧诊采样器(ADR-0047):采样生命周期=对局屏生命周期——挂载开采/卸载停采,
  // 设置「性能诊断」行随时导诊断包(真机卡顿取证;桌面探针测不到真机体感)。
  useEffect(() => {
    startFrameDiag();
    return () => stopFrameDiag();
  }, []);
  const junshiOptions =
    junshiUp && !junshiTargeting
      ? snapshot.choices.filter((o) => o.id !== "pass" && o.id !== "cancel")
      : [];
  // 渲染序与可用性按值记账；快照的新数组不构成新选择上下文。同名序缩短或重排
  // 无法映射回真实纸牌实例，整次选择作废，禁止将旧 key 迁到另一张同名牌。
  const junshiScope = JSON.stringify([
    selfSeat,
    selfPlayer.id,
    junshiOptions.map((o) => [o.id, o.available]),
  ]);
  useEffect(() => setJunshiSelection(null), [junshiScope, junshiTargeting, junshiUp]);
  const junshiSelected =
    junshiSelection != null && junshiSelection.scope === junshiScope
      ? junshiOptions.find((o) => o.id === junshiSelection.optionId && o.available)
      : undefined;
  // 目标段候选(available 过滤后供席位呼吸/棋盘呼吸与数字键同序)。
  const junshiSeatOptions = junshiTargeting
    ? (snapshot.choices.filter((o) => o.targetSeat != null) as Array<
        (typeof snapshot.choices)[number] & { targetSeat: number }
      >)
    : [];
  // 城目标段候选(火攻技与火烧连营锦囊同窗同款):choices 城选项
  //(结构化载荷含 targetTileIndex,available 引擎已闸——技域合法城清单空时技选项灰置
  //「射程内无可烧之城」根本进不了目标段;锦囊域候选=全部城池格恒非空)。点亮/点选
  // 形制两域同款无第二形制(无主中心免伤是结算语义,UI 无差别)。域互斥:目标段在城域
  // 时候席选项恒空(候选形状单源 choices.ts)。
  const junshiCityOptions = junshiTargeting
    ? (snapshot.choices.filter((o) => o.targetTileIndex != null) as Array<
        (typeof snapshot.choices)[number] & { targetTileIndex: number }
      >)
    : [];
  const junshiCityTargeting = junshiCityOptions.length > 0;

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

  // 目标段提交命令装配(席位域 targets=[座位] / 城指向域 targets=[目标城 tileIndex]:
  // 技=useHeroSkill、锦囊=useJinnang,四种组合命令形状同构一装配两域共用;城指向域
  // (火烧连营)提交后由引擎按 cityTargetOptionId 对选项集复验,通道与候选 id
  // 沿 choices 既有形状,不出第三条通路。目标段在窗恒有 pendingSkill/pendingCard
  // 之一(引擎字段互斥单源),双缺=状态机 bug——`!` 直取失载荷当场炸出(零兜底)。
  const junshiTargetCmd = (target: number): GameCommand =>
    junshiPendingSkill != null
      ? {
          type: "useHeroSkill",
          heroId: junshiPendingSkill.heroId,
          skillId: junshiPendingSkill.skillId,
          targets: [target],
        }
      : { type: "useJinnang", cardId: junshiPendingCard!.cardId, targets: [target] };

  // 卡牌段确认(动作钮「出牌」)与目标段确认(动作钮「出」)共用拍点:选中项/选中席/
  // 选中格发命令,同时播放落印音。
  const junshiConfirm = () => {
    if (junshiTargeting) {
      // 城目标段:提交通道 targets=[目标城
      // tileIndex](choices 候选 targetTileIndex 同值);席位域=targets=[选中席]。
      // 选中必在(playEnabled 已闸的确认钮自门控),缺选静返=自门控口径(非兜底)。
      const target = junshiCityTargeting ? junshiTargetTile : junshiTargetSeat;
      if (target == null) return;
      getAudio().play("stamp");
      dispatchCommand(junshiTargetCmd(target));
      return;
    }
    if (junshiSelected == null) return;
    getAudio().play("stamp");
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
  // 卡牌段「不出」= 今不用(牌不消耗);目标段「作罢」= 收回此计牌(不消耗、不记冷却)。
  const junshiPass = () => {
    if (junshiTargeting) {
      dispatchCommand(
        junshiPendingSkill != null
          ? {
              type: "useHeroSkill",
              heroId: junshiPendingSkill.heroId,
              skillId: junshiPendingSkill.skillId,
              cancel: true,
            }
          : { type: "useJinnang", cardId: junshiPendingCard!.cardId, cancel: true },
      );
    } else {
      dispatchCommand({ type: "useJinnang", cardId: null });
    }
  };
  // 目标段选席:席位点击层与数字键同写一个选中态(首点选中/再点同席取消);
  // 打出经 junshiConfirm(动作条「出」)。
  const junshiToggleSeat = (targetSeat: number) =>
    setJunshiTargetSeat((cur) => (cur === targetSeat ? null : targetSeat));
  // 城目标段选格:棋盘格点击层同写一个选中态
  //(首点选中/再点同格取消/点他格改选);打出经 junshiConfirm
  //(动作条「出」)。
  const junshiToggleTile = (tileIndex: number) =>
    setJunshiTargetTile((cur) => (cur === tileIndex ? null : tileIndex));
  // 落格点击路由:城目标段在窗时候选格点击=选格,不再走选都/详情路由;
  // 非候选格=死区(候选金环呼吸+全场压暗已表意,§4.6;席位域不可选槽轻晃同判词,
  // 格侧死区零反馈可接受——压暗态一眼可辨不可点)。其余相位原路由(useCapitalPick)。
  const handleTileClick = (tileIndex: number) => {
    if (junshiCityTargeting) {
      if (junshiCityOptions.some((o) => o.targetTileIndex === tileIndex))
        junshiToggleTile(tileIndex);
      return;
    }
    onTileClick(tileIndex);
  };
  // 目标段数字键 1..n 选中可用席位(与点选同口径:只选中,不打出;
  // useDigitKeyPick 单源;卡牌段数字键在 HandRack)。
  useDigitKeyPick(
    junshiTargeting,
    junshiSeatOptions.filter((o) => o.available).map((o) => o.targetSeat),
    junshiToggleSeat,
  );

  // 自己也是候选时,SeatRail 自机格使用同一 seatTarget 通路。
  // ── 反应窗态:快照 reaction 专用字段驱动 ──
  // 反应询问不走 choices 单属主通道(多属主),本件从 reaction 派生横幅/可打牌/选份;
  // 命令=respondReaction(seat 显式携带)。与出牌阶段态互斥(AwaitingReaction 相位)。
  // 被询问判定公式单源 controllers/reaction.ts。
  // 已应答退出窗态:本座已在 pendingReaction.answers 占座(用与不用都占座)
  // 即不再复显横幅/金边/可打牌面——UI 消费权威应答账本,防残留与重复点击入口;引擎
  // 对重复应答本就警告拒绝。answers 逐条公开(联机投影不裁,seat-projection.ts 注)。
  const reactionUp =
    snapshot.phase === "Playing" &&
    snapshot.turnPhase === "AwaitingReaction" &&
    snapshot.reaction != null &&
    reactionQueriesSeat(snapshot.reaction, selfSeat) &&
    !snapshot.pendingReaction!.answers.some((a) => a.seat === selfSeat);
  // 窗实例号:seq 变化即新窗(同 kind/userSeat/cardId 的连续窗不靠 key 区分了),
  // 横幅重挂=倒计时弧重起、静默代发重评估,与权威侧窗级 deadline 同享同一判据。
  const reactionSeq = snapshot.pendingReaction?.seq ?? null;
  // 降噪口(客户端本地态,ADR-0017 §4):「本回合不再询问」只活到当前行动者回合结束
  //(行动者变更即解除)——静默期间收到询问自动立即代发「不用」,不弹横幅。
  // 状态机单源 reaction-mute.ts(纯函数;语义:静默记按下时的
  // 行动者,换人即解除且回到原行动者不复燃)。
  const [reactMute, setReactMute] = useState<ReactionMuteState>(reactionMuteInitial);
  useEffect(
    () => setReactMute((s) => reactionMuteOnActor(s, snapshot.activeIndex)),
    [snapshot.activeIndex],
  );
  const reactMuted = reactionMuted(reactMute, snapshot.activeIndex);
  // 静默自动应答:窗开且静默中 → 代发不用(单机走驱动链排队,联机走 WS;均与手点同路)。
  // 依赖含窗实例号:静默期间连续两窗(march 续走下一城,seq 递增)时第二窗也要代发。
  useEffect(() => {
    if (reactionUp && reactMuted)
      dispatchCommand({ type: "respondReaction", seat: selfSeat, use: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispatchCommand 闭包随渲染更新,依赖窗态/静默/窗实例号三个语义键
  }, [reactionUp, reactMuted, reactionSeq]);
  // 卡牌段选中与按份族选份(点牌选中,再点同牌取消;进/出窗态清空重选;
  // share 语义随域=座位号或受击城 tileIndex)
  const reactScope = JSON.stringify([selfSeat, selfPlayer.id, selfHandOrder, reactionSeq]);
  const [reactSelection, setReactSelection] = useState<
    (RackCardSelection & { scope: string }) | null
  >(null);
  const reactCardId =
    reactSelection != null && reactSelection.scope === reactScope ? reactSelection.optionId : null;
  const [reactShare, setReactShare] = useState<number | null>(null);
  useEffect(() => {
    setReactSelection(null);
    setReactShare(null);
  }, [reactionUp, reactScope]);
  const reaction = snapshot.reaction;
  // 本窗公告牌的目标域(单源 core/jinnang 目录;反识破链环窗公告的是识破自身,域=
  // reaction 族,天然落「免选」分支——链环应答不带份,与引擎 respondReaction 校验同形)。
  const reactDomain =
    reactionUp && reaction?.kind === "jinnang" ? jinnangCardOf(reaction.cardId).targetDomain : null;
  // 按份族必选份:识破只免其中一份,须指定被保护份——all-others=座位份(横征暴敛等,
  // 含自己);one-city=城份(火烧连营,份=受击城 tileIndex 清单)。选中反应牌才出
  // 份候选(与既有 all-others 同形);其余域(单目标/半路杀出/链环窗)shareSeat 不参与
  // 语义,免选。
  const reactShareSeats =
    reactionUp &&
    reaction?.kind === "jinnang" &&
    reactCardId != null &&
    (reactDomain === "all-others" || reactDomain === "one-city")
      ? reaction.targetSeats
      : [];
  // 此刻可打的反应锦囊(手牌 ∩ 本窗牌种;目录单源 core/jinnang,UI 不自判合法性)。
  // 在座却无 selfPlayer=引擎/快照 bug,未判空直取让它当场崩出(零兜底)
  // ——不写 `!= null` 静默收窄成空手牌。
  const reactPlayable =
    reactionUp && reaction != null
      ? selfPlayer.jinnangHand.filter(
          (id) => jinnangCardOf(id).effect.kind === REACTION_EXPECT[reaction.kind], // 窗种→反应 kind 单源
        )
      : [];
  const reactRespond = (use: boolean, cardId?: string, shareSeat?: number) => {
    if (use) getAudio().play("stamp"); // 落印音
    dispatchCommand({ type: "respondReaction", seat: selfSeat, use, cardId, shareSeat });
  };
  // 未选牌点按「出牌」计数:动作条自门控回执 → HandRack 可用牌金圈脉冲一拍。
  const [playNudge, setPlayNudge] = useState(0);
  const seatLabelOf = (seat: number) => snapshot.players[seat].guohao;
  // 城指向域选份令牌/目标括注的城名查表(board 越界当场炸=零兜底)。
  const cityNameOf = (tileIndex: number) => board.at(tileIndex).name;
  const reactBanner =
    reactionUp && reaction != null && !reactMuted ? (
      <ReactionBanner
        // key 挂窗实例号:seq 变化即重挂重起弧(倒计时投影与权威侧窗级 deadline
        // 同享同一判据;同参数牌的连续窗不靠 kind/userSeat/cardId 区分)。
        key={`reaction-${reactionSeq}`}
        text={
          reaction.kind === "jinnang"
            ? snapshot.pendingReaction?.payload.kind === "counter"
              ? // 反识破链环:公告的是一张识破,文案带链根与争夺份(争夺份标签随
                // 根域:城指向域=城名;其余=国号);整计链(连环计被识破)无份
                // 可保,改列根计目标(目标域读目录)
                `${snapshot.players[reaction.userSeat].guohao} 识破【${snapshot.pendingReaction.payload.root.cardId}】${
                  snapshot.pendingReaction.payload.shareSeat != null
                    ? `(保 ${
                        jinnangCardOf(snapshot.pendingReaction.payload.root.cardId).targetDomain ===
                        "one-city"
                          ? cityNameOf(snapshot.pendingReaction.payload.shareSeat)
                          : snapshot.players[snapshot.pendingReaction.payload.shareSeat].guohao
                      })`
                    : jinnangTargetNote(
                        snapshot.pendingReaction.payload.root.cardId,
                        snapshot.pendingReaction.payload.root.targets,
                        seatLabelOf,
                        cityNameOf,
                      )
                },可反识破`
              : // 根窗:目标括注随目录目标域——被询问者凭此判「要不要识破」
                `${snapshot.players[reaction.userSeat].guohao} 使用【${reaction.cardId}】${jinnangTargetNote(reaction.cardId, reaction.targetSeats, seatLabelOf, cityNameOf)}`
            : `${snapshot.players[reaction.userSeat].guohao} 行军将过你的城池`
        }
        // 来者锦囊 mini 签面:jinnang 窗带本窗牌面锚点;march 窗无牌不挂。
        cardId={reaction.kind === "jinnang" ? reaction.cardId : undefined}
        // 时长来自权威快照 windowMs,统一经 scaleReactionMs 包装。
        durationMs={scaleReactionMs(reaction.windowMs)}
        shareSeats={reactShareSeats}
        shareSeat={reactShare}
        onPickShare={(share) => setReactShare((cur) => (cur === share ? null : share))} // 首点选中/再点取消
        // 份令牌标签随域:城指向域=城名,其余=国号(候选集语义随 reactShareSeats)。
        seatLabel={reactDomain === "one-city" ? cityNameOf : seatLabelOf}
        confirmEnabled={reactCardId != null && (reactShareSeats.length === 0 || reactShare != null)}
        onConfirm={() => {
          if (reactCardId == null) return;
          reactRespond(true, reactCardId, reactShareSeats.length > 0 ? reactShare! : undefined);
        }}
        onDecline={() => reactRespond(false)}
        onMute={() => {
          setReactMute(reactionMuteEngage(snapshot.activeIndex)); // 先记静默(本回合内后续询问不弹)
          reactRespond(false); // 当前窗立即以「不用」应答
        }}
      />
    ) : null;

  // ── 「你可」选择闸窗态:快照 pendingSkillChoices 首问驱动 ──
  // 相位单属主(decisionOwner=挂问属主,引擎 getter;interactive 经 canAct 主分支
  // 已门控:决策方=本座×非 bot×未托管×演出落定)。真人经触发卡应答:发动(放逐
  // 先点候选笺选目标;行殇目标既定直发)/暂不发,命令=respondSkillChoice(seat
  // 显式携带,反应窗同款 selfSeat 通路)。非属主座位零渲染(公开信息=战报行);
  // bot/托管座位由驱动链代答,不进窗态。快照 canonicalization:相位在窗而队列键
  // 缺席 = 状态机 bug,`!` 直取当场炸出(零兜底,同 pendingReaction 口径)。
  const skillUp =
    interactive && snapshot.phase === "Playing" && snapshot.turnPhase === "AwaitingSkillChoice";
  const skillPending = skillUp ? snapshot.pendingSkillChoices![0] : null;
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
      ? `${snapshot.players[skillPending.ownerSeat].guohao}「${skillDef.name}」可达发动条件,可指定目标或暂不发${
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

  // ── 显隐规则同步(回合联动+决策保底):rackHidden 被「回合/窗态沿」重同步,
  // 沿与沿之间锦囊钮 toggle 随便改(手动临时开/收,下一道沿重新对齐)──
  // 亮沿=我的回合开始(activeIndex 回 selfSeat)/ 任何窗态开场(出牌窗 junshiUp、
  // 反应窗 reactBanner 由无到有)——决策保底,「决策通路不被收走」由通路本身
  // 保证(出牌窗=动作条、反应窗=横幅),同步只管「看得见架」;收沿=回合交出
  // (activeIndex 离席)/ 窗态收场且不在我的回合——决策毕,架撤。dep-array effect
  // 一枚管四沿(清空重选同款手法;布尔组合幂等,沿间不重跑)。
  const myTurnUp = snapshot.phase === "Playing" && snapshot.activeIndex === selfSeat;
  const windowUp = junshiUp || reactBanner != null || skillBanner != null;
  useEffect(() => {
    setRackHidden(!(myTurnUp || windowUp));
  }, [myTurnUp, windowUp]);
  // 窗态+收起的两处派生(呼吸金光/banner-only 形态,消费点见下渲染段):一次推导。
  const rackBreathe = rackHidden && windowUp;
  const rackBannerOnly = rackHidden && (reactBanner != null || skillBanner != null);

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
            cityTargetTiles={
              junshiCityTargeting
                ? new Set(junshiCityOptions.map((o) => o.targetTileIndex))
                : undefined
            }
            cityPickedTileIndex={junshiCityTargeting ? junshiTargetTile : null}
            /* 候选集全座位透传——非决策席也见静态金圈与壹贰叁序号印 */
            candidateTiles={offeredCapitals ?? undefined}
            /* 目标段:可用候选席位的棋子金虚线环呼吸(与席位格金圈同步) */
            targetedPlayerIds={
              junshiTargeting
                ? new Set(
                    junshiSeatOptions
                      .filter((o) => o.available)
                      .map((o) => players[o.targetSeat].id),
                  )
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
              snapshot={snapshot}
              viewSeat={viewSeat}
              interactive={interactive}
              tileDetail={tileDetail}
            />
          </div>
        </div>
        {/* 顶左设置/详情两钮,顶中留给知会槽。 */}
        <GameTopBar snapshot={snapshot} warUnread={warUnread} onOpenSettings={openSettings} />
        {/* 顶中知会槽承载回合胶囊/都城停条带/等待条,瞬态知会优先,由 fxStore 槽泵排队互斥。 */}
        <NoticeBanner
          snapshot={snapshot}
          interactive={interactive}
          selfPresenting={selfPresenting}
          viewSeat={viewSeat}
          online={online}
        />
        {/* 席位格按稳定 selfSeat 识别自机,活跃方金圈指名。
          目标段由 choices 派生候选,点格选中/再点取消,打出经动作条确认。 */}
        <SeatRail
          snapshot={snapshot}
          selfSeat={selfSeat}
          targets={
            junshiTargeting
              ? {
                  bySeat: new Map(
                    junshiSeatOptions.map((o) => [
                      o.targetSeat,
                      {
                        available: o.available,
                        reason: o.reason,
                        selected: o.targetSeat === junshiTargetSeat,
                      },
                    ]),
                  ),
                  onPick: junshiToggleSeat, // 首点选中/再点取消,打出走动作条「出」
                }
              : undefined
          }
        />
        {/* 底缘透明手牌区:签面驻左端 + 手牌架。
          显隐=回合联动+决策保底(亮=我的回合∪决策窗在场∪手动临时开,规则同步
          见 rackHidden 声明处)。挂载条件 `!rackHidden || 横幅窗在场`(反应窗/
          「你可」触发卡):纯收起整区卸载(签面随之,卸载零占位,战斗区
          最大化);收起时若横幅窗在场,区壳仍挂载以宿主横幅(banner-only 形态,
          签面/牌行不挂,横幅失去架体依托后贴底下移)。 */}
        {(!rackHidden || reactBanner != null || skillBanner != null) && (
          <HandZone
            snapshot={snapshot}
            player={selfPlayer}
            autopilotOn={autopilotOn}
            bannerOnly={rackBannerOnly}
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
                        onSelect: (selection) =>
                          setJunshiSelection(
                            selection != null ? { ...selection, scope: junshiScope } : null,
                          ),
                        onConfirm: junshiConfirm,
                      }
                    : undefined
                }
                reaction={
                  reactBanner != null
                    ? {
                        banner: reactBanner,
                        reactiveIds: reactPlayable,
                        seq: snapshot.pendingReaction!.seq,
                        selectedKey: reactCardId != null ? reactSelection!.key : null,
                        onSelect: (selection) => {
                          getAudio().play("jinnangSelect"); // 选中音(选中可逆,取消不出声)
                          setReactShare(null); // 换选即清份(份随牌走)
                          setReactSelection((cur) =>
                            cur?.scope === reactScope && cur.key === selection.key
                              ? null
                              : { ...selection, scope: reactScope },
                          );
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
          bookPlayReady={junshiUp && !junshiTargeting} // 己方出牌阶段卡牌段可用技能书
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
          />
        )}
        {/* 动作条独立于牌架,收架仍可决策;卡牌段出牌/不出,目标段出/作罢。
          未选牌的确认尝试触发 playNudge:架展开时提示可用牌,收起时提示锦囊钮。 */}
        {junshiUp && (
          <ActionBar
            segment={junshiTargeting ? "target" : "card"}
            playEnabled={
              junshiTargeting
                ? junshiCityTargeting
                  ? junshiTargetTile != null // 城目标段:选中格点亮「出」
                  : junshiTargetSeat != null
                : junshiSelected != null
            }
            onPlay={junshiConfirm}
            onPass={junshiPass}
            rightShift={!junshiTargeting && junshiSelected != null}
            onBlockedAttempt={() => setPlayNudge((n) => n + 1)}
          />
        )}
        {/* 战报抽屉(入口在设置内):条件挂载,常收零占位。 */}
        {warReportOpen && (
          <WarReportDrawer snapshot={snapshot} onClose={() => setWarReportOpen(false)} />
        )}
        {/* 窥探弹层:军情密探即时窥探的 viewer-only 演出——开关态单源 fxStore
          (peekApplied 表现事件驱动,关闭即清),组件按 viewerSeat===本座自门。 */}
        <PeekModal selfSeat={selfSeat} />
        {/* 名下城池清单由 GameTopBar 的诸侯详情城池列打开,开合态归其子树。 */}
        {/* 竖屏手机「请横屏」提示层:常驻 DOM,显隐在 layout.css 媒询。 */}
        <RotateHintOverlay />
      </div>
    </AudioProvider>
  );
}
