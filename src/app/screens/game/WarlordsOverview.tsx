// 诸侯详情弹窗(#702,spec #697 ⑥;#732 正名「诸侯详情」,组件名 WarlordsOverview
// 不改):左上 ☰ 点开的近全屏十列名录直读分板(LoL
// 手游记分板式),原型 tmp/席位侧列原型.html ⑦ 诸侯总览弹窗一节判决原样移植(原型
// 时代的旧称,定名见 GLOSSARY「诸侯详情」)——
// 十列 grid 行行对齐:印/国号单名/现金(两)/体力条+值/牌数/城池名 chips/名将名
// chips/珍宝计数槽/声/委。名录直读口径(可见性拍板):城池=具体城池名 chips(黛青,
// 超 3 折叠「+N」;点击开现役 #622 名下城池清单,钻入式单层互斥——本层先关清单再开,
// #701 单人格弹层城池徽章同法);名将=麾下名将名 chips(朱砂,空槽画空格,信息公开
// 同 #701 名将徽章口径);珍宝=计数槽(名录公开与否另议,维持计数);手牌=暗牌计数
// (ADR-0016)。状态全视觉不用文字(DESIGN §4.6):自己行金描边(.self)、破产行照排
// 灰化(.dead)、活跃方印金圈(.is-active 印金圈呼吸)。不设目标列(战报可查,维持
// 拍板);玩家名=国号单名(示意人名不入 UI)。打开不暂停对局:本弹层纯读快照声明式
// 渲染,无任何时钟/命令副作用,开着随快照实时重渲(CityLedgerModal 同口径)。
// 与单人格弹层两级并存:总览=全家福,格 tap=单人纵深(SeatPopModal 已存在,勿动)。
// 壳收口 shadcn 底件 ui/dialog(Base UI:Esc/点外关闭白拿;挂载不夺焦
// initialFocus={false},焦点留在触发钮);题名行兼拖动把手(ADR-0031 DialogDragHandle)。
// 样式在 warlords-overview.css(经 Portal 渲染在 body,.game-layout 罩不到,zl- 前缀
// 防串扰)。
import { HERO_CAPACITY } from "@core/constants";
import { playerColor, rgba } from "@core/theme";
import type { GameSnapshot } from "@app/store/gameStore";
import { getControllerContext } from "@app/controllers/registry";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { DialogDragHandle } from "@app/hooks/use-dialog-drag";
import { STAMINA_LOW } from "./SeatPopModal";
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
}: {
  snapshot: GameSnapshot;
  seat: number;
  self: boolean;
  /** 城池名按棋盘 index 序(行军顺序,与 #622 清单行序同口径),上游解析。 */
  cityNames: string[];
  onOpenLedger: (seat: number) => void;
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
      {/* 体力条+值:细轨 26px + 裸值,濒耗竭转朱砂(格上/单人格层同口径) */}
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
      {/* 城池列(真按钮):城池名 chips 黛青,超 3 折叠「+N」;点击开 #622 清单。
          空名下如实空列(清单有空态,非兜底)。 */}
      <button
        type="button"
        className="zl-cities"
        data-testid={TESTIDS.warlordsCities(seat)}
        aria-haspopup="dialog"
        aria-label={`${p.guohao}名下城池 ${p.properties.length} 城,点开清单`}
        onClick={() => onOpenLedger(seat)}
      >
        {cityNames.slice(0, CITY_CHIPS).map((name) => (
          <span key={name} className="zl-cityslot">
            {name}
          </span>
        ))}
        {cityNames.length > CITY_CHIPS && (
          <span className="zl-cityslot zl-more">+{cityNames.length - CITY_CHIPS}</span>
        )}
      </button>
      {/* 名将列:麾下名将名 chips 朱砂(信息公开),空槽画空格(HERO_CAPACITY 单源
          core/constants,上限恒 3 槽不折叠)。全名进 title 浮签防截断失读。 */}
      <span className="zl-heroes" data-testid={TESTIDS.warlordsHeroes(seat)}>
        {Array.from({ length: HERO_CAPACITY }, (_, i) => {
          const h = p.heroes[i];
          return h ? (
            <span key={h.id} className="zl-hnslot" title={h.name}>
              {h.name}
            </span>
          ) : (
            <span key={i} className="zl-hnslot zl-empty" aria-hidden="true">
              ·
            </span>
          );
        })}
      </span>
      {/* 珍宝计数槽:槽位=件数示意,满槽「玉」;维持计数不开名录(原型 ⑦ 判词) */}
      <span
        className="zl-gems"
        data-testid={TESTIDS.warlordsGems(seat)}
        aria-label={`珍宝 ${p.treasures.length}`}
      >
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
      {/* 声 / 委(收尾两数值列) */}
      <span className="zl-attr">
        声 <b data-testid={TESTIDS.warlordsRep(seat)}>{p.reputation}</b>
      </span>
      <span className="zl-attr">
        委 <b data-testid={TESTIDS.warlordsWarrant(seat)}>{p.warrants}</b>
      </span>
    </div>
  );
}

/** 诸侯详情弹窗:座序即行序,全家福一屏(满编 8 行零滚动,样式文件预算)。城池名
 *  解析与 #622 清单同源(board/catalog 单源,缺城=数据 bug 当场炸)。 */
export function WarlordsOverview({
  snapshot,
  selfSeat,
  onOpenLedger,
  onClose,
}: {
  snapshot: GameSnapshot;
  /** 自机口径(#453 契约):自己行金描边。 */
  selfSeat: number;
  /** 城池列点击:开 #622 名下城池清单(开合态归消费方 GameTopBar,单层互斥)。 */
  onOpenLedger: (seat: number) => void;
  onClose: () => void;
}) {
  // board:registry 静态上下文单源(同 CityLedgerModal;本弹层只在 GameScreenLive
  // 门卫后可达,缺上下文 = 接线 bug,断言炸出,零兜底)。
  const { board } = getControllerContext()!;
  const cityNames = snapshot.players.map((p) =>
    p.properties
      .map((h) => {
        const tileIndex = board.tiles.findIndex((t) => t.propertyId === h.propertyId);
        if (tileIndex < 0) {
          throw new Error(`诸侯详情:propertyId ${h.propertyId} 不在棋盘上(数据 bug)`);
        }
        return { name: board.at(tileIndex).name, tileIndex };
      })
      .sort((a, b) => a.tileIndex - b.tileIndex)
      .map((r) => r.name),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid={TESTIDS.warlordsOverview}
        aria-label="诸侯详情"
        /* 挂载不夺焦(PileShell 同款):焦点留在触发钮,Esc/点外两路关闭白拿 */
        initialFocus={false}
        className="zl"
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
            onClick={onClose}
            className="zl-close"
          >
            ✕
          </button>
        </DialogDragHandle>
        {snapshot.players.map((p, seat) => (
          <OverviewRow
            key={p.id}
            snapshot={snapshot}
            seat={seat}
            self={seat === selfSeat}
            cityNames={cityNames[seat]}
            onOpenLedger={onOpenLedger}
          />
        ))}
      </DialogContent>
    </Dialog>
  );
}
