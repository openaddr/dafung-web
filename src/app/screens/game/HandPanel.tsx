// 侧栏·手牌区(对照旧 renderHand + action-zone 的手牌部分):
// 头部:现金 / 委任状 / 国号;卡区:珍宝 + 名士(点击看详情卷轴);
// 动作区:签面 + 行军按钮(行军是主行动不是抉择,留守手牌区——交互重构已确认决策)。
// 交互重构:原 ActionInline 内嵌决策(买/扩军/驻跸/选路)整体迁入卷轴体系
// (DecisionScrollLayer 按相位自动弹出),手牌区不再有任何决策按钮。
import { useEffect, useRef, useState } from "react";
import { rgba, playerColor } from "@core/theme";
import { formatMoney } from "@core/money";
import type { GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import type { GameController } from "@app/controllers/controller";
import { CardDetailScroll, type CardDetail } from "./CardDetailScroll";
import { TESTIDS } from "./testids";
import "./game-hud.css";

// 签面数字 → 汉字(旧 dice-face 一~六 的展示口径)
const DIE_FACE = ["一", "二", "三", "四", "五", "六"];

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

interface HandPanelProps {
  snapshot: GameSnapshot;
  /** 本地视角玩家(热座=活跃人类;联机=自己)。null = 未入座,只渲染空态。 */
  player: GameSnapshot["players"][number] | null;
  controller: GameController | null;
  interactive: boolean;
  /** G-17:打开卡详情卷轴时通知父层(用于关掉城详情卷轴,双层卷轴互斥)。 */
  onCardDetailOpen?: () => void;
}

export function HandPanel({ snapshot, player, controller, interactive, onCardDetailOpen }: HandPanelProps) {
  // 托管:联机从 netStore 的 seats 广播回读(本端已入座);单机未入座(mySeat=-1)
  // 回落 controller.autoPilotOn(本地标记)。速度是本地 UI 态(切速时若在托管中立即重发)
  const net = useNetStore();
  const [autopilotSpeed, setAutopilotSpeed] = useState<"fast" | "slow">("fast");
  // UI F5:当前查看详情的卡(珍宝/名士);null = 无卷轴
  const [cardDetail, setCardDetail] = useState<CardDetail | null>(null);
  // 托管态单源取值(与 GameScreen 同口径):联机=座位广播,单机=控制器本地标记
  const autopilotOn = net.roomId !== "" ? net.seats[net.mySeat].autoPilot : (controller?.autoPilotOn ?? false);
  // G-9 现金变化就地反馈:跨快照比对 cash 差值,现金 chip 右上浮出 +/− 标记
  // (game-hud.css 的 game-cash-float 1.2s 上浮消失;正=gold 负=danger)。
  const prevCashRef = useRef<number | null>(null);
  const floatIdRef = useRef(0);
  const [cashFloats, setCashFloats] = useState<{ id: number; delta: number }[]>([]);
  const cash = player?.cash ?? null;
  useEffect(() => {
    if (cash == null) {
      prevCashRef.current = null;
      return;
    }
    const prev = prevCashRef.current;
    prevCashRef.current = cash;
    if (prev == null || prev === cash) return;
    const delta = cash - prev;
    if (delta === 0) return;
    const id = ++floatIdRef.current;
    setCashFloats((f) => [...f, { id, delta }]);
    const timer = setTimeout(() => {
      setCashFloats((f) => f.filter((x) => x.id !== id));
    }, 1250);
    return () => clearTimeout(timer);
  }, [cash]);
  // G-11:手牌区按内容定高(shrink-0),纵向弹性让给战报区;max-h-full +
  // 区内 overflow-y-auto 兜住矮视口(布局约束)。头部/动作/托管行不参与压缩。
  return (
    <section
      data-testid={TESTIDS.handPanel}
      className="flex max-h-full min-h-0 shrink-0 flex-col border-b border-gold/40"
    >
      <h3 className="shrink-0 px-3 pt-2 font-brush text-base">手牌</h3>
      {!player ? (
        /* G-10 未入座空态:观战视角——无手牌可看、无行动可发,动作区(签面/行军/托管)不渲染 */
        <div className="px-3 pb-3 pt-1">
          <div className="font-brush text-sm text-ink-dim">观战中 · 跟随对局视角</div>
          <div className="mt-1 text-xs leading-5 text-ink-dim/80">
            你尚未入座,当前跟随对局发起者的视角旁观;回到首页入座后即可执子行军。
          </div>
        </div>
      ) : (
        <div
          className="min-h-0 overflow-y-auto px-3"
          style={{ ["--player-color" as string]: rgba(playerColor(player.colorIndex)) }}
        >
          {/* 头部:现金/委任。W3 字号阶梯三档:现金数值 text-lg brush(核心可断言数值)/
              标签 text-xs / 卡片 text-xs——不再让 text-sm 混进来拉平层次。
              #32 按钮体系:统计 chip 统一 min-h-9 + items-center + rounded + px-2.5,
              与卡区/按钮同一圆角口径(ScrollButton 的 rounded),行内等高对齐。 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="relative inline-flex min-h-9 items-center">
              <span
                data-testid={TESTIDS.handCash}
                className="inline-flex min-h-9 items-center rounded bg-panel-hi px-2.5 font-brush text-lg leading-none text-money"
              >
                {formatMoney(player.cash)}
              </span>
              {/* G-9:现金增减浮标(chip 右上,1.2s 上浮渐隐;正=gold 负=danger) */}
              {cashFloats.map((f) => (
                <span
                  key={f.id}
                  className={
                    "game-cash-float pointer-events-none absolute -top-2 right-0 font-brush text-xs " +
                    (f.delta > 0 ? "text-gold" : "text-danger")
                  }
                >
                  {f.delta > 0 ? "+" : "−"}
                  {formatMoney(Math.abs(f.delta))}
                </span>
              ))}
            </span>
            <span
              data-testid={TESTIDS.handWarrants}
              className="inline-flex min-h-9 items-center rounded bg-panel-hi px-2.5 text-xs leading-none"
            >
              委任 {player.warrants}
            </span>
            {/* G-9:身价小字(netWorth 为快照派生字段,含地产/珍宝估值,自己非活跃时也可见) */}
            <span className="min-h-9 py-1 text-xs text-ink-dim">身价 {formatMoney(player.netWorth)}</span>
          </div>
          {/* 卡区:珍宝 + 名士。素材图属旧 render/assets 体系,阶段 6 再接;先用文字卡占位。
              #32 按钮体系:卡 chip 统一 min-h-10(触屏 ≥40px 点击区)+ items-center +
              rounded + px-2.5 gap-1.5,与头部 chip / 按钮同圆角同间距,列高一致。 */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {player.treasures.map((t) => (
              <div
                key={t.id}
                data-testid={TESTIDS.handTreasure(t.id)}
                title={`Lv${t.level}`}
                className="inline-flex min-h-10 cursor-pointer items-center rounded border border-gold/60 bg-panel-hi px-2.5 text-xs leading-none hover:border-gold hover:bg-panel"
                // UI F5:cursor-pointer 不再撒谎——点击弹出详情卷轴(对照旧 showHandDetail)
                onClick={() => {
                  setCardDetail({ kind: "treasure", card: t });
                  onCardDetailOpen?.(); // G-17:卡详情卷轴打开时关掉城详情卷轴
                }}
              >
                <span className="text-gold">◆</span> {t.name} <span className="text-ink-dim">Lv{t.level}</span>
              </div>
            ))}
            {player.heroes.map((h) => (
              <div
                key={h.id}
                data-testid={TESTIDS.handHero(h.id)}
                title={h.title}
                className="inline-flex min-h-10 cursor-pointer items-center rounded border border-gold/60 bg-panel-hi px-2.5 text-xs leading-none hover:border-gold hover:bg-panel"
                // UI F5:同上,名士详情卷轴
                onClick={() => {
                  setCardDetail({ kind: "hero", card: h });
                  onCardDetailOpen?.(); // G-17:同上,双层卷轴互斥
                }}
              >
                <span className="text-danger">帥</span> {h.name} <span className="text-ink-dim">{h.title}</span>
              </div>
            ))}
            {/* 空状态(对照旧 renderHand「暂无珍宝 · 名士」) */}
            {player.treasures.length === 0 && player.heroes.length === 0 && (
              <span className="text-xs text-ink-dim">暂无珍宝 · 名士</span>
            )}
          </div>
        </div>
      )}
      {/* 动作区:签面 + 行军 + 内嵌决策(所有按钮 disabled 绑定 interactive,单一来源 store)。
          W3:行军(primary)独占一行,内嵌决策另起一行——primary text-base 与 xs 混排
          会让基线错位、视觉重心漂移,分行后主次一眼可分。
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
                   可掷=实心金底+深墨字+呼吸光晕(game-hud.css 的 keyframe,经 Tailwind
                   任意值 animate-[...] 挂载);禁用=金描边灰底 + text-ink-dim
                   (替代整按钮 opacity 压暗,原因旁注仍由 F1 提供)。 */
                className={
                  "h-11 min-w-24 cursor-pointer rounded border-2 px-5 font-brush text-lg leading-none transition-colors " +
                  (reason === null
                    ? "border-gold bg-gold/80 text-ink hover:bg-gold animate-[game-cta-breathe_2s_ease-in-out_infinite]"
                    : "border-gold/50 bg-gold/15 text-ink-dim enabled:hover:bg-gold/40 disabled:cursor-not-allowed"
                )}
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
      {/* UI F5:珍宝/名士详情卷轴(点卡弹出;只读,唯一交互是关闭) */}
      {cardDetail && <CardDetailScroll detail={cardDetail} onClose={() => setCardDetail(null)} />}
    </section>
  );
}

