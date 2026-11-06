// 顶部浮层(#700 全浮层骨架;#732 顶左行序重排,原型 tmp/席位侧列原型.html ①顶钮
// 左移对账判决的修订):顶左一行 = ⚙ 设置 → ☰ 详情(32×32,避 safe-area);
// 顶中让给知会横幅槽(NoticeBanner,#732)。
// 「N 轮」chip 已退役(#853):#731 拍板 chip 时 #762 回合胶囊尚未诞生,胶囊
// (「第 N 轮」,NoticeBanner 常驻件)上线后两者同屏双通道说一件事,属决策后
// 新冗余——轮次唯一落胶囊,顶左只留两钮(翻案理由存档 ADR-0032 修订记)。
// 旧顶栏退役清单(#700):目标身价 / 回合方字条(「X之回合」/「称帝」,席位格活跃
// 金圈呼吸已承担指名)/ 锦囊牌库角标(牌库耗尽自动洗回,不展示)/ 复位·放大·缩小钮
// / 静音钮(音效开关降级入设置弹层)。
// #702:详情钮点亮,接诸侯详情弹窗(WarlordsOverview,原型 ⑦ 十列分板;#732 正名
// 「诸侯详情」,组件名不改)。#1097 起本弹层是查档唯一入口(#1096 决议3 四元素
// 钻入:城池 chips/名将 chips/珍宝槽/声列)。开合态归顶栏子树自洽(不进 GameScreen
// 装配);名下城池清单(#622)与席位明细(SeatAttrModals)二级开合态同住本件——
// 四元素点击钻入,单层互斥(详情先关再开目标弹层,居中模态不叠两层,#701 徽章
// 钻入同法)。selfSeat(#453 契约,与 GameScreen 同式):详情自己行金描边/清单自看
// 标题都需要「屏前真人」的稳定身份。
// 本件挂在 AudioProvider 内(设置弹层经 GameScreen 挂载,同树消费 useAudio)。
import { useState } from "react";
import { useGameStore, useStablePlayers, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { Sym } from "@app/screens/shared/Sym";
import { TESTIDS } from "./testids";
import { WarlordsOverview } from "./WarlordsOverview";
import { SeatDetailModal, type SeatDetailKind } from "./SeatAttrModals";
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
  // 详情弹层/名下城池清单(#622)/席位明细(#701 族)开合态(#702,#1097 四钻入):
  // 目标持座位号不持玩家对象——弹层开着随快照实时重渲;明细持 {kind, seat}。
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [ledgerSeat, setLedgerSeat] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ kind: SeatDetailKind; seat: number } | null>(null);
  // 四元素钻入单层互斥(#1096 决议3):先关详情层再开目标弹层(城池/明细同法)。
  const drillToLedger = (seat: number) => {
    setOverviewOpen(false);
    setLedgerSeat(seat);
  };
  const drillToDetail = (seat: number, kind: SeatDetailKind) => {
    setOverviewOpen(false);
    setDetail({ kind, seat });
  };
  // selfSeat(#453 收口契约):单机热座恒 0、联机=本座,勿用决策视角轮转值——
  // 与 GameScreen 同式。
  const viewSeat = useGameStore((s) => s.viewSeat);
  const roomId = useNetStore((s) => s.roomId);
  const selfSeat = roomId !== "" ? viewSeat : 0;
  // 玩家行值等复用(#1140 渲染税):三件钻入弹层的 memo 前提——内容不变即引用
  // 不变,「开着随快照实时重渲」收窄为「开着随内容变化重渲」。
  const players = useStablePlayers(snapshot.players);
  return (
    <div className="topbar" data-testid={TESTIDS.topBar}>
      {/* 顶左一行(#732 行序):设置(开设置弹层)→ 详情(#702 点开诸侯详情弹窗) */}
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
      </span>
      {/* 诸侯详情弹窗(#702,#732 正名):四元素钻入=关本层开目标弹层(单层互斥) */}
      {overviewOpen && (
        <WarlordsOverview
          snapshot={snapshot}
          players={players}
          selfSeat={selfSeat}
          onOpenLedger={drillToLedger}
          onOpenDetail={drillToDetail}
          onClose={() => setOverviewOpen(false)}
        />
      )}
      {/* 名下城池清单弹层(#622):详情城池列点开的二级目标;开着随内容变化重渲(#1140) */}
      {ledgerSeat != null && (
        <CityLedgerModal
          players={players}
          seat={ledgerSeat}
          self={ledgerSeat === selfSeat}
          onClose={() => setLedgerSeat(null)}
        />
      )}
      {/* 席位明细弹层族(名将/珍宝/声望,SeatAttrModals):详情名将 chips/珍宝槽/
          声列点开的二级目标;开着随内容变化重渲(#1140) */}
      {detail != null && (
        <SeatDetailModal
          kind={detail.kind}
          p={players[detail.seat]}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
