// 手牌区(#700 全浮层骨架,原型 tmp/席位侧列原型.html ①handzone 判决移植):
// 底缘透明浮置容器,签面驻左端 + 锦囊手牌架(漆木条随仪表条退役,架体透明化)。
// 显隐账本在 GameScreen(锦囊圆钮开关 + 窗态强制),本件只呈现。
// 签面(原仪表条「签」徽章平移,testid dice-face 不变):驻留上轮点数;待起摇
// (#530)转「待」浅印 + 呼吸金边——UI 状态变化承载(DESIGN §4.6,不加文字标牌)。
import type { ReactNode } from "react";
import type { GameSnapshot, SnapshotPlayer } from "@app/store/gameStore";
import { ATTR_TIPS, Tip } from "./Tip";
import { TESTIDS } from "./testids";
import "./layout.css";

// 签面数字 → 汉字(原 dice-face 一~六 的展示口径,自 DashboardBar 平移)
const DIE_FACE = ["一", "二", "三", "四", "五", "六"];

export interface HandZoneProps {
  snapshot: GameSnapshot;
  /** 本地视角玩家(对局屏挂载期恒在座)。 */
  player: SnapshotPlayer;
  /** 托管态(useAutopilotOn 单源;待起摇判定免误报)。 */
  autopilotOn: boolean;
  children: ReactNode;
}

/** 底缘透明手牌区:签面(左端)+ 手牌架。 */
export function HandZone({ snapshot, player, autopilotOn, children }: HandZoneProps) {
  // 待起摇(#530):本端座位轮到且停在 Roll 等待态(自动起摇在途,~1.8s)——签面
  // 驻留的是上轮点数,静置即误导。托管中由 bot 代打(Roll 不经等待态),不提示。
  const awaitingMyRoll =
    !autopilotOn &&
    snapshot.turnPhase === "Roll" &&
    snapshot.players[snapshot.activeIndex]?.id === player.id;
  return (
    <div className="handzone" data-testid={TESTIDS.handZone}>
      <Tip
        tip={ATTR_TIPS.sign}
        testId={TESTIDS.diceFace}
        className={"diceseal" + (awaitingMyRoll ? " await" : "")}
      >
        {awaitingMyRoll ? "待" : snapshot.lastRoll ? DIE_FACE[snapshot.lastRoll.die - 1] : "签"}
      </Tip>
      {children}
    </div>
  );
}
