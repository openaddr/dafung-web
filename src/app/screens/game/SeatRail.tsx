// 席位竖卡列(#253 三区骨架,原型 .seatcol/.seat 移植):对手一人一张竖卡
// (国号印+名 / 现金 / 体力血条 / 属性图标徽章两行制),右栏诸侯列表(OthersPanel)
// 退役后的去向。观战与自身不出卡;破产卡降透明+划名(原 OthersPanel 语义平移)。
// 纵列规则(拍板口径):1-3 对手右一列;4-6 右列 3 + 左列其余(槽位对称成对填充,
// 4 席票面未定义,按列容 3 就几何);7+ 余席顶行缩微(原型其五:右 3 + 左 3 + 顶中)。
// 活跃方=金圈光效+「运筹中」微标(DESIGN.md §4.6 例外保留项,仅此一处;操作不限时,
// 无回合倒计时条,2026-09-25 拍板)。终局胜者=席位卡金环(.won,DESIGN §4.6:撤掉
// 文字状态仍可辨则不加文字,无「胜」字章)。
// 目标段(#256):军师窗指向性牌确认后,候选席位卡金圈呼吸(.candidate/.seat-target,
// 原型 .selglow 移植,无文字章)+ 点席位即出(免二次确认);棋盘 token 同步呼吸归
// TokenLayer 挂点。暗牌(联机他人手牌)只显牌背+计数(ADR-0016 投影口径);军情密探
// 窥探目标在浮签里追加窥见牌名(原 OthersPanel title 语义平移)。
import { formatMoney } from "@core/money";
import { playerColor, rgba } from "@core/theme";
import type { GameSnapshot, SnapshotPlayer } from "@app/store/gameStore";
import { AttrIcon, MiniBacks } from "./AttrIcon";
import { ATTR_TIPS, Tip, type TipText } from "./Tip";
import { TESTIDS } from "./testids";
import "./layout.css";

/** 体力血条转红的低体力线(原型图例口径「低于三成转红」)。 */
const STAMINA_LOW = 30;

interface Seated {
  p: SnapshotPlayer;
  seat: number;
}

/** 目标段(#256)单席点击槽:available=候选(金圈呼吸,可点即出);
 *  不可用席位照列不动,reason 进浮签(title,DESIGN §4.6 禁文字章)。 */
export interface SeatTargetSlot {
  available: boolean;
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
        (target?.available ? " candidate" : "")
      }
    >
      {active && <span className="think">运筹中</span>}
      <div className="vhead">
        <span className="guo-yin" style={{ background: rgba(playerColor(p.colorIndex)) }}>
          {p.guohao.charAt(0)}
        </span>
        <span className="nm">
          {p.guohao || p.name}
          {p.isBot ? " 智" : ""}
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
      {/* 目标段点击层(#256):真按钮覆盖卡面(键盘可达,不自写交互语义);点席位即出,
          免二次确认。席位卡本体仍是展示件,候选态=金圈呼吸(.candidate,layout.css)。 */}
      {target && (
        <button
          type="button"
          data-testid={TESTIDS.seatTarget(seat)}
          className="seat-target"
          disabled={!target.available}
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

/** 席位竖卡列:槽位切分 + 渲染。整个列随快照声明式重渲,无本地状态。
 *  槽位切分(文件头规则):列容 3;4-6 右列 3 + 左列其余;7+ 右 3 + 左 3 + 顶行缩微。
 *  targets(#256 目标段):军师窗指向性牌的候选席位(键=座位号),在场时候选席
 *  金圈呼吸、点席位即出;GameScreen 从快照 choices 派生,本件只呈现。 */
export interface SeatRailProps {
  snapshot: GameSnapshot;
  viewSeat: number;
  targets?: {
    bySeat: Map<number, { available: boolean; reason?: string }>;
    onPick: (seat: number) => void;
  };
}

export function SeatRail({ snapshot, viewSeat, targets }: SeatRailProps) {
  // 军情密探(#122/T4):本座位窥探中的对手——只有这些席位的手牌内容在浮签放行
  const peeking = new Set(
    snapshot.jinnangPeeks.filter((pk) => pk.viewer === viewSeat).map((pk) => pk.target),
  );
  const opponents: Seated[] = snapshot.players
    .map((p, seat) => ({ p, seat }))
    .filter(({ seat }) => seat !== viewSeat);
  const right = opponents.slice(0, 3);
  const left = opponents.slice(3, 6);
  const top = opponents.slice(6);

  const targetSlot = (seat: number): SeatTargetSlot | undefined => {
    const t = targets?.bySeat.get(seat);
    if (!t || !targets) return undefined;
    return { available: t.available, reason: t.reason, onPick: () => targets.onPick(seat) };
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
