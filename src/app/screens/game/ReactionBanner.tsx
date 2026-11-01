// 反应窗横幅(#281,#234 P1-D「牌架即反应窗」;#751 精修,#760 倒计时信号重校):
// 结算事件横幅从手牌架上缘长出——左段倒计时弧嵌剩余秒数(#751 A5:阅读序前置;
// #760:常态弧墨金弱轨 goldWash,≤5s 转 danger 档=朱砂弧+秒数、2Hz 呼吸脉动、
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

/** 倒计时弧几何:SVG 圆周收敛(viewBox 36,半径 15);周长 2π·15 ≈ 94.2478 作
 *  dasharray 与收敛终点,单源在 reaction-banner.css(.reaction-timer .arc)。 */
const ARC_R = 15;

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
  // 倒计时三通路(#1022 渲染税收口,rAF 逐帧 setState 驱动整条横幅退役):
  // ① 弧=CSS 动画扛(挂载拍声明 reaction-arc-drain,时长经 --reaction-dur 内联直供
  //    animation-duration——durationMs 已过 scaleReactionMs 缩放单源,缩放通道天然
  //    保住),逐帧工作归浏览器渲染管线;
  // ② 秒数/危险档/危急滴答=1Hz interval 一拍管三事:秒数 ref 直写 textContent(不进
  //    React 状态)、危险档 ≤5s 翻面每窗至多一次 setState(已翻即 bailout)、滴答音
  //    每秒一记挪 1Hz 拍(秒界判定与 rAF 版逐帧判等价);
  // ③ 到点收回=精确 setTimeout(durationMs 拍)补位,不靠 1Hz 粗粒度——本件先于权威
  //    侧收回时视觉收回,「不用」代发仍归权威侧(LocalController 定时器/联机 room
  //    循环),先后语义与 rAF 版一致(#284 windowMs 单源)。
  // 后台标签页 interval/timeout 节流,回前台按挂载墙钟(start)重算追平——与 rAF 版
  // 「回前台下一拍按墙钟重算」语义等价。
  const start = useRef<number>(0);
  const tickedSecs = useRef<number | null>(null);
  const numRef = useRef<HTMLSpanElement | null>(null);
  // 首拍即真值(挂载渲染):初始秒数/危险档由 durationMs 直算,不占 setState 预算
  //(短窗 ≤5s 挂载即危险档,与 rAF 版首帧即翻一致)。
  const [expired, setExpired] = useState(false);
  const [danger, setDanger] = useState(() => Math.ceil(durationMs / 1000) <= 5);
  useEffect(() => {
    start.current = performance.now();
    tickedSecs.current = null;
    const beat = () => {
      const remain = durationMs - (performance.now() - start.current);
      if (remain <= 0) return; // 到点即停:秒数不下探 0,收回拍归 setTimeout(rAF 版断链同语义)
      const secs = Math.ceil(remain / 1000);
      if (numRef.current) numRef.current.textContent = String(secs);
      if (secs <= 5) {
        setDanger(true); // 危险档翻面(已翻即 bailout,Object.is)
        if (secs >= 1 && tickedSecs.current !== secs) {
          tickedSecs.current = secs;
          getAudio().play("reactionTick"); // 危急滴答(#760):每秒一记,挪 1Hz 拍
        }
      }
    };
    const iv = setInterval(beat, 1000);
    const to = setTimeout(() => {
      clearInterval(iv); // 收回拍接管,1Hz 拍即停(过期后本件仍挂载、返回 null)
      setExpired(true);
    }, durationMs);
    return () => {
      clearInterval(iv);
      clearTimeout(to);
    };
  }, [durationMs]);
  if (expired) return null; // 到点自动收回(视为不用;权威侧随后同步真态)

  // 剩余秒数(#751 A5):弧心嵌数,数字=信息属 §4.6 例外;≤5s 转 danger 档
  //(数字转朱砂、弧转朱砂亮档,#760 重校:常态弧退墨金弱轨 goldWash,朱砂留给危急;
  // 危急段弧与秒数 2Hz 呼吸脉动+每秒滴答)。秒数只在此处定初值,之后 1Hz 拍 ref
  // 直写,不走 React 状态(danger 翻面重渲不回写,textContent 保持现状)。
  const secs0 = Math.ceil(durationMs / 1000);

  return (
    <div className="reaction-banner" data-testid={TESTIDS.reactionBanner}>
      {/* 弧+秒数(#751 A5):阅读序前置——「还剩多久」先于「发生了什么」;testid 挂
          盒子(svg 在内,e2e 可见性断言零漂移);秒数是真信息,不 aria-hidden。
          弧收敛=CSS 动画(#1022):时长经 --reaction-dur 内联直供 animation-duration,
          文件内 reduced-motion 兜块以同变量反制 app.css M-4 全局兜层(弧=信息载体,
          保留走满时长),见 reaction-banner.css。 */}
      <span
        className={"reaction-timerbox" + (danger ? " danger" : "")}
        data-testid={TESTIDS.reactionTimer}
        style={{ ["--reaction-dur" as string]: `${durationMs}ms` }}
      >
        <svg className="reaction-timer" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
          <circle className="track" cx="18" cy="18" r={ARC_R} />
          <circle className="arc" cx="18" cy="18" r={ARC_R} />
        </svg>
        <span ref={numRef} className="reaction-timer-num">
          {secs0}
        </span>
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
