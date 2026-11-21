// 组件收口：复用动作条和 Base UI Button，触发卡从手牌架上缘展开。
// 行殇的目标既定，放逐从候选笺点选。联机停摆超时由权威侧应答「暂不发」。
import { Button } from "@base-ui/react/button";
import { TargetActionBar, TargetActionButton } from "./TargetActionBar";
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
    <TargetActionBar
      className="skill-banner"
      testId={TESTIDS.skillChoiceBanner}
      title={<span data-testid={TESTIDS.skillChoiceText}>{text}</span>}
      actions={
        <>
          {seats.length > 0 && (
            <div className="skill-banner-seats">
              {seats.map(({ seat, label }) => (
                <Button
                  key={seat}
                  type="button"
                  data-testid={TESTIDS.skillChoiceSeat(seat)}
                  className={"skill-banner-seat-chip" + (pickedSeat === seat ? " picked" : "")}
                  aria-pressed={pickedSeat === seat}
                  onClick={() => onPickSeat(seat)}
                >
                  {label}
                </Button>
              ))}
            </div>
          )}
          <TargetActionButton data-testid={TESTIDS.skillChoiceDecline} onClick={onDecline}>
            暂不发
          </TargetActionButton>
          <TargetActionButton
            variant="commit"
            data-testid={TESTIDS.skillChoiceConfirm}
            disabled={!confirmEnabled}
            onClick={onConfirm}
          >
            发动
          </TargetActionButton>
        </>
      }
    />
  );
}
