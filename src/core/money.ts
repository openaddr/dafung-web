// 货币格式化(#299 重标定):唯一单位「两」。内部 cash 即两,无换算层;
// 显示 = 千分位 + 「两」后缀(如 30000 → "30,000 两");≤0 一律显示「0 两」。
export function formatMoney(cash: number): string {
  if (cash <= 0) return "0 两";
  return `${String(cash).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} 两`;
}
