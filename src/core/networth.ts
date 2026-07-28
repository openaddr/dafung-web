// 身价计算:现金 + 地产账面价值(+ 股票市值,v2.0 无股票)。单一口径,被胜利判定/排行榜/破产裁决复用。
// 对应 C# 版 Economy/NetWorthCalculator.cs。
import type { Player } from "./types";

/**
 * 净资产 = 仅现金(珍宝、城池账面均不计入)。
 * 设计决策:迫使玩家管理现金流——买城/扩军直接降净资产,只有都城补给、赠宝赏银、
 * 贸易售价这些"现金流入"才能推高净资产达终局。囤珍宝/囤城不能赢。
 */
export function netWorth(player: Player): number {
  return player.cash;
}
