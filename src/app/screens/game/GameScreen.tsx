// Game 屏(#700 全浮层骨架;#732 顶左行序重排):棋盘全幅垫底 + 顶部浮层(顶左
// 设置/详情/N 轮 chip 一行)+ 顶中知会横幅槽(NoticeBanner)+ 席位格列(#698 重形)
// + 底缘透明手牌区 + 右下三圆钮。
// 旧顶栏/底部仪表条(DashboardBar)已退役并核销(#700):目标身价/回合方字条/牌库
// 角标/复位·缩放·静音钮 → 席位格与设置弹层承接;现金/属性徽章/体力/「你」印 →
// 席位格(#698 起一人一格全字段,自机金样式);签面 → 手牌区左端;托管钮 → #701
// tap 弹层(过渡期不可达可接受);战报把手 → 设置弹层「战报›」(数据照记)。
// WaitingBar 保留为全局兜底,席位格活跃金圈呼吸承担「谁在行动」指名(操作不限时,
// 无倒计时条)。
// 出牌阶段态(#256):旧弹窗退役(DecisionScrollLayer 不再路由该相位),出牌面
// 上架手牌架——本件从快照派生窗态载荷(turnPhase=AwaitingJinnang + interactive
// 门控,与退役前弹窗同门)接线三方:HandRack(窗态牌面/手势)、ActionBar(两段
// 动作条)、SeatRail+TokenLayer(目标段候选呼吸)。引擎相位/choices/命令语义
// 零改动,只换呈现层;零可用自动过口径不变(引擎侧已自动)。
// #255/#361 收口:战报抽屉(右缘把手,WarReportDrawer)在本件持有开合态;珍宝/名将
// 明细走牌架双入口+藏品弹层(HandRack 内自持,expandPile 徽章机制已退役)。
// usePanZoom/TokenLayer 其余/FxLayer 不动。
// 数据流:gameStore.snapshot → 声明式渲染;交互统一经 registry 取 controller 下发。
// 选都/详情流程状态机仍收口 useCapitalPick;本屏只做接线与布局。
import { useEffect, useState } from "react";
import { BoardView } from "@app/components/board/BoardView";
import { useGameStore, useLocalPlayer, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore, useAutopilotOn } from "@app/store/netStore";
import { getController, getControllerMap, setController } from "@app/controllers/registry";
import type { GameCommand } from "@core/authority";
import type { MapData } from "@core/board-loader";
import { jinnangCardOf } from "@core/jinnang";
import { getAudio } from "@app/fx/audio";
import { scaleReactionMs } from "@app/fx/timings";
import { reactionQueriesSeat } from "@app/controllers/reaction";
import { AudioProvider } from "@app/fx/AudioProvider";
import { DiceOverlay } from "@app/fx/DiceOverlay";
import { FxLayer } from "@app/fx/FxLayer";
import { useFxStore } from "@app/fx/fxStore";
import { HandRack } from "./HandRack";
import { HandZone } from "./HandZone";
import { ReactionBanner } from "./ReactionBanner";
import { GameTopBar } from "./GameTopBar";
import { SeatRail } from "./SeatRail";
import { PileButtons } from "./PileButtons";
import { SettingsDialog } from "./SettingsDialog";
import { ActionBar } from "./ActionBar";
import { NoticeBanner } from "./NoticeBanner";
import { WarReportDrawer } from "./WarReportDrawer";
import { PeekModal } from "./PeekModal";
import { CityLedgerModal } from "./CityLedgerModal";
import { DecisionScrollLayer } from "./scroll/DecisionScrollLayer";
import { InquiryLayer } from "./InquiryScroll";
import { useCapitalPick } from "./useCapitalPick";
import { HintBar } from "@app/screens/shared/HintBar";
import { ConnectionBanner } from "@app/screens/shared/ConnectionBanner";
import { useDigitKeyPick } from "@app/hooks/use-digit-key-pick";
import { TESTIDS } from "./testids";

export function GameScreen() {
  const snapshot = useGameStore((s) => s.snapshot);
  const map = getControllerMap();
  if (!snapshot || !map) {
    // S9 未开局兜底页:此前只是一行灰字,玩家会卡死在空屏。
    // 理论上 setScreen("game") 前必有 controller+map(刷新丢快照/路由错误会到这里),
    // 给「回到首页」逃生口而不是让玩家面对空棋盘干瞪眼。
    // 主体拆到 GameScreenLive:snapshot/map 就位才挂载,空态分支与对局分支不共享 hooks。
    const back = useGameStore.getState().setScreen;
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg p-6">
        <div className="rounded-lg border-2 border-gold/60 bg-panel px-10 py-8 text-center shadow">
          <div className="font-title text-3xl text-ink tracking-widest">尚未开局</div>
          <div className="mt-2 font-deco text-sm text-ink-dim">对局数据不存在或已丢失</div>
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
  return <GameScreenLive snapshot={snapshot} map={map} />;
}

/** 竖屏手机「请横屏」提示层(#276 纠偏定案:移动端只做横屏形态,竖屏不做游戏布局)。
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

// 锦囊手牌显隐偏好键(#700;键名风格照地图偏好键 MAP_PREF_KEY 的 dafung.* 族)。
const HAND_VISIBLE_KEY = "dafung.handVisible";
/** 读偏好:缺键=显示(首局默认亮);仅「0」算收起,其余一律显示。 */
const readHandPref = (): boolean => localStorage.getItem(HAND_VISIBLE_KEY) !== "0";

/** 已开局主体:棋盘全幅 + 全浮层(顶部条/席位格列/手牌区/三圆钮);hooks 全在此,
 *  snapshot/map 由 GameScreen 门卫。 */
function GameScreenLive({ snapshot, map }: { snapshot: GameSnapshot; map: MapData }) {
  // 模块级取控制器(不在 React 状态里:实例含方法/WS,非渲染数据,见 registry.ts 注释)
  const controller = getController();
  const interactive = useGameStore((s) => s.interactive);
  // 本座位动作在途(#611「行军中…」提示源):与 interactive 同拍由控制器写入,
  // WaitingBar 与按钮同源消费——亮一起亮、灰一起灰。
  const selfPresenting = useGameStore((s) => s.selfPresenting);
  const viewSeat = useGameStore((s) => s.viewSeat);
  const hint = useGameStore((s) => s.hint);
  const hintLevel = useGameStore((s) => s.hintLevel);
  const localPlayer = useLocalPlayer();
  const net = useNetStore();
  // 自局座位(稳定身份,勿用 viewSeat):单机热座下 viewSeat 跟随决策方轮转(bot 回合
  // 时指到 bot 席),席位格自机格识别/仪表条身份/手牌架都需要的是固定的「人」。
  // 单机起手坐姿恒为座位 0(SoloSetup 座位表构造:首座 isBot:false);联机=本座。
  const selfSeat = net.roomId !== "" ? viewSeat : 0;
  // 自局玩家(#284 零兜底审视):对局屏挂载即已入座(selfSeat 恒 ≥0;观战预留分支
  // 已随 #690 退役)——座位缺位 = 快照与座位表不一致(接线 bug),undefined 直通
  // 下游崩出来,不做 `?? null` 静默兜底。
  const selfPlayer = snapshot.players[selfSeat];
  // 托管态单源取值收口 useAutopilotOn(netStore):联机已入座=座位广播,单机=控制器本地
  // 标记(托管以在座为前提,未入座恒 false)。
  const autopilotOn = useAutopilotOn(controller);
  // 行军接管的棋子(阶段 6):fxStore.marching → BoardView.skipTokenIds,
  // 行军期间 React 声明式定位让位给 useMarch 的逐段命令式动画。
  const marching = useFxStore((s) => s.marching);
  // 名下城池清单弹层(#622)开合态(同 SkillGlossaryDialog 先例:交互语义归消费方)。
  // 目标持座位号不持玩家对象——弹层开着随快照实时重渲;selfSeat 命中即自看口径。
  const [cityLedgerSeat, setCityLedgerSeat] = useState<number | null>(null);
  // 设置弹层/战报抽屉开合态(#700:战报入口降级设置弹层,两态都在本件收口)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [warReportOpen, setWarReportOpen] = useState(false);
  // 锦囊手牌显隐开关(#700):对局内记忆、重进恢复(localStorage,键名风格照地图
  // 偏好键 dafung.mapId);缺键=显示(首局默认亮,原型 ① 锦囊钮亮态)。出牌阶段态
  // 与反应窗(牌架即窗)强制显示——决策面不能被视野偏好收走。
  const [handPref, setHandPref] = useState(readHandPref);
  const toggleHandPref = () =>
    setHandPref((v) => {
      localStorage.setItem(HAND_VISIBLE_KEY, v ? "0" : "1");
      return !v;
    });
  // 选都/详情流程状态机(useCapitalPick 单文件持有):选都候选派生 +
  // onTileClick 相位路由 + 详情/定都确认时序。
  const { offeredCapitals, selectableTiles, onTileClick, tileDetail } = useCapitalPick({
    snapshot,
  });

  // 快照玩家是 BoardPlayer 的结构超集(heroes/treasures 等展示字段棋盘不消费):
  // BoardView 的 props 已按真实消费面声明为最小接口,直接透传即可,无需断言。
  const players = snapshot.players;

  // ── 出牌阶段态(#256):AwaitingJinnang 的呈现层状态机(选牌在本件,命令直发引擎)──
  // 门与退役前的卷轴弹窗完全同款:interactive 门控=本地决策(controller 单源),
  // choices 含 pass/cancel = 注册表确已产出出牌阶段选项(相位/选项集不符时不进窗态)。
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
  // 与退窗态即清空重选(与一期弹窗口径一致)。
  const [junshiSelectedId, setJunshiSelectedId] = useState<string | null>(null);
  // 目标段选中席(#417 统一口径:首点选中/再点同席取消——不再点席位即出;席位点击层
  // 与数字键共用此选中态,执行走动作条「出」确认钮)。进/出目标段即清空重选。
  const [junshiTargetSeat, setJunshiTargetSeat] = useState<number | null>(null);
  useEffect(() => {
    setJunshiSelectedId(null);
    setJunshiTargetSeat(null);
  }, [junshiTargeting, junshiUp]);
  const junshiOptions =
    junshiUp && !junshiTargeting
      ? snapshot.choices.filter((o) => o.id !== "pass" && o.id !== "cancel")
      : [];
  const junshiSelected =
    junshiSelectedId != null
      ? junshiOptions.find((o) => o.id === junshiSelectedId && o.available)
      : undefined;
  // 目标段候选(available 过滤后供席位呼吸/棋盘呼吸与数字键同序)。
  const junshiSeatOptions = junshiTargeting
    ? (snapshot.choices.filter((o) => o.targetSeat != null) as Array<
        (typeof snapshot.choices)[number] & { targetSeat: number }
      >)
    : [];

  // 与 DecisionScrollLayer.dispatch 同款可选拍点(registry 未就绪时不发;GameScreenLive
  // 只在 controller/map 就位后挂载,正常流到不了 null)。
  const dispatchCommand = (cmd: GameCommand) => controller?.dispatchCommand(cmd);

  // 回到主页(#700 设置弹层):弃局离屏——销毁控制器(LocalController 释放时钟/
  // 行军会话,OnlineController 断 WS),本屏随 screen 切换卸载;新开局由各屏流程
  // 重新 setController(registry 换局销毁契约不变)。
  const goHome = () => {
    setController(null);
    useGameStore.getState().setScreen("setup");
  };

  // 卡牌段确认(动作钮「出牌」)与目标段确认(动作钮「出」)共用拍点:选中项/选中席
  // 发命令;落印音效随一期迁移。
  const junshiConfirm = () => {
    if (junshiTargeting) {
      if (junshiTargetSeat == null) return;
      getAudio().play("stamp");
      dispatchCommand(junshiSeatCmd(junshiTargetSeat));
      return;
    }
    if (junshiSelected == null) return;
    getAudio().play("stamp");
    dispatchCommand(
      junshiSelected.skillId != null
        ? { type: "useHeroSkill", skillId: junshiSelected.skillId }
        : { type: "useJinnang", cardId: junshiSelected.id },
    );
  };
  // 卡牌段「不出」= 今不用(牌不消耗);目标段「作罢」= 收回此计牌(不消耗、不记冷却)。
  const junshiPass = () => {
    if (junshiTargeting) {
      dispatchCommand(
        junshiPendingSkill != null
          ? { type: "useHeroSkill", skillId: junshiPendingSkill.skillId, cancel: true }
          : { type: "useJinnang", cardId: junshiPendingCard!.cardId, cancel: true },
      );
    } else {
      dispatchCommand({ type: "useJinnang", cardId: null });
    }
  };
  // 目标段选席(#417):席位点击层与数字键同写一个选中态(首点选中/再点同席取消);
  // 打出经 junshiConfirm(动作条「出」)。
  const junshiToggleSeat = (targetSeat: number) =>
    setJunshiTargetSeat((cur) => (cur === targetSeat ? null : targetSeat));
  const junshiSeatCmd = (targetSeat: number): GameCommand =>
    junshiPendingSkill != null
      ? { type: "useHeroSkill", skillId: junshiPendingSkill.skillId, targets: [targetSeat] }
      : { type: "useJinnang", cardId: junshiPendingCard!.cardId, targets: [targetSeat] };

  // 目标段数字键 1..n 选中可用席位(#417 与点选同口径:只选中,不打出;
  // useDigitKeyPick 单源;卡牌段数字键在 HandRack)。
  useDigitKeyPick(
    junshiTargeting,
    junshiSeatOptions.filter((o) => o.available).map((o) => o.targetSeat),
    junshiToggleSeat,
  );

  // 目标段自选目标(#417):候选含自己(any 域放行——华佗·赈济)时,自机格点击层
  // 即候选钮(SeatRail targets 按 seats 全量装配,含 selfSeat;testid seatTarget 族
  // 同一通路)。#700 仪表条退役后「你」印候选钮不再存在,自选目标回归席位格单点。
  // ── 反应窗态(#281,#234 P1-D 牌架即反应窗):快照 reaction 专用字段驱动 ──
  // 反应询问不走 choices 单属主通道(多属主),本件从 reaction 派生横幅/可打牌/选份;
  // 命令=respondReaction(seat 显式携带)。与出牌阶段态互斥(AwaitingReaction 相位)。
  // 被询问判定公式单源 controllers/reaction.ts(#284)。
  // 已应答退出窗态(#453/B2):本座已在 pendingReaction.answers 占座(用与不用都占座)
  // 即不再复显横幅/金边/可打牌面——UI 消费权威应答账本,防残留与重复点击入口;引擎
  // 对重复应答本就警告拒绝。answers 逐条公开(联机投影不裁,seat-projection.ts 注)。
  const reactionUp =
    snapshot.phase === "Playing" &&
    snapshot.turnPhase === "AwaitingReaction" &&
    snapshot.reaction != null &&
    reactionQueriesSeat(snapshot.reaction, selfSeat) &&
    !snapshot.pendingReaction!.answers.some((a) => a.seat === selfSeat);
  // 窗实例号(#284):seq 变化即新窗(同 kind/userSeat/cardId 的连续窗不靠 key 区分了),
  // 横幅重挂=倒计时弧重起、静默代发重评估,与权威侧窗级 deadline 同享同一判据。
  const reactionSeq = snapshot.pendingReaction?.seq ?? null;
  // 降噪口(客户端本地态,ADR-0017 §4):「本回合不再询问」只活到当前行动者回合结束
  //(行动者变更即解除)——静默期间收到询问自动立即代发「不用」,不弹横幅。
  const [reactMutedSeat, setReactMutedSeat] = useState<number | null>(null);
  useEffect(() => setReactMutedSeat(null), [snapshot.activeIndex]);
  const reactMuted = reactMutedSeat === snapshot.activeIndex;
  // 静默自动应答:窗开且静默中 → 代发不用(单机走驱动链排队,联机走 WS;均与手点同路)。
  // 依赖含窗实例号:静默期间连续两窗(march 续走下一城,seq 递增)时第二窗也要代发。
  useEffect(() => {
    if (reactionUp && reactMuted)
      dispatchCommand({ type: "respondReaction", seat: selfSeat, use: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispatchCommand 闭包随渲染更新,依赖窗态/静默/窗实例号三个语义键
  }, [reactionUp, reactMuted, reactionSeq]);
  // 卡牌段选中与 AOE 选份(G-19 一期手感:点牌选中,再点同牌取消;进/出窗态清空重选)
  const [reactCardId, setReactCardId] = useState<string | null>(null);
  const [reactShare, setReactShare] = useState<number | null>(null);
  useEffect(() => {
    setReactCardId(null);
    setReactShare(null);
  }, [reactionUp]);
  const reaction = snapshot.reaction;
  // AOE 全体域必选份(横征暴敛等):识破只免其中一份,须指定被保护座位(含自己);
  // 其余域 shareSeat 不参与语义,免选(单目标/半路杀出)。
  const reactShareSeats =
    reactionUp && reaction?.kind === "jinnang" && reactCardId != null
      ? jinnangCardOf(reaction.cardId).targetDomain === "all-others"
        ? reaction.targetSeats
        : []
      : [];
  // 此刻可打的反应锦囊(手牌 ∩ 本窗牌种;目录单源 core/jinnang,UI 不自判合法性)。
  // 在座却无 selfPlayer=引擎/快照 bug,未判空直取让它当场崩出(零兜底,#284 评审)
  // ——不写 `!= null` 静默收窄成空手牌。
  const reactPlayable =
    reactionUp && reaction != null
      ? selfPlayer.jinnangHand.filter(
          (id) =>
            jinnangCardOf(id).effect.kind === (reaction.kind === "jinnang" ? "counter" : "ambush"),
        )
      : [];
  const reactRespond = (use: boolean, cardId?: string, shareSeat?: number) => {
    if (use) getAudio().play("stamp"); // 落印音随一期口径
    dispatchCommand({ type: "respondReaction", seat: selfSeat, use, cardId, shareSeat });
  };
  const reactBanner =
    reactionUp && reaction != null && !reactMuted ? (
      <ReactionBanner
        // key 挂窗实例号(#284):seq 变化即重挂重起弧(倒计时投影与权威侧窗级 deadline
        // 同享同一判据;同参数牌的连续窗不靠 kind/userSeat/cardId 区分)。
        key={`reaction-${reactionSeq}`}
        text={
          reaction.kind === "jinnang"
            ? snapshot.pendingReaction?.payload.kind === "counter"
              ? // 反识破链环(#571):公告的是一张识破,文案带链根与争夺份
                `${snapshot.players[reaction.userSeat].guohao} 识破【${snapshot.pendingReaction.payload.root.cardId}】${
                  snapshot.pendingReaction.payload.shareSeat != null
                    ? `(保 ${snapshot.players[snapshot.pendingReaction.payload.shareSeat].guohao})`
                    : ""
                },可反识破`
              : `${snapshot.players[reaction.userSeat].guohao} 使用【${reaction.cardId}】`
            : `${snapshot.players[reaction.userSeat].guohao} 行军将过你的城池`
        }
        // 时长单源(#284):读快照 windowMs 过缩放包装,不再按窗种引常量表——
        // 单机=引擎常量 3000(缩放后行为不变);联机=权威侧配置,两端同长。
        durationMs={scaleReactionMs(reaction.windowMs)}
        shareSeats={reactShareSeats}
        shareSeat={reactShare}
        onPickShare={(seat) => setReactShare((cur) => (cur === seat ? null : seat))} // #417 首点选中/再点取消
        seatLabel={(seat) => snapshot.players[seat].guohao}
        confirmEnabled={reactCardId != null && (reactShareSeats.length === 0 || reactShare != null)}
        onConfirm={() => {
          if (reactCardId == null) return;
          reactRespond(true, reactCardId, reactShareSeats.length > 0 ? reactShare! : undefined);
        }}
        onDecline={() => reactRespond(false)}
        onMute={() => {
          setReactMutedSeat(snapshot.activeIndex); // 先记静默(本回合内后续询问不弹)
          reactRespond(false); // 当前窗立即以「不用」应答
        }}
      />
    ) : null;

  // 选都阶段的引导文案(三选一:引擎按价格分层+地理分散滚出 3 候选)。
  // 按「谁的 turn」分化(dogfood 2026-09-28:bot 定都 40s+ 期间画面只有淡金圈,
  // 玩家不知在等谁、也不知金圈是何物;轮到自己时也要明示「点哪」):
  // bot 定都中=「「X」正在定都(第 N/M 位)…」;轮到本地=「轮到你定都:点选一座候选城」。
  // 顺序号取 draft 座位序中尚未定都者,直观呈现还差几人。
  // 未定判定用 <0(#423 项1):capitalIndex 初始 -1(core/player.ts),`== null` 恒假
  // ——「余 X 人未定」曾是恒 0;与 TokenLayer 的 setupUnselected 同一口径。
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
      {/* 掷骰签面(自建全屏 overlay,不渲染内容)——与 AudioProvider 同挂在 Game 屏,
          生命周期=一局;#188 第 1 步:掷骰由控制器定时自动发起(起签后起摇),演出期间
          控制器 busy 锁 interactive,决策卷轴在演出结束后才呈现。 */}
      <DiceOverlay />
      <div className="game-layout relative h-full w-full overflow-hidden bg-bg text-ink">
        {/* 棋盘区全幅垫底(id="board-wrap":FxLayer 的逻辑坐标→容器像素换算锚点)。
          棋盘初始取景 = computeFitView 按图推导的总览 viewBox + preserveAspectRatio
          meet——容器变矮
          整盘等比缩小,无需 pan/zoom 补偿。 */}
        <div id="board-wrap" className="board-area">
          {/* F2 断线横幅:z-20 压过 hint,断线是对局中优先级最高的状态反馈 */}
          <ConnectionBanner />
          <BoardView
            map={map}
            players={players}
            /* L47:视角玩家 id 透传——自己棋子加玩家色微光圈(棋盘侧「我是谁」锚点) */
            viewSeat={localPlayer.id}
            /* 点格相位路由(Playing 详情 / Setup 选都 / 灰城 hint)在 useCapitalPick */
            onTileClick={onTileClick}
            selectableTiles={selectableTiles}
            /* X4(#23):候选集全座位透传——非决策席也见静态金圈与壹贰叁序号印 */
            candidateTiles={offeredCapitals ?? undefined}
            /* #256 目标段:可用候选席位的棋子金虚线环呼吸(与席位格金圈同步) */
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
            isSetupPhase={snapshot.phase === "Setup"}
            skipTokenIds={marching}
          />
          {/* 阶段 6:浮字/铜钱雨/回合横幅/印章(store 驱动的瞬时表现) */}
          <FxLayer />
          {setupHint && (
            // S8(#41);#732 评审修复重立几何契约:选都期知会槽恒空(等待条
            // phase≠Playing 直接 null),选都引导上移驻槽行(+8)——纯播报即知会,
            // 与槽内件同几何;统一 hint 退第二行(+48),与槽内等待条/横幅上下错开。
            <div
              data-testid={TESTIDS.hint}
              className="pointer-events-none absolute top-[calc(var(--safe-top)+8px)] left-1/2 -translate-x-1/2 rounded-[3px] border border-lacquer-gold/30 bg-panel/95 px-4 py-1 font-title text-lg shadow-sm"
            >
              {setupHint}
            </div>
          )}
          {/* F4:统一 hint 组件(样式与过期口径与 lobby/App 一致;#732 评审修复:
              顶中 +8 行归知会槽,game 屏 hint 落 +48 第二行,不再与等待条同轴叠字) */}
          <HintBar
            hint={hint}
            level={hintLevel}
            overlayTopClass="top-[calc(var(--safe-top)+48px)]"
          />
          {/* 决策卷轴路由(阶段 6 接线):按相位弹招贤/珍宝/破产/胜利/城池详情。
            容器 pointer-events-none:无弹层时不挡棋盘;各弹层自带遮罩(z-30)接管交互。
            选都/详情流程只下发一个窄 props(tileDetail,状态机在 useCapitalPick)。 */}
          <div id="scroll-layer" className="pointer-events-none absolute inset-0">
            <DecisionScrollLayer
              snapshot={snapshot}
              viewSeat={viewSeat}
              interactive={interactive}
              tileDetail={tileDetail}
            />
            {/* 定制问询弹层路由(#424,ADR-0022 交互 handler 客户端半边):与决策卷轴
              平级同槽(AwaitingInquiry 与各决策相位互斥,无同帧双弹层),呈现意图定制。 */}
            <InquiryLayer snapshot={snapshot} interactive={interactive} />
          </div>
        </div>
        {/* 顶部浮层(#700;#732 顶左行序):设置/详情两钮 + 「N 轮」chip 同排,顶中让给知会槽 */}
        <GameTopBar snapshot={snapshot} onOpenSettings={() => setSettingsOpen(true)} />
        {/* 顶中知会横幅槽(#732):回合横幅/都城停条带/等待条(宿主迁槽,文案派生
            口径不变)共用一条带——排队互斥在 fxStore 知会槽泵,瞬态知会优先于等待条。 */}
        <NoticeBanner
          snapshot={snapshot}
          interactive={interactive}
          selfPresenting={selfPresenting}
          viewSeat={viewSeat}
          online={net.roomId !== ""}
        />
        {/* 席位格列(#698 重形:96×38 双行八项格):全员一人一格(自机入列),
          活跃方金圈呼吸指名。
          消费的是稳定自局座位(selfSeat):自机格识别要「人」而非决策视角——热座
          viewSeat 随决策方轮转(#453/B1 契约,prop 名已收口 selfSeat)。
          #256/#417 目标段:候选席位格金圈呼吸,点格=选中/再点取消(targets 由快照
          choices 派生,打出走动作条「出」)。 */}
        <SeatRail
          snapshot={snapshot}
          selfSeat={selfSeat}
          cityLedger={{ openSeat: cityLedgerSeat, onOpen: setCityLedgerSeat }}
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
                  onPick: junshiToggleSeat, // #417 首点选中/再点取消,打出走动作条「出」
                }
              : undefined
          }
        />
        {/* 底缘透明手牌区(#700):签面驻左端 + 手牌架。
          显隐=锦囊圆钮偏好 ∥ 窗态强制(出牌阶段/反应窗的决策面不被视野偏好收走);
          收起=条件挂载(卸载零占位,战斗区最大化)。 */}
        {(handPref || junshiUp || reactBanner != null) && (
          <HandZone
            snapshot={snapshot}
            player={selfPlayer}
            autopilotOn={autopilotOn}
            children={
              /* #238/T3 手牌架(player 用稳定自局玩家——热座 viewSeat 轮到 bot 时架
              不该换出 bot 的牌。#256:出牌阶段态载荷随快照派生;#700:藏品入口
              迁右下三圆钮,架体只承载牌面与窗态)。 */
              <HandRack
                player={selfPlayer}
                junshi={
                  junshiUp
                    ? {
                        options: junshiOptions,
                        pendingCardId: junshiPendingCard?.cardId ?? null,
                        pendingSkillId: junshiPendingSkill?.skillId ?? null,
                        selectedId: junshiSelectedId,
                        onSelect: setJunshiSelectedId,
                        onConfirm: junshiConfirm,
                      }
                    : undefined
                }
                reaction={
                  reactBanner != null
                    ? {
                        banner: reactBanner,
                        reactiveIds: reactPlayable,
                        selectedId: reactCardId,
                        onSelect: (id) => {
                          getAudio().play("jinnangSelect"); // 选中音(选中可逆,取消不出声)
                          setReactShare(null); // 换选即清份(份随牌走)
                          setReactCardId((cur) => (cur === id ? null : id));
                        },
                      }
                    : undefined
                }
              />
            }
          />
        )}
        {/* 右下三圆钮(#700):锦囊=手牌显隐开关(亮=显示)/ 珍宝 / 名将(藏品弹层
          入口,#361 双入口接替);坐姿渲染。 */}
        <PileButtons
          player={selfPlayer}
          handVisible={handPref || junshiUp || reactBanner != null}
          onToggleHand={toggleHandPref}
        />
        {/* 设置弹层(#700):音效/演出加速/战报›/版本/回到主页(入口降级收口件) */}
        {settingsOpen && (
          <SettingsDialog
            onClose={() => setSettingsOpen(false)}
            onOpenWarReport={() => setWarReportOpen(true)}
            onGoHome={goHome}
          />
        )}
        {/* 动作条(#256):锚仪表条上缘不锚牌;卡牌段=出牌/不出,目标段=出(选中席
          点亮,#417)/作罢;选中放大牌占中时右让不遮牌面(原型 margin-left:240px 口径)。 */}
        {junshiUp && (
          <ActionBar
            segment={junshiTargeting ? "target" : "card"}
            playEnabled={junshiTargeting ? junshiTargetSeat != null : junshiSelected != null}
            onPlay={junshiConfirm}
            onPass={junshiPass}
            rightShift={!junshiTargeting && junshiSelected != null}
          />
        )}
        {/* 战报抽屉(#255;#700 入口降级设置弹层):条件挂载,常收零占位。 */}
        {warReportOpen && (
          <WarReportDrawer snapshot={snapshot} onClose={() => setWarReportOpen(false)} />
        )}
        {/* 窥探弹层(#575):军情密探即时窥探的 viewer-only 演出——开关态单源 fxStore
          (peekApplied 表现事件驱动,关闭即清),组件按 viewerSeat===本座自门。 */}
        <PeekModal selfSeat={selfSeat} />
        {/* 名下城池清单弹层(#622):席位格/仪表条城池图标点开,只读五列清单;
          开合态在本件(上),目标持座位号——弹层开着随快照实时重渲。 */}
        {cityLedgerSeat != null && (
          <CityLedgerModal
            snapshot={snapshot}
            seat={cityLedgerSeat}
            self={cityLedgerSeat === selfSeat}
            onClose={() => setCityLedgerSeat(null)}
          />
        )}
        {/* 竖屏手机「请横屏」提示层(#276 纠偏):常驻 DOM,显隐在 layout.css 媒询。 */}
        <RotateHintOverlay />
      </div>
    </AudioProvider>
  );
}
