// 货币格式化(#299 重标定):唯一单位「两」。内部 cash 即两,无换算层;
// 显示 = 千分位 + 「两」后缀(如 30000 → "30,000 两");0 显「0 两」;
// 负数 = 调用方符号 bug,契约违例直接抛(2026-10-17 收紧,#566「差 0 两」的旧钳位退役——
// 静默钳零曾把符号算反掩盖成「金额显示 0」)。
export function formatMoney(cash: number): string {
  if (cash < 0) throw new Error(`formatMoney 收到负数 ${cash}:符号 bug,契约违例当场炸出`);
  if (cash === 0) return "0 两";
  return `${String(cash).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} 两`;
}
