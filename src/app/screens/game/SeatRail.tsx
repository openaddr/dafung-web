// 席位格列(#698 席位条重形:96×38 双行八项格,旧席位竖卡+仪表徽章行整体退役):
// 右缘单列一人一格(自机入列),原型 tmp/席位侧列原型.html
// ①全屏语境/②席位格解剖/③状态一览 三节判决移植——行1=国号印(座位色,字符居中)
// +托管微标(#770,托管中才有)+现金主数(无千分位省「两」)+体力色条(吃行1剩余
// 宽度,濒耗竭转朱砂);行2=#770 分组制:高频组「城楼+牌背」(图标 10px/计数 11px)
// +发丝线组分隔+低频组「战盔/玉璧/墨竹」三项(8px/10px 旧规格)——旧六项
// 等权 space-between 均分退役(#751 C 批容量重排后内宽恒贴边,分组给组界结构;
// 全宽出血预算判据见 layout.css .l2,量测口径:10px tabular 数字 6px/11px 6.6)。
// 图标逐路径复刻 AttrIcon.tsx 现役资产(战盔/玉璧走 ATTR_ENTRY_D,牌背=MiniBacks),
// 零新画。
// 状态全视觉不用文字(DESIGN §4.6):活跃=金圈呼吸(.active)、目标候选=金圈呼吸
// (.candidate)+选中实金停持(.picked,#417 统一口径)、破产=降透明印灰(.bankrupt)、
// 终局胜者=金环(.won)、自机=金描边+左金条+金渐变(.self,无「你」字)、托管(AI
// 代打)开启=国号印右 8px 齿轮微标(.hosted,#770,取值与 useAutopilotOn 同源:
// 联机=座位广播逐席 autoPilot、单机=控制器本地标记;开关交互唯设置弹层,ADR-0028)
// ——旧「自身不出卡」规则与「运筹中」文字微标随席位卡形态一并退役(活跃金圈呼吸
// 即指名)。
// 列几何(拍板口径):列宽 96 固定、格间距 2px、列 y8 起排;格高=clamp(30,(可用高−14)/8,38),
// 可用高=视口高−顶距 8−钮区 54(#700 右下三圆钮上缘;落地前该 54px 仅作格高预算),
// 矮横屏 390/375/320 三档高全部零滚动——式样落 layout.css,组件零断点分支。
// 纯展示(#1096 决议1,工单 #1097):旧 #701 交互通路整体退役——格面 tap 单人格
// 弹层(SeatPopModal 已删)、五图标直达(城楼/战盔/玉璧/墨竹)、长按浮签(Tip)
// 一并拆除;查档收编诸侯详情四钻入(城池 chips/名将 chips/珍宝槽/声列,GameTopBar
// 持开合态),托管开关收编设置弹层 settingsAutopilot(同一 ADR-0028 引擎通路)。
// 格上保留的只有展示面:金圈呼吸/齿轮微标/双行数字/跳变浮字(fx 面非交互)。
// 目标段点击层(#256/#417)不受影响:点格=选中/再点同席取消,打出走动作条「出」;
// 不可选席点按=格身轻晃(§4.6 位移即状态;不可指定原因读 aria-label——旧「弹层
// reason 印条」通路随单人格弹层退役)。自机候选面:自机格目标段随 targets 在场
// (自选目标 any 域,候选即自机格点击层;react-self-target 同款)。
// 变化反馈(#495):全员现金/体力浮标(useDeltaFloat/DeltaFloats 共享单源),自机格
// 同锚现金主数/体力条——仪表条已随 #700 退役,自机跳变反馈归席位格(评审 #697 收口;
// 旧「#700 前双挂浮两遍」随仪表条本体不复存在)。
import { useState } from "react";
import { formatMoney } from "@core/money";
import { playerColor, playerSealText, rgba } from "@core/theme";
import type { GameSnapshot, SnapshotPlayer } from "@app/store/gameStore";
import { useAutopilotOn, useNetStore } from "@app/store/netStore";
import { getController } from "@app/controllers/registry";
import { useDeltaFloat, DeltaFloats } from "./useDeltaFloat";
import { AttrIcon, MiniBacks } from "./AttrIcon";
import { ATTR_TIPS } from "./Tip";
import { TESTIDS } from "./testids";
import "./layout.css";
import "./seat-target.css";

/** 体力色条转朱砂的濒耗竭线(原 SeatPopModal 单源迁本件,#1097 弹层退役;
 *  格上血条与诸侯详情体力条同规)。 */
export const STAMINA_LOW = 30;

/** 目标段(#256/#417)单席点击槽:available=候选(金圈呼吸,点选=选中);
 *  selected=已选中(实金停持,再点取消);不可用席位照列不动,点按=轻晃
 *  (见 SeatCell 目标段注)。 */
export interface SeatTargetSlot {
  available: boolean;
  selected?: boolean;
  reason?: string;
  onPick: () => void;
}

/** 手牌计数封顶(#743 判词 A/#751 C 批):行 2 内宽 84px 预算向数字倾斜后仍容不下
 *  两位数——≥10 显示「9+」(MiniBacks「至多示意 3 张」同款示意口径,数值例外条款
 *  允许,非文字角标);负声望保留真实负值不在封顶族。 */
const HAND_COUNT_CAP = 9;
const handCountText = (count: number): string =>
  count > HAND_COUNT_CAP ? `${HAND_COUNT_CAP}+` : String(count);

/** 单张席位格(96×38 双行八项格,纯展示)。self=自机格(金描边+左金条+金渐变,
 *  无点击层)。hosted=托管(AI 代打)开启(#770):国号印右 8px 齿轮常驻微标,
 *  纯展示——开关交互唯一通路在设置弹层(settingsAutopilot,ADR-0028 单一开关)。 */
function SeatCell({
  p,
  seat,
  self,
  active,
  winner,
  hosted,
  target,
}: {
  p: SnapshotPlayer;
  seat: number;
  self: boolean;
  active: boolean;
  winner: boolean;
  hosted: boolean;
  target?: SeatTargetSlot;
}) {
  // 死区轻晃(#743 判词 E/#751 C 批):目标段不可选席位点按→格身一次轻晃(视觉反馈,
  // §4.6 色变/位移即状态,不加文字章),随 animationEnd 自清——一次性演出不驻类。
  const [shake, setShake] = useState(false);
  // 变化浮标(#495,全员含自机):首帧只立基准不浮,跨快照跳变才出标。浮标挂行内
  // relative 容器(带 testid 的数值本体保持纯文本,e2e textContent 断言不受浮标串扰)。
  const cashFloats = useDeltaFloat(p.cash);
  const staminaFloats = useDeltaFloat(p.stamina);
  return (
    <div
      data-testid={self ? TESTIDS.seatSelf : TESTIDS.seat(seat)}
      onAnimationEnd={() => setShake(false)}
      className={
        "seat" +
        (self ? " self" : "") +
        (active ? " active" : "") +
        (winner ? " won" : "") +
        (p.isBankrupt ? " bankrupt" : "") +
        (target?.available ? " candidate" : "") +
        (target?.selected ? " picked" : "") +
        (shake ? " shake" : "")
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
      {/* 行2(#770 分组):高频组「城+牌」(图标 10px/计数 11px)+ 发丝线组分隔 +
          低频组三项(名将/珍宝/声望,维持 8px/10px 旧规格);space-between 把
          行2 余量分到发丝线两侧成组间隙。#1096 决议1 后五图标纯展示:计数裸排,
          名词在 aria-label(原浮签触发元退化为 span);查档钻入走诸侯详情四元素。 */}
      <div className="l2">
        <div className="l2hi">
          <span
            className="ai ai-city"
            data-testid={TESTIDS.seatAttr(seat, "city")}
            aria-label={`城池 ${p.properties.length}`}
          >
            <AttrIcon kind="city" size={10} />
            {p.properties.length}
          </span>
          <span
            className="ai ai-hand"
            data-testid={TESTIDS.seatAttr(seat, "hand")}
            aria-label={`锦囊手牌 ${p.jinnangHandCount}`}
          >
            {p.jinnangHandCount > HAND_COUNT_CAP ? (
              /* 封顶态(#743 判词 A):≥10 只出「9+」不带牌背示意——行 2 全宽预算
                 容不下背组+双字(判据见 layout.css .l2) */
              handCountText(p.jinnangHandCount)
            ) : (
              <>
                <MiniBacks count={p.jinnangHandCount} />
                {p.jinnangHandCount}
              </>
            )}
          </span>
        </div>
        <span className="l2sep" aria-hidden="true" />
        <div className="l2lo">
          <span
            className="ai ai-hero"
            data-testid={TESTIDS.seatAttr(seat, "hero")}
            aria-label={`名将 ${p.heroes.length}`}
          >
            <AttrIcon kind="hero" size={9} />
            {p.heroes.length}
          </span>
          <span
            className="ai ai-gem"
            data-testid={TESTIDS.seatAttr(seat, "gem")}
            aria-label={`珍宝 ${p.treasures.length}`}
          >
            <AttrIcon kind="gem" size={9} />
            {p.treasures.length}
          </span>
          <span
            /* 负声望警示(#556):值 <0 值色改朱砂(数值即信息,色变即状态,§4.6
               不加标牌);样式 layout.css .ai.ai-rep.rep-neg。 */
            className={"ai ai-rep" + (p.reputation < 0 ? " rep-neg" : "")}
            data-testid={TESTIDS.seatAttr(seat, "rep")}
            aria-label={`声望 ${p.reputation}`}
          >
            <AttrIcon kind="rep" size={9} />
            {p.reputation}
          </span>
        </div>
      </div>
      {/* 目标段点击层(#256/#417):真按钮覆盖格面(键盘可达,不自写交互语义);
          点格=选中/再点取消(选中实金停持 .picked,样式 seat-target.css),打出走
          动作条「出」确认钮。不可选席(#743 判词 E/#751 C 批):disabled 会吞点击
          形成死区——改 aria-disabled 挂点,点按=格身轻晃(原「弹层放行+reason
          印条」随 #1096 决议1 退役,原因读 aria-label)。 */}
      {target && (
        <button
          type="button"
          data-testid={TESTIDS.seatTarget(seat)}
          className={"seat-target" + (target.selected ? " picked" : "")}
          aria-disabled={!target.available || undefined}
          aria-pressed={target.available ? Boolean(target.selected) : undefined}
          aria-label={
            target.available
              ? `指定 ${p.guohao || p.name} 为目标`
              : `不可指定:${target.reason ?? ""}`
          }
          onClick={() => {
            if (!target.available) {
              setShake(true);
              return;
            }
            target.onPick();
          }}
        />
      )}
    </div>
  );
}

/** 席位格列:全员一人一格(自机入列,座序即列序)。
 *  整列随快照声明式重渲;唯一的组件内状态是格身的死区轻晃(一次性演出,随
 *  animationEnd 自清)。旧三槽位切分(右 3+左 3+顶行缩微)随席位卡形态退役
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
}

export function SeatRail({ snapshot, selfSeat, targets }: SeatRailProps) {
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
            hosted={hosted(seat)}
            target={targetSlot(seat)}
          />
        ))}
      </div>
    </div>
  );
}
