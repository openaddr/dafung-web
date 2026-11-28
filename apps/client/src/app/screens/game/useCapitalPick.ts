// 选都/详情流程状态机(spec #107 C5 下沉:原散在 GameScreen 的两个 useState、
// onTileClick 相位路由、详情/定都确认两态时序
// 整体收进本文件,单一文件持有;GameScreen 只取返回值接线)。
// 流程口径:
//   Playing 点格 = 城池详情卷轴(#33,含特殊地点);
//   Setup 选都期点可选城 = 首击开详情卷轴、确认在卷轴内「定都于此」(#35,整合旧
//     pendingCapital 确认框——确认框不再独立存在);
//   Setup 选都期点灰城 = 即时 hint 反馈(#27)。
// tile 点击入口留在 GameScreen(棋盘 BoardView 在它手里),故走「hook 持有状态机 +
// DecisionScrollLayer 收单个窄 props」方案,而非整流程搬进卷轴层。
import { useCallback, useMemo, useState } from "react";
import { useGameStore, type GameSnapshot } from "@app/store/gameStore";
import type {
  SeatIntent,
  SeatIntentResult,
  SeatInteractionView,
} from "@dafung/core/protocol/seat-interaction";
import type { CapitalOption } from "@dafung/core/protocol/wire";

/** 交给 DecisionScrollLayer 的单一下沉 props:详情卷轴定位数据 + 关闭/定都确认入口。
 *  流程状态机(detailTileIndex 等)不外泄,卷轴层只按请求渲染。 */
export type TileDetailRequest = {
  /** 详情格索引。 */
  tileIndex: number;
  onClose: () => void;
} & (
  | { pickCapital: false }
  | { pickCapital: true; option: CapitalOption; canConfirm: boolean; onConfirmCapital: () => void }
);

interface CapitalPickFlow {
  /** 选都候选集(全座位可见，null 表示非选都期)。BoardView candidateTiles。 */
  offeredCapitals: number[] | null;
  /** 轮到本地选都时的可选城集(非决策席位 undefined = 无可点)。BoardView selectableTiles。 */
  selectableTiles: Set<number> | undefined;
  /** 棋盘点格相位路由(见文件头)。BoardView onTileClick。 */
  onTileClick: (tileIndex: number) => void;
  /** DecisionScrollLayer 的详情流程请求;null = 不弹。 */
  tileDetail: TileDetailRequest | null;
  inspection: TileDetailRequest | null;
  closeInspection: () => void;
}

function offeredCapitalTiles(snapshot: GameSnapshot): number[] | null {
  return snapshot.phase === "Setup" && snapshot.setupPhase === "PickCapital"
    ? snapshot.offeredCapitals
    : null;
}

export function useCapitalPick(args: {
  seatView: SeatInteractionView<GameSnapshot>;
  readOnly: boolean;
  act: (intent: SeatIntent) => SeatIntentResult;
}): CapitalPickFlow {
  const { seatView, readOnly, act } = args;
  const { snapshot, capital, interactive } = seatView;
  const [detailTile, setDetailTile] = useState<number | null>(null);
  const [inspectionTile, setInspectionTile] = useState<number | null>(null);

  // 选都候选(snapshot.offeredCapitals)全座位可见。
  // 非决策席位静态低透明金圈 + 壹贰叁序号印(不可点不脉冲),「轮到本地选」才升格为可点脉冲。
  const offeredCapitals = offeredCapitalTiles(snapshot);
  // 候选集内容串作键:快照每次 sync 都换新对象,按引用订阅会让 select 集/镜头效果
  // 随同步反复重建;同一候选集只应生效一次。
  const myPickKey = interactive
    ? capital?.options.map((option) => option.tileIndex).join(",")
    : undefined;
  const selectableTiles = useMemo(
    () => (myPickKey ? new Set(myPickKey.split(",").map(Number)) : undefined),
    [myPickKey],
  );
  const closeInspection = useCallback(() => setInspectionTile(null), []);
  const handleCapital = (intent: SeatIntent) => {
    const result = act(intent);
    if (result.status === "unavailable") useGameStore.getState().pushHint(result.reason);
  };
  const onTileClick = (tileIndex: number) => {
    // 相位路由收口(Wave3 候选2,原 controller.tileClick 的职责上移)
    if (readOnly) {
      setInspectionTile(tileIndex);
    } else if (snapshot.phase === "Playing") {
      setDetailTile(tileIndex);
    } else if (selectableTiles) {
      if (selectableTiles.has(tileIndex)) {
        handleCapital({ type: "selectCapital", tileIndex });
      } else {
        const taken = snapshot.takenCapitalIndices.includes(tileIndex);
        useGameStore
          .getState()
          .pushHint(taken ? "该城已被占据,另择他城" : "只能选择当前候选城", "error");
      }
    }
  };
  let tileDetail: TileDetailRequest | null = null;
  if (detailTile !== null && snapshot.phase === "Playing") {
    tileDetail = { tileIndex: detailTile, pickCapital: false, onClose: () => setDetailTile(null) };
  } else if (capital !== null && capital.selectedOption !== null) {
    tileDetail = {
      tileIndex: capital.selectedOption.tileIndex,
      pickCapital: true,
      option: capital.selectedOption,
      canConfirm: capital.canConfirm,
      onClose: () => handleCapital({ type: "cancel" }),
      onConfirmCapital: () => handleCapital({ type: "confirm" }),
    };
  }

  return {
    offeredCapitals,
    selectableTiles,
    onTileClick,
    tileDetail,
    inspection:
      readOnly && inspectionTile !== null
        ? {
            tileIndex: inspectionTile,
            pickCapital: false,
            onClose: closeInspection,
          }
        : null,
    closeInspection,
  };
}
