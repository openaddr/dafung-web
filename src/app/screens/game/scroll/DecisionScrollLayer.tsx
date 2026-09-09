// 决策卷轴路由层(阶段 6 接线):按 snapshot 相位决定弹哪个卷轴。
// 数据全部来自 gameStore 快照 + registry 的静态上下文(board/catalog 只读查询),
// 命令统一经 controller.dispatchCommand 下发——组件不直接改引擎,与旧 openScroll 体系同构。
// Wave3(候选5):不再 import getEngine 摸活引擎,城名/地产定义经 getControllerContext。
// 挂载于 GameScreen #scroll-layer(absolute 覆盖,pointer-events 由各弹层自身开启)。
// #90(R3-C3):相位切换时保留上一个子节点 210ms 作幽灵退场帧(经 ScrollGhostContext
// 让其 ScrollShell 以 rollback 类收场),决策卷轴「卷起来收走」不再瞬时消失。
// #107 C6:该机制(prev 快照/sig 判定/ghost state/定时/让位)整体下沉 useGhostChild,
// 本层只算 skip(按子节点类型)、就地收场时调 yield(),render 期不再有 state/ref/定时。
import { Fragment } from "react";
import type { GameCommand } from "@core/types";
import { formatMoney } from "@core/money";
import { sellValueOf } from "@core/economy";
import type { GameSnapshot } from "@app/store/gameStore";
import { getController, getControllerContext, getControllerMap } from "@app/controllers/registry";
import {
  BankruptcyScroll,
  BranchDecisionScroll,
  BuyDecisionScroll,
  EncounterChoiceScroll, ExhaustionChoiceScroll, JinnangScroll,
  HeroPickScroll,
  TileDetailScroll,
  TreasureVisitorScroll,
  UpgradeDecisionScroll,
  VictoryScreen,
} from "./index";
import { ScrollGhostContext } from "./ScrollShell";
import { useGhostChild } from "./useGhostChild";
import { exportGameLog } from "../gameLogExport";
import type { TileDetailRequest } from "../useCapitalPick";

export interface DecisionScrollLayerProps {
  snapshot: GameSnapshot;
  viewSeat: number;
  interactive: boolean;
  /** 城池详情/选都确认流程(spec #107 C5 下沉:状态机在 useCapitalPick,本层只按
   *  请求渲染,不再收 4 个流程 props)。null = 不弹。 */
  tileDetail: TileDetailRequest | null;
}

export function DecisionScrollLayer({
  snapshot,
  viewSeat,
  interactive,
  tileDetail,
}: DecisionScrollLayerProps) {
  const controller = getController();
  const map = getControllerMap();
  const ctx = getControllerContext();

  // 本帧应显示的弹层:原路由逻辑原样收进 IIFE,供幽灵帧机制对比子节点身份。
  // registry 未就绪时旧版整层直接 return null;现统一表达为 child = null——
  // hook 调用须每渲染都执行(顺序稳定),「什么都不弹」与「弹层清空」是同一份输入。
  const child = (() => {
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
          // E4(#16):胜因透传快照真值(引擎 VictoryReason),不再写死——群雄尽灭局显示群雄尽灭
          winReason={snapshot.winReason}
          // E4(#16):终榜一行(身价降序 + 破产标注),数据同源快照 players
          standings={[...players]
            .sort((a, b) => b.netWorth - a.netWorth)
            .map((p) => ({
              guohao: p.guohao,
              colorIndex: p.colorIndex,
              netWorthLabel: formatMoney(p.netWorth),
              bankrupt: p.isBankrupt,
            }))}
          // 重开:最朴素可靠的方式是整页重载回设置屏(旧版亦无局内重开)
          onRestart={() => location.reload()}
          // ADR-0014:对局日志导出入口(终局落完整 jsonl 文件,含局头)
          onExportLog={() => void exportGameLog(snapshot)}
        />
      );
    }
  }

  // ── 城池详情(只读,任何时候可弹;#33 特殊地点同样展示类型说明)──
  if (tileDetail !== null) {
    const tileIndex = tileDetail.tileIndex;
    const tile = board.at(tileIndex);
    const def = tile.propertyId ? catalog.get(tile.propertyId) : null;
    const ownerEntry = def
      ? players.find((p) => p.properties.some((h) => h.propertyId === tile.propertyId))
      : undefined;
    const owned = ownerEntry?.properties.find((h) => h.propertyId === tile.propertyId);
    return (
      <TileDetailScroll
        tileIndex={tileIndex}
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
        isCapital={ownerEntry?.capitalIndex === tileIndex}
        onClose={() => {
          // 详情卷轴经 Shell 的 closing 出口就地演收起:让位,不再补幽灵帧(防二连播)。
          // 协议在 useGhostChild——标记于下次身份变化时消费一次并自动复位。
          ghostSlot.yield();
          tileDetail.onClose();
        }}
        pickCapital={
          tileDetail.pickCapital
            ? { onConfirm: () => tileDetail.onConfirmCapital(tileIndex) }
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
            // #60:展示价与引擎入账同一口径——economy.sellValueOf(def, level),即引擎
            // sellPropertyBankruptcy 的入账函数(不再用购入价,那正是展示 40 实得 16 的根因)。
            // 零兜底:catalog 缺该城 = 数据 bug,非空断言让其抛。
            const def = catalog.get(h.propertyId)!;
            return {
              propId: h.propertyId,
              name: tileIndex >= 0 ? board.at(tileIndex).name : h.propertyId,
              sellPrice: sellValueOf(def, h.level),
              purchasePrice: def.purchasePrice,
              level: h.level,
            };
          })}
        heroes={me.heroes.map((h) => ({ id: h.id, name: h.name }))}
        onCommand={dispatch}
      />
    );
  }

  // ── 珍宝使交涉:城主决策视角;本地是访客时给只读等待视角 ──
  // L42:城主卷轴是决策卷轴,补 interactive 门控(联机 fx.playing / 单机 drive 锁期间
  // 行军未完不弹);访客只读等待面板视同 WaitingBar 的过程反馈,保持即时。
  if (snapshot.treasureVisitor && snapshot.turnPhase === "AwaitingTreasureOwner") {
    const tv = snapshot.treasureVisitor;
    const owner = players[tv.ownerIdx];
    const visitor = players[snapshot.activeIndex];
    if (owner && visitor) {
      const showOwner = viewSeat === tv.ownerIdx && interactive;
      const isVisitorView = viewSeat === snapshot.activeIndex;
      if (showOwner || isVisitorView) {
        const propDef = catalog.get(tv.propertyId);
        const ownerLevel =
          owner.properties.find((h) => h.propertyId === tv.propertyId)?.level ?? 0;
        if (propDef) {
          return (
            <TreasureVisitorScroll
              role={showOwner ? "owner" : "visitor"}
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
  // spec #107 C1(选项集消费缝):三个卷轴的可用性/原因经 snapshot.choices 消费引擎
  // 注册表口径(ADR-0013),本层只透传,不自行判定。
  // 联机 pending 期间 interactive=false,卷轴暂不弹——命令回包后相位离开,无需「…中」占位。
  if (interactive && snapshot.phase === "Playing") {
    const tp = snapshot.turnPhase;
    if (tp === "AwaitingBranch") {
      return <BranchDecisionScroll choices={snapshot.choices} onCommand={dispatch} />;
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
              choices={snapshot.choices}
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
              choices={snapshot.choices}
              onCommand={dispatch}
            />
          );
        }
      }
    }
  }

  // ── 抉择机遇(#124):机遇文段 + 目录选项;上下文单源快照 choices(选项携带
  // encounterId/encounterText,choices.ts 注册表产出)——选项缺失/无标识 = 相位与注册表
  // 不符(数据 bug),不弹(与旧版整层 return null 同口径)。
  // 体力耗竭(#130):选项=降级/失去,卷轴同构机遇(无 encounterId 标识,以相位路由)
  if (interactive && snapshot.phase === "Playing" && snapshot.turnPhase === "AwaitingExhaustion") {
    if (snapshot.choices.length > 0) {
      return <ExhaustionChoiceScroll choices={snapshot.choices} onCommand={dispatch} />;
    }
  }
  if (interactive && snapshot.phase === "Playing" && snapshot.turnPhase === "AwaitingEncounter") {
    const head = snapshot.choices.find((o) => o.encounterId != null);
    if (head) {
      return (
        <EncounterChoiceScroll
          encounterId={head.encounterId!}
          encounterText={head.encounterText!}
          choices={snapshot.choices}
          onCommand={dispatch}
        />
      );
    }
  }

  // ── 锦囊(#122/T2):回合开始掷骰前,用牌或今不用(选项含灰置手牌)──
  if (interactive && snapshot.phase === "Playing" && snapshot.turnPhase === "AwaitingJinnang") {
    if (snapshot.choices.some((o) => o.id === "pass")) {
      return <JinnangScroll choices={snapshot.choices} onCommand={dispatch} />;
    }
  }

  // ── 招贤纳士:三选一(无"不取",引擎相位守卫如此)──
  if (snapshot.turnPhase === "AwaitingHeroPick" && snapshot.offeredHeroes.length > 0 && interactive) {
    return <HeroPickScroll offered={snapshot.offeredHeroes} onCommand={dispatch} />;
  }

  return null;
  })();

  // ── 幽灵帧协议唯一入口(#107 C6 useGhostChild):只在「弹层区清空」(child 由非空转
  //    null)时为上一个卷轴播 210ms 退场帧;A→B 直接换页不播——快节奏相位回环下幽灵与
  //    新卷轴并存,死按钮会抢在真按钮前面被 `.first()` 类选择器/e2e 命中,吞掉真实点击
  //    (e2e 速战档实测)。skip 的判定条件由本层按子节点类型算:胜利屏是全屏覆盖而非
  //    卷轴,退场帧会让陈旧覆盖层多压 210ms,不配退场帧;详情卷轴的就地收场走事件侧
  //    yield()(见上方 onClose)。机制细节(prev 快照/定时/让位出列)全在 hook。──
  const ghostSlot = useGhostChild(child, {
    skip: child !== null && child.type === VictoryScreen,
  });

  if (!map || !ctx) return null;

  return (
    <>
      {/* 常驻 key 槽:幽灵帧出列时当前子节点不被 React 按位对调重挂 */}
      <Fragment key="scroll-current">{child}</Fragment>
      {/* 幽灵帧渲染在当前子节点之后(DOM 末位)+ ScrollShell 幽灵态整体 inert,
          保证任何选择器/点击永远先命中真实卷轴 */}
      {ghostSlot.ghost !== null && (
        <ScrollGhostContext.Provider value={true}>{ghostSlot.ghost}</ScrollGhostContext.Provider>
      )}
    </>
  );
}
