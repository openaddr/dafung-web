// 决策卷轴使用座位视图和地图目录，玩家选择交给控制器。
// Wave3(候选5):不再 import getEngine 摸活引擎,城名/地产定义经 getControllerContext。
// 挂载于 GameScreen #scroll-layer(absolute 覆盖,pointer-events 由各弹层自身开启)。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CityTier } from "@dafung/core/engine/economy";
import { tileIndexOfProperty } from "@dafung/core/engine/board";
import { Theme } from "@dafung/core/engine/theme";
import type { LandDecisionCommand } from "@dafung/core/protocol/wire";
import { useGameStore, useStablePlayers, type GameSnapshot } from "@app/store/gameStore";
import { getController, getControllerContext, getControllerMap } from "@app/controllers/registry";
import { getAudio } from "@app/fx/audio";
import { playRecruitmentAfterSupply } from "@app/fx/capital-supply-audio";
import { useFxStore } from "@app/fx/fxStore";
import { checkpointGameDiagnostics } from "@app/game-diagnostics";
import { gameArchiveFailureText } from "@app/game-diagnostic-record";
import { DialogPeekDecision } from "@app/hooks/dialog-stack";
import { waitForGameArchive } from "@app/gameLogArchive";
import { BankruptcyScroll } from "./BankruptcyScroll";
import { ConfirmDialog } from "./ConfirmDialog";
import { HeroPickScroll } from "./HeroPickScroll";
import { TileDetailScroll } from "./TileDetailScroll";
import { TreasureVisitorScroll } from "./TreasureVisitorScroll";
import { VictoryScreen } from "./VictoryScreen";
import { BuyDecisionScroll, UpgradeDecisionScroll } from "./DecisionScrolls";
import type { TileDetailRequest } from "../useCapitalPick";

interface DecisionScrollLayerProps {
  snapshot: GameSnapshot;
  viewSeat: number;
  interactive: boolean;
  decisionKey: string | null;
  parked: boolean;
  /** 城池详情/选都确认流程(spec #107 C5 下沉:状态机在 useCapitalPick,本层只按
   *  请求渲染,不再收 4 个流程 props)。null = 不弹。 */
  tileDetail: TileDetailRequest | null;
  onDecisionVisibilityChange?: (visible: boolean) => void;
}

// 地域行标签单源(#828 区域单源化):区名=分组名,唯一源 Theme.groupNames——
// 自由文本 region 字段已随 schema 退役(#823),详情/购地卷轴的地域行都经此一行。
// 未知分组字母(自定义图)无分组名,落空串(纯 UI 空态,调用方按空省略该段)。
function groupLineLabel(group: string | undefined): string {
  return group != null ? (Theme.groupNames[group] ?? "") : "";
}

// 城池档位行名(ADR-0042 决策 6 + DESIGN §4.8 名词纪律):详情/购地/扩军三卷轴
// 城名旁缀两字档位名(「名城」式,不加前缀/定位语/解释),唯一源 Theme.cityTierNames
// (#828 同款单源化:显示名在本层算成成品,卷轴只收字符串);tier 逐城必配且
// loadMap 白名单校验,查表必中,无未知值分支。板上不立文字牌(棋盘呈现归 T2 票)。
function tierLineLabel(tier: CityTier): string {
  return Theme.cityTierNames[tier];
}

export function decisionScrollIdentity(snapshot: GameSnapshot, viewSeat: number): string | null {
  if (snapshot.phase !== "Playing") return null;
  const identity = [
    snapshot.gameId,
    snapshot.turnNumber,
    snapshot.activeIndex,
    snapshot.decisionOwner,
    viewSeat,
    snapshot.turnPhase,
  ];
  switch (snapshot.turnPhase) {
    case "AwaitingBankruptcySettle":
      return JSON.stringify([...identity, snapshot.pendingDebt]);
    case "AwaitingTreasureOwner":
      return JSON.stringify([...identity, snapshot.treasureVisitor]);
    case "AwaitingDecision":
      return JSON.stringify([...identity, snapshot.pendingLand]);
    case "AwaitingHeroPick":
      return JSON.stringify([...identity, snapshot.offeredHeroes]);
    default:
      return null;
  }
}

export function TileDetail({
  snapshot,
  viewSeat,
  request,
}: {
  snapshot: GameSnapshot;
  viewSeat: number;
  request: TileDetailRequest;
}) {
  const { board, catalog } = getControllerContext()!;
  const players = useStablePlayers(snapshot.players);
  const { tileIndex } = request;
  const tile = board.at(tileIndex);
  const def = catalog.get(tile.propertyId!);
  if (def == null) throw new Error(`详情卷轴:城 ${tile.propertyId} 不在 catalog`);
  const owner = players.find((p) => p.properties.some((h) => h.propertyId === tile.propertyId));
  const holding = owner?.properties.find((h) => h.propertyId === tile.propertyId);
  return (
    <TileDetailScroll
      tileIndex={tileIndex}
      tile={tile}
      tileName={tile.name}
      groupLabel={groupLineLabel(def.group)}
      tierLabel={tierLineLabel(def.tier)}
      property={def}
      players={players}
      context={
        request.pickCapital
          ? {
              kind: "capital",
              cash: players[viewSeat].cash,
              cost: request.option.cost,
              canConfirm: request.canConfirm,
              reason: request.option.available ? null : request.option.reason,
              onConfirm: request.onConfirmCapital,
            }
          : { kind: "view" }
      }
      ownerGuohao={owner?.guohao ?? null}
      ownerLevel={holding != null ? holding.level : null}
      ownerDefense={holding != null ? holding.defense : null}
      burning={holding != null ? holding.burning : null}
      damageRanking={holding != null ? holding.damageRanking : null}
      isCapital={owner?.capitalIndex === tileIndex}
      onClose={request.onClose}
    />
  );
}

export function DecisionScrollLayer({
  snapshot,
  viewSeat,
  interactive,
  decisionKey,
  parked,
  tileDetail,
  onDecisionVisibilityChange,
}: DecisionScrollLayerProps) {
  const controller = getController();
  const seatView = useGameStore((state) => state.seatView);
  const showDecision = interactive || parked;
  const map = getControllerMap();
  const ctx = getControllerContext();
  // 玩家行值等复用(#1140 渲染税):详情卷轴(players 直传 TileThumb/归属推导)与
  // 胜利屏(终榜)的 memo 前提;players 稳定后,弹层各自的值等比较才有着落。
  const players = useStablePlayers(snapshot.players);
  const restarting = useRef(false);
  const victoryPreludePending = useFxStore(
    ({ victoryPresentation }) =>
      victoryPresentation?.phase === "prelude" && victoryPresentation.gameId === snapshot.gameId,
  );
  const [restartError, setRestartError] = useState<string | null>(null);
  const restartGame = useCallback(() => {
    if (restarting.current) return;
    restarting.current = true;
    const { gameId } = snapshot;
    void (async () => {
      const captureFailure = await checkpointGameDiagnostics(gameId).then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      const failures = await waitForGameArchive(gameId);
      if (getController()?.engine.gameId !== gameId) return;
      const messages = failures.map(gameArchiveFailureText);
      if (captureFailure !== null && !failures.some((failure) => failure.kind === "capture")) {
        messages.push(gameArchiveFailureText({ kind: "capture", message: captureFailure }));
      }
      if (messages.length === 0) location.reload();
      else setRestartError(messages.join("；"));
    })();
  }, [snapshot.gameId]);

  // 当前相位的抉择或详情。
  // registry 未就绪时旧版整层直接 return null;现统一表达为 child = null——
  // hook 调用须每渲染都执行(顺序稳定),「什么都不弹」与「弹层清空」是同一份输入。
  const child = (() => {
    if (!map || !ctx) return null;
    const board = ctx.board;
    const catalog = ctx.catalog;

    if (snapshot.phase === "GameOver") {
      if (snapshot.winReason === "aborted") {
        return <VictoryScreen key={snapshot.gameId} winReason="aborted" onRestart={restartGame} />;
      }
      if (victoryPreludePending) return null;
      const winner = players.find((p) => p.id === snapshot.winner);
      if (winner === undefined || snapshot.winReason === "None") {
        throw new Error("终局快照缺胜者或胜因");
      }
      return (
        <VictoryScreen
          key={snapshot.gameId}
          gameId={snapshot.gameId}
          winner={winner}
          players={players}
          round={snapshot.round}
          context={ctx}
          winReason={snapshot.winReason}
          onRestart={restartGame}
        />
      );
    }

    if (tileDetail !== null) {
      return <TileDetail snapshot={snapshot} viewSeat={viewSeat} request={tileDetail} />;
    }

    if (showDecision && seatView?.decisionPoint != null && seatView.bankruptcy !== null) {
      const { bankruptcy, decisionPoint } = seatView;
      return (
        <BankruptcyScroll
          key={decisionPoint}
          guohao={players[viewSeat].guohao}
          view={bankruptcy}
          onIntent={(intent) =>
            interactive && !parked ? controller?.dispatchIntent(intent, decisionPoint) : undefined
          }
        />
      );
    }

    if (showDecision && seatView?.decisionPoint != null && seatView.treasure !== null) {
      const { treasure, decisionPoint } = seatView;
      const { decision, mode, selectedTreasure } = treasure;
      const enabled = interactive && !parked;
      return (
        <TreasureVisitorScroll
          role="owner"
          ownerGuohao={players[viewSeat].guohao}
          visitorGuohao={players[decision.visitorSeat].guohao}
          tileName={board.at(decision.tileIndex).name}
          decision={decision}
          mode={mode}
          selectedTreasure={selectedTreasure}
          interactive={enabled}
          canConfirm={enabled && treasure.canConfirm}
          onIntent={(intent) => {
            if (enabled || intent.type === "cancel")
              controller?.dispatchIntent(intent, decisionPoint);
          }}
        />
      );
    }
    // 访客等待反馈随公开落格事实即时显示。
    if (snapshot.turnPhase === "AwaitingTreasureOwner" && viewSeat === snapshot.activeIndex) {
      const { ownerIdx, propertyId } = snapshot.treasureVisitor!;
      const owner = players[ownerIdx];
      return (
        <TreasureVisitorScroll
          role="visitor"
          ownerGuohao={owner.guohao}
          visitorGuohao={players[viewSeat].guohao}
          tileName={board.at(tileIndexOfProperty(board, propertyId)).name}
          treasureCount={owner.treasures.length}
        />
      );
    }

    if (
      showDecision &&
      seatView?.decisionPoint != null &&
      seatView.decisionOptions?.kind === "landDecision"
    ) {
      const {
        decisionPoint,
        decisionOptions: { landing, options },
      } = seatView;
      const p = players[viewSeat];
      const tile = board.at(landing.tileIndex);
      const def = catalog.get(landing.propertyId);
      if (def == null) throw new Error(`购地/扩军卷轴:目录无城池 ${landing.propertyId}`);
      const choose = (command: LandDecisionCommand["type"]) => {
        if (interactive && !parked)
          controller?.dispatchIntent({ type: "chooseLand", command }, decisionPoint);
      };
      if (landing.kind === "PropertyAvailable") {
        return (
          <BuyDecisionScroll
            tileName={tile.name}
            groupLabel={groupLineLabel(def.group)}
            tierLabel={tierLineLabel(def.tier)}
            property={def}
            cash={p.cash}
            options={options}
            onChoose={choose}
          />
        );
      }
      const holding = p.properties.find((h) => h.propertyId === landing.propertyId);
      if (holding == null) throw new Error(`扩军卷轴:决策方未持有城池 ${landing.propertyId}`);
      return (
        <UpgradeDecisionScroll
          tileName={tile.name}
          tierLabel={tierLineLabel(def.tier)}
          level={holding.level}
          defense={holding.defense}
          property={def}
          isCapital={p.capitalIndex === landing.tileIndex}
          options={options}
          onChoose={choose}
        />
      );
    }

    // ── 出牌阶段路由已退役(#256):AwaitingJinnang 不再弹卷轴,出牌面上架手牌架
    // (出牌阶段态/动作条/目标段接线归 GameScreen;引擎相位与 choices 零改动)。
    // JinnangScroll 组件体已随 #255 收口删除;令笺亦于 #360 退役(主动技牌归
    // HandRack 窗态消费,#818 起为 SkillCardFace 技能卡)──

    // 招贤无候选时仍可求书或跳过。
    if (
      showDecision &&
      seatView?.decisionPoint != null &&
      seatView.decisionOptions?.kind === "recruitment"
    ) {
      const { decisionPoint, decisionOptions } = seatView;
      return (
        <HeroPickScroll
          key={decisionPoint}
          options={decisionOptions.options}
          onChoose={(optionId) => {
            if (interactive && !parked)
              controller?.dispatchIntent({ type: "chooseRecruitment", optionId }, decisionPoint);
          }}
        />
      );
    }

    return null;
  })();

  const scope = tileDetail !== null && !tileDetail.pickCapital ? null : decisionKey;
  const visibleDecision =
    scope !== null &&
    child !== null &&
    !parked &&
    (tileDetail?.pickCapital === true || (interactive && viewSeat === snapshot.decisionOwner));
  useLayoutEffect(() => {
    onDecisionVisibilityChange?.(visibleDecision);
  }, [onDecisionVisibilityChange, visibleDecision]);
  // 同一抉择可短暂收起、失去操作权或被详情盖住，展纸声跟首次呈现走。
  const announcedDecision = useRef<string | null>(null);
  const visibleDecisionKey = visibleDecision ? decisionKey : null;
  const currentDecision = useRef<string | null>(null);
  useLayoutEffect(() => {
    currentDecision.current = visibleDecisionKey;
    return () => {
      currentDecision.current = null;
    };
  }, [visibleDecisionKey]);
  const { gameId, turnNumber, turnPhase } = snapshot;
  const playerId = players[viewSeat]?.id;
  useEffect(() => {
    if (decisionKey === null) announcedDecision.current = null;
    if (visibleDecisionKey === null || announcedDecision.current === visibleDecisionKey) return;
    announcedDecision.current = visibleDecisionKey;
    const audio = getAudio();
    if (turnPhase === "AwaitingHeroPick") {
      if (playerId === undefined) throw new Error("招贤展开时缺少当前座位");
      const play = audio.defer("scrollOpen");
      playRecruitmentAfterSupply({ gameId, turn: turnNumber, playerId }, () => {
        if (currentDecision.current === visibleDecisionKey) play();
      });
    } else {
      audio.play("scrollOpen");
    }
  }, [decisionKey, visibleDecisionKey, gameId, turnNumber, turnPhase, playerId]);

  if (!map || !ctx) return null;

  return (
    <>
      {child?.type === VictoryScreen ? (
        <div className="contents" inert={restartError !== null}>
          {child}
        </div>
      ) : (
        <DialogPeekDecision.Provider key={scope} value={scope}>
          {child}
        </DialogPeekDecision.Provider>
      )}
      {restartError !== null && (
        <ConfirmDialog
          title="对局诊断保存失败"
          confirmLabel="继续再战"
          cancelLabel="返回终局"
          danger
          onConfirm={() => location.reload()}
          onCancel={() => {
            restarting.current = false;
            setRestartError(null);
          }}
        >
          {restartError}
        </ConfirmDialog>
      )}
    </>
  );
}
