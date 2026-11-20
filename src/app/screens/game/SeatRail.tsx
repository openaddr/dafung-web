// 席位格列(#698 席位条重形:96×38 双行八项格,旧席位竖卡+仪表徽章行整体退役):
// 右缘单列一人一格(自机入列),原型席位侧列(临时件已佚)
// ①全屏语境/②席位格解剖/③状态一览 三节判决移植——行1=国号印(座位色,字符居中)
// +托管微标(#770,托管中才有)+现金主数(无千分位省「两」)+体力色条(吃行1剩余
// 宽度,濒耗竭转朱砂);行2=汉字五账式(#1128):「城/牌/将/宝/望」汉字当标识
// (题字字体,纸色退后一档)+tabular 计数,单色淡纸——旧五枚彩色 SVG 图标
// (城楼/牌背组/战盔/玉璧/墨竹)整线退役:9-10px 下战盔糊团、玉璧环与数字 0
// 同形、4×6 牌背近隐形「城1 牌9+」连读成「19+」(844×390 实拍实锤);彩色图标
// 制整线退役(末代放大场消费方诸侯详情/牌架相继改道,AttrIcon 件 2026-11-07
// 废弃文件清扫批删除)。发丝线组分隔(#770)保留,预算判据见 layout.css .l2。
// 国号印旁的三角标指示回合方，席位格边框和勾表达目标状态。
// 自机用左金条，出局降透明度；托管由国号印右侧齿轮标识。
// 列几何(拍板口径):列宽 96 固定、格间距 2px、列 y8 起排;格高=clamp(30,(可用高−14)/8,38),
// 可用高=视口高−顶距 8−钮区 54(#700 右下三圆钮上缘;落地前该 54px 仅作格高预算),
// 矮横屏 390/375/320 三档高全部零滚动——式样落 layout.css,组件零断点分支。
// 无席位目标段时，点任一席位格打开同一份诸侯详情；托管开关在设置内。
// 选席时点候选格选中或取消，点不可选格在动作条显示原因。
// 变化反馈(#495):全员现金/体力浮标(useDeltaFloat/DeltaFloats 共享单源),自机格
// 同锚现金主数/体力条——仪表条已随 #700 退役,自机跳变反馈归席位格(评审 #697 收口;
// 旧「#700 前双挂浮两遍」随仪表条本体不复存在)。
import { memo } from "react";
import { Button } from "@base-ui/react/button";
import { formatMoney } from "@core/money";
import { skillMarksOf } from "@core/roster";
import { isTriggerSkill, skillById } from "@core/skills";
import { playerColor, playerSealText, rgba } from "@core/theme";
import { useStablePlayers, type GameSnapshot, type SnapshotPlayer } from "@app/store/gameStore";
import { useAutopilotOn, useNetStore } from "@app/store/netStore";
import { getController } from "@app/controllers/registry";
import { useDeltaFloat, DeltaFloats } from "./useDeltaFloat";
import { ATTR_TIPS } from "./Tip";
import { TESTIDS } from "./testids";
import "./layout.css";
import "./seat-target.css";

/** 体力色条转朱砂的濒耗竭线(原 SeatPopModal 单源迁本件,#1097 弹层退役;
 *  格上血条与诸侯详情体力条同规)。 */
export const STAMINA_LOW = 30;

/** 放逐标记阈值(#1378)读技表单源(core/skills fangzhu params;技表数据 bug
 *  当场炸出,不兜底)。 */
const FANGZHU_THRESHOLD = (() => {
  const def = skillById("fangzhu");
  if (!isTriggerSkill(def)) throw new Error("放逐标记:技表 fangzhu 非被动技(数据 bug)");
  return def.params!.threshold;
})();

/** 放逐标记进度(#1378):麾下槽位技能标记容器读 fangzhu 计数(读口单源
 *  roster.skillMarksOf,未启技=0 规范缺省);无标记=不挂(攒怒中才在场)。
 *  ready=标记已达阈值(待决窗问挂起中),呈现档位供样式呼吸。 */
function fangzhuMarkOf(p: SnapshotPlayer): { mark: number; ready: boolean } | null {
  let mark = 0;
  for (const slot of p.heroes) mark = Math.max(mark, skillMarksOf(slot, "fangzhu"));
  if (mark <= 0) return null;
  return { mark, ready: mark >= FANGZHU_THRESHOLD };
}

/** 目标状态与回合、身份可叠加。已定首选可同时是已选和当前步骤不可选。 */
interface SeatTargetState {
  available: boolean;
  selected: boolean;
  reason?: string;
}

interface SeatTargetSlot extends SeatTargetState {
  locked?: boolean;
  onPick: (seat: number) => void;
  onUnavailable: (seat: number, reason: string) => void;
}

/** 手牌计数封顶(#743 判词 A/#751 C 批):行 2 内宽预算容不下两位数——≥10 显示
 *  「9+」(示意口径,数值例外条款允许,非文字角标);负声望保留真实负值不在
 *  封顶族。 */
const HAND_COUNT_CAP = 9;
const handCountText = (count: number): string =>
  count > HAND_COUNT_CAP ? `${HAND_COUNT_CAP}+` : String(count);

/** SeatCell 值等(#1140 渲染税,Tile #1023 链 A 同族):p 引用由 SeatRail 的
 *  useStablePlayers 保证「内容不变即引用不变」;target 槽对象每渲染重建,按字段比
 *  目标段换步或在途锁变化时，同步更新点击处理。 */
function seatCellEqual(
  a: {
    p: SnapshotPlayer;
    seat: number;
    self: boolean;
    active: boolean;
    winner: boolean;
    hosted: boolean;
    target?: SeatTargetSlot;
    onOpenOverview?: () => void;
  },
  b: {
    p: SnapshotPlayer;
    seat: number;
    self: boolean;
    active: boolean;
    winner: boolean;
    hosted: boolean;
    target?: SeatTargetSlot;
    onOpenOverview?: () => void;
  },
): boolean {
  return (
    a.p === b.p &&
    a.seat === b.seat &&
    a.self === b.self &&
    a.active === b.active &&
    a.winner === b.winner &&
    a.hosted === b.hosted &&
    a.onOpenOverview === b.onOpenOverview &&
    a.target?.available === b.target?.available &&
    a.target?.selected === b.target?.selected &&
    a.target?.reason === b.target?.reason &&
    a.target?.locked === b.target?.locked &&
    a.target?.onPick === b.target?.onPick &&
    a.target?.onUnavailable === b.target?.onUnavailable
  );
}

/** 单张席位格。目标段选席时优先处理目标，其余时间作为诸侯详情入口。 */
const SeatCell = memo(function SeatCell({
  p,
  seat,
  self,
  active,
  winner,
  hosted,
  target,
  onOpenOverview,
}: {
  p: SnapshotPlayer;
  seat: number;
  self: boolean;
  active: boolean;
  winner: boolean;
  hosted: boolean;
  target?: SeatTargetSlot;
  onOpenOverview?: () => void;
}) {
  const seatLabel = active ? `${p.guohao} · 当前回合` : p.guohao;
  if (target?.available === false && target.reason == null)
    throw new Error(`席位 ${seatLabel} 不可选，但缺少原因`);
  // 放逐标记进度(#1378):攒怒中(标记>0)挂席位格底缘金色进度轨,满档呼吸;
  // 状态表达 §4.6(进度即状态,不落文字标牌;数值与名词在 aria-label)。
  const skillMark = fangzhuMarkOf(p);
  // 变化浮标(#495,全员含自机):首帧只立基准不浮,跨快照跳变才出标。浮标挂行内
  // relative 容器(带 testid 的数值本体保持纯文本,e2e textContent 断言不受浮标串扰)。
  const cashFloats = useDeltaFloat(p.cash);
  const staminaFloats = useDeltaFloat(p.stamina);
  return (
    <div
      data-testid={self ? TESTIDS.seatSelf : TESTIDS.seat(seat)}
      className={
        "seat" +
        (self ? " self" : "") +
        (active ? " active" : "") +
        (winner ? " won" : "") +
        (p.isBankrupt ? " bankrupt" : "") +
        (target?.available ? " candidate" : "") +
        (target?.selected ? " picked" : "") +
        (target && !target.available && !target.selected ? " unavailable" : "")
      }
      style={{
        ["--pc" as string]: rgba(playerColor(p.colorIndex)),
        ["--pc-seal" as string]: rgba(playerSealText(p.colorIndex)),
      }}
    >
      {/* 行1:国号印(座位色) + 托管微标(#770,托管中才有) + 现金主数 + 体力色条 */}
      <div className="l1">
        <span className="pseal">{p.guohao.charAt(0)}</span>
        {/* 托管常驻微标(#770):AI 代打是持续状态,齿轮=代打隐喻(§4.6 撤文字
            可辨,role=img 补读屏名;视觉不加文字)。纯展示,开关在设置弹层。 */}
        {hosted && (
          <span
            className="hosted"
            data-testid={TESTIDS.seatHosted(seat)}
            role="img"
            aria-label="托管中"
          >
            {/* 齿轮 8×8:中环+八向齿(Sym settings 同族微缩,方 viewBox 内联) */}
            <svg viewBox="0 0 16 16" width={8} height={8} aria-hidden="true" focusable="false">
              <g stroke="currentColor" strokeWidth={1.8} fill="none" strokeLinecap="round">
                <circle cx="8" cy="8" r="2.6" />
                <path d="M8 1.6 V3.6 M8 12.4 V14.4 M1.6 8 H3.6 M12.4 8 H14.4 M3.5 3.5 L4.9 4.9 M11.1 11.1 L12.5 12.5 M12.5 3.5 L11.1 4.9 M4.9 11.1 L3.5 12.5" />
              </g>
            </svg>
          </span>
        )}
        {/* 现金主数:无千分位省「两」(格上口径)。testid 挂内层纯数 span,浮标在
            外层 relative 容器——textContent 不受串扰 */}
        <span className="cash relative">
          <span data-testid={TESTIDS.seatCash(seat)}>{p.cash}</span>
          <DeltaFloats
            floats={cashFloats}
            fmt={(d) => (d > 0 ? "+" : "−") + formatMoney(Math.abs(d))}
          />
        </span>
        {/* 体力色条(纯展示,濒耗竭转朱砂):数值不入格(#698 口径),名词在
            aria-label(原浮签触发元退化为 span,e2e 的 aria-label 契约不变)。 */}
        <span
          className="strack-tip relative"
          data-testid={TESTIDS.seatStamina(seat)}
          aria-label={ATTR_TIPS.stamina.name}
        >
          <span className={"strack" + (p.stamina < STAMINA_LOW ? " low" : "")}>
            <i style={{ width: `${p.stamina}%` }} />
          </span>
          <DeltaFloats
            floats={staminaFloats}
            fmt={(d) => (d > 0 ? "+" : "−") + String(Math.abs(d))}
          />
        </span>
      </div>
      {/* 行2 汉字五账式(#1128):「城/牌/将/宝/望」+ tabular 计数,单色淡纸;
          发丝线组分隔(#770)保留:高频读数(城/牌)|低频藏品(将/宝/望)。
          名词在 aria-label,testid 契约不变(e2e 零改);负声望整项朱砂(#556,
          样式 layout.css .ai.ai-rep.rep-neg)。 */}
      <div className="l2">
        <div className="l2hi">
          <span
            className="ai ai-city"
            data-testid={TESTIDS.seatAttr(seat, "city")}
            aria-label={`城池 ${p.properties.length}`}
          >
            <i className="ai-tag">城</i>
            {p.properties.length}
          </span>
          <span
            className="ai ai-hand"
            data-testid={TESTIDS.seatAttr(seat, "hand")}
            aria-label={`锦囊手牌 ${p.jinnangHandCount}`}
          >
            <i className="ai-tag">牌</i>
            {/* 封顶态(#743 判词 A):≥10 只出「9+」,五账式下与常规态同形 */}
            {handCountText(p.jinnangHandCount)}
          </span>
        </div>
        <span className="l2sep" aria-hidden="true" />
        <div className="l2lo">
          <span
            className="ai ai-hero"
            data-testid={TESTIDS.seatAttr(seat, "hero")}
            aria-label={`名将 ${p.heroes.length}`}
          >
            <i className="ai-tag">将</i>
            {p.heroes.length}
          </span>
          <span
            className="ai ai-gem"
            data-testid={TESTIDS.seatAttr(seat, "gem")}
            aria-label={`珍宝 ${p.treasures.length}`}
          >
            <i className="ai-tag">宝</i>
            {p.treasures.length}
          </span>
          <span
            className={"ai ai-rep" + (p.reputation < 0 ? " rep-neg" : "")}
            data-testid={TESTIDS.seatAttr(seat, "rep")}
            aria-label={`声望 ${p.reputation}`}
          >
            <i className="ai-tag">望</i>
            {p.reputation}
          </span>
        </div>
      </div>
      {/* 放逐标记进度(#1378):格底缘 2px 金色进度轨(攒怒中在场,满档呼吸),
          状态表达 §4.6——进度即状态,格上零文字标牌;数值与名词进 aria-label。
          阈值读技表单源(SeatRail 模块头 FANGZHU_THRESHOLD);超出阈值的部分随
          发动归零舍弃,进度封顶 100%。 */}
      {skillMark != null && (
        <span
          className={"skmark" + (skillMark.ready ? " ready" : "")}
          data-testid={TESTIDS.seatSkillMark(seat)}
          role="img"
          aria-label={`放逐 ${skillMark.mark}/${FANGZHU_THRESHOLD}`}
        >
          <i
            style={{
              width: `${Math.min(100, Math.round((skillMark.mark / FANGZHU_THRESHOLD) * 100))}%`,
            }}
          />
        </span>
      )}
      {onOpenOverview && (
        <Button
          type="button"
          data-testid={TESTIDS.seatOverview(seat)}
          className="seat-target"
          aria-haspopup="dialog"
          aria-label={`诸侯详情 · ${seatLabel}`}
          onClick={onOpenOverview}
        />
      )}
      {target && (
        <Button
          type="button"
          data-testid={TESTIDS.seatTarget(seat)}
          className="seat-target"
          disabled={target.locked}
          aria-pressed={target.available || target.selected ? target.selected : undefined}
          aria-label={
            target.available ? `指定 ${seatLabel} 为目标` : `查看 ${seatLabel} · ${target.reason}`
          }
          onClick={() => {
            if (target.available) target.onPick(seat);
            else target.onUnavailable(seat, target.reason!);
          }}
        />
      )}
    </div>
  );
}, seatCellEqual);

/** 全员按座序显示。selfSeat 是屏前身份，热座也独立于当前回合和决策视角。 */
interface SeatRailProps {
  snapshot: GameSnapshot;
  selfSeat: number;
  onOpenOverview: () => void;
  targets?: {
    bySeat: Map<number, SeatTargetState>;
    locked?: boolean;
    onPick: (seat: number) => void;
    onUnavailable: (seat: number, reason: string) => void;
  };
}

export function SeatRail({ snapshot, selfSeat, onOpenOverview, targets }: SeatRailProps) {
  // 席位行值等复用(#1140 渲染税):内容不变的席位元素引用稳定,SeatCell 的 memo
  // 不再被每拍新对象打穿——整列从「随快照声明式重渲」收窄到「变的席才重渲」。
  const players = useStablePlayers(snapshot.players);
  // 托管常驻微标(#770)每席位取值,与 useAutopilotOn 同一双源分式:
  // 联机 = 座位广播全席位回读(seat-projection autoPilot,ADR-0028 单一开关——
  // 大厅座位列表同源),本座走 selfHosted 同值;单机 = 控制器本地标记(热座唯一
  // 真人座=自机,bot 非托管恒 false)。seats 直取不设兜底:联机在座席查无 = 接线 bug。
  const controller = getController();
  const selfHosted = useAutopilotOn(controller);
  const netSeats = useNetStore((s) => (s.roomId !== "" ? s.seats : null));
  const hosted = (seat: number): boolean =>
    seat === selfSeat ? selfHosted : netSeats != null ? netSeats[seat].autoPilot : false;

  const targetSlot = (seat: number): SeatTargetSlot | undefined => {
    if (targets == null) return undefined;
    const t = targets.bySeat.get(seat);
    if (t == null) throw new Error(`选席时缺少席位 ${seat} 的状态`);
    return {
      ...t,
      locked: targets.locked,
      onPick: targets.onPick,
      onUnavailable: targets.onUnavailable,
    };
  };

  return (
    <div data-testid={TESTIDS.seatRail} aria-label="诸侯席位" className="seat-rail">
      <div className="seatcol">
        {players.map((p, seat) => (
          <SeatCell
            key={p.id}
            p={p}
            seat={seat}
            self={seat === selfSeat}
            active={snapshot.phase === "Playing" && seat === snapshot.activeIndex}
            winner={Boolean(snapshot.isOver && snapshot.winner === p.id)}
            hosted={hosted(seat)}
            target={targetSlot(seat)}
            onOpenOverview={targets == null ? onOpenOverview : undefined}
          />
        ))}
      </div>
    </div>
  );
}
