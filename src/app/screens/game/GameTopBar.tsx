// 顶部浮层(#700 全浮层骨架,原型 tmp/席位侧列原型.html ①顶钮左移对账 判决移植):
// 顶左两钮(诸侯总览 ☰ / 设置 ⚙,32×32,避 safe-area)+ 顶中「N 轮」浮置 chip。
// 旧顶栏退役清单(本票):目标身价 / 回合方字条(「X之回合」/「称帝」,席位格活跃
// 金圈呼吸已承担指名)/ 锦囊牌库角标(牌库耗尽自动洗回,不展示)/ 复位·放大·缩小钮
// / 静音钮(音效开关降级入设置弹层)。
// #702:总览钮点亮,接诸侯总览弹窗(WarlordsOverview,原型 ⑦ 十列分板)。开合态
// 归顶栏子树自洽(#701 席位列弹层开合态同口径,不进 GameScreen 装配);名下城池清单
// (#622)二级开合态同住本件——总览城池列点击钻入,单层互斥(总览先关清单再开,
// #701 弹层城池徽章同法)。selfSeat(#453 契约,与 GameScreen 同式):总览自己行
// 金描边/清单自看标题都需要「屏前真人」的稳定身份。
// 本件挂在 AudioProvider 内(设置弹层经 GameScreen 挂载,同树消费 useAudio)。
import { useState } from "react";
import { useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { Sym } from "@app/screens/shared/Sym";
import { TESTIDS } from "./testids";
import { WarlordsOverview } from "./WarlordsOverview";
import { CityLedgerModal } from "./CityLedgerModal";
import "./layout.css";

export interface GameTopBarProps {
  snapshot: GameSnapshot;
  onOpenSettings: () => void;
}

export function GameTopBar({ snapshot, onOpenSettings }: GameTopBarProps) {
  // 总览弹层/名下城池清单(#622)开合态(#702):清单目标持座位号不持玩家对象
  // (GameScreen cityLedgerSeat 同口径)——弹层开着随快照实时重渲。
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [ledgerSeat, setLedgerSeat] = useState<number | null>(null);
  // selfSeat(#453 收口契约):单机热座恒 0、联机=本座,勿用决策视角轮转值——
  // 与 GameScreen 同式;观战(viewSeat=-1)无自机行,总览全家福照列。
  const viewSeat = useGameStore((s) => s.viewSeat);
  const roomId = useNetStore((s) => s.roomId);
  const selfSeat = roomId !== "" ? viewSeat : 0;
  return (
    <div className="topbar" data-testid={TESTIDS.topBar}>
      {/* 顶左两钮:总览(#702 点开诸侯总览弹窗)/ 设置(开设置弹层) */}
      <span className="topbtns">
        <button
          type="button"
          data-testid={TESTIDS.topbarOverview}
          title="诸侯总览"
          aria-label="诸侯总览"
          aria-haspopup="dialog"
          aria-expanded={overviewOpen}
          onClick={() => setOverviewOpen(true)}
          className="tbtn"
        >
          <Sym name="overview" size={15} />
        </button>
        <button
          type="button"
          data-testid={TESTIDS.settingsButton}
          title="设置"
          aria-label="设置"
          aria-haspopup="dialog"
          onClick={onOpenSettings}
          className="tbtn"
        >
          <Sym name="settings" size={15} />
        </button>
      </span>
      {/* 顶中「N 轮」chip:浮置不挡棋盘拖拽(pointer-events 由 .topbar 关、本件放行) */}
      <span className="turnchip" data-testid={TESTIDS.topbarRound}>
        <b>{snapshot.round}</b> 轮
      </span>
      {/* 诸侯总览弹窗(#702):城池列钻入=关本层开 #622 清单(单层互斥,#701 同法) */}
      {overviewOpen && (
        <WarlordsOverview
          snapshot={snapshot}
          selfSeat={selfSeat}
          onOpenLedger={(seat) => {
            setOverviewOpen(false);
            setLedgerSeat(seat);
          }}
          onClose={() => setOverviewOpen(false)}
        />
      )}
      {/* 名下城池清单弹层(#622):总览城池列点开的二级目标;开着随快照实时重渲 */}
      {ledgerSeat != null && (
        <CityLedgerModal
          snapshot={snapshot}
          seat={ledgerSeat}
          self={ledgerSeat === selfSeat}
          onClose={() => setLedgerSeat(null)}
        />
      )}
    </div>
  );
}
