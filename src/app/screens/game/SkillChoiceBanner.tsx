// 组件收口:保留现实现——#1378「你可」选择闸触发卡:反应窗同形横幅(落印/不用同款
// 裸钮,非弹层不夺焦;细则 docs/design/组件收口.md)
// 「你可」触发卡(#1378,#1377 选择闸的呈现面):待决技触发卡从手牌架上缘长出——
// 文案段(「X「放逐」可达发动条件…」)+ 目标候选笺行(放逐选人:点笺=选中/再点同笺
// 取消,复用反应窗 AOE 选份笺形)+ 发动墨钮 / 暂不发漆钮。行殇目标既定(载荷
// targetSeat)免选,文案带目标括注;交互语义自持(真按钮,不自写 role)。
// 样式在 skill-choice-banner.css(独立类名,反应窗按钮种口径:墨钮/同底漆钮;
// reaction-btn 作用域锁 .reaction-banner 内,不跨件复用选择器——ReactionBanner 同判词)。
// 无倒计时弧:引擎对此窗无窗级 deadline(单机决策不限时;联机停摆超时=权威侧看门狗
// 代发「暂不发」,#1378 真修,窗长不经快照下发,客户端无源可映)——呈现零自造定时。
// 超时语义归权威侧(暂不发,标记保留);本件只呈现与发命令。
import { TESTIDS } from "./testids";
import "./skill-choice-banner.css";

/** 目标候选笺载荷(GameScreen 从快照 choices 派生,ADR-0013 唯一可用性口径)。 */
export interface SkillChoiceSeatOption {
  seat: number;
  label: string;
}

interface SkillChoiceBannerProps {
  /** 文案段(技名+发动询问;GameScreen 组装,与引擎挂问战报同款措辞)。 */
  text: string;
  /** 目标候选笺(放逐选人;行殇目标既定=空数组,免选)。 */
  seats: SkillChoiceSeatOption[];
  /** 已选目标座位(null=未选;seats 非空时未选则发动钮禁用)。 */
  pickedSeat: number | null;
  onPickSeat: (seat: number) => void;
  /** 发动可用性(行殇恒可;放逐=已选目标)。 */
  confirmEnabled: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}

/** 「你可」触发卡(定位/挂载归 HandRack:架即反应窗,卡从架上缘长出)。 */
export function SkillChoiceBanner({
  text,
  seats,
  pickedSeat,
  onPickSeat,
  confirmEnabled,
  onConfirm,
  onDecline,
}: SkillChoiceBannerProps) {
  return (
    <div className="skill-banner" data-testid={TESTIDS.skillChoiceBanner}>
      <span className="skill-banner-text" data-testid={TESTIDS.skillChoiceText}>
        {text}
      </span>
      {seats.length > 0 && (
        <span className="skill-banner-seats">
          {seats.map(({ seat, label }) => (
            <button
              key={seat}
              type="button"
              data-testid={TESTIDS.skillChoiceSeat(seat)}
              className={"skill-banner-seat-chip" + (pickedSeat === seat ? " picked" : "")}
              aria-pressed={pickedSeat === seat}
              onClick={() => onPickSeat(seat)}
            >
              {label}
            </button>
          ))}
        </span>
      )}
      <button
        type="button"
        className="skill-banner-btn mo"
        data-testid={TESTIDS.skillChoiceConfirm}
        disabled={!confirmEnabled}
        onClick={onConfirm}
      >
        发动
      </button>
      <button
        type="button"
        className="skill-banner-btn qian"
        data-testid={TESTIDS.skillChoiceDecline}
        onClick={onDecline}
      >
        暂不发
      </button>
    </div>
  );
}
