// 决策卷轴路由层(阶段 6 接线):按 snapshot 相位决定弹哪个卷轴。
// 数据全部来自 gameStore 快照 + registry 的静态上下文(board/catalog 只读查询),
// 命令统一经 controller.dispatchCommand 下发——组件不直接改引擎,与旧 openScroll 体系同构。
// Wave3(候选5):不再 import getEngine 摸活引擎,城名/地产定义经 getControllerContext。
// 挂载于 GameScreen #scroll-layer(absolute 覆盖,pointer-events 由各弹层自身开启)。
import type { GameCommand } from "@core/types";
import { formatMoney } from "@core/money";
import type { GameSnapshot } from "@app/store/gameStore";
import { getController, getControllerContext, getControllerMap } from "@app/controllers/registry";
import {
  BankruptcyScroll,
  BranchDecisionScroll,
  BuyDecisionScroll,
  HaltDecisionScroll,
  HeroPickScroll,
  TileDetailScroll,
  TreasureVisitorScroll,
  UpgradeDecisionScroll,
  VictoryScreen,
} from "./index";

export interface DecisionScrollLayerProps {
  snapshot: GameSnapshot;
  viewSeat: number;
  interactive: boolean;
  /** 城池详情(Playing 相位点城查看,GameScreen 本地态)。null = 不弹。 */
  detailTileIndex: number | null;
  onDetailClose: () => void;
  /** #35 选都模式:详情卷轴内嵌「定都于此/再想想」(Setup PickCapital 期点可选城)。 */
  detailPickCapital: boolean;
  onConfirmCapital: (tileIndex: number) => void;
}

export function DecisionScrollLayer({
  snapshot,
  viewSeat,
  interactive,
  detailTileIndex,
  onDetailClose,
  detailPickCapital,
  onConfirmCapital,
}: DecisionScrollLayerProps) {
  const controller = getController();
  const map = getControllerMap();
  const ctx = getControllerContext();
  if (!map || !ctx) return null;

  const dispatch = (cmd: GameCommand) => controller?.dispatchCommand(cmd);
  const players = snapshot.players;
  const board = ctx.board;
  const catalog = ctx.catalog;

  // ── 终局:胜利屏(全屏覆盖,优先级最高)──
  if (snapshot.phase === "GameOver" && snapshot.winner !== null) {
    const winner = players.find((p) => p.id === snapshot.winner);
    if (winner) {
      return (
        <VictoryScreen
          guohao={winner.guohao}
          colorIndex={winner.colorIndex}
          finalNetWorthLabel={formatMoney(winner.netWorth)}
          turnNumber={snapshot.round}
          winReason="NetWorth"
          // 重开:最朴素可靠的方式是整页重载回设置屏(旧版亦无局内重开)
          onRestart={() => location.reload()}
        />
      );
    }
  }

  // ── 城池详情(只读,任何时候可弹;#33 特殊地点同样展示类型说明)──
  if (detailTileIndex !== null) {
    const tile = board.at(detailTileIndex);
    const def = tile.propertyId ? catalog.get(tile.propertyId) : null;
    const ownerEntry = def
      ? players.find((p) => p.properties.some((h) => h.propertyId === tile.propertyId))
      : undefined;
    const owned = ownerEntry?.properties.find((h) => h.propertyId === tile.propertyId);
    return (
      <TileDetailScroll
        tileIndex={detailTileIndex}
        tileName={tile.name}
        tileType={tile.type}
        region={tile.region ?? ""}
        property={
          def
            ? {
                id: def.id,
                purchasePrice: def.purchasePrice,
                maxLevel: def.maxLevel,
                valueByLevel: def.valueByLevel,
              }
            : null
        }
        ownerGuohao={ownerEntry?.guohao ?? null}
        ownerLevel={owned?.level ?? 0}
        isCapital={ownerEntry?.capitalIndex === detailTileIndex}
        onClose={onDetailClose}
        pickCapital={
          detailPickCapital
            ? { onConfirm: () => onConfirmCapital(detailTileIndex) }
            : undefined
        }
      />
    );
  }

  // ── 破产清算:债务人在凑钱(热座=本地视角玩家)──
  if (snapshot.pendingDebt && interactive && players[viewSeat] && !players[viewSeat].isBankrupt) {
    const me = players[viewSeat];
    // 都城不可变卖(旧版同样跳过 capitalIndex)
    const capitalPropId =
      me.capitalIndex !== null && me.capitalIndex !== undefined
        ? board.at(me.capitalIndex).propertyId
        : null;
    return (
      <BankruptcyScroll
        guohao={me.guohao}
        cash={me.cash}
        debtAmount={snapshot.pendingDebt.amount}
        // 快照珍宝即展示子集({id,name,level,desc}),组件 props 按该形状声明,价格由 level 推导
        treasures={me.treasures}
        sellableProperties={me.properties
          .filter((h) => h.propertyId !== capitalPropId)
          .map((h) => {
            // 城名:按 board.at 的 propertyId 反查格索引(MapTile.id 与 propertyId 非同源,勿混用)
            const tileIndex = board.tiles.findIndex((t) => t.propertyId === h.propertyId);
            return {
              propId: h.propertyId,
              name: tileIndex >= 0 ? board.at(tileIndex).name : h.propertyId,
              purchasePrice: catalog.get(h.propertyId)?.purchasePrice ?? 0,
            };
          })}
        heroes={me.heroes.map((h) => ({ id: h.id, name: h.name }))}
        onCommand={dispatch}
      />
    );
  }

  // ── 珍宝使交涉:城主决策视角;本地是访客时给只读等待视角 ──
  if (snapshot.treasureVisitor && snapshot.turnPhase === "AwaitingTreasureOwner") {
    const tv = snapshot.treasureVisitor;
    const owner = players[tv.ownerIdx];
    const visitor = players[snapshot.activeIndex];
    if (owner && visitor) {
      const isOwnerView = viewSeat === tv.ownerIdx;
      const isVisitorView = viewSeat === snapshot.activeIndex;
      if (isOwnerView || isVisitorView) {
        const propDef = catalog.get(tv.propertyId);
        const ownerLevel =
          owner.properties.find((h) => h.propertyId === tv.propertyId)?.level ?? 0;
        if (propDef) {
          return (
            <TreasureVisitorScroll
              role={isOwnerView ? "owner" : "visitor"}
              ownerGuohao={owner.guohao}
              visitorGuohao={visitor.guohao}
              tileName={board.at(visitor.position)?.name ?? ""}
              treasures={owner.treasures}
              property={{ id: propDef.id, tradeAdd: propDef.tradeAdd, tradeMult: propDef.tradeMult }}
              cityLevel={ownerLevel}
              onCommand={dispatch}
            />
          );
        }
      }
    }
  }

  // ── 常规决策卷轴(交互重构:从侧栏 ActionInline 迁入,轮到即自动弹出)──
  // 判定逻辑原样迁自 HandPanel.ActionInline;数据走 snapshot + registry 静态上下文。
  // 联机 pending 期间 interactive=false,卷轴暂不弹——命令回包后相位离开,无需「…中」占位。
  if (interactive && snapshot.phase === "Playing") {
    const tp = snapshot.turnPhase;
    if (tp === "AwaitingCapitalHalt" && snapshot.lastMove) {
      // 目的地城名经 registry 静态上下文查(board 不可变,联机同路)
      return (
        <HaltDecisionScroll
          capitalName={board.at(snapshot.lastMove.capitalIndex)?.name ?? "都城"}
          nextName={board.at(snapshot.lastMove.landIndex)?.name ?? "下一城"}
          onCommand={dispatch}
        />
      );
    }
    if (tp === "AwaitingBranch") {
      return <BranchDecisionScroll onCommand={dispatch} />;
    }
    if (tp === "AwaitingDecision") {
      const p = players[snapshot.activeIndex];
      const def = snapshot.lastLandOutcomeProperty
        ? catalog.get(snapshot.lastLandOutcomeProperty)
        : null;
      if (def) {
        // 城名/地域:按 propertyId 反查格索引(MapTile.id 与 propertyId 非同源,勿混用)
        const tileIndex = board.tiles.findIndex((t) => t.propertyId === def.id);
        const tile = tileIndex >= 0 ? board.at(tileIndex) : null;
        if (snapshot.lastLandOutcomeKind === "PropertyAvailable") {
          return (
            <BuyDecisionScroll
              tileName={tile?.name ?? def.id}
              region={tile?.region ?? ""}
              property={{
                purchasePrice: def.purchasePrice,
                maxLevel: def.maxLevel,
                valueByLevel: def.valueByLevel,
              }}
              cash={p.cash}
              warrants={p.warrants}
              onCommand={dispatch}
            />
          );
        }
        if (snapshot.lastLandOutcomeKind === "OwnProperty") {
          return (
            <UpgradeDecisionScroll
              tileName={tile?.name ?? def.id}
              level={p.properties.find((x) => x.propertyId === def.id)?.level ?? 1}
              property={{
                maxLevel: def.maxLevel,
                valueByLevel: def.valueByLevel,
              }}
              onCommand={dispatch}
            />
          );
        }
      }
    }
  }

  // ── 招贤纳士:三选一(无"不取",引擎相位守卫如此)──
  if (snapshot.turnPhase === "AwaitingHeroPick" && snapshot.offeredHeroes.length > 0 && interactive) {
    return <HeroPickScroll offered={snapshot.offeredHeroes} onCommand={dispatch} />;
  }

  return null;
}
