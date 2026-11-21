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
import { useNetStore } from "@app/store/netStore";
import { getController } from "@app/controllers/registry";

/** 交给 DecisionScrollLayer 的单一下沉 props:详情卷轴定位数据 + 关闭/定都确认入口。
 *  流程状态机(detailTileIndex 等)不外泄,卷轴层只按请求渲染。 */
export type TileDetailRequest = {
  /** 详情格索引。 */
  tileIndex: number;
  onClose: () => void;
} & ({ pickCapital: false } | { pickCapital: true; onConfirmCapital: () => void });

interface CapitalPickFlow {
  /** X4(#23) 选都候选集(引擎三选一,全座位可见;null = 非选都期)。BoardView candidateTiles。 */
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

export function selectableCapitalTiles(snapshot: GameSnapshot, seat: number): number[] | null {
  return snapshot.currentSetupPlayerIndex === seat ? offeredCapitalTiles(snapshot) : null;
}

export function useCapitalPick(args: {
  snapshot: GameSnapshot;
  readOnly: boolean;
}): CapitalPickFlow {
  const { snapshot, readOnly } = args;
  const roomId = useNetStore((s) => s.roomId);
  const mySeat = useNetStore((s) => s.mySeat);
  // 城池详情(Playing 相位点城查看;Setup 选都期点可选城也走详情,内嵌「定都于此」)
  const [detail, setDetail] = useState<{ tileIndex: number; capitalScope: string | null } | null>(
    null,
  );
  const [inspectionTile, setInspectionTile] = useState<number | null>(null);

  // X4(#23) 选都候选:引擎三选一候选(snapshot.offeredCapitals,跨玩家不重复)全座位可见——
  // 非决策席位静态低透明金圈 + 壹贰叁序号印(不可点不脉冲),「轮到本地选」才升格为可点脉冲。
  const offeredCapitals = offeredCapitalTiles(snapshot);
  // 候选集内容串作键:快照每次 sync 都换新对象,按引用订阅会让 select 集/镜头效果
  // 随同步反复重建;同一候选集只应生效一次。
  // 轮到本地视角选都(单机真人固定首座;联机按房间座位)才有可点交互。
  const myPickKey = selectableCapitalTiles(snapshot, roomId !== "" ? mySeat : 0)?.join(",");
  const selectableTiles = useMemo(
    () => (myPickKey ? new Set(myPickKey.split(",").map(Number)) : undefined),
    [myPickKey],
  );
  const capitalScope =
    myPickKey === undefined
      ? null
      : JSON.stringify([snapshot.gameId, snapshot.currentSetupPlayerIndex, myPickKey]);

  const closeDetail = () => setDetail(null);
  const closeInspection = useCallback(() => setInspectionTile(null), []);
  // #35 详情内「定都于此」:确认才落子推进(先收卷轴再发命令,时序保持原样)
  const confirmCapital = (tileIndex: number) => {
    closeDetail();
    getController()?.setupPickCapital(tileIndex);
  };
  const onTileClick = (tileIndex: number) => {
    // 相位路由收口(Wave3 候选2,原 controller.tileClick 的职责上移)
    if (readOnly) {
      setInspectionTile(tileIndex);
    } else if (snapshot.phase === "Playing") {
      setDetail({ tileIndex, capitalScope: null });
    } else if (selectableTiles) {
      if (selectableTiles.has(tileIndex)) {
        setDetail({ tileIndex, capitalScope });
      } else {
        const taken = snapshot.takenCapitalIndices.includes(tileIndex);
        useGameStore
          .getState()
          .pushHint(taken ? "该城已被占据,另择他城" : "本轮三选一:仅候选之城可选", "error");
      }
    }
  };
  let tileDetail: TileDetailRequest | null = null;
  if (detail !== null && detail.capitalScope === null && snapshot.phase === "Playing") {
    tileDetail = { tileIndex: detail.tileIndex, pickCapital: false, onClose: closeDetail };
  } else if (detail !== null && capitalScope !== null && detail.capitalScope === capitalScope) {
    tileDetail = {
      tileIndex: detail.tileIndex,
      pickCapital: true,
      onClose: closeDetail,
      onConfirmCapital: () => confirmCapital(detail.tileIndex),
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
