// 侧栏·手牌 + 动作区(对照旧 renderHand + action-zone):
// 头部:现金 / 委任状 / 国号;卡区:珍宝 + 名士(点击看详情卷轴——本阶段只留挂点);
// 动作区:签面 + 行军按钮 + 内嵌常规决策按钮(买/扩军/驻跸/选路,对照 renderActionInline)。
import { useState } from "react";
import { rgba, playerColor } from "@core/theme";
import { formatMoney } from "@core/money";
import type { GameCommand } from "@core/types";
import type { GameSnapshot } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import type { GameController } from "@app/controllers/controller";
import { TESTIDS } from "./testids";

// 签面数字 → 汉字(旧 dice-face 一~六 的展示口径)
const DIE_FACE = ["一", "二", "三", "四", "五", "六"];

interface HandPanelProps {
  snapshot: GameSnapshot;
  /** 本地视角玩家(热座=活跃人类;联机=自己)。null = 未入座,只渲染空态。 */
  player: GameSnapshot["players"][number] | null;
  controller: GameController | null;
  interactive: boolean;
}

export function HandPanel({ snapshot, player, controller, interactive }: HandPanelProps) {
  // 托管(联机):生效态从 netStore 的 seats 广播回读;速度是本地 UI 态(切速时若在托管中立即重发)
  const net = useNetStore();
  const [autopilotSpeed, setAutopilotSpeed] = useState<"fast" | "slow">("fast");
  const autopilotOn = net.seats[net.mySeat]?.autoPilot ?? false;
  return (
    <section data-testid={TESTIDS.handPanel} className="flex min-h-0 flex-1 flex-col border-b border-gold/40">
      <h3 className="px-3 pt-2 font-brush text-base">手牌</h3>
      {!player ? (
        <div className="px-3 py-2 text-sm text-ink-dim">未入座</div>
      ) : (
        <div
          className="px-3"
          style={{ ["--player-color" as string]: rgba(playerColor(player.colorIndex)) }}
        >
          {/* 头部:现金/委任(可断言的核心数值)*/}
          <div className="flex items-center gap-2 text-sm">
            <span
              data-testid={TESTIDS.handCash}
              className="rounded bg-panel-hi px-2 py-0.5 font-brush text-money"
            >
              {formatMoney(player.cash)}
            </span>
            <span data-testid={TESTIDS.handWarrants} className="rounded bg-panel-hi px-2 py-0.5">
              委任 {player.warrants}
            </span>
          </div>
          {/* 卡区:珍宝 + 名士。素材图属旧 render/assets 体系,阶段 6 再接;先用文字卡占位 */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {player.treasures.map((t) => (
              <div
                key={t.id}
                data-testid={TESTIDS.handTreasure(t.id)}
                title={`Lv${t.level}`}
                className="cursor-pointer rounded border border-gold/60 bg-panel-hi px-2 py-1 text-xs hover:bg-panel"
                // TODO(阶段 5b/6):珍宝详情卷轴(旧 showHandDetail);本阶段点击暂无操作
                onClick={undefined}
              >
                <span className="text-gold">◆</span> {t.name} <span className="text-ink-dim">Lv{t.level}</span>
              </div>
            ))}
            {player.heroes.map((h) => (
              <div
                key={h.id}
                data-testid={TESTIDS.handHero(h.id)}
                title={h.title}
                className="cursor-pointer rounded border border-gold/60 bg-panel-hi px-2 py-1 text-xs hover:bg-panel"
                // TODO(阶段 5b/6):名士详情卷轴;本阶段点击暂无操作
                onClick={undefined}
              >
                <span className="text-danger">帥</span> {h.name} <span className="text-ink-dim">{h.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* 动作区:签面 + 行军 + 内嵌决策(所有按钮 disabled 绑定 interactive,单一来源 store) */}
      <div className="mt-2 flex flex-wrap items-center gap-2 px-3 pb-2">
        <span
          data-testid={TESTIDS.diceFace}
          className="rounded border border-gold/60 bg-panel-hi px-2 py-1 font-brush"
        >
          {snapshot.lastRoll ? DIE_FACE[snapshot.lastRoll.die - 1] ?? "签" : "签"}
        </span>
        <button
          type="button"
          data-testid={TESTIDS.rollButton}
          disabled={!interactive || snapshot.turnPhase !== "Roll"}
          onClick={() => controller?.roll()}
          className="rounded border border-gold bg-gold/20 px-4 py-1 font-brush text-lg enabled:hover:bg-gold/40 disabled:opacity-40"
        >
          行军
        </button>
        <ActionInline snapshot={snapshot} controller={controller} interactive={interactive} />
      </div>
      {/* 托管行(仅联机可见;单机控制器 autopilotSupported=false):托管中服务器 bot 代打,
          interactive 被锁,本地只旁观。对照旧 client-controller 的 autopilot-row。 */}
      {controller?.autopilotSupported && (
        <div className="flex items-center gap-2 px-3 pb-2 text-xs text-ink-dim">
          <button
            type="button"
            data-testid={TESTIDS.autopilotButton}
            onClick={() => controller.setAutoPilot(!autopilotOn, autopilotSpeed)}
            className="rounded border border-ink/40 bg-panel-hi px-2 py-0.5 font-deco hover:bg-panel cursor-pointer"
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
            className="rounded border border-ink/30 bg-bg px-1 py-0.5 font-deco text-ink-dim"
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

/** 内嵌常规决策(对照旧 renderActionInline):驻跸/选路/买地/扩军。
 *  复杂相位(招贤/珍宝交涉/破产)不在侧栏,由卷轴弹层负责(阶段 5b/6)。 */
function ActionInline({
  snapshot,
  controller,
  interactive,
}: {
  snapshot: GameSnapshot;
  controller: GameController | null;
  interactive: boolean;
}) {
  if (!interactive || snapshot.phase !== "Playing") return null;
  const dispatch = (cmd: GameCommand) => controller?.dispatchCommand(cmd);
  const add = (label: string, action: string, cmd: GameCommand, opts: { primary?: boolean; disabled?: boolean } = {}) => (
    <button
      type="button"
      key={action}
      data-testid={TESTIDS.actionButton(action)}
      disabled={opts.disabled}
      onClick={() => dispatch(cmd)}
      className={`rounded border px-2 py-0.5 text-xs ${opts.primary ? "border-gold bg-gold/20 font-brush text-base" : "border-ink/30 hover:bg-panel-hi"} disabled:opacity-40`}
    >
      {label}
    </button>
  );

  const tp = snapshot.turnPhase;
  if (tp === "AwaitingCapitalHalt" && snapshot.lastMove) {
    // 驻跸抉择:目的地城名需要 catalog(经控制器引擎读;联机只读引擎同样可查)
    const engine = controller?.engine;
    const capName = engine?.board.at(snapshot.lastMove.capitalIndex)?.name ?? "都城";
    const destName = engine?.board.at(snapshot.lastMove.landIndex)?.name ?? "下一城";
    return (
      <div data-testid={TESTIDS.actionInline} className="flex gap-2">
        {add(`驻跸·${capName}`, "halt", { type: "haltAtCapital" }, { primary: true })}
        {add(`继续→${destName}`, "continue", { type: "continueMove" })}
      </div>
    );
  }
  if (tp === "AwaitingBranch") {
    return (
      <div data-testid={TESTIDS.actionInline} className="flex gap-2">
        {add("走大路", "main", { type: "selectBranch", kind: "Main" }, { primary: true })}
        {add("入辅路", "branch", { type: "selectBranch", kind: "Branch" })}
      </div>
    );
  }
  if (tp === "AwaitingDecision") {
    const p = snapshot.players[snapshot.activeIndex];
    const def = snapshot.lastLandOutcomeProperty
      ? controller?.engine.catalog.get(snapshot.lastLandOutcomeProperty)
      : null;
    if (snapshot.lastLandOutcomeKind === "PropertyAvailable" && def) {
      const canBuy = p.cash >= def.purchasePrice && p.warrants >= 1;
      const reason = p.warrants < 1 ? "委任状不足" : "银两不足";
      return (
        <div data-testid={TESTIDS.actionInline} className="flex gap-2">
          {add(
            canBuy ? `购地 ${formatMoney(def.purchasePrice)}·1委任` : `购地(${reason})`,
            "buy",
            { type: "buyProperty" },
            { primary: canBuy, disabled: !canBuy },
          )}
          {add("不取", "skip", { type: "endDecision" })}
        </div>
      );
    }
    if (snapshot.lastLandOutcomeKind === "OwnProperty" && def) {
      const h = p.properties.find((x) => x.propertyId === def.id);
      const lvl = h?.level ?? 0;
      const canUp = lvl < def.maxLevel && p.cash >= def.upgradeCost;
      return (
        <div data-testid={TESTIDS.actionInline} className="flex gap-2">
          {add(
            canUp ? `扩军 ${formatMoney(def.upgradeCost)}` : `扩军(${lvl >= def.maxLevel ? "满级" : "银两不足"})`,
            "upgrade",
            { type: "upgradeProperty" },
            { primary: canUp, disabled: !canUp },
          )}
          {add("按兵不动", "skip", { type: "endDecision" })}
        </div>
      );
    }
  }
  return null;
}
