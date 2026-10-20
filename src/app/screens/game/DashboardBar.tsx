// 底部仪表条(#253 三区骨架,原型 .dash/.me 移植):身份头 + 现金大数(全屏唯一)+
// 属性徽章(深底亮变体)+ 体力血条 + 签徽章 + 托管热钮 + 珍宝/名将计数徽章;
// 目标段身份区兼任自己候选钮(自选目标:any 域技含自己,「你」印变身候选钮,
// 样式 game-hud.css .you-target)。右段为手牌架槽(HandRack 原样入槽,弹性宽)。右栏手牌区(HandPanel)与珍宝·名将区
// (TreasuryPanel)已随 #253/#255 退役;珍宝/名将徽章 = 纯展示计数(#361 起,明细看
// 牌架双入口——expandPile 点开展开机制随明细排退役而消亡)。
// 观战(未入座):身份头转灰「观」印 + 被跟随者(房主座)资产只读呈现(原 S12 语义),
// 托管/签面不渲染(无座可托,原 G-10 口径)。
// 浮标/脉冲机制复用 useDeltaFloat/game-hud.css。
// #622 城池徽章装回点击(#361 局部翻案):轻点=名下城池清单(CityLedgerModal,开合态
// 归消费方 GameScreen;目标=被展示玩家,坐姿=自己→「本方」,观战=跟随座→国号题名),
// aria-expanded 随弹层;珍宝/名将徽章维持纯展示计数;长按浮签不受影响。
import type { ReactNode } from "react";
import { formatMoney } from "@core/money";
import { HERO_CAPACITY } from "@core/constants";
import { playerColor, rgba } from "@core/theme";
import type { GameSnapshot, SnapshotPlayer } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import type { GameController } from "@app/controllers/controller";
import { useDeltaFloat, DeltaFloats, type DeltaFloat } from "./useDeltaFloat";
import { AttrIcon } from "./AttrIcon";
import { ATTR_TIPS, Tip } from "./Tip";
import type { SeatTargetSlot, CityLedgerWiring } from "./SeatRail";
import { TESTIDS } from "./testids";
import "./layout.css";
import "./game-hud.css";

// 签面数字 → 汉字(原 dice-face 一~六 的展示口径)
const DIE_FACE = ["一", "二", "三", "四", "五", "六"];

/** chip pulse 触发键(原 HandPanel.gainPulseKey 同口径,组件退役随迁):
 *  浮标流中「最近一次 delta>0」那条的 id 作 key,key 变化 → 重挂载重播 pulse。 */
function gainPulseKey(floats: DeltaFloat[]): number {
  for (let i = floats.length - 1; i >= 0; i--) {
    if (floats[i].delta > 0) return floats[i].id;
  }
  return 0;
}

export interface DashboardBarProps {
  snapshot: GameSnapshot;
  /** 本地视角玩家(null = 观战/未入座)。 */
  player: SnapshotPlayer | null;
  controller: GameController | null;
  /** 托管态(useAutopilotOn 单源;GameScreen 已取,免重复订阅)。 */
  autopilotOn: boolean;
  /** 名下城池清单(#622):城池徽章轻点开弹层,开合态归消费方(GameScreen 持态)。 */
  cityLedger: CityLedgerWiring;
  /** 目标段自己候选(自选目标:any 域技含自己;undefined=非目标段/观战,「你」印还原
   *  展示死章)。席位栏结构性不出自己卡(#253),自己的候选面落身份区——与席位卡
   *  SeatTargetSlot 完全同口径,候选集由 GameScreen 从快照 choices 派生。 */
  selfTarget?: (SeatTargetSlot & { seat: number }) | undefined;
  /** 手牌架槽内容(HandRack;观战时不渲染)。 */
  children?: ReactNode;
}

export function DashboardBar({
  snapshot,
  player,
  controller,
  autopilotOn,
  cityLedger,
  selfTarget,
  children,
}: DashboardBarProps) {
  const net = useNetStore();
  // 浮标跟「被展示的玩家」走:坐姿=自己;观战=被跟随者(房主座)。快照按座直取,
  // 取不到即接线 bug,按零兜底原则炸出来(原 HandPanel 同一口径)。
  const shown = player ?? snapshot.players[net.host];
  // 被展示玩家的座位(#622 清单目标):player 与快照 players 同行同源,按引用落座;
  // 观战=房主座。
  const shownSeat = player ? snapshot.players.indexOf(player) : net.host;
  const cashFloats = useDeltaFloat(shown.cash);
  const warrantFloats = useDeltaFloat(shown.warrants);
  const cashPulseKey = gainPulseKey(cashFloats);
  const warrantPulseKey = gainPulseKey(warrantFloats);
  // 待起摇(#530):本端座位轮到且停在 Roll 等待态(自动起摇在途,~1.8s)——签面
  // 驻留的是上轮点数,静置即误导(狗粮静置 40s+)。托管中由 bot 代打(Roll 不经
  // 等待态,与 controller.checkRollSeal 同判),不提示。
  const awaitingMyRoll =
    player != null &&
    !autopilotOn &&
    snapshot.turnPhase === "Roll" &&
    snapshot.players[snapshot.activeIndex]?.id === player.id;

  return (
    <div className="dash" data-testid={TESTIDS.dashboardBar}>
      <div className="me">
        <div className="head">
          {/* 国号印(#510 漆金环/双描边方案):玩家色经 --pc 注入印环(见 layout.css) */}
          <span
            className="guo-yin"
            style={{ ["--pc" as string]: rgba(playerColor(shown.colorIndex)) }}
          >
            {shown.guohao.charAt(0)}
          </span>
          <span className="nm">
            {shown.guohao} · {player ? "本方视角" : "跟随视角"}
          </span>
          {player ? (
            selfTarget ? (
              /* 目标段自己候选钮(自选目标):与席位卡点击层同口径——真按钮(键盘可达,
                 不自写交互语义)、候选=金圈呼吸(.candidate)、选中=实金停持(.picked)、
                 不可用=禁用印原因(title/aria,DESIGN §4.6 不加文字章);testid 复用
                 seatTarget(seat) 族,e2e 与对手席位同一选择器通路。 */
              <button
                type="button"
                data-testid={TESTIDS.seatTarget(selfTarget.seat)}
                className={
                  "you you-target" +
                  (selfTarget.available ? " candidate" : "") +
                  (selfTarget.selected ? " picked" : "")
                }
                disabled={!selfTarget.available}
                aria-pressed={selfTarget.available ? Boolean(selfTarget.selected) : undefined}
                aria-label={
                  selfTarget.available ? "指定自己为目标" : `不可指定:${selfTarget.reason ?? ""}`
                }
                title={selfTarget.available ? undefined : selfTarget.reason}
                onClick={selfTarget.onPick}
              >
                你
              </button>
            ) : (
              <span className="you" data-testid={TESTIDS.dashYou} title="这是你">
                你
              </span>
            )
          ) : (
            <span className="guan" title={`观战 · 跟随「${shown.guohao}」的视角`}>
              观
            </span>
          )}
          <span className="sp" />
          {/* 托管热钮(联机=服务器 bot 代打;单机=本地 bot 代打,autopilotSupported 控显隐) */}
          {player && controller?.autopilotSupported && (
            <>
              <button
                type="button"
                data-testid={TESTIDS.autopilotButton}
                onClick={() => controller.setAutoPilot(!autopilotOn)}
                className="tuoguan"
              >
                {autopilotOn ? "收回" : "托管"}
              </button>
              {autopilotOn && <span className="tuoguan-on">托管中</span>}
            </>
          )}
        </div>
        <div className="rows">
          <Tip tip={ATTR_TIPS.cash} testId={TESTIDS.dashCash} className="badge b-cash relative">
            <span className="cash-lab">现金</span>
            <span key={cashPulseKey} className={cashPulseKey > 0 ? "game-chip-pulse" : undefined}>
              {formatMoney(shown.cash)}
            </span>
            <DeltaFloats
              floats={cashFloats}
              fmt={(d) => (d > 0 ? "+" : "−") + formatMoney(Math.abs(d))}
            />
          </Tip>
          <Tip
            tip={ATTR_TIPS.warrant}
            testId={TESTIDS.dashAttr("warrant")}
            ariaLabel={`委任状 ${shown.warrants}`}
            className="badge b-warrant relative"
          >
            <AttrIcon kind="warrant" />
            <span
              key={warrantPulseKey}
              className={warrantPulseKey > 0 ? "game-chip-pulse" : undefined}
            >
              {shown.warrants}
            </span>
            <DeltaFloats
              floats={warrantFloats}
              fmt={(d) => (d > 0 ? "+" : "−") + String(Math.abs(d))}
            />
          </Tip>
          {/* 城池徽章(#622):唯一装回点击的属性徽章——轻点=名下城池清单(目标=被展示
              玩家);aria-expanded 随弹层开合。 */}
          <Tip
            tip={ATTR_TIPS.city}
            testId={TESTIDS.dashAttr("city")}
            ariaLabel={`城池 ${shown.properties.length}`}
            className="badge b-city"
            onTap={() => cityLedger.onOpen(shownSeat)}
            ariaExpanded={cityLedger.openSeat === shownSeat}
          >
            <AttrIcon kind="city" />
            {shown.properties.length}
          </Tip>
          <Tip
            tip={ATTR_TIPS.rep}
            testId={TESTIDS.dashAttr("rep")}
            ariaLabel={`声望 ${shown.reputation}`}
            className="badge b-rep"
          >
            <AttrIcon kind="rep" />
            {shown.reputation}
          </Tip>
          <Tip tip={ATTR_TIPS.stamina} testId={TESTIDS.dashStamina} className="badge">
            <span className="hpbar">
              <i style={{ width: `${shown.stamina}%` }} />
              <em>{shown.stamina}</em>
            </span>
          </Tip>
        </div>
        <div className="rows">
          {/* 签面(原 dice-face 方章迁此;结果驻留)+ 珍宝/名将计数徽章(纯展示,见下)。
              待起摇(#530):签面转「待」浅印 + 呼吸金边(样式 game-hud.css .await)——
              UI 状态变化承载(DESIGN §4.6),不加文字标牌;上轮点数历史归战报。 */}
          {player && (
            <Tip
              tip={ATTR_TIPS.sign}
              testId={TESTIDS.diceFace}
              className={"badge b-sign" + (awaitingMyRoll ? " await" : "")}
            >
              {awaitingMyRoll
                ? "待"
                : snapshot.lastRoll
                  ? DIE_FACE[snapshot.lastRoll.die - 1]
                  : "签"}
            </Tip>
          )}
          {/* 珍宝/名将计数徽章:纯展示计数(#361)——明细排退役后无处可展,徽章只报数;
              看明细走牌架双入口(HandRack 右端,点谁开谁的层)。远读看顶栏、近看点入口,
              同一数字两处呈现,不出第二事实源(同读 snapshot 一字段)。 */}
          <Tip
            tip={ATTR_TIPS.gem}
            testId={TESTIDS.dashTreasures}
            ariaLabel={`珍宝 ${shown.treasures.length}`}
            className="badge b-gem"
          >
            <AttrIcon kind="gem" />
            {shown.treasures.length}
          </Tip>
          <Tip
            tip={ATTR_TIPS.hero}
            testId={TESTIDS.dashHeroes}
            ariaLabel={`名将 ${shown.heroes.length}/${HERO_CAPACITY}`}
            className="badge b-hero"
          >
            <AttrIcon kind="hero" />
            {shown.heroes.length}/{HERO_CAPACITY}
          </Tip>
        </div>
      </div>
      {/* 手牌架槽:HandRack 原样入槽(观战时 HandRack 自返回 null,槽留空) */}
      <div className="dash-rack">{children}</div>
    </div>
  );
}
