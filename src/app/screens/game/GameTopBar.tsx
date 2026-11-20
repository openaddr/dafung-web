// 顶部浮层(#700 全浮层骨架;#732 顶左行序重排,原型席位侧列(临时件已佚) ①顶钮
// 左移对账判决的修订):顶左一行 = ⚙ 设置 → ☰ 详情(32×32,避 safe-area);
// 顶中让给知会横幅槽(NoticeBanner,#732)。
// 「N 轮」chip 已退役(#853):#731 拍板 chip 时 #762 回合胶囊尚未诞生,胶囊
// (「第 N 轮」,NoticeBanner 常驻件)上线后两者同屏双通道说一件事,属决策后
// 新冗余——轮次唯一落胶囊,顶左只留两钮(翻案理由存档 ADR-0032 修订记)。
// 旧顶栏退役清单(#700):目标身价 / 回合方字条(「X之回合」/「称帝」,席位格活跃
// 金圈呼吸已承担指名)/ 锦囊牌库角标(牌库耗尽自动洗回,不展示)/ 复位·放大·缩小钮
// / 静音钮(音效开关降级入设置弹层)。
import { Sym } from "@app/screens/shared/Sym";
import { TESTIDS } from "./testids";
import "./layout.css";

interface GameTopBarProps {
  overviewOpen: boolean;
  onOpenOverview: () => void;
  /** 战报未读条数(#768,GameScreen 本地已读游标对比 warEntriesOf):>0 时 ⚙ 钮
   *  右上挂 6px 呼吸金点(战报入口的未读表达;打开抽屉即清账)。 */
  warUnread: number;
  onOpenSettings: () => void;
}

export function GameTopBar({
  warUnread,
  onOpenSettings,
  overviewOpen,
  onOpenOverview,
}: GameTopBarProps) {
  return (
    <div className="topbar" data-testid={TESTIDS.topBar}>
      {/* 顶左一行(#732 行序):设置(开设置弹层)→ 详情(#702 点开诸侯详情弹窗) */}
      <span className="topbtns">
        <button
          type="button"
          data-testid={TESTIDS.settingsButton}
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
          aria-label="诸侯详情"
          aria-haspopup="dialog"
          aria-expanded={overviewOpen}
          onClick={onOpenOverview}
          className="tbtn"
        >
          <Sym name="overview" size={15} />
        </button>
      </span>
    </div>
  );
}
