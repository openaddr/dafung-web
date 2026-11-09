// 组件收口:已收口——诸侯详情,底件 ui/dialog+ADR-0031 拖动把手,挂载不夺焦;城池列四元素钻入 SeatAttrModals,钻入式单层互斥(细则 docs/design/组件收口.md)
// 诸侯详情弹窗(#702,spec #697 ⑥;#732 正名「诸侯详情」,组件名 WarlordsOverview
// 不改):左上 ☰ 点开的近全屏十列名录直读分板(LoL
// 手游记分板式),原型席位侧列(临时件已佚) ⑦ 诸侯总览弹窗一节判决原样移植(原型
// 时代的旧称,定名见 GLOSSARY「诸侯详情」)——
// 十列 grid 行行对齐:印/国号单名/现金(两)/体力条+值/牌数/城池名 chips/名将名
// chips/珍宝计数槽/声。名录直读口径(可见性拍板):城池=具体城池名 chips(黛青,
// 超 3 折叠「+N」);名将=麾下名将名 chips(朱砂,空槽画空格,信息公开);珍宝=
// 计数槽(名录公开与否另议,维持计数);手牌=暗牌计数(ADR-0016)。
// 四元素可点钻入(#1096 决议3,工单 #1097):城池 chips→#622 名下城池清单、名将
// chips→SeatAttrModals 名录、珍宝槽→珍宝列表、声列→声望明细——可点件金描边+微亮
// 金底+尾「›」(spop-click 同形制,样式 warlords-overview.css .zl-drill/.zl-face),
// 钻入式单层互斥沿用既有口径:本层先关再开目标弹层(GameTopBar 持开合态)。#1097
// 起本弹层是查档唯一入口(格面 tap 单人格弹层与格上图标直达随 #1096 决议1 退役)。
// 状态全视觉不用文字(DESIGN §4.6):自己行金描边(.self)、破产行照排
// 灰化(.dead)、活跃方印金圈(.is-active 印金圈呼吸)。不设目标列(战报可查,维持
// 拍板);玩家名=国号单名(示意人名不入 UI)。打开不暂停对局:本弹层纯读快照声明式
// 渲染,无任何时钟/命令副作用,开着随快照实时重渲(CityLedgerModal 同口径)。
// 壳收口 shadcn 底件 ui/dialog(Base UI:Esc/点外关闭白拿;挂载不夺焦
// initialFocus={false},焦点留在触发钮);题名行兼拖动把手(ADR-0031 DialogDragHandle)。
// 样式在 warlords-overview.css(经 Portal 渲染在 body,.game-layout 罩不到,zl- 前缀
// 防串扰)。
import { memo } from "react";
import { HERO_CAPACITY } from "@core/constants";
import { heroById } from "@core/heroes";
import { tileIndexOfProperty } from "@core/board";
import { playerColor, rgba } from "@core/theme";
import type { GameSnapshot, SnapshotPlayer } from "@app/store/gameStore";
import { getControllerContext } from "@app/controllers/registry";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { DialogDragHandle } from "@app/hooks/use-dialog-drag";
import { useDialogExit } from "@app/hooks/use-dialog-exit";
import { STAMINA_LOW } from "./SeatRail";
import type { SeatDetailKind } from "./SeatAttrModals";
import { RepProbBar } from "./RepProbBar";
import { TESTIDS } from "./testids";
import "./warlords-overview.css";

/** 城池 chips 直读上限:超出折叠「+N」(原型 ⑦ 制式;清单全量在 #622 点开即达)。 */
const CITY_CHIPS = 3;
/** 珍宝计数槽保底槽数(原型 ⑦ gemsq 3 槽制式):持有超过时槽位随之增多,计数槽
 *  不折断——静默截断=谎报持有,零兜底。 */
const GEM_SLOTS = 3;

/** 单行(=单诸侯)。行随快照实时重渲,行内零本地状态;p 恒为有效座位玩家
 *  (上游 snapshot.players 直取,接线 bug 当场炸,零兜底)。 */
function OverviewRow({
  snapshot,
  seat,
  self,
  cityNames,
  onOpenLedger,
  onOpenDetail,
}: {
  snapshot: GameSnapshot;
  seat: number;
  self: boolean;
  /** 城池名按棋盘 index 序(行军顺序,与 #622 清单行序同口径),上游解析。 */
  cityNames: string[];
  onOpenLedger: (seat: number) => void;
  onOpenDetail: (seat: number, kind: SeatDetailKind) => void;
}) {
  const p = snapshot.players[seat];
  const active = snapshot.phase === "Playing" && seat === snapshot.activeIndex;
  return (
    <div
      data-testid={TESTIDS.warlordsRow(seat)}
      className={
        "zl-row" +
        (self ? " self" : "") +
        (active ? " is-active" : "") +
        (p.isBankrupt ? " dead" : "")
      }
      style={{ ["--pc" as string]: rgba(playerColor(p.colorIndex)) }}
    >
      {/* 印(座位色,字符居中;活跃方金圈走 .is-active 后代选择器,§4.6 无文字标牌) */}
      <span className="zl-seal" aria-hidden="true">
        {p.guohao.charAt(0)}
      </span>
      {/* 国号单名(玩家名=国号,示意人名不入 UI) */}
      <span className="zl-nm">{p.guohao}</span>
      {/* 现金(两):裸数+小「两」(原型 .scash 口径;testid 挂内层纯数 span) */}
      <span className="zl-cash">
        <span data-testid={TESTIDS.warlordsCash(seat)}>{p.cash}</span>
        <i> 两</i>
      </span>
      {/* 体力条+值:细轨 26px + 裸值,濒耗竭转朱砂(格上同口径) */}
      <span className="zl-stamp">
        <span className="zl-track" aria-hidden="true">
          <i
            className={p.stamina < STAMINA_LOW ? "low" : undefined}
            style={{ width: `${p.stamina}%` }}
          />
        </span>
        <span data-testid={TESTIDS.warlordsStamina(seat)}>{p.stamina}</span>
      </span>
      {/* 牌数(暗牌计数,ADR-0016) */}
      <span className="zl-attr">
        牌 <b data-testid={TESTIDS.warlordsHand(seat)}>{p.jinnangHandCount}</b>
      </span>
      {/* 城池列(可点钻入件):城池名 chips 黛青,超 3 折叠「+N」;点击开 #622 清单。
          空名下如实空列(清单有空态,非兜底)。 */}
      <button
        type="button"
        className="zl-drill"
        data-testid={TESTIDS.warlordsCities(seat)}
        aria-haspopup="dialog"
        aria-label={`${p.guohao}名下城池 ${p.properties.length} 城,点开清单`}
        onClick={() => onOpenLedger(seat)}
      >
        <span className="zl-face">
          {cityNames.slice(0, CITY_CHIPS).map((name) => (
            <span key={name} className="zl-cityslot">
              {name}
            </span>
          ))}
          {cityNames.length > CITY_CHIPS && (
            <span className="zl-cityslot zl-more">+{cityNames.length - CITY_CHIPS}</span>
          )}
        </span>
      </button>
      {/* 名将列(可点钻入件→名录):麾下名将名 chips 朱砂(信息公开),空槽画空格
          (HERO_CAPACITY 单源 core/constants,上限恒 3 槽不折叠)。槽位原生读(#786):
          名按 heroId 回查名将表单源;全名进 title 浮签防截断失读。 */}
      <button
        type="button"
        className="zl-drill"
        data-testid={TESTIDS.warlordsHeroes(seat)}
        aria-haspopup="dialog"
        aria-label={`${p.guohao}麾下名将 ${p.heroes.length},点开名录`}
        onClick={() => onOpenDetail(seat, "hero")}
      >
        <span className="zl-face">
          {Array.from({ length: HERO_CAPACITY }, (_, i) => {
            const slot = p.heroes[i];
            if (slot == null)
              return (
                <span key={i} className="zl-hnslot zl-empty" aria-hidden="true">
                  ·
                </span>
              );
            const name = heroById(slot.heroId).name;
            return (
              <span key={slot.heroId} className="zl-hnslot" title={name}>
                {name}
              </span>
            );
          })}
        </span>
      </button>
      {/* 珍宝计数槽(可点钻入件→列表):槽位=件数示意,满槽「玉」 */}
      <button
        type="button"
        className="zl-drill"
        data-testid={TESTIDS.warlordsGems(seat)}
        aria-haspopup="dialog"
        aria-label={`珍宝 ${p.treasures.length},点开列表`}
        onClick={() => onOpenDetail(seat, "gem")}
      >
        <span className="zl-face">
          {Array.from({ length: Math.max(GEM_SLOTS, p.treasures.length) }, (_, i) => (
            <span
              key={i}
              className={"zl-slot" + (i < p.treasures.length ? " zl-full" : "")}
              aria-hidden="true"
            >
              {i < p.treasures.length ? "玉" : ""}
            </span>
          ))}
        </span>
      </button>
      {/* 声列(可点钻入件→声望明细):数值本体 warlordsRep 单独挂(纯数断言不受
          「声」字串扰),钻入钮另挂 warlordsRepCell。值旁挂三档概率条(#1096 决议4,
          形制 A:52×8 行内档,无浮签;条纯视觉 aria-hidden,语义在数值与本钮可及名)。 */}
      <button
        type="button"
        className="zl-drill"
        data-testid={TESTIDS.warlordsRepCell(seat)}
        aria-haspopup="dialog"
        aria-label={`声望 ${p.reputation},点开明细`}
        onClick={() => onOpenDetail(seat, "rep")}
      >
        <span className="zl-face zl-attr">
          声 <b data-testid={TESTIDS.warlordsRep(seat)}>{p.reputation}</b>
          <RepProbBar reputation={p.reputation} size="row" />
        </span>
      </button>
    </div>
  );
}

/** 值等(#1140 渲染税):消费面=players(引用稳定,GameTopBar 经 useStablePlayers
 *  下传)+ round/phase/activeIndex/selfSeat 四标量;三回调不入比较——全是 setState
 *  驱动的钻入/关闭(行为恒定,身份每渲染抖动)。cityNames/行渲染全由这些输入派生。 */
function warlordsOverviewEqual(
  a: {
    snapshot: GameSnapshot;
    players: SnapshotPlayer[];
    selfSeat: number;
  },
  b: {
    snapshot: GameSnapshot;
    players: SnapshotPlayer[];
    selfSeat: number;
  },
): boolean {
  return (
    a.players === b.players &&
    a.selfSeat === b.selfSeat &&
    a.snapshot.round === b.snapshot.round &&
    a.snapshot.phase === b.snapshot.phase &&
    a.snapshot.activeIndex === b.snapshot.activeIndex
  );
}

/** 诸侯详情弹窗:座序即行序,全家福一屏(满编 8 行零滚动,样式文件预算)。城池名
 *  解析与 #622 清单同源(board/catalog 单源,缺城=数据 bug 当场炸)。
 *  重渲口径(#1140):「开着随快照实时重渲」收窄为「随内容变化重渲」——演出期
 *  开着掂量时,内容没变的拍 bail out,行树不再每拍陪跑。 */
export const WarlordsOverview = memo(function WarlordsOverview({
  snapshot,
  players,
  selfSeat,
  onOpenLedger,
  onOpenDetail,
  onClose,
}: {
  snapshot: GameSnapshot;
  /** 全体玩家(值等复用引用,#1140;行内容真源)。 */
  players: SnapshotPlayer[];
  /** 自机口径(#453 契约):自己行金描边。 */
  selfSeat: number;
  /** 城池列点击:开 #622 名下城池清单(开合态归消费方 GameTopBar,单层互斥)。 */
  onOpenLedger: (seat: number) => void;
  /** 四钻入之名将/珍宝/声列点击:开 SeatAttrModals 对应明细(消费方先关本层再开,
   *  居中模态不叠两层——城池钻入同法)。 */
  onOpenDetail: (seat: number, kind: SeatDetailKind) => void;
  onClose: () => void;
}) {
  // board:registry 静态上下文单源(同 CityLedgerModal;本弹层只在 GameScreenLive
  // 门卫后可达,缺上下文 = 接线 bug,断言炸出,零兜底)。
  const { board } = getControllerContext()!;
  // 退场动画(#767 底件族⑤):×/Esc/点外走「播完再移除」(zl-out 淡出下沉 8px +
  // 遮罩 dialog-overlay-out,210ms 出口卸载);四元素钻入走消费方直卸(GameTopBar
  // 单层互斥先关再开),不经本协议,卸载清理收计时器零残影。
  const { closing, requestClose } = useDialogExit(onClose);
  const cityNames = players.map((p) =>
    p.properties
      .map((h) => {
        const tileIndex = tileIndexOfProperty(board, h.propertyId);
        return { name: board.at(tileIndex).name, tileIndex };
      })
      .sort((a, b) => a.tileIndex - b.tileIndex)
      .map((r) => r.name),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        data-testid={TESTIDS.warlordsOverview}
        aria-label="诸侯详情"
        /* 挂载不夺焦(PileShell 同款):焦点留在触发钮,Esc/点外两路关闭白拿 */
        initialFocus={false}
        /* 收起中:壳体/遮罩挂退场类(动画播完由协议卸载,重复出口由协议守卫挡掉) */
        overlayProps={closing ? { className: "dialog-overlay-out" } : undefined}
        className={"zl" + (closing ? " zl-out" : "")}
      >
        {/* 题名行兼拖动把手(#674/ADR-0031);✕ 钮自带拖动豁免 */}
        <DialogDragHandle className="zl-head" testid={TESTIDS.modalDragHandle}>
          {/* 可达名:题名即 DialogTitle(视觉/读屏同一节点;疏排照原型 .st 原文) */}
          <DialogTitle className="zl-title">诸 侯 详 情</DialogTitle>
          <span className="zl-round">{snapshot.round} 轮</span>
          <button
            type="button"
            data-testid={TESTIDS.modalClose}
            aria-label="关闭"
            onClick={requestClose}
            className="zl-close"
          >
            ✕
          </button>
        </DialogDragHandle>
        {players.map((p, seat) => (
          <OverviewRow
            key={p.id}
            snapshot={snapshot}
            seat={seat}
            self={seat === selfSeat}
            cityNames={cityNames[seat]}
            onOpenLedger={onOpenLedger}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </DialogContent>
    </Dialog>
  );
}, warlordsOverviewEqual);
