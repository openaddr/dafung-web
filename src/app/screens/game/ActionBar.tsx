// 动作条(#256 军师窗态,军师幕弹窗退役的落点件):斗地主式两段动作条,居中浮于
// 仪表条上缘(原型 tmp/prototype-layout.html .actionbar 移植,bottom 184px)。
// **锚条不锚牌**——空手牌时按钮仍在;选中放大牌占中时整条右让(margin-left:240px,
// 原型口径)不遮牌面。两段拍板口径:
//   卡牌段 =「出牌 / 不出」:出牌=选中项确认(未选中禁用),不出=今不用(牌不消耗);
//   目标段 =「选择目标 / 作罢」:选择目标是信息标签(非按钮),作罢=收回此计牌
//   (不消耗、不记冷却)。点席位即出免二次确认(SeatRail 点击层直发,不过本条)。
// 按钮种(DESIGN §4.2):出牌=墨钮(lacquer 实底+lacquerGold 字,启用态金内环即
// 原型 .armed);不出/作罢=原型 .qian 同底漆钮。字体按 §4.3 新文案红线落 font-brush
// (原型的小薇禁新用);样式在 layout.css(.game-layout 作用域)。
import { TESTIDS } from "./testids";

export type ActionBarSegment = "card" | "target";

export interface ActionBarProps {
  segment: ActionBarSegment;
  /** 卡牌段「出牌」可用性(有选中且可用);目标段不消费。 */
  playEnabled: boolean;
  /** 卡牌段「出牌」(发 useJinnang/useHeroSkill)。 */
  onPlay: () => void;
  /** 卡牌段=不出(useJinnang cardId:null);目标段=作罢(cancel:true)。 */
  onPass: () => void;
  /** 选中放大牌占中 → 整条右让(原型 margin-left:240px);目标段不右让。 */
  rightShift: boolean;
}

export function ActionBar({ segment, playEnabled, onPlay, onPass, rightShift }: ActionBarProps) {
  return (
    <div
      data-testid={TESTIDS.actionbar}
      className={"actionbar" + (rightShift ? " right-shift" : "")}
    >
      {segment === "card" ? (
        <>
          <button
            type="button"
            data-testid={TESTIDS.actionbarPlay}
            className="actionbar-btn mo"
            disabled={!playEnabled}
            onClick={onPlay}
          >
            出牌
          </button>
          <button type="button" data-testid={TESTIDS.actionbarPass} className="actionbar-btn qian" onClick={onPass}>
            不出
          </button>
        </>
      ) : (
        <>
          <span data-testid={TESTIDS.actionbarTarget} className="actionbar-lab">
            选择目标
          </span>
          <button type="button" data-testid={TESTIDS.actionbarCancel} className="actionbar-btn qian" onClick={onPass}>
            作罢
          </button>
        </>
      )}
    </div>
  );
}
