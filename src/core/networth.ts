// 身价计算:现金 + 地产账面价值(+ 股票市值,v2.0 无股票)。单一口径,被胜利判定/排行榜/破产裁决复用。
// 对应 C# 版 Economy/NetWorthCalculator.cs。
import type { Player } from "./types";
import { holdingBookValue } from "./types";

export function netWorth(player: Player): number {
  const propertyValue = player.properties.reduce(
    (sum, h) => sum + holdingBookValue(h),
    0,
  );
  return player.cash + propertyValue;
}
