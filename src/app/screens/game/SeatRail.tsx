// 席位格列(#698 席位条重形:96×38 双行八项格,旧席位竖卡+仪表徽章行整体退役):
// 右缘单列一人一格(自机入列,观战 selfSeat<0 无自机格),原型 tmp/席位侧列原型.html
// ①全屏语境/②席位格解剖/③状态一览 三节判决移植——行1=国号印(座位色,字符居中)
// +现金主数(无千分位省「两」)+体力色条(吃行1剩余宽度,濒耗竭转朱砂);行2=城楼/
// 牌背/战盔/玉璧/墨竹/卷轴六图标计数 space-between 均分(几何上不可能溢出)。图标
// 逐路径复刻 AttrIcon.tsx 现役资产(战盔/玉璧走 ATTR_ENTRY_D,牌背=MiniBacks),零新画。
// 状态全视觉不用文字(DESIGN §4.6):活跃=金圈呼吸(.active)、目标候选=金圈呼吸
// (.candidate)+选中实金停持(.picked,#417 统一口径)、破产=降透明印灰(.bankrupt)、
// 终局胜者=金环(.won)、自机=金描边+左金条+金渐变(.self,无「你」字)——旧「自身
// 不出卡」规则与「运筹中」文字微标随席位卡形态一并退役(活跃金圈呼吸即指名)。
// 列几何(拍板口径):列宽 96 固定、格间距 2px、列 y8 起排;格高=clamp(30,(可用高−14)/8,38),
// 可用高=视口高−顶距 8−钮区 54(#700 右下三圆钮上缘;落地前该 54px 仅作格高预算),
// 矮横屏 390/375/320 三档高全部零滚动——式样落 layout.css,组件零断点分支。
// 交互:格面 tap=单人格弹层(#701,原型 ⑤ 移植,SeatPopModal/seat-pop.css,开合态
// 归本列)、格上图标直达(#701):城楼=名下城池清单(#622 原样,开合态仍归
// GameScreen)、战盔=名将名录/玉璧=珍宝列表/墨竹=声望明细/卷轴=委任明细
// (SeatAttrModals,钻入式单层互斥);牌背=暗牌不可点(ADR-0016,浮签照旧)。格根
// 点击层=目标段选席(#256/#417 原样等价保留);弹层可 tap 的通路=格上非按钮区
// (印/现金/图标间隙——七个浮签触发元与目标层按钮各自 claim 点击,冒泡止于
// spop-claim 壳,详 SeatCell)。自机候选面仍在仪表条身份区「你」印(自机格不设
// 目标点击层——与仪表条双挂同 testid 会炸 e2e strict 模式)。
// 变化反馈(#495):全员现金/体力浮标(useDeltaFloat/DeltaFloats 共享单源),自机格
// 同锚现金主数/体力条——仪表条已随 #700 退役,自机跳变反馈归席位格(评审 #697 收口;
// 旧「#700 前双挂浮两遍」随仪表条本体不复存在)。
import { useState, type ReactNode } from "react";
import { formatMoney } from "@core/money";
import { playerColor, rgba } from "@core/theme";
import type { GameSnapshot, SnapshotPlayer } from "@app/store/gameStore";
import { useDeltaFloat, DeltaFloats } from "./useDeltaFloat";
import { AttrIcon, MiniBacks } from "./AttrIcon";
import { ATTR_TIPS, Tip, type TipText } from "./Tip";
import { TESTIDS } from "./testids";
import { SeatPopModal, STAMINA_LOW } from "./SeatPopModal";
import { SeatDetailModal, type SeatDetailKind } from "./SeatAttrModals";
import "./layout.css";
import "./seat-target.css";
import "./seat-pop.css";

/** 浮签触发元/目标层按钮的点击 claim 壳(#701):格面 tap=弹层归格根,七个按钮的
 *  点击冒泡止于此壳(display:contents 不改排版)——图标各自走直达/浮签,不夺格 tap。 */
function Claim({ children }: { children: ReactNode }) {
  return (
    <span className="spop-claim" onClick={(e) => e.stopPropagation()}>
      {children}
    </span>
  );
}

/** 目标段(#256/#417)单席点击槽:available=候选(金圈呼吸,点选=选中);
 *  selected=已选中(实金停持,再点取消);不可用席位照列不动,reason 进浮签
 *  (title,DESIGN §4.6 禁文字章)。 */
export interface SeatTargetSlot {
  available: boolean;
  selected?: boolean;
  reason?: string;
  onPick: () => void;
}

/** 名下城池清单弹层(#622)的席位侧载荷:openSeat=当前开着的清单目标(null=关),
 *  onOpen=点城池徽章请求开清单;aria-expanded 由 openSeat===seat 派生。 */
export interface CityLedgerWiring {
  openSeat: number | null;
  onOpen: (seat: number) => void;
}

/** 单张席位格(96×38 双行八项格)。self=自机格(金描边+左金条+金渐变,纯展示)。
 *  #701 交互接线:onOpenPop=格面 tap(非按钮区)开单人格弹层;onOpenDetail=格上
 *  图标直达四明细(城池走 cityLedger 原通路)。 */
function SeatCell({
  p,
  seat,
  self,
  active,
  winner,
  target,
  cityLedger,
  onOpenPop,
  onOpenDetail,
}: {
  p: SnapshotPlayer;
  seat: number;
  self: boolean;
  active: boolean;
  winner: boolean;
  target?: SeatTargetSlot;
  cityLedger: CityLedgerWiring;
  onOpenPop: (seat: number) => void;
  onOpenDetail: (seat: number, kind: SeatDetailKind) => void;
}) {
  // 手牌浮签恒纯「暗置」口径(#575:窥探即时一次性,窥见放行随 jinnangPeeks 账本退役)
  const handTip: TipText = {
    name: ATTR_TIPS.hand.name,
    detail: `${ATTR_TIPS.hand.detail}(以牌背示意,数量为准)`,
  };
  // 变化浮标(#495,全员含自机):首帧只立基准不浮,跨快照跳变才出标。浮标挂行内
  // relative 容器(带 testid 的数值本体保持纯文本,e2e textContent 断言不受浮标串扰)。
  const cashFloats = useDeltaFloat(p.cash);
  const staminaFloats = useDeltaFloat(p.stamina);
  return (
    <div
      data-testid={self ? TESTIDS.seatSelf : TESTIDS.seat(seat)}
      onClick={() => onOpenPop(seat)}
      className={
        "seat" +
        (self ? " self" : "") +
        (active ? " active" : "") +
        (winner ? " won" : "") +
        (p.isBankrupt ? " bankrupt" : "") +
        (target?.available ? " candidate" : "") +
        (target?.selected ? " picked" : "")
      }
      style={{ ["--pc" as string]: rgba(playerColor(p.colorIndex)) }}
    >
      {/* 格面 tap(#701)=单人格弹层:格根接点击;七个按钮(六图标+体力条)经
          Claim 壳止泡各走己路,目标层按钮自带止泡——落到这里的只剩非按钮区 */}
      {/* 行1:国号印(座位色) + 现金主数 + 体力色条 */}
      <div className="l1">
        <span className="pseal">{p.guohao.charAt(0)}</span>
        {/* 现金主数:无千分位省「两」(格上口径);千分位全称在单人格弹层。
            testid 挂内层纯数 span,浮标在外层 relative 容器——textContent 不受串扰 */}
        <span className="cash relative">
          <span data-testid={TESTIDS.seatCash(seat)}>{p.cash}</span>
          <DeltaFloats
            floats={cashFloats}
            fmt={(d) => (d > 0 ? "+" : "−") + formatMoney(Math.abs(d))}
          />
        </span>
        <Claim>
          <Tip tip={ATTR_TIPS.stamina} testId={TESTIDS.seatStamina(seat)} className="strack-tip">
            <span className={"strack" + (p.stamina < STAMINA_LOW ? " low" : "")}>
              <i style={{ width: `${p.stamina}%` }} />
            </span>
          </Tip>
        </Claim>
        <DeltaFloats
          floats={staminaFloats}
          fmt={(d) => (d > 0 ? "+" : "−") + String(Math.abs(d))}
        />
      </div>
      {/* 行2:城楼/牌背/战盔/玉璧/墨竹/卷轴六图标计数,space-between 均分。
          #701 直达:战盔/玉璧/墨竹/卷轴轻点开明细弹层,城楼走 #622 清单(原样),
          牌背=暗牌不可点(ADR-0016,浮签照旧);六图标全部 Claim 止泡,不夺格 tap。 */}
      <div className="l2">
        <Claim>
          <Tip
            tip={ATTR_TIPS.city}
            className="ai ai-city"
            testId={TESTIDS.seatAttr(seat, "city")}
            ariaLabel={`城池 ${p.properties.length}`}
            onTap={() => cityLedger.onOpen(seat)}
            ariaExpanded={cityLedger.openSeat === seat}
          >
            <AttrIcon kind="city" size={9} />
            {p.properties.length}
          </Tip>
        </Claim>
        <Claim>
          <Tip
            tip={handTip}
            className="ai ai-hand"
            testId={TESTIDS.seatAttr(seat, "hand")}
            ariaLabel={`锦囊手牌 ${p.jinnangHandCount}`}
          >
            <MiniBacks count={p.jinnangHandCount} />
            {p.jinnangHandCount}
          </Tip>
        </Claim>
        <Claim>
          <Tip
            tip={ATTR_TIPS.hero}
            className="ai ai-hero"
            testId={TESTIDS.seatAttr(seat, "hero")}
            ariaLabel={`名将 ${p.heroes.length}`}
            onTap={() => onOpenDetail(seat, "hero")}
          >
            <AttrIcon kind="hero" size={9} />
            {p.heroes.length}
          </Tip>
        </Claim>
        <Claim>
          <Tip
            tip={ATTR_TIPS.gem}
            className="ai ai-gem"
            testId={TESTIDS.seatAttr(seat, "gem")}
            ariaLabel={`珍宝 ${p.treasures.length}`}
            onTap={() => onOpenDetail(seat, "gem")}
          >
            <AttrIcon kind="gem" size={9} />
            {p.treasures.length}
          </Tip>
        </Claim>
        <Claim>
          <Tip
            tip={ATTR_TIPS.rep}
            /* 负声望警示(#556):值 <0 值色改朱砂(数值即信息,色变即状态,§4.6
               不加标牌);样式 layout.css .ai.ai-rep.rep-neg。 */
            className={"ai ai-rep" + (p.reputation < 0 ? " rep-neg" : "")}
            testId={TESTIDS.seatAttr(seat, "rep")}
            ariaLabel={`声望 ${p.reputation}`}
            onTap={() => onOpenDetail(seat, "rep")}
          >
            <AttrIcon kind="rep" size={9} />
            {p.reputation}
          </Tip>
        </Claim>
        <Claim>
          <Tip
            tip={ATTR_TIPS.warrant}
            className="ai ai-warrant"
            testId={TESTIDS.seatAttr(seat, "warrant")}
            ariaLabel={`委任状 ${p.warrants}`}
            onTap={() => onOpenDetail(seat, "warrant")}
          >
            <AttrIcon kind="warrant" size={9} />
            {p.warrants}
          </Tip>
        </Claim>
      </div>
      {/* 目标段点击层(#256/#417):真按钮覆盖格面(键盘可达,不自写交互语义);
          点格=选中/再点取消(选中实金停持 .picked,样式 seat-target.css),打出走
          动作条「出」确认钮。格本体仍是展示件,候选态=金圈呼吸(.candidate)。 */}
      {target && (
        <button
          type="button"
          data-testid={TESTIDS.seatTarget(seat)}
          className={"seat-target" + (target.selected ? " picked" : "")}
          disabled={!target.available}
          aria-pressed={target.available ? Boolean(target.selected) : undefined}
          aria-label={
            target.available
              ? `指定 ${p.guohao || p.name} 为目标`
              : `不可指定:${target.reason ?? ""}`
          }
          title={target.available ? undefined : target.reason}
          onClick={(e) => {
            e.stopPropagation(); // 目标段点击不冒泡进格 tap 弹层通路(#701)
            target.onPick();
          }}
        />
      )}
    </div>
  );
}

/** 席位格列:全员一人一格(自机入列,座序即列序;观战 selfSeat<0 无自机格)。
 *  整列随快照声明式重渲;唯一的组件内状态是对手格的现金/体力浮标(#495,useDeltaFloat
 *  自持,随格挂载随值自清)。旧三槽位切分(右 3+左 3+顶行缩微)随席位卡形态退役
 *  ——满编 8 席在列高自适应下零滚动(拍板口径,layout.css)。targets(#256/#417
 *  目标段):出牌阶段指向性牌的候选席位(键=座位号),在场时候选格金圈呼吸、点格=
 *  选中/再点同格取消(打出归动作条「出」确认钮,GameScreen 从快照 choices 派生,
 *  本件只呈现)。selfSeat(#453 收口契约):「屏前真人的自我身份」——单机热座恒 0、
 *  联机=本座,勿传「决策视角」viewSeat(热座下随 decisionOwner 轮转)。 */
export interface SeatRailProps {
  snapshot: GameSnapshot;
  selfSeat: number;
  targets?: {
    bySeat: Map<number, { available: boolean; selected?: boolean; reason?: string }>;
    onPick: (seat: number) => void;
  };
  /** 名下城池清单(#622):城池徽章轻点开弹层,开合态归消费方(GameScreen 持态)。 */
  cityLedger: CityLedgerWiring;
}

export function SeatRail({ snapshot, selfSeat, targets, cityLedger }: SeatRailProps) {
  // 单人格弹层/明细弹层开合态(#701):归席位列子树自洽(不进 GameScreen 装配)。
  // 开合态持座位号不持玩家对象——弹层开着随快照实时重渲(CityLedgerModal 同口径);
  // 钻入=关单人格层开明细,居中模态单层互斥。
  const [popSeat, setPopSeat] = useState<number | null>(null);
  const [detail, setDetail] = useState<{
    kind: SeatDetailKind;
    seat: number;
  } | null>(null);
  const openPop = (seat: number) => setPopSeat(seat);
  const openDetail = (seat: number, kind: SeatDetailKind) => {
    setPopSeat(null);
    setDetail({ kind, seat });
  };

  const targetSlot = (seat: number): SeatTargetSlot | undefined => {
    const t = targets?.bySeat.get(seat);
    if (!t || !targets) return undefined;
    return {
      available: t.available,
      selected: t.selected,
      reason: t.reason,
      onPick: () => targets.onPick(seat),
    };
  };

  return (
    <div data-testid={TESTIDS.seatRail} aria-label="诸侯席位" className="seat-rail">
      <div className="seatcol">
        {snapshot.players.map((p, seat) => (
          <SeatCell
            key={p.id}
            p={p}
            seat={seat}
            self={seat === selfSeat}
            active={snapshot.phase === "Playing" && seat === snapshot.activeIndex}
            winner={Boolean(snapshot.isOver && snapshot.winner === p.id)}
            target={targetSlot(seat)}
            cityLedger={cityLedger}
            onOpenPop={openPop}
            onOpenDetail={openDetail}
          />
        ))}
      </div>
      {/* 单人格弹层(#701):tap 格开,点外/Esc 关;自机格带托管开关行(SeatPopModal 内
          门卫)。popSeat 只由席位格点击写入,恒为有效座号,players 直取不设兜底。 */}
      {popSeat != null && (
        <SeatPopModal
          p={snapshot.players[popSeat]}
          seat={popSeat}
          self={popSeat === selfSeat}
          cityLedger={cityLedger}
          onOpenDetail={openDetail}
          onClose={() => setPopSeat(null)}
        />
      )}
      {/* 明细弹层族(#701):格上战盔/玉璧/墨竹/卷轴与弹层名将徽章钻入的单层出口 */}
      {detail != null && (
        <SeatDetailModal
          kind={detail.kind}
          p={snapshot.players[detail.seat]}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
