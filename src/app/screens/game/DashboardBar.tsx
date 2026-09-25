// 底部仪表条(#253 三区骨架,原型 .dash/.me 移植):身份头 + 现金大数(全屏唯一)+
// 属性徽章(深底亮变体)+ 体力血条 + 签徽章 + 托管/速度 + 珍宝/名将计数徽章;
// 右段为手牌架槽(HandRack 原样入槽,弹性宽)。右栏手牌区(HandPanel)与珍宝·名将区
// (TreasuryPanel)已随 #253/#255 退役:点珍宝/名将徽章 = expandPile——明细展入
// 手牌架行(HandRack pile 槽,收起飞回、一次一摞、点另一摞切换,不弹窗)。
// 观战(未入座):身份头转灰「观」印 + 被跟随者(房主座)资产只读呈现(原 S12 语义),
// 托管/签面不渲染(无座可托,原 G-10 口径),计数徽章不可展开(无架可展)。
// 浮标/脉冲机制复用 useDeltaFloat/game-hud.css。
import { useState } from "react";
import type { ReactNode } from "react";
import { formatMoney } from "@core/money";
import { HERO_CAPACITY } from "@core/constants";
import { playerColor, rgba } from "@core/theme";
import type { GameSnapshot, SnapshotPlayer } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import type { GameController } from "@app/controllers/controller";
import { useDeltaFloat, type DeltaFloat } from "./useDeltaFloat";
import { AttrIcon } from "./AttrIcon";
import { ATTR_TIPS, Tip } from "./Tip";
import type { RackPile } from "./HandRack";
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

/** 现金/委任浮标 span(评审去重:两处同形收拢):漆底直出亮档配色(正=lacquerGold /
 *  负=attr-hero-bright),动画复用 game-hud.css game-cash-float;数值格式化由调用方给
 *  (现金走 formatMoney 带单位,委任裸数)。 */
function DeltaFloats({ floats, fmt }: { floats: DeltaFloat[]; fmt: (delta: number) => string }) {
  return (
    <>
      {floats.map((f) => (
        <span
          key={f.id}
          className={
            "game-cash-float pointer-events-none absolute -top-2 right-0 font-brush text-sm " +
            (f.delta > 0 ? "text-lacquer-gold" : "text-attr-hero-bright")
          }
        >
          {fmt(f.delta)}
        </span>
      ))}
    </>
  );
}

export interface DashboardBarProps {
  snapshot: GameSnapshot;
  /** 本地视角玩家(null = 观战/未入座)。 */
  player: SnapshotPlayer | null;
  controller: GameController | null;
  /** 托管态(useAutopilotOn 单源;GameScreen 已取,免重复订阅)。 */
  autopilotOn: boolean;
  /** 手牌架槽内容(HandRack;观战时不渲染)。 */
  children?: ReactNode;
  /** expandPile(#255):当前展开的摞(null = 全收);一次只展开一摞。 */
  pileOpen?: RackPile | null;
  /** 徽章点击切换展开(仅坐姿;空摞由本件拦下不展开)。 */
  onTogglePile?: (pile: RackPile) => void;
}

export function DashboardBar({ snapshot, player, controller, autopilotOn, children, pileOpen, onTogglePile }: DashboardBarProps) {
  const net = useNetStore();
  const [autopilotSpeed, setAutopilotSpeed] = useState<"fast" | "slow">("fast");
  // expandPile(#255):空摞(0 张)不可展开——徽章仍显计数,点击零动作;坐姿才有摞可展
  // (观战无手牌架,明细无处可落)。
  const togglePile = (pile: RackPile) => {
    if (!player || !onTogglePile) return;
    if (pile === "treasures" ? shown.treasures.length === 0 : shown.heroes.length === 0) return;
    onTogglePile(pile);
  };
  // 浮标跟「被展示的玩家」走:坐姿=自己;观战=被跟随者(房主座)。快照按座直取,
  // 取不到即接线 bug,按零兜底原则炸出来(原 HandPanel 同一口径)。
  const shown = player ?? snapshot.players[net.host];
  const cashFloats = useDeltaFloat(shown.cash);
  const warrantFloats = useDeltaFloat(shown.warrants);
  const cashPulseKey = gainPulseKey(cashFloats);
  const warrantPulseKey = gainPulseKey(warrantFloats);

  return (
    <div className="dash" data-testid={TESTIDS.dashboardBar}>
      <div className="me">
        <div className="head">
          <span className="guo-yin" style={{ background: rgba(playerColor(shown.colorIndex)) }}>
            {shown.guohao.charAt(0)}
          </span>
          <span className="nm">
            {shown.guohao} · {player ? "本方视角" : "跟随视角"}
          </span>
          {player ? (
            <span className="you" data-testid={TESTIDS.dashYou} title="这是你">
              你
            </span>
          ) : (
            <span className="guan" title={`观战 · 跟随「${shown.guohao}」的视角`}>
              观
            </span>
          )}
          <span className="sp" />
          {/* 托管热钮 + 速度(联机=服务器 bot 代打;单机=本地 bot 代打,autopilotSupported 控显隐) */}
          {player && controller?.autopilotSupported && (
            <>
              <button
                type="button"
                data-testid={TESTIDS.autopilotButton}
                onClick={() => controller.setAutoPilot(!autopilotOn, autopilotSpeed)}
                className="tuoguan"
              >
                {autopilotOn ? "收回" : "托管"}
              </button>
              <select
                data-testid={TESTIDS.autopilotSpeed}
                value={autopilotSpeed}
                onChange={(e) => {
                  const speed = e.target.value as "fast" | "slow";
                  setAutopilotSpeed(speed);
                  if (autopilotOn) controller.setAutoPilot(true, speed); // 托管中切速立即生效
                }}
                aria-label="托管速度"
                className="dash-speed"
              >
                <option value="fast">快</option>
                <option value="slow">慢</option>
              </select>
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
            <span key={warrantPulseKey} className={warrantPulseKey > 0 ? "game-chip-pulse" : undefined}>
              {shown.warrants}
            </span>
            <DeltaFloats
              floats={warrantFloats}
              fmt={(d) => (d > 0 ? "+" : "−") + String(Math.abs(d))}
            />
          </Tip>
          <Tip
            tip={ATTR_TIPS.city}
            testId={TESTIDS.dashAttr("city")}
            ariaLabel={`城池 ${shown.properties.length}`}
            className="badge b-city"
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
          {/* 签面(原 dice-face 方章迁此;结果驻留)+ 珍宝/名将计数徽章(expandPile 开关,见下) */}
          {player && (
            <Tip tip={ATTR_TIPS.sign} testId={TESTIDS.diceFace} className="badge b-sign">
              {snapshot.lastRoll ? DIE_FACE[snapshot.lastRoll.die - 1] : "签"}
            </Tip>
          )}
          {/* expandPile(#255):计数徽章即摞的开关——点击明细展入手牌架行,再点收起;
              展开态 = .open 漆金内环(§4.6 状态即 UI),空摞(0 张)点击零动作不可展开。 */}
          <Tip
            tip={ATTR_TIPS.gem}
            testId={TESTIDS.dashTreasures}
            ariaLabel={`珍宝 ${shown.treasures.length}`}
            className={"badge b-gem" + (pileOpen === "treasures" ? " open" : "")}
            ariaExpanded={pileOpen === "treasures"}
            onClick={() => togglePile("treasures")}
          >
            <AttrIcon kind="gem" />
            {shown.treasures.length}
          </Tip>
          <Tip
            tip={ATTR_TIPS.hero}
            testId={TESTIDS.dashHeroes}
            ariaLabel={`名将 ${shown.heroes.length}/${HERO_CAPACITY}`}
            className={"badge b-hero" + (pileOpen === "heroes" ? " open" : "")}
            ariaExpanded={pileOpen === "heroes"}
            onClick={() => togglePile("heroes")}
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
