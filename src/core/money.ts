// 货币格式化:锭 / 两 / 分,百进制。
// 进位:1 锭 = 100 两,1 两 = 100 分(1两=100分 合古制:1两=10钱=100分,此处略去"钱"档)。
// 内部 cash 即"分"(最小单位),直接按分数分组显示。
// 例:4→4分,120→1两20分,400→4两,2500→25两,8000→80两,12000→1锭20两。
const FEN_PER_LIANG = 100;   // 1两 = 100分
const FEN_PER_DING = 10000;  // 1锭 = 100两 = 10000分

export function formatMoney(cash: number): string {
  if (cash <= 0) return "0分";
  const ding = Math.floor(cash / FEN_PER_DING);
  const rem = cash % FEN_PER_DING;
  const liang = Math.floor(rem / FEN_PER_LIANG);
  const fen = rem % FEN_PER_LIANG;
  const parts: string[] = [];
  if (ding) parts.push(`${ding}锭`);
  if (liang) parts.push(`${liang}两`);
  if (fen) parts.push(`${fen}分`);
  return parts.join("") || "0分";
}
