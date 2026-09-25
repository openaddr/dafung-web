// 席位竖卡列(#253 三区骨架,原型 .seatcol/.seat 移植):对手一人一张竖卡
// (国号印+名 / 现金 / 体力血条 / 属性图标徽章两行制),右栏诸侯列表(OthersPanel)
// 退役后的去向。观战与自身不出卡;破产卡降透明+划名(原 OthersPanel 语义平移)。
// 纵列规则(拍板口径):1-3 对手右一列;4-6 右列 3 + 左列其余(槽位对称成对填充,
// 4 席票面未定义,按列容 3 就几何);7+ 余席顶行缩微(原型其五:右 3 + 左 3 + 顶中)。
// 活跃方=金圈光效+倒计时条+「运筹中」微标(DESIGN.md §4.6 例外保留项,仅此一处)。
// 暗牌(联机他人手牌)只显牌背+计数(ADR-0016 投影口径);军情密探窥探目标在
// 浮签里追加窥见牌名(原 OthersPanel title 语义平移)。
import { formatMoney } from "@core/money";
import { playerColor, rgba } from "@core/theme";
import type { GameSnapshot, SnapshotPlayer } from "@app/store/gameStore";
import { AttrIcon, MiniBacks } from "./AttrIcon";
import { ATTR_TIPS, Tip } from "./Tip";
import { TESTIDS } from "./testids";
import "./layout.css";

/** 体力血条转红的低体力线(原型图例口径「低于三成转红」)。 */
const STAMINA_LOW = 30;

interface Seated {
  p: SnapshotPlayer;
  seat: number;
}

/** 单张席位竖卡。mini = 顶行缩微形态(原型其五:缩为四格——现金+血条 | 城/手牌)。 */
function SeatCard({
  p,
  seat,
  active,
  winner,
  peekedHand,
  mini = false,
}: {
  p: SnapshotPlayer;
  seat: number;
  active: boolean;
  winner: boolean;
  peekedHand: string[];
  mini?: boolean;
}) {
  const handTip =
    peekedHand.length > 0
      ? `${ATTR_TIPS.hand};窥见:${peekedHand.join("、")}`
      : `${ATTR_TIPS.hand}(以牌背示意,数量为准)`;
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
      className={"seat" + (active ? " active" : "") + (p.isBankrupt ? " bankrupt" : "")}
    >
      {active && <span className="think">运筹中</span>}
      <div className="vhead">
        <span className="guo-yin" style={{ background: rgba(playerColor(p.colorIndex)) }}>
          {p.guohao.charAt(0)}
        </span>
        <span className="nm">
          {p.guohao || p.name}
          {p.isBot ? " 智" : ""}
          {winner && (
            <span className="win-mark"> 胜</span>
          )}
        </span>
      </div>
      <div className="cash" data-testid={TESTIDS.seatCash(seat)}>
        {formatMoney(p.cash)}
      </div>
      <Tip tip={ATTR_TIPS.stamina} testId={TESTIDS.seatStamina(seat)}>
        <span className={"hpbar" + (p.stamina < STAMINA_LOW ? " low" : "")}>
          <i style={{ width: `${p.stamina}%` }} />
          <em>{p.stamina}</em>
        </span>
      </Tip>
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
      {active && <span className="timerbar" aria-hidden="true" />}
    </div>
  );
}

/** 席位竖卡列:槽位切分 + 渲染。整个列随快照声明式重渲,无本地状态。
 *  槽位切分(文件头规则):列容 3;4-6 右列 3 + 左列其余;7+ 右 3 + 左 3 + 顶行缩微。 */
export function SeatRail({ snapshot, viewSeat }: { snapshot: GameSnapshot; viewSeat: number }) {
  // 军情密探(#122/T4):本座位窥探中的对手——只有这些席位的手牌内容在浮签放行
  const peeking = new Set(
    (snapshot.jinnangPeeks ?? []).filter((pk) => pk.viewer === viewSeat).map((pk) => pk.target),
  );
  const opponents: Seated[] = snapshot.players
    .map((p, seat) => ({ p, seat }))
    .filter(({ seat }) => seat !== viewSeat);
  const right = opponents.slice(0, 3);
  const left = opponents.slice(3, 6);
  const top = opponents.slice(6);

  const renderCard = ({ p, seat }: Seated) => (
    <SeatCard
      key={p.id}
      p={p}
      seat={seat}
      active={snapshot.phase === "Playing" && seat === snapshot.activeIndex}
      winner={Boolean(snapshot.isOver && snapshot.winner === p.id)}
      peekedHand={peeking.has(seat) ? p.jinnangHand : []}
    />
  );

  return (
    <div data-testid={TESTIDS.seatRail} aria-label="诸侯席位" className="seat-rail">
      <div className="seatcol">{right.map(renderCard)}</div>
      {left.length > 0 && <div className="seatcol left">{left.map(renderCard)}</div>}
      {top.length > 0 && (
        <div className="seatrow-top">{top.map(({ p, seat }) => (
          <SeatCard
            key={p.id}
            p={p}
            seat={seat}
            active={snapshot.phase === "Playing" && seat === snapshot.activeIndex}
            winner={Boolean(snapshot.isOver && snapshot.winner === p.id)}
            peekedHand={peeking.has(seat) ? p.jinnangHand : []}
            mini
          />
        ))}</div>
      )}
    </div>
  );
}
