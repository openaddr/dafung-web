// 反应窗横幅(#281,#234 P1-D「牌架即反应窗」):结算事件横幅从手牌架上缘长出——
// 左段事件文案 + 右段朱砂倒计时弧;落印确认墨钮 / 不用 / 降噪口「本回合不再询问」。
// AOE 全体域(横征暴敛等)追加选份候选笺行:点笺=定被保护份(含自己),再落印确认;
// 单目标/半路杀出免选。交互语义自持(真按钮,不自写 role);样式在 reaction-banner.css。
//
// 倒计时弧与权威侧定时器同源:时长由 GameScreen 传入(fx/timings.ts REACTION,与
// LocalController 同一常量同一缩放),起点=本件挂载(窗开=快照落地),到点自动收回
// 视为「不用」——代发命令归权威侧(LocalController/联机 room 循环),本件只呈现。
import { useEffect, useRef, useState } from "react";
import { TESTIDS } from "./testids";
import "./reaction-banner.css";

export interface ReactionBannerProps {
  /** 左段事件文案(单机/联机同构,GameScreen 组装:「X 使用【火烧连营】」等)。 */
  text: string;
  /** 倒计时总时长(ms):与权威侧定时器同源同长(timings.ts REACTION)。 */
  durationMs: number;
  /** AOE 选份候选座位集(空=免选)。 */
  shareSeats: number[];
  /** 已选被保护份(null=未选;shareSeats 非空时未选则落印禁用)。 */
  shareSeat: number | null;
  onPickShare: (seat: number) => void;
  /** 候选笺文案(座位 → 国号,GameScreen 从快照取)。 */
  seatLabel: (seat: number) => string;
  /** 落印确认可用性(选中反应牌且份已定)。 */
  confirmEnabled: boolean;
  onConfirm: () => void;
  onDecline: () => void;
  onMute: () => void;
}

/** 倒计时弧几何:SVG 圆周dasharray 收敛(viewBox 36,半径 15,周长 2π·15)。 */
const ARC_R = 15;
const ARC_C = 2 * Math.PI * ARC_R;

/** 结算事件横幅(定位/挂载归 HandRack:架即反应窗,横幅从架上缘长出)。 */
export function ReactionBanner({
  text,
  durationMs,
  shareSeats,
  shareSeat,
  onPickShare,
  seatLabel,
  confirmEnabled,
  onConfirm,
  onDecline,
  onMute,
}: ReactionBannerProps) {
  // 剩余时间比例(rAF 收敛):起点=挂载(窗开);到点本件收回——「不用」的代发归权威侧
  //(LocalController 定时器/联机 room 循环),两端同一 REACTION 常量,同源同长。
  const start = useRef<number>(0);
  const [frac, setFrac] = useState(1);
  useEffect(() => {
    start.current = performance.now();
    let raf = 0;
    const tick = () => {
      const left = Math.max(0, 1 - (performance.now() - start.current) / durationMs);
      setFrac(left);
      if (left > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);
  if (frac <= 0) return null; // 到点自动收回(视为不用;权威侧随后同步真态)

  return (
    <div className="reaction-banner" data-testid={TESTIDS.reactionBanner}>
      <span className="reaction-text" data-testid={TESTIDS.reactionText}>
        {text}
      </span>
      {shareSeats.length > 0 && (
        <span className="reaction-shares">
          {shareSeats.map((seat) => (
            <button
              key={seat}
              type="button"
              data-testid={TESTIDS.reactionSeat(seat)}
              className={"reaction-seat-chip" + (shareSeat === seat ? " picked" : "")}
              aria-pressed={shareSeat === seat}
              onClick={() => onPickShare(seat)}
            >
              {seatLabel(seat)}
            </button>
          ))}
        </span>
      )}
      <button
        type="button"
        className="reaction-btn mo"
        data-testid={TESTIDS.reactionConfirm}
        disabled={!confirmEnabled}
        onClick={onConfirm}
      >
        落印
      </button>
      <button
        type="button"
        className="reaction-btn qian"
        data-testid={TESTIDS.reactionDecline}
        onClick={onDecline}
      >
        不用
      </button>
      <button
        type="button"
        className="reaction-mute"
        data-testid={TESTIDS.reactionMute}
        onClick={onMute}
      >
        本回合不再询问
      </button>
      <svg
        className="reaction-timer"
        data-testid={TESTIDS.reactionTimer}
        viewBox="0 0 36 36"
        aria-hidden="true"
        focusable="false"
      >
        <circle className="track" cx="18" cy="18" r={ARC_R} />
        <circle
          className="arc"
          cx="18"
          cy="18"
          r={ARC_R}
          strokeDasharray={ARC_C}
          strokeDashoffset={ARC_C * (1 - frac)}
        />
      </svg>
    </div>
  );
}

/** 反应窗被询问判定(UI 消费快照 reaction 的统一口径):jinnang 窗按公告询问集
 *  (联机已按座位投影,march 窗按城主)。控制器侧各有同公式镜像(分层不互引,
 *  bot.ts/local.ts 指纹先例),改引擎 reactionQueriedOf 时三处同改。 */
export function reactionQueriedMe(
  view: { kind: "jinnang"; queriedBySeat: number[] } | { kind: "march"; ownerSeat: number },
  seat: number,
): boolean {
  return view.kind === "jinnang" ? view.queriedBySeat.includes(seat) : view.ownerSeat === seat;
}
