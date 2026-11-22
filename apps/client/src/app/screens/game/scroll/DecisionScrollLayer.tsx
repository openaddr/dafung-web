// 决策卷轴路由层(阶段 6 接线):按 snapshot 相位决定弹哪个卷轴。
// 数据全部来自 gameStore 快照 + registry 的静态上下文(board/catalog 只读查询),
// 命令统一经 controller.dispatchCommand 下发——组件不直接改引擎,与旧 openScroll 体系同构。
// Wave3(候选5):不再 import getEngine 摸活引擎,城名/地产定义经 getControllerContext。
// 挂载于 GameScreen #scroll-layer(absolute 覆盖,pointer-events 由各弹层自身开启)。
import { useCallback, useRef, useState } from "react";
import type { GameCommand } from "@dafung/core/engine/authority";
import { sellValueOf, type CityTier } from "@dafung/core/engine/economy";
import { tileIndexOfProperty } from "@dafung/core/engine/board";
import { Theme } from "@dafung/core/engine/theme";
import { useStablePlayers, type GameSnapshot } from "@app/store/gameStore";
import { getController, getControllerContext, getControllerMap } from "@app/controllers/registry";
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
  if (snapshot.phase === "Setup" && snapshot.setupPhase === "PickCapital") {
    return JSON.stringify([
      snapshot.gameId,
      snapshot.phase,
      snapshot.currentSetupPlayerIndex,
      snapshot.offeredCapitals,
    ]);
  }
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
}: DecisionScrollLayerProps) {
  const controller = getController();
  const showDecision = interactive || parked;
  const map = getControllerMap();
  const ctx = getControllerContext();
  // 玩家行值等复用(#1140 渲染税):详情卷轴(players 直传 TileThumb/归属推导)与
  // 胜利屏(终榜)的 memo 前提;players 稳定后,弹层各自的值等比较才有着落。
  const players = useStablePlayers(snapshot.players);
  const restarting = useRef(false);
  const victoryDuelPending = useFxStore((state) => state.victoryDuelGameId === snapshot.gameId);
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
    const dispatch = (cmd: GameCommand) => {
      if (interactive && !parked) controller?.dispatchCommand(cmd);
    };
    const board = ctx.board;
    const catalog = ctx.catalog;

    if (snapshot.phase === "GameOver") {
      if (snapshot.winReason === "aborted") {
        return <VictoryScreen key={snapshot.gameId} winReason="aborted" onRestart={restartGame} />;
      }
      if (victoryDuelPending) return null;
      const winner = players.find((p) => p.id === snapshot.winner);
      if (winner === undefined || snapshot.winReason === "None") {
        throw new Error("终局快照缺胜者或胜因");
      }
      return (
        <VictoryScreen
          key={snapshot.gameId}
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

    // ── 破产清算:债务人在凑钱(热座=本地视角玩家)──
    if (
      snapshot.pendingDebt &&
      showDecision &&
      players[viewSeat] &&
      !players[viewSeat].isBankrupt
    ) {
      const me = players[viewSeat];
      // 都城不可变卖(旧版同样跳过 capitalIndex)
      const capitalPropId =
        me.capitalIndex !== null && me.capitalIndex !== undefined
          ? board.at(me.capitalIndex).propertyId
          : null;
      return (
        <BankruptcyScroll
          key={`${viewSeat}:${snapshot.turnNumber}`}
          guohao={me.guohao}
          cash={me.cash}
          debtAmount={snapshot.pendingDebt.amount}
          // 快照珍宝即展示子集({id,name,level,desc}),组件 props 按该形状声明,价格由 level 推导
          treasures={me.treasures}
          sellableProperties={me.properties
            .filter((h) => h.propertyId !== capitalPropId)
            .map((h) => {
              // 城名:反查单源 core/board tileIndexOfProperty(MapTile.id 与 propertyId 非同源,
              // 勿混用;缺城=数据 bug 炸出,不回退 id 冒充城名——零兜底)
              const tileIndex = tileIndexOfProperty(board, h.propertyId);
              // #60:展示价与引擎入账同一口径——economy.sellValueOf(def, level),即引擎
              // 批量清偿的逐城入账函数。
              // 零兜底:catalog 缺该城 = 数据 bug,非空断言让其抛。
              const def = catalog.get(h.propertyId)!;
              return {
                propId: h.propertyId,
                name: board.at(tileIndex).name,
                sellPrice: sellValueOf(def, h.level),
                level: h.level,
              };
            })}
          onCommand={dispatch}
        />
      );
    }

    // ── 珍宝使交涉:城主决策视角;本地是访客时给只读等待视角 ──
    // L42:城主卷轴是决策卷轴,补 interactive 门控(本座位演出落定前不弹,#611:
    // canAct 改绑 fxStore 行军会话,他座棋子照飞、队列积压不进门);访客只读等待
    // 面板视同 WaitingBar 的过程反馈,保持即时。
    if (snapshot.treasureVisitor && snapshot.turnPhase === "AwaitingTreasureOwner") {
      const tv = snapshot.treasureVisitor;
      const owner = players[tv.ownerIdx];
      const visitor = players[snapshot.activeIndex];
      if (owner && visitor) {
        const showOwner = viewSeat === tv.ownerIdx && showDecision;
        const isVisitorView = viewSeat === snapshot.activeIndex;
        if (showOwner || isVisitorView) {
          const propDef = catalog.get(tv.propertyId);
          const holding = owner.properties.find((h) => h.propertyId === tv.propertyId);
          if (holding === undefined)
            throw new Error(`珍宝交涉:城 ${tv.propertyId} 不在 ${owner.guohao} 名下`);
          if (propDef) {
            return (
              <TreasureVisitorScroll
                role={showOwner ? "owner" : "visitor"}
                ownerGuohao={owner.guohao}
                visitorGuohao={visitor.guohao}
                tileName={board.at(visitor.position)?.name ?? ""}
                treasures={owner.treasures}
                property={propDef}
                cityLevel={holding.level}
                onCommand={dispatch}
              />
            );
          }
        }
      }
    }

    // ── 常规决策卷轴(交互重构:从侧栏 ActionInline 迁入,轮到即自动弹出)──
    // 判定逻辑原样迁自 HandPanel.ActionInline;数据走 snapshot + registry 静态上下文。
    // spec #107 C1(选项集消费缝):卷轴的可用性/原因经 snapshot.choices 消费引擎
    // 注册表口径(ADR-0013),本层只透传,不自行判定。
    // 联机 pending 期间 interactive=false,卷轴暂不弹——命令回包后相位离开,无需「…中」占位。
    if (showDecision && snapshot.phase === "Playing") {
      const tp = snapshot.turnPhase;
      if (tp === "AwaitingDecision") {
        const p = players[snapshot.activeIndex];
        const pending = snapshot.pendingLand;
        if (pending == null) throw new Error("购地/扩军卷轴:AwaitingDecision 缺 pendingLand");
        const def = catalog.get(pending.propertyId);
        if (def == null) throw new Error(`购地/扩军卷轴:目录无城池 ${pending.propertyId}`);
        // 决策入口只读 pendingLand;落格金额等表现信息不参与路由。
        const tile = board.at(tileIndexOfProperty(board, def.id));
        if (pending.kind === "PropertyAvailable") {
          return (
            <BuyDecisionScroll
              tileName={tile.name}
              groupLabel={groupLineLabel(def.group)}
              tierLabel={tierLineLabel(def.tier)}
              property={def}
              cash={p.cash}
              choices={snapshot.choices}
              onCommand={dispatch}
            />
          );
        }
        const holding = p.properties.find((x) => x.propertyId === def.id);
        if (holding == null) throw new Error(`扩军卷轴:决策方未持有城池 ${def.id}`);
        return (
          <UpgradeDecisionScroll
            tileName={tile.name}
            tierLabel={tierLineLabel(def.tier)}
            level={holding.level}
            defense={holding.defense}
            property={def}
            isCapital={p.capitalIndex >= 0 && board.at(p.capitalIndex).propertyId === def.id}
            choices={snapshot.choices}
            onCommand={dispatch}
          />
        );
      }
    }

    // ── 出牌阶段路由已退役(#256):AwaitingJinnang 不再弹卷轴,出牌面上架手牌架
    // (出牌阶段态/动作条/目标段接线归 GameScreen;引擎相位与 choices 零改动)。
    // JinnangScroll 组件体已随 #255 收口删除;令笺亦于 #360 退役(主动技牌归
    // HandRack 窗态消费,#818 起为 SkillCardFace 技能卡)──

    // 招贤无候选时仍可求书或跳过。
    if (snapshot.turnPhase === "AwaitingHeroPick" && showDecision) {
      return (
        <HeroPickScroll
          offered={snapshot.offeredHeroes}
          choices={snapshot.choices}
          onCommand={dispatch}
        />
      );
    }

    return null;
  })();

  const scope = tileDetail !== null && !tileDetail.pickCapital ? null : decisionKey;

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
