// Game 屏(#253 三区骨架):棋盘全幅垫底 + 顶部对局条 + 席位竖卡列 + 底部仪表条。
// 右侧栏(aside)已退役并核销(#253 迁移、#255 删件):StatusBar→顶部条、
// HandPanel→仪表条+手牌架、TreasuryPanel→仪表条计数徽章(expandPile 点开明细)、
// OthersPanel→席位卡、CollapsedRail/侧栏折叠态随 aside 一并退役;WaitingBar 保留为
// 全局兜底,席位卡倒计时条承担「谁在行动」指名。
// 军师窗态(#256):军师幕弹窗退役(DecisionScrollLayer 不再路由该相位),出牌面
// 上架手牌架——本件从快照派生窗态载荷(turnPhase=AwaitingJinnang + interactive
// 门控,与退役前弹窗同门)接线三方:HandRack(窗态牌面/手势)、ActionBar(两段
// 动作条)、SeatRail+TokenLayer(目标段候选呼吸)。引擎相位/choices/命令语义
// 零改动,只换呈现层;零可用自动过口径不变(引擎侧已自动)。
// #255 收口:战报抽屉(右缘把手,WarReportDrawer)+ expandPile(珍宝/名将徽章
// 点开明细落手牌架行)在本件持有两份 UI 态并接线。
// usePanZoom/TokenLayer 其余/FxLayer 不动。
// 数据流:gameStore.snapshot → 声明式渲染;交互统一经 registry 取 controller 下发。
// 选都/详情流程状态机仍收口 useCapitalPick;本屏只做接线与布局。
import { useEffect, useRef, useState } from "react";
import { BoardView, type BoardViewHandle } from "@app/components/board/BoardView";
import { useGameStore, useLocalPlayer, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore, useAutopilotOn } from "@app/store/netStore";
import { getController, getControllerMap } from "@app/controllers/registry";
import type { GameCommand, MapData } from "@core/types";
import { getAudio } from "@app/fx/audio";
import { AudioProvider } from "@app/fx/AudioProvider";
import { DiceOverlay } from "@app/fx/DiceOverlay";
import { FxLayer } from "@app/fx/FxLayer";
import { useFxStore } from "@app/fx/fxStore";
import { HandRack, type RackPile } from "./HandRack";
import { GameTopBar } from "./GameTopBar";
import { SeatRail } from "./SeatRail";
import { DashboardBar } from "./DashboardBar";
import { ActionBar } from "./ActionBar";
import { WaitingBar } from "./WaitingBar";
import { WarReportDrawer } from "./WarReportDrawer";
import { DecisionScrollLayer } from "./scroll/DecisionScrollLayer";
import { useCapitalPick } from "./useCapitalPick";
import { HintBar } from "@app/screens/shared/HintBar";
import { ConnectionBanner } from "@app/screens/shared/ConnectionBanner";
import { TESTIDS } from "./testids";
import { VERSION } from "../../../version";

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
          <div className="font-brush text-3xl text-ink tracking-widest">尚未开局</div>
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

/** 已开局主体:棋盘全幅 + 三区(顶部条/席位卡列/仪表条);hooks 全在此,
 *  snapshot/map 由 GameScreen 门卫。 */
function GameScreenLive({ snapshot, map }: { snapshot: GameSnapshot; map: MapData }) {
  // 模块级取控制器(不在 React 状态里:实例含方法/WS,非渲染数据,见 registry.ts 注释)
  const controller = getController();
  // 棋盘 pan/zoom 复位句柄(BoardView forwardRef 暴露 reset;顶部条复位钮用)
  const boardRef = useRef<BoardViewHandle>(null);
  const interactive = useGameStore((s) => s.interactive);
  const viewSeat = useGameStore((s) => s.viewSeat);
  const hint = useGameStore((s) => s.hint);
  const hintLevel = useGameStore((s) => s.hintLevel);
  const localPlayer = useLocalPlayer();
  const net = useNetStore();
  // 自局座位(稳定身份,勿用 viewSeat):单机热座下 viewSeat 跟随决策方轮转(bot 回合
  // 时指到 bot 席),席位卡「自身不出卡」/仪表条身份/手牌架都需要的是固定的「人」。
  // 单机起手坐姿恒为座位 0(SoloSetup 座位表构造:首座 isBot:false);联机=本座
  // (viewSeat,观战=-1 → players[-1]=undefined,按观战口径走)。
  const selfSeat = net.roomId !== "" ? viewSeat : 0;
  const selfPlayer = snapshot.players[selfSeat] ?? null;
  // 托管态单源取值收口 useAutopilotOn(netStore):联机已入座=座位广播,单机=控制器本地
  // 标记,观战(mySeat=-1)恒 false——观战无托管。
  const autopilotOn = useAutopilotOn(controller);
  // 行军接管的棋子(阶段 6):fxStore.marching → BoardView.skipTokenIds,
  // 行军期间 React 声明式定位让位给 useMarch 的逐段命令式动画。
  const marching = useFxStore((s) => s.marching);
  // expandPile(#255):仪表条珍宝/名将徽章展开的摞(明细落 HandRack 手牌行左旁;
  // 一次一摞,点另一摞切换,再点收起)。空摞拦截在 DashboardBar 侧。
  const [pileOpen, setPileOpen] = useState<RackPile | null>(null);
  const togglePile = (pile: RackPile) => setPileOpen((cur) => (cur === pile ? null : pile));
  // 选都/详情流程状态机(useCapitalPick 单文件持有):选都候选派生 +
  // onTileClick 相位路由 + 详情/定都确认时序。
  const { offeredCapitals, selectableTiles, onTileClick, tileDetail } = useCapitalPick({
    snapshot,
  });

  // 快照玩家是 BoardPlayer 的结构超集(heroes/treasures 等展示字段棋盘不消费):
  // BoardView 的 props 已按真实消费面声明为最小接口,直接透传即可,无需断言。
  const players = snapshot.players;

  // ── 军师窗态(#256):AwaitingJinnang 的呈现层状态机(选牌在本件,命令直发引擎)──
  // 门与退役前的军师幕卷轴完全同款:interactive 门控=本地决策(controller 单源),
  // choices 含 pass/cancel = 注册表确已产出军师窗选项(相位/选项集不符时不进窗态)。
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
  useEffect(() => setJunshiSelectedId(null), [junshiTargeting, junshiUp]);
  const junshiOptions =
    junshiUp && !junshiTargeting
      ? snapshot.choices.filter((o) => o.id !== "pass" && o.id !== "cancel")
      : [];
  const junshiSelected =
    junshiSelectedId != null
      ? junshiOptions.find((o) => o.id === junshiSelectedId && o.available)
      : undefined;
  // 目标段候选(available 过滤后供席位呼吸/棋盘呼吸与数字键同序)。
  const junshiSeatOptions =
    junshiTargeting
      ? (snapshot.choices.filter((o) => o.targetSeat != null) as Array<
          (typeof snapshot.choices)[number] & { targetSeat: number }
        >)
      : [];

  // 与 DecisionScrollLayer.dispatch 同款可选拍点(registry 未就绪时不发;GameScreenLive
  // 只在 controller/map 就位后挂载,正常流到不了 null)。
  const dispatchCommand = (cmd: GameCommand) => controller?.dispatchCommand(cmd);

  // 卡牌段确认(动作钮「出牌」与 Enter 共用):选中项发命令;落印音效随一期迁移。
  const junshiConfirm = () => {
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
  // 目标段:点席位即出(免二次确认;席位点击层与数字键共用)。
  const junshiSeatCmd = (targetSeat: number): GameCommand =>
    junshiPendingSkill != null
      ? { type: "useHeroSkill", skillId: junshiPendingSkill.skillId, targets: [targetSeat] }
      : { type: "useJinnang", cardId: junshiPendingCard!.cardId, targets: [targetSeat] };

  // 目标段数字键 1..n 直发可用席位命令(一期 G-19 旧口径;卡牌段数字键在 HandRack)。
  const seatKb = useRef({ up: false, seats: [] as number[], junshiSeatCmd, dispatchCommand });
  seatKb.current = {
    up: junshiTargeting,
    seats: junshiSeatOptions.filter((o) => o.available).map((o) => o.targetSeat),
    junshiSeatCmd,
    dispatchCommand,
  };
  useEffect(() => {
    if (!junshiTargeting) return;
    const onKey = (e: KeyboardEvent) => {
      const k = seatKb.current;
      if (!k.up) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1) {
        const hit = k.seats[n - 1];
        if (hit != null) k.dispatchCommand(k.junshiSeatCmd(hit));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [junshiTargeting]);

  // 选都阶段的引导文案(三选一:引擎按价格分层+地理分散滚出 3 候选)
  const setupHint =
    snapshot.phase === "Setup" && snapshot.setupPhase === "PickCapital"
      ? `「${snapshot.players[snapshot.currentSetupPlayerIndex].guohao}」三选一:于候选城中择一定都`
      : null;

  return (
    <AudioProvider>
      {/* 3D 骰子(自建全屏 overlay,不渲染内容)——与 AudioProvider 同挂在 Game 屏,
          生命周期=一局;#188 第 1 步:掷骰由控制器定时自动发起(起签后起摇),演出期间
          控制器 busy 锁 interactive,决策卷轴在演出结束后才呈现。 */}
      <DiceOverlay />
      <div className="game-layout relative h-full w-full overflow-hidden bg-bg text-ink">
      {/* 棋盘区全幅垫底(id="board-wrap":FxLayer 的逻辑坐标→容器像素换算锚点)。
          棋盘初始取景 = FIT_VIEW 固定 viewBox + preserveAspectRatio meet——容器变矮
          整盘等比缩小,无需 pan/zoom 补偿。 */}
      <div id="board-wrap" className="board-area">
        {/* F2 断线横幅:z-20 压过 hint,断线是对局中优先级最高的状态反馈 */}
        <ConnectionBanner />
        <BoardView
          ref={boardRef}
          map={map}
          players={players}
          /* L47:视角玩家 id 透传——自己棋子加玩家色微光圈(棋盘侧「我是谁」锚点) */
          viewSeat={localPlayer?.id}
          /* 点格相位路由(Playing 详情 / Setup 选都 / 灰城 hint)在 useCapitalPick */
          onTileClick={onTileClick}
          selectableTiles={selectableTiles}
          /* X4(#23):候选集全座位透传——旁观席位也见静态金圈与壹贰叁序号印 */
          candidateTiles={offeredCapitals ?? undefined}
          /* #256 目标段:可用候选席位的棋子金虚线环呼吸(与席位卡金圈同步) */
          targetedPlayerIds={
            junshiTargeting
              ? new Set(
                  junshiSeatOptions
                    .filter((o) => o.available)
                    .map((o) => players[o.targetSeat].id),
                )
              : undefined
          }
          activeTileIndex={snapshot.phase === "Playing" ? players[snapshot.activeIndex].position : null}
          isSetupPhase={snapshot.phase === "Setup"}
          skipTokenIds={marching}
        />
        {/* 阶段 6:浮字/铜钱雨/回合横幅/印章(store 驱动的瞬时表现) */}
        <FxLayer />
        {setupHint && (
          // S8(#41):WaitingBar 槽复用——选都期 WaitingBar 恒空(phase≠Playing 直接
          // null),同槽上下错开不再叠字。
          <div
            data-testid={TESTIDS.hint}
            className="pointer-events-none absolute top-[calc(var(--safe-top)+48px)] left-1/2 -translate-x-1/2 rounded-[3px] border border-[rgba(43,35,23,0.25)] bg-panel/95 px-4 py-1 font-brush text-lg shadow-sm"
          >
            {setupHint}
          </div>
        )}
        {/* F4:统一 hint 组件(样式与过期口径与 lobby/App 一致) */}
        <HintBar hint={hint} level={hintLevel} />
        {/* G-3/16/21 统一等待状态条:bot 运筹 / 远端人类落子 / 对方抉择 / 变卖抵债。
            #253:席位卡倒计时条承担「谁在行动」指名,本条保留为全局兜底。 */}
        <WaitingBar
          snapshot={snapshot}
          interactive={interactive}
          viewSeat={viewSeat}
          online={net.roomId !== ""}
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
        </div>
        {/* 版本角标(构建排查用;右下角,席位卡列与仪表条之间的空档) */}
        <span className="pointer-events-none absolute right-1 bottom-0.5 font-wenkai text-[10px] text-ink-dim/70">
          {VERSION}
        </span>
      </div>
      {/* 顶部对局条:回合 chip(第 N 轮 + 目标身价)+ 活跃方名 | 牌库/弃牌 + 复位/缩放/静音 */}
      <GameTopBar
        snapshot={snapshot}
        /* chip 印章=自局视角;观战未入座跟随房主座(快照按座直取,取不到即接线 bug) */
        self={selfPlayer ?? players[net.host]}
        onResetView={() => boardRef.current?.reset()}
        onZoomIn={() => boardRef.current?.zoomBy(1.25)}
        onZoomOut={() => boardRef.current?.zoomBy(0.8)}
      />
      {/* 席位竖卡列:对手一人一张(观战与自身不出卡),活跃方金圈光效+「运筹中」微标。
          排除的是稳定自局座位(selfSeat),非热座 viewSeat——后者随决策方轮转。
          #256 目标段:候选席位卡金圈呼吸+点席位即出(targets 由快照 choices 派生)。 */}
      <SeatRail
        snapshot={snapshot}
        viewSeat={selfSeat}
        targets={
          junshiTargeting
            ? {
                bySeat: new Map(
                  junshiSeatOptions.map((o) => [
                    o.targetSeat,
                    { available: o.available, reason: o.reason },
                  ]),
                ),
                onPick: (seat: number) => dispatchCommand(junshiSeatCmd(seat)),
              }
            : undefined
        }
      />
      {/* 底部仪表条:身份头 + 现金大数(全屏唯一)+ 属性徽章 + 体力血条 + 签 + 托管;
          珍宝/名将徽章即 expandPile 开关(#255,空摞拦在 DashboardBar);
          右段手牌架槽给 HandRack 让位(弹性宽) */}
      <DashboardBar
        snapshot={snapshot}
        player={selfPlayer}
        controller={controller}
        autopilotOn={autopilotOn}
        pileOpen={pileOpen}
        onTogglePile={togglePile}
      >
        {/* #238/T3 底部常驻手牌架(观战自返回 null)。player 用稳定自局玩家——
            热座 viewSeat 轮到 bot 时架不该换出 bot 的牌。#256:军师窗态载荷随快照
            派生(窗态下架即出牌面,常态点牌仍开详情)。 */}
        <HandRack
          player={selfPlayer}
          pile={pileOpen}
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
        />
      </DashboardBar>
      {/* 动作条(#256):锚仪表条上缘不锚牌;卡牌段=出牌/不出,目标段=选择目标/作罢;
          选中放大牌占中时右让不遮牌面(原型 margin-left:240px 口径)。 */}
      {junshiUp && (
        <ActionBar
          segment={junshiTargeting ? "target" : "card"}
          playEnabled={junshiSelected != null}
          onPlay={junshiConfirm}
          onPass={junshiPass}
          rightShift={!junshiTargeting && junshiSelected != null}
        />
      )}
      {/* 战报抽屉(#255):右缘竖把手 + 抽屉渲染对局日志;常收零占位(收起时只有把手)。 */}
      <WarReportDrawer snapshot={snapshot} />
      </div>
    </AudioProvider>
  );
}
