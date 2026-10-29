// 货币格式化单测(#299 重标定:唯一单位「两」;#745 千分位退役=裸数;0 → 「0 两」,负数契约违例抛)。
import { describe, it, expect } from "bun:test";
import { formatMoney } from "@core/money";

describe("formatMoney(#299 重标定)", () => {
  it("裸数 + 「两」后缀(#745 千分位退役,弹层/常驻层口径归一)", () => {
    expect(formatMoney(999)).toBe("999 两");
    expect(formatMoney(1000)).toBe("1000 两");
    expect(formatMoney(15000)).toBe("15000 两");
    expect(formatMoney(30000)).toBe("30000 两");
    expect(formatMoney(1234567)).toBe("1234567 两");
  });

  it("0 显「0 两」;负数 = 符号 bug,契约违例抛(2026-10-17 收紧)", () => {
    expect(formatMoney(0)).toBe("0 两");
    expect(() => formatMoney(-1)).toThrow(/负数/);
    expect(() => formatMoney(-30000)).toThrow(/负数/);
  });
});
