// 侧栏·手牌区(对照旧 renderHand + action-zone 的手牌部分):
// 头部:L47 玩家身份头(国号大字 + 玩家色底纹 + 「你」印)+ 现金 / 委任;
// 动作区:签面 + 行军按钮(行军是主行动不是抉择,留守手牌区——交互重构已确认决策)。
// L48:珍宝/名士卡迁出至 TreasuryPanel(战报移除后腾出的常驻展示区),本区只留身份与行动。
// 交互重构:原 ActionInline 内嵌决策(买/扩军/驻跸/选路)整体迁入卷轴体系
// (DecisionScrollLayer 按相位自动弹出),手牌区不再有任何决策按钮。
// #44/S11:现金浮标的跨快照 diff 逻辑抽成 useDeltaFloat(本目录同名文件);
// #21/X2:委任 chip 复用同款浮标(巡幸 +2 金字浮出,买城 −1 红字);
// #45/S12:观战空态从两行说明升级为「观」印身份行 + 被跟随者(房主)资产列表。
// R3-C10(#97):现金/委任 chip 数值变化时一拍 0.98→1 pulse(game-hud.css 的
// game-chip-pulse),软化数字硬切;触发键推导见 gainPulseKey。
import { useState } from "react";
import { rgba, playerColor } from "@core/theme";
import { formatMoney } from "@core/money";
import { guidePriceOf } from "@core/treasures";
import type { GameSnapshot, SnapshotPlayer } from "@app/store/gameStore";
import { useNetStore, useAutopilotOn } from "@app/store/netStore";
import type { GameController } from "@app/controllers/controller";
import { DeltaFloatSpans, useDeltaFloat, type DeltaFloat } from "./useDeltaFloat";
import { TESTIDS } from "./testids";
import "./game-hud.css";

// 签面数字 → 汉字(旧 dice-face 一~六 的展示口径)
const DIE_FACE = ["一", "二", "三", "四", "五", "六"];

/** #97 chip pulse 触发键:浮标流中「最近一次 delta>0」那条的 id(无则 0)。
 *  用作 chip 元素的 key:key 变化 → React 重挂载 chip → game-chip-pulse 入场动画
 *  重播;盒模型不变,布局零位移(优于 animation-name 切换:不必备双份 keyframes)。
 *  浮标按入列顺序 1.25s 出列,末位正浮标出列时更早的正浮标必已出列,key 只会
 *  单调走 0→a→b→0 不会回跳空放;归零时 pulse 类同步摘除,静态 chip 不带动画。
 *  负增量不触发(已有 danger 红浮标承担反馈,pulse 只庆祝「进账」一拍)。 */
function gainPulseKey(floats: DeltaFloat[]): number {
  for (let i = floats.length - 1; i >= 0; i--) {
    if (floats[i].delta > 0) return floats[i].id;
  }
  return 0;
}

/** 行军按钮 disabled 原因(UI F1):从快照 + interactive + pending 集中推导,返回 null = 可用。
 *  为什么集中一处:内嵌买地/扩军已把原因写在文案里,行军没有——这里补齐并统一口径,
 *  悬停 title 与旁注灰字共用同一返回值,避免两套说法漂移。 */
function reasonForDisabled(
  s: GameSnapshot,
  interactive: boolean,
  pending: boolean,
  autopilotOn: boolean,
): string | null {
  if (pending) return "行军中…";
  if (!interactive) {
    if (s.phase !== "Playing") return "非对局中";
    // G-8:托管中与等待区分——托管可主动「收回」取回操作,提示语引导而非冷冰冰「未轮到你」
    return autopilotOn ? "托管中,点「收回」取回操作" : "未轮到你";
  }
  if (s.turnPhase !== "Roll") return "轮次未到,先完成当前抉择";
  return null;
}

/** L47「我是谁」锚点:国号大字 brush + 玩家色底纹(左染渐变 + 左缘 3px 色条,与
 *  OthersPanel 活跃竖条同语言)+ 金框「你」小印(与托管「托」印同款章形)。
 *  单机/联机同口径:player 即 viewSeat 玩家(HandPanel props 由 GameScreen 传入)。 */
function IdentityHeader({ player }: { player: NonNullable<HandPanelProps["player"]> }) {
  const c = playerColor(player.colorIndex);
  return (
    <div
      data-testid={TESTIDS.handIdentity}
      title={`你执「${player.guohao}」`}
      className="m-2 flex items-center gap-2.5 rounded border-l-[3px] px-2.5 py-1.5"
      style={{
        ["--player-color" as string]: rgba(c),
        borderColor: rgba(c, 0.55),
        background: `linear-gradient(100deg, ${rgba(c, 0.22)}, ${rgba(c, 0.04)} 72%)`,
      }}
    >
      <span className="font-brush text-2xl leading-none text-ink">{player.guohao || "?"}</span>
      <span className="font-deco text-xs text-ink-dim">本方视角</span>
      <span className="ml-auto inline-flex rotate-[-4deg] items-center justify-center rounded-[2px] border-[1.5px] border-gold bg-gold/15 px-1.5 py-0.5 font-brush text-xs leading-none text-gold">
        你
      </span>
    </div>
  );
}

/** #45/S12「我是谁在看」观战锚点:与 IdentityHeader 同一行解剖(国号大字 + 被跟随者
 *  色底纹 + 章形印),但印文是灰墨「观」——你(gold,参与者)与观(墨,旁观者)
 *  用印色区分身份,不靠新读者猜。国号 = 被跟随者(对局发起者=房主座)。 */
function SpectatorIdentityHeader({ followed }: { followed: SnapshotPlayer }) {
  const c = playerColor(followed.colorIndex);
  return (
    <div
      data-testid={TESTIDS.handSpectatorIdentity}
      title={`观战 · 跟随「${followed.guohao}」的视角`}
      className="m-2 flex items-center gap-2.5 rounded border-l-[3px] px-2.5 py-1.5"
      style={{
        ["--player-color" as string]: rgba(c),
        borderColor: rgba(c, 0.35),
        background: `linear-gradient(100deg, ${rgba(c, 0.1)}, ${rgba(c, 0.02)} 72%)`,
      }}
    >
      <span className="font-brush text-2xl leading-none text-ink-dim">{followed.guohao || "?"}</span>
      <span className="font-deco text-xs text-ink-dim">跟随视角</span>
      <span className="ml-auto inline-flex rotate-[-4deg] items-center justify-center rounded-[2px] border-[1.5px] border-ink/50 bg-ink/5 px-1.5 py-0.5 font-brush text-xs leading-none text-ink-dim">
        观
      </span>
    </div>
  );
}

interface HandPanelProps {
  snapshot: GameSnapshot;
  /** 本地视角玩家(热座=活跃人类;联机=自己)。null = 未入座,只渲染空态。 */
  player: GameSnapshot["players"][number] | null;
  controller: GameController | null;
  interactive: boolean;
}

export function HandPanel({ snapshot, player, controller, interactive }: HandPanelProps) {
  // 托管:联机从 netStore 的 seats 广播回读(本端已入座);单机未入座(mySeat=-1)
  // 回落 controller.autoPilotOn(本地标记)。速度是本地 UI 态(切速时若在托管中立即重发)
  const net = useNetStore();
  const [autopilotSpeed, setAutopilotSpeed] = useState<"fast" | "slow">("fast");
  // 托管态单源取值收口 useAutopilotOn(与 GameScreen 同一口径,spec #107 C5):
  // 联机已入座=座位广播,单机=控制器本地标记;观战(mySeat=-1)恒 false——观战无托管
  // (#45/S12 的 mySeat 守卫随收口进 hook 单点,不再各写一份)。
  const autopilotOn = useAutopilotOn(controller);
  // 浮标跟「被展示的玩家」走(#45/S12):坐姿=自己;观战空态=被跟随者(对局发起者
  // =房主座,net.host)。快照是全量广播,按座直取——观战时房间字段必然就位,
  // 取不到说明接线有 bug,按零兜底原则让它炸出来。
  const shown = player ?? snapshot.players[net.host];
  // G-9 现金 / #21 委任:跨快照差值浮标(useDeltaFloat 单一实现,chip 右上浮出
  // +/− 标记,game-hud.css 的 game-cash-float 上浮消失(时长 token --dur-fx);正=深金 负=danger)。
  const cashFloats = useDeltaFloat(shown.cash);
  const warrantFloats = useDeltaFloat(shown.warrants);
  // #97:chip pulse 触发键(见 gainPulseKey)——现金/委任 chip 同管线同处理。
  const cashPulseKey = gainPulseKey(cashFloats);
  const warrantPulseKey = gainPulseKey(warrantFloats);
  // G-11:手牌区按内容定高(shrink-0),纵向弹性让给珍宝·名士区(L48 起接管战报腾位);
  // 头部/动作/托管行不参与压缩。
  return (
    <section
      data-testid={TESTIDS.handPanel}
      className="flex max-h-full min-h-0 shrink-0 flex-col border-b border-gold/40"
    >
      {!player ? (
        /* G-10 未入座空态:观战视角——无手牌可看、无行动可发,动作区(签面/行军/托管)不渲染。
            #45/S12:空态从两行说明升级为「观」印身份行 + 被跟随者资产(现金/委任 chips
            与坐姿分支同款,#21 浮标同样生效;身价小字为观战态额外保留——R3-B7(#79)
            去重只收敛坐姿分支);珍宝/名士列表就地平铺(只读,详情卷轴仍归
            TreasuryPanel 的卡区职责)。入座引导保留一行收尾。 */
        <>
          <h3 className="px-3 pt-2 font-brush text-base">手牌</h3>
          <SpectatorIdentityHeader followed={shown} />
          <div data-testid={TESTIDS.handSpectatorAssets} className="px-3 pb-3">
            {/* 资产 chips:与坐姿分支同一行解剖(chip 阶梯/浮标),观战也能看到被跟随者的
                现金/委任跳变反馈;身份行已锚定「看的是谁」,这里不再重复国号。 */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="relative inline-flex min-h-9 items-center">
                {/* #97:pulse 与坐姿分支同款(见 gainPulseKey),观战视角同样有变化反馈 */}
                <span
                  key={cashPulseKey}
                  data-testid={TESTIDS.handCash}
                  className={
                    "inline-flex min-h-9 items-center rounded bg-panel-hi px-2.5 font-brush text-lg leading-none text-money" +
                    (cashPulseKey > 0 ? " game-chip-pulse" : "")
                  }
                >
                  {formatMoney(shown.cash)}
                </span>
                <DeltaFloatSpans floats={cashFloats} format={(n) => formatMoney(n)} />
              </span>
              <span className="relative inline-flex min-h-9 items-center">
                <span
                  key={warrantPulseKey}
                  data-testid={TESTIDS.handWarrants}
                  className={
                    "inline-flex min-h-9 items-center rounded bg-panel-hi px-2.5 text-xs leading-none" +
                    (warrantPulseKey > 0 ? " game-chip-pulse" : "")
                  }
                >
                  委任 {shown.warrants}
                </span>
                {/* #21:委任状计数不是钱,浮标取整数码(巡幸 +2 / 买城 −1) */}
                <DeltaFloatSpans floats={warrantFloats} format={(n) => String(n)} />
              </span>
              <span className="min-h-9 py-1 text-xs text-ink-dim">身价 {formatMoney(shown.netWorth)}</span>
            </div>
            {/* 资产列表:珍宝(◆ 名 · 等级 · 指导价)与名士名条——只读平铺,行 anatomy
                与 TreasuryPanel 同语言(◆ 金符 / 右对齐 text-money),但非按钮:
                开详情卷轴是珍宝·名士区的交互职责,观战空态只承担「看得见」。 */}
            <div className="mt-2 flex flex-col gap-1">
              {shown.treasures.map((t) => (
                <div
                  key={t.id}
                  title={t.desc}
                  className="flex min-h-8 items-center gap-2 rounded border border-gold/40 bg-panel-hi px-2.5 text-xs leading-none"
                >
                  <span className="shrink-0 text-gold">◆</span>
                  <span className="truncate">{t.name}</span>
                  <span className="shrink-0 text-ink-dim">Lv{t.level}</span>
                  <span className="ml-auto shrink-0 text-money">指导价 {formatMoney(guidePriceOf(t.level))}</span>
                </div>
              ))}
              {shown.treasures.length === 0 && <span className="text-xs text-ink-dim">暂无珍宝</span>}
              <div className="pt-0.5 text-xs leading-5 text-ink-dim">
                名士
                {shown.heroes.length > 0
                  ? " " + shown.heroes.map((h) => h.name).join("·")
                  : " 暂无"}
              </div>
            </div>
            <div className="mt-1 text-xs leading-5 text-ink-dim/80">
              观战中 · 跟随对局发起者的视角旁观;回到首页入座后即可执子行军。
            </div>
          </div>
        </>
      ) : (
        <>
          {/* L47 身份头:替代原「手牌」标题,联机多端第一眼可知「我是谁」 */}
          <IdentityHeader player={player} />
          <div className="px-3">
            {/* 头部:现金/委任。W3 字号阶梯三档:现金数值 text-lg brush(核心可断言数值)/
                标签 text-xs / 卡片 text-xs——不再让 text-sm 混进来拉平层次。
                #32 按钮体系:统计 chip 统一 min-h-9 + items-center + rounded + px-2.5,
                与卡区/按钮同一圆角口径(ScrollButton 的 rounded),行内等高对齐。 */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="relative inline-flex min-h-9 items-center">
                {/* #97:key=最近一次正增量浮标 id,变化即重挂载 chip 重播 pulse
                    (盒模型不变);负增量已有红浮标,不 pulse,推导见 gainPulseKey。 */}
                <span
                  key={cashPulseKey}
                  data-testid={TESTIDS.handCash}
                  className={
                    "inline-flex min-h-9 items-center rounded bg-panel-hi px-2.5 font-brush text-lg leading-none text-money" +
                    (cashPulseKey > 0 ? " game-chip-pulse" : "")
                  }
                >
                  {formatMoney(player.cash)}
                </span>
                {/* G-9:现金增减浮标(chip 右上,上浮渐隐时长 token --dur-fx;正=深金 负=danger)。
                    #44:浮标渲染与观战分支共用 DeltaFloatSpans,只差数值文案口径 */}
                <DeltaFloatSpans floats={cashFloats} format={(n) => formatMoney(n)} />
              </span>
              <span className="relative inline-flex min-h-9 items-center">
                <span
                  key={warrantPulseKey}
                  data-testid={TESTIDS.handWarrants}
                  className={
                    "inline-flex min-h-9 items-center rounded bg-panel-hi px-2.5 text-xs leading-none" +
                    (warrantPulseKey > 0 ? " game-chip-pulse" : "")
                  }
                >
                  委任 {player.warrants}
                </span>
                {/* #21/X2:委任 chip 复用同款浮标——巡幸过都城 +2(金字)浮出,
                    买城 −1(红字);计数非钱,format 取整数。
                    #97:pulse 口径与现金 chip 一致(正增量触发,见 gainPulseKey) */}
                <DeltaFloatSpans floats={warrantFloats} format={(n) => String(n)} />
              </span>
              {/* R3-B7(#79):身价小字已删——坐姿分支只留现金大数 + 委任 chip(有浮字反馈),
                  手牌区是「我的钱」唯一大数呈现;身价归状态卡 meta,不再三处重复 */}
            </div>
          </div>
        </>
      )}
      {/* 动作区:签面 + 行军(所有按钮 disabled 绑定 interactive,单一来源 store)。
          W3:行军(primary)独占一行——primary text-base 与 xs 混排会让基线错位、
          视觉重心漂移,分行后主次一眼可分。
          G-10:未入座(观战)不渲染——无签可掷无军可行。 */}
      {player && (
      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2 px-3 pb-1">
        {/* #32 按钮体系·一级(主行动):签面方 h-11 w-11 + 行军 h-11,同一行等高;
            主 CTA 与卷轴决策按钮(ScrollButton)同圆角(rounded)/brush 字体,口径统一。 */}
        <span
          data-testid={TESTIDS.diceFace}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-gold/60 bg-panel-hi font-brush text-lg leading-none"
        >
          {snapshot.lastRoll ? DIE_FACE[snapshot.lastRoll.die - 1] ?? "签" : "签"}
        </span>
        {/* Wave3(候选2):roll() 一行转发已从基类删除,行军=标准命令直发(dispatchCommand 唯一入口) */}
        {(() => {
          // UI F1/F3:disabled 原因集中推导;pending(联机命令已发未回)显示「行军中…」
          const reason = reasonForDisabled(snapshot, interactive, net.pending, autopilotOn);
          return (
            <>
              <button
                type="button"
                data-testid={TESTIDS.rollButton}
                disabled={reason !== null}
                onClick={() => controller?.dispatchCommand({ type: "rollAndMove" })}
                title={reason ?? "行军"}
                /* P0-4 行军升格主 CTA:#32 后可用/禁用两态同 h-11 同圆角,仅换皮——
                   可掷=实心金底+深墨字+呼吸光晕(game-hud.css 的 .game-cta-breathe 类,
                   R3-C1 后时长/缓动引 --dur-ambient/--ease-sine token);禁用=金描边灰底 +
                   text-ink-dim(替代整按钮 opacity 压暗,原因旁注仍由 F1 提供)。 */
                className={
                  "h-11 min-w-24 cursor-pointer rounded border-2 px-5 font-brush text-lg leading-none transition-colors " +
                  (reason === null
                    ? "border-gold bg-gold/80 text-ink hover:bg-gold game-cta-breathe"
                    : "border-gold/50 bg-gold/15 text-ink-dim enabled:hover:bg-gold/40 disabled:cursor-not-allowed"
                  )
                }
              >
                {net.pending ? "行军中…" : "行军"}
              </button>
              {reason && !net.pending && (
                <span className="text-xs text-ink-dim">{reason}</span>
              )}
            </>
          );
        })()}
      </div>
      )}
      {/* 托管行(联机=服务器 bot 代打;单机=本地 bot 代打,均由 autopilotSupported 控制
          显隐):托管中 interactive 被锁,本地只旁观。对照旧 client-controller 的 autopilot-row。
          G-10:未入座(观战)不渲染——无座可托。 */}
      {player && controller?.autopilotSupported && (
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2 text-xs text-ink-dim">
          {/* #32 按钮体系·三级(小操作):托管/速度 h-10(触屏 ≥40px 基线,不因「小」破线),
              rounded + text-xs 与主 CTA 同圆角阶梯,仅字号/内边距收小拉开层次。 */}
          <button
            type="button"
            data-testid={TESTIDS.autopilotButton}
            onClick={() => controller.setAutoPilot(!autopilotOn, autopilotSpeed)}
            className="h-10 cursor-pointer rounded border border-ink/40 bg-panel-hi px-3 font-deco text-xs leading-none hover:bg-panel"
          >
            {autopilotOn ? "收回" : "托管"}
          </button>
          <select
            data-testid={TESTIDS.autopilotSpeed}
            value={autopilotSpeed}
            onChange={(e) => {
              const speed = e.target.value as "fast" | "slow";
              setAutopilotSpeed(speed);
              if (autopilotOn) controller.setAutoPilot(true, speed); // 托管中切速立即生效(旧行为)
            }}
            className="h-10 cursor-pointer rounded border border-ink/30 bg-bg px-2 font-deco text-xs leading-none text-ink-dim"
            aria-label="托管速度"
          >
            <option value="fast">快</option>
            <option value="slow">慢</option>
          </select>
          {autopilotOn && <span className="text-gold">托管中</span>}
        </div>
      )}
    </section>
  );
}
