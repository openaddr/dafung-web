// 席位竖卡列(#253 三区骨架,原型 .seatcol/.seat 移植):对手一人一张竖卡
// (国号印+名 / 现金 / 体力血条 / 属性图标徽章两行制),右栏诸侯列表(OthersPanel)
// 退役后的去向。观战与自身不出卡;破产卡降透明+划名(原 OthersPanel 语义平移)。
// 纵列规则(拍板口径):1-3 对手右一列;4-6 右列 3 + 左列其余(槽位对称成对填充,
// 4 席票面未定义,按列容 3 就几何);7+ 余席顶行缩微(原型其五:右 3 + 左 3 + 顶中)。
// 活跃方=金圈光效+「运筹中」微标(DESIGN.md §4.6 例外保留项,仅此一处;操作不限时,
// 无回合倒计时条,2026-09-25 拍板)。终局胜者=席位卡金环(.won,DESIGN §4.6:撤掉
// 文字状态仍可辨则不加文字,无「胜」字章)。
// 目标段(#256/#417):出牌阶段指向性牌确认后,候选席位卡金圈呼吸(.candidate,
// 原型 .selglow 移植,无文字章)+ 点席位=选中(实金停持态 .picked,再点同席取消,
// #417 统一口径)+ 动作条「出」钮打出;棋盘 token 同步呼吸归 TokenLayer 挂点。
// 暗牌(联机他人手牌)只显牌背+计数(ADR-0016 投影口径);军情密探窥探目标在浮签里
// 追加窥见牌名(原 OthersPanel title 语义平移)。
// 变化反馈(#495):对手现金/体力挂 useDeltaFloat 浮标(与仪表条同款机制,正金负朱,
//  渲染件 DeltaFloats 共享单源)——大富翁最核心的「谁在变富」不再静默。
import { formatMoney } from "@core/money";
import { playerColor, rgba } from "@core/theme";
import type { GameSnapshot, SnapshotPlayer } from "@app/store/gameStore";
import { useDeltaFloat, DeltaFloats } from "./useDeltaFloat";
import { AttrIcon, MiniBacks } from "./AttrIcon";
import { ATTR_TIPS, Tip, type TipText } from "./Tip";
import { TESTIDS } from "./testids";
import "./layout.css";
import "./seat-target.css";

/** 体力血条转红的低体力线(原型图例口径「低于三成转红」)。 */
const STAMINA_LOW = 30;

interface Seated {
  p: SnapshotPlayer;
  seat: number;
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

/** 单张席位竖卡。mini = 顶行缩微形态(原型其五:缩为四格——现金+血条 | 城/手牌)。 */
function SeatCard({
  p,
  seat,
  active,
  winner,
  peekedHand,
  target,
  mini = false,
}: {
  p: SnapshotPlayer;
  seat: number;
  active: boolean;
  winner: boolean;
  peekedHand: string[];
  target?: SeatTargetSlot;
  mini?: boolean;
}) {
  const handTip: TipText =
    peekedHand.length > 0
      ? {
          name: ATTR_TIPS.hand.name,
          detail: `${ATTR_TIPS.hand.detail};窥见:${peekedHand.join("、")}`,
        }
      : { name: ATTR_TIPS.hand.name, detail: `${ATTR_TIPS.hand.detail}(以牌背示意,数量为准)` };
  // 变化浮标(#495):对手现金/体力与仪表条同款机制——首帧只立基准不浮,跨快照
  // 跳变才出标。浮标挂卡内 relative 容器(带 testid 的数值本体保持纯文本,e2e
  // textContent 断言不受浮标串扰)。
  const cashFloats = useDeltaFloat(p.cash);
  const staminaFloats = useDeltaFloat(p.stamina);
  const badges = (
    <>
      <Tip
        tip={ATTR_TIPS.city}
        className="ib c-city"
        testId={TESTIDS.seatAttr(seat, "city")}
        ariaLabel={`城池 ${p.properties.length}`}
      >
        <AttrIcon kind="city" />
        {p.properties.length}
      </Tip>
      <Tip
        tip={handTip}
        className="ib c-hand"
        testId={TESTIDS.seatAttr(seat, "hand")}
        ariaLabel={`锦囊手牌 ${p.jinnangHandCount}`}
      >
        <MiniBacks count={p.jinnangHandCount} />
        {p.jinnangHandCount}
      </Tip>
    </>
  );
  return (
    <div
      data-testid={TESTIDS.seat(seat)}
      className={
        "seat" +
        (active ? " active" : "") +
        (winner ? " won" : "") +
        (p.isBankrupt ? " bankrupt" : "") +
        (target?.available ? " candidate" : "") +
        (target?.selected ? " picked" : "")
      }
    >
      {active && <span className="think">运筹中</span>}
      <div className="vhead">
        {/* 国号印(#510 漆金环/双描边方案):玩家色经 --pc 注入印环,字走漆面金字
            (原「玩家色底+白字」印面 1.9-2.9 不可读,制式见 layout.css .guo-yin) */}
        <span className="guo-yin" style={{ ["--pc" as string]: rgba(playerColor(p.colorIndex)) }}>
          {p.guohao.charAt(0)}
        </span>
        <span className="nm">
          {p.guohao || p.name}
          {p.isBot ? " 智" : ""}
        </span>
      </div>
      {/* 现金(#495 挂浮标):relative 容器锚浮标;数值本体 span 保持 testid 纯文本 */}
      <div className="cash relative">
        <span data-testid={TESTIDS.seatCash(seat)}>{formatMoney(p.cash)}</span>
        <DeltaFloats
          floats={cashFloats}
          fmt={(d) => (d > 0 ? "+" : "−") + formatMoney(Math.abs(d))}
        />
      </div>
      {/* 体力血条(#495 挂浮标):浮标挂在 Tip 外的 relative 容器——血条本体
          overflow:hidden 会裁掉上浮标;容器保 flex(席位卡是 flex 列,Tip 触发元
          靠 flex item 拉满卡宽,普通 div 包裹会缩瘪)且触发元(含 testid)文本
          仍只有刻度数 */}
      <div className="relative flex">
        <Tip tip={ATTR_TIPS.stamina} testId={TESTIDS.seatStamina(seat)}>
          <span className={"hpbar" + (p.stamina < STAMINA_LOW ? " low" : "")}>
            <i style={{ width: `${p.stamina}%` }} />
            <em>{p.stamina}</em>
          </span>
        </Tip>
        <DeltaFloats
          floats={staminaFloats}
          fmt={(d) => (d > 0 ? "+" : "−") + String(Math.abs(d))}
        />
      </div>
      {mini ? (
        /* 缩微四格:城/手牌一行(现金+血条在上,复用常态卡结构) */
        <div className="vgrid">{badges}</div>
      ) : (
        <div className="vgrid">
          <Tip
            tip={ATTR_TIPS.warrant}
            className="ib c-warrant"
            testId={TESTIDS.seatAttr(seat, "warrant")}
            ariaLabel={`委任状 ${p.warrants}`}
          >
            <AttrIcon kind="warrant" />
            {p.warrants}
          </Tip>
          {badges}
          <Tip
            tip={ATTR_TIPS.rep}
            className="ib c-rep"
            testId={TESTIDS.seatAttr(seat, "rep")}
            ariaLabel={`声望 ${p.reputation}`}
          >
            <AttrIcon kind="rep" />
            {p.reputation}
          </Tip>
          <Tip
            tip={ATTR_TIPS.gem}
            className="ib c-gem"
            testId={TESTIDS.seatAttr(seat, "gem")}
            ariaLabel={`珍宝 ${p.treasures.length}`}
          >
            <AttrIcon kind="gem" />
            {p.treasures.length}
          </Tip>
          <Tip
            tip={ATTR_TIPS.hero}
            className="ib c-hero"
            testId={TESTIDS.seatAttr(seat, "hero")}
            ariaLabel={`名将 ${p.heroes.length}`}
          >
            <AttrIcon kind="hero" />
            {p.heroes.length}
          </Tip>
        </div>
      )}
      {/* 目标段点击层(#256/#417):真按钮覆盖卡面(键盘可达,不自写交互语义);
          点席位=选中/再点取消(选中实金停持 .picked,样式 seat-target.css),打出走
          动作条「出」确认钮。席位卡本体仍是展示件,候选态=金圈呼吸(.candidate)。 */}
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
          onClick={target.onPick}
        />
      )}
    </div>
  );
}

/** 席位竖卡列:槽位切分 + 渲染。整个列随快照声明式重渲;唯一的组件内状态是
 *  SeatCard 的现金/体力浮标(#495,useDeltaFloat 自持,随卡挂载随值自清)。
 *  槽位切分(文件头规则):列容 3;4-6 右列 3 + 左列其余;7+ 右 3 + 左 3 + 顶行缩微。
 *  selfSeat(#453 收口契约):本参数是「屏前真人的自我身份」——单机热座恒 0、联机=本座,
 *  勿传「决策视角」viewSeat(热座下随 decisionOwner 轮转):窥探放行(#122/T4,#453/B1
 *  教训——审计 #446 曾因 prop 名 viewSeat 误判绑定错位)与「自身不出卡」消费的都是
 *  稳定身份。targets(#256/#417 目标段):出牌阶段指向性牌的候选席位(键=座位号),
 *  在场时候选席金圈呼吸、点席位=选中/再点同席取消(打出归动作条「出」确认钮,
 *  GameScreen 从快照 choices 派生,本件只呈现)。 */
export interface SeatRailProps {
  snapshot: GameSnapshot;
  selfSeat: number;
  targets?: {
    bySeat: Map<number, { available: boolean; selected?: boolean; reason?: string }>;
    onPick: (seat: number) => void;
  };
}

export function SeatRail({ snapshot, selfSeat, targets }: SeatRailProps) {
  // 军情密探(#122/T4):本座位窥探中的对手——只有这些席位的手牌内容在浮签放行
  const peeking = new Set(
    snapshot.jinnangPeeks.filter((pk) => pk.viewer === selfSeat).map((pk) => pk.target),
  );
  const opponents: Seated[] = snapshot.players
    .map((p, seat) => ({ p, seat }))
    .filter(({ seat }) => seat !== selfSeat);
  const right = opponents.slice(0, 3);
  const left = opponents.slice(3, 6);
  const top = opponents.slice(6);

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

  // 单卡渲染单源(mini 参数收拢:常态列与顶行缩微同构,仅形态差异——评审去重前
  // 顶行分支整抄 renderCard)。
  const renderCard = ({ p, seat }: Seated, mini = false) => (
    <SeatCard
      key={p.id}
      p={p}
      seat={seat}
      active={snapshot.phase === "Playing" && seat === snapshot.activeIndex}
      winner={Boolean(snapshot.isOver && snapshot.winner === p.id)}
      peekedHand={peeking.has(seat) ? p.jinnangHand : []}
      target={targetSlot(seat)}
      mini={mini}
    />
  );

  return (
    <div data-testid={TESTIDS.seatRail} aria-label="诸侯席位" className="seat-rail">
      <div className="seatcol">{right.map((s) => renderCard(s))}</div>
      {left.length > 0 && <div className="seatcol left">{left.map((s) => renderCard(s))}</div>}
      {top.length > 0 && <div className="seatrow-top">{top.map((s) => renderCard(s, true))}</div>}
    </div>
  );
}
