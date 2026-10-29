// 顶部浮层(#700 全浮层骨架;#732 顶左行序重排,原型 tmp/席位侧列原型.html ①顶钮
// 左移对账判决的修订):顶左一行 = ⚙ 设置 → ☰ 详情(32×32,避 safe-area)→
// 「N 轮」浮置 chip(样式原样只挪位,与钮行基线对齐);顶中让给知会横幅槽
// (NoticeBanner,#732)。
// 旧顶栏退役清单(#700):目标身价 / 回合方字条(「X之回合」/「称帝」,席位格活跃
// 金圈呼吸已承担指名)/ 锦囊牌库角标(牌库耗尽自动洗回,不展示)/ 复位·放大·缩小钮
// / 静音钮(音效开关降级入设置弹层)。
// #702:详情钮点亮,接诸侯详情弹窗(WarlordsOverview,原型 ⑦ 十列分板;#732 正名
// 「诸侯详情」,组件名不改)。开合态归顶栏子树自洽(#701 席位列弹层开合态同口径,
// 不进 GameScreen 装配);名下城池清单(#622)二级开合态同住本件——详情城池列点击
// 钻入,单层互斥(详情先关清单再开,#701 弹层城池徽章同法)。selfSeat(#453 契约,
// 与 GameScreen 同式):详情自己行金描边/清单自看标题都需要「屏前真人」的稳定身份。
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
  /** 战报未读条数(#768,GameScreen 本地已读游标对比 warEntriesOf):>0 时 ⚙ 钮
   *  右上挂 6px 呼吸金点(战报入口的未读表达;打开抽屉即清账)。 */
  warUnread: number;
  onOpenSettings: () => void;
}

export function GameTopBar({ snapshot, warUnread, onOpenSettings }: GameTopBarProps) {
  // 详情弹层/名下城池清单(#622)开合态(#702):清单目标持座位号不持玩家对象
  // (GameScreen cityLedgerSeat 同口径)——弹层开着随快照实时重渲。
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [ledgerSeat, setLedgerSeat] = useState<number | null>(null);
  // selfSeat(#453 收口契约):单机热座恒 0、联机=本座,勿用决策视角轮转值——
  // 与 GameScreen 同式。
  const viewSeat = useGameStore((s) => s.viewSeat);
  const roomId = useNetStore((s) => s.roomId);
  const selfSeat = roomId !== "" ? viewSeat : 0;
  return (
    <div className="topbar" data-testid={TESTIDS.topBar}>
      {/* 顶左一行(#732 行序):设置(开设置弹层)→ 详情(#702 点开诸侯详情弹窗)
          → 「N 轮」chip;chip 浮置样式原样,仅从顶中迁入本行尾 */}
      <span className="topbtns">
        <button
          type="button"
          data-testid={TESTIDS.settingsButton}
          title="设置"
          aria-label={warUnread > 0 ? "设置,战报有新条目" : "设置"}
          aria-haspopup="dialog"
          onClick={onOpenSettings}
          className="tbtn"
        >
          <Sym name="settings" size={15} />
          {/* 战报未读金点(#768):绝对定位挂件不进钮盒(32×32 几何断言不动);
              可达语义并入 aria-label(§4.6 状态用视觉,读屏走名)。 */}
          {warUnread > 0 && (
            <i
              data-testid={TESTIDS.settingsUnreadDot}
              className="war-unread-dot"
              aria-hidden="true"
            />
          )}
        </button>
        <button
          type="button"
          data-testid={TESTIDS.topbarOverview}
          title="详情"
          aria-label="详情"
          aria-haspopup="dialog"
          aria-expanded={overviewOpen}
          onClick={() => setOverviewOpen(true)}
          className="tbtn"
        >
          <Sym name="overview" size={15} />
        </button>
        {/* 「N 轮」chip(#732 迁位):保留「轮」字与浮置 chip 形态,与钮行基线对齐 */}
        <span className="turnchip" data-testid={TESTIDS.topbarRound}>
          <b>{snapshot.round}</b> 轮
        </span>
      </span>
      {/* 诸侯详情弹窗(#702,#732 正名):城池列钻入=关本层开 #622 清单(单层互斥,#701 同法) */}
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
      {/* 名下城池清单弹层(#622):详情城池列点开的二级目标;开着随快照实时重渲 */}
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
