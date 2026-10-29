// 反应窗横幅(#281,#234 P1-D「牌架即反应窗」;#751 精修,#760 倒计时信号重校):
// 结算事件横幅从手牌架上缘长出——左段倒计时弧嵌剩余秒数(#751 A5:阅读序前置;
// #760:常态弧墨金弱轨 inkwash,≤5s 转 danger 档=朱砂弧+秒数、2Hz 呼吸脉动、
// 每秒滴答音)+
// 来者锦囊 mini 签面(#751 A6,复用 JinnangCardFace 器物语言)+ 事件文案;落印确认
// 墨钮 / 不用 / 降噪口「本回合不再询问」(mute 移按钮行末位并与拍板钮拉开间距,
// #751 A4 防误触)。AOE 全体域(横征暴敛等)追加选份候选笺行:点笺=定被保护份
//(含自己),再落印确认;单目标/半路杀出免选。交互语义自持(真按钮,不自写 role);
// 样式在 reaction-banner.css。
//
// 倒计时弧与权威侧定时器同源(#284 单源收口):时长=GameScreen 传入的 view.windowMs
//  (引擎查 core/constants 表写入、随快照走)经 fx/timings.ts scaleReactionMs 缩放,
// 起点=本件挂载(窗开=快照落地),到点自动收回视为「不用」——代发命令归权威侧
//(LocalController 定时器/联机 room 循环),本件只呈现。
import { useEffect, useRef, useState } from "react";
import { JinnangCardFace } from "@app/components/card/JinnangCardFace";
import { getAudio } from "@app/fx/audio";
import { TESTIDS } from "./testids";
import "./reaction-banner.css";

export interface ReactionBannerProps {
  /** 左段事件文案(单机/联机同构,GameScreen 组装:「X 使用【火烧连营】」等)。 */
  text: string;
  /** 来者锦囊 id(#751 A6):行首 mini 签面锚点(jinnang 窗必有;march 窗无牌不挂)。 */
  cardId?: string;
  /** 倒计时总时长(ms):与权威侧定时器同源同长(view.windowMs 经 scaleReactionMs,#284)。 */
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
  cardId,
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
  //(LocalController 定时器/联机 room 循环),时长同源见文件头注释(#284 windowMs 单源)。
  // 危急滴答(#760):同一 rAF 拍内判秒——≤5s 段每跨一秒(秒数变化且 ≥1)播一记
  // reactionTick,调度与倒计时同源不另起定时器;reduced-motion 只退动效,滴答音保留。
  const start = useRef<number>(0);
  const tickedSecs = useRef<number | null>(null);
  const [frac, setFrac] = useState(1);
  useEffect(() => {
    start.current = performance.now();
    tickedSecs.current = null;
    let raf = 0;
    const tick = () => {
      const left = Math.max(0, 1 - (performance.now() - start.current) / durationMs);
      const secs = Math.max(0, Math.ceil((left * durationMs) / 1000));
      if (secs <= 5 && secs >= 1 && tickedSecs.current !== secs) {
        tickedSecs.current = secs;
        getAudio().play("reactionTick");
      }
      setFrac(left);
      if (left > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);
  if (frac <= 0) return null; // 到点自动收回(视为不用;权威侧随后同步真态)

  // 剩余秒数(#751 A5):弧心嵌数,数字=信息属 §4.6 例外;≤5s 转 danger 档
  //(数字转朱砂、弧转朱砂亮档,#760 重校:常态弧退墨金弱轨 inkwash,朱砂留给危急;
  // 危急段弧与秒数 2Hz 呼吸脉动+每秒滴答,旧一次性入场脉动已由持续脉动取代)。
  const secs = Math.max(0, Math.ceil((frac * durationMs) / 1000));
  const danger = secs <= 5;

  return (
    <div className="reaction-banner" data-testid={TESTIDS.reactionBanner}>
      {/* 弧+秒数(#751 A5):阅读序前置——「还剩多久」先于「发生了什么」;testid 挂
          盒子(svg 在内,e2e 可见性断言零漂移);秒数是真信息,不 aria-hidden。 */}
      <span
        className={"reaction-timerbox" + (danger ? " danger" : "")}
        data-testid={TESTIDS.reactionTimer}
      >
        <svg className="reaction-timer" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
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
        <span className="reaction-timer-num">{secs}</span>
      </span>
      {/* 来者锦囊 mini 签面(#751 A6):卡面是既有器物语言非新增标牌;纯装饰锚点
          (文案已带牌名,读屏不重念),march 窗无牌不挂。 */}
      {cardId != null && (
        <JinnangCardFace cardId={cardId} className="reaction-mini" aria-hidden="true" />
      )}
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
      {/* 降噪口(#751 A4):移按钮行末位并与拍板钮拉开一档间距(≥12px)——即效语义
          不动,与「不用」的近邻误触面拆掉。 */}
      <button
        type="button"
        className="reaction-mute"
        data-testid={TESTIDS.reactionMute}
        onClick={onMute}
      >
        本回合不再询问
      </button>
    </div>
  );
}
