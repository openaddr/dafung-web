// 货币格式化单测(#299 重标定:唯一单位「两」,千分位;≤0 → 「0 两」)。
import { describe, it, expect } from "bun:test";
import { formatMoney } from "@core/money";

describe("formatMoney(#299 重标定)", () => {
  it("千分位分组 + 「两」后缀", () => {
    expect(formatMoney(999)).toBe("999 两");
    expect(formatMoney(1000)).toBe("1,000 两");
    expect(formatMoney(15000)).toBe("15,000 两");
    expect(formatMoney(30000)).toBe("30,000 两");
    expect(formatMoney(1234567)).toBe("1,234,567 两");
  });

  it("≤0 一律「0 两」", () => {
    expect(formatMoney(0)).toBe("0 两");
    expect(formatMoney(-1)).toBe("0 两");
    expect(formatMoney(-30000)).toBe("0 两");
  });
});
