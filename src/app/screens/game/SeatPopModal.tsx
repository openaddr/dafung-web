// 席位格 tap 单人格弹层(#701,spec #697 ④):格面 tap 开的单人纵深弹层,原型
// tmp/席位侧列原型.html ⑤节判决原样移植——头=国号印(座位色)+国号+现金章(裸数
// 全称带「两」,与格上省「两」口径区隔;#745 高3 起全链无千分位);体力数值条
// (0-100,濒耗竭转朱砂与格上同口径);
// 声望/委任行;城池/手牌/名将/珍宝四徽章,可点项(城池/名将)金描边+微亮底+尾「›」,
// 不可点项(手牌/珍宝)素底淡字,一眼可辨;自机格加托管开关行、对手格无(开关接现役
// 托管引擎通路:useAutopilotOn 回读 + controller.setAutoPilot,行为=旧托管钮)。
// 徽章钻入=关本层开明细(SeatRail 持开合态):居中模态不叠两层——双遮罩互夺 Esc/点外、
// 拖动把手 testid 同族严格命中都不可靠。城池徽章走现役 #622 通路(cityLedger.onOpen,
// 开合态仍归 GameScreen),名将徽章开 SeatAttrModals 名录。手牌徽章=暗牌只计数不可点
// (ADR-0016 口径);珍宝徽章素底(原型 ⑤ 判词:可点项唯城池/名将)。
// 壳收口 shadcn 底件 ui/dialog(Base UI:Esc/点外关闭白拿;挂载不夺焦
// initialFocus={false},焦点留在触发格上);题名行兼拖动把手(DialogDragHandle,
// ADR-0031)——原型 .pop 无题名行无 X,题名=国号(D 称可达名同节点),关闭唯点外/Esc。
// 样式在 seat-pop.css(经 Portal 渲染在 body,spop-* 前缀防串扰)。
import { formatMoney } from "@core/money";
import { playerColor, rgba } from "@core/theme";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { useAutopilotOn } from "@app/store/netStore";
import { getController } from "@app/controllers/registry";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { Switch } from "@app/components/ui/switch";
import { DialogDragHandle } from "@app/hooks/use-dialog-drag";
import { AttrIcon, MiniBacks } from "./AttrIcon";
import { TESTIDS } from "./testids";
import type { CityLedgerWiring } from "./SeatRail";

/** 体力色条转朱砂的濒耗竭线:单源迁本件(#698 格上血条与 #701 弹层数值条同规)。 */
export const STAMINA_LOW = 30;

export function SeatPopModal({
  p,
  seat,
  self,
  notice,
  cityLedger,
  onOpenDetail,
  onClose,
}: {
  p: SnapshotPlayer;
  seat: number;
  /** 自机口径:托管开关行仅此渲染(对手格无,原型 ⑤ 判词)。 */
  self: boolean;
  /** 死区 reason 印条(#743 判词 E/#751 C 批):目标段不可选席点按放行到本层时
   *  传入——题行下一行墨底纸字,禁用原因=§4.6 文字例外(触屏无 hover 的唯一
   *  可达通路);常规格面 tap 不传不出。 */
  notice?: string;
  cityLedger: CityLedgerWiring;
  /** 徽章钻入(名将名录;弹层关、明细开)。 */
  onOpenDetail: (seat: number, kind: "hero") => void;
  onClose: () => void;
}) {
  // 控制器模块级单源(同 CityLedgerModal getControllerContext 取径;弹层只在
  // GameScreenLive 门卫后可达,缺上下文 = 接线 bug)。
  const controller = getController();
  // 托管态单源回读(useAutopilotOn:联机=座位广播,单机=控制器本地标记)。
  const autopilotOn = useAutopilotOn(controller);
  // 名将徽章值:麾下名将名(公开信息,原型 ⑤「张辽」口径);多将「·」连排一行
  // 省略,全名进 title 浮签;空麾下如实报 0。
  const heroNames = p.heroes.map((h) => h.name).join("·");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid={TESTIDS.seatPop(seat)}
        aria-label={`${p.guohao} · 席位详情`}
        /* 挂载不夺焦(PileShell 同款):焦点留在触发格上,Esc/点外两路关闭白拿 */
        initialFocus={false}
        className="spop"
      >
        {/* 题名行兼拖动把手(#674/ADR-0031);行内无按钮,整行即把手 */}
        <DialogDragHandle className="spop-head" testid={TESTIDS.modalDragHandle}>
          <span
            className="spop-seal"
            style={{ ["--pc" as string]: rgba(playerColor(p.colorIndex)) }}
            aria-hidden="true"
          >
            {p.guohao.charAt(0)}
          </span>
          {/* 可达名:题名即 DialogTitle(视觉/读屏同一节点) */}
          <DialogTitle className="spop-nm">{p.guohao}</DialogTitle>
          <span className="spop-cash" data-testid={TESTIDS.seatPopCash(seat)}>
            现金 {formatMoney(p.cash)}
          </span>
        </DialogDragHandle>
        {notice != null && (
          <div className="spop-notice" data-testid={TESTIDS.seatPopNotice(seat)}>
            {notice}
          </div>
        )}
        <div className="spop-row">
          体力
          <b className="spop-num" data-testid={TESTIDS.seatPopStamina(seat)}>
            {p.stamina}
          </b>
          /100
          <span className="spop-track" aria-hidden="true">
            <i
              className={p.stamina < STAMINA_LOW ? "low" : undefined}
              style={{ width: `${p.stamina}%` }}
            />
          </span>
        </div>
        <div className="spop-row between">
          声望
          <b className="spop-num" data-testid={TESTIDS.seatPopRep(seat)}>
            {p.reputation}
          </b>
          <span aria-hidden="true">·</span>
          委任状
          <b className="spop-num" data-testid={TESTIDS.seatPopWarrant(seat)}>
            {p.warrants}
          </b>
        </div>
        <div className="spop-badges">
          {/* 城池(可点)→ 现役 #622 名下城池清单:先关本层再开清单,居中模态不叠两层 */}
          <button
            type="button"
            className="spop-b spop-click"
            data-testid={TESTIDS.seatPopBadge(seat, "city")}
            aria-haspopup="dialog"
            onClick={() => {
              onClose();
              cityLedger.onOpen(seat);
            }}
          >
            <b className="spop-bv spop-city">
              <AttrIcon kind="city" size={12} />
              {p.properties.length}
            </b>
            城池
          </button>
          {/* 手牌(素底淡字):暗牌只计数,无明细通路(ADR-0016) */}
          <span className="spop-b" data-testid={TESTIDS.seatPopBadge(seat, "hand")}>
            <b className="spop-bv spop-hand">
              <MiniBacks count={p.jinnangHandCount} />
              {p.jinnangHandCount}
            </b>
            手牌
          </span>
          {/* 名将(可点)→ 名录/卡面(信息公开):钻入关本层 */}
          <button
            type="button"
            className="spop-b spop-click"
            data-testid={TESTIDS.seatPopBadge(seat, "hero")}
            aria-haspopup="dialog"
            title={heroNames}
            onClick={() => {
              onClose();
              onOpenDetail(seat, "hero");
            }}
          >
            <b className="spop-bv spop-hero">
              <span className="spop-hero-names">{heroNames === "" ? 0 : heroNames}</span>
            </b>
            名将
          </button>
          {/* 珍宝(素底淡字):原型 ⑤ 判词可点项唯城池/名将;明细路在格上玉璧图标 */}
          <span className="spop-b" data-testid={TESTIDS.seatPopBadge(seat, "gem")}>
            <b className="spop-bv spop-gem">{p.treasures.length}</b>
            珍宝
          </span>
        </div>
        {/* 托管开关行(仅自机格;autopilotSupported 门卫与旧托管钮同款:联机/单机有)。
            开关皮单源回 ui/switch 底件桥接(#745 高4:spop-switch 双类覆写退役,
            on 态吃 --primary=漆金,success 语义错位收口)。 */}
        {self && controller?.autopilotSupported && (
          <div className="spop-switch-row">
            托管
            <Switch
              data-testid={TESTIDS.seatPopAutopilot(seat)}
              aria-label="托管"
              checked={autopilotOn}
              onCheckedChange={(next) => controller.setAutoPilot(next)}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
