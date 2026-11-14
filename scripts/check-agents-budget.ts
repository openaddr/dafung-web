// AGENTS.md 体量闸(ADR-0033 修订节;#1337 拍板、#1338 落地):双档机械制。
//   硬闸 14KB:超闸禁合并——净增长须等量置换(挤掉等量旧文),「冻结+置换」为反复胖机制。
//   方向性 10KB:达阵线——超线即触发瘦身票(#1452 第三修订节;2026-11-09「超线提醒放行」口径已废)。
// 2026-11-09「诚实底线 13.8KB」已被第三修订节推翻:该底线测于「十条常驻」分级,#1442 指针式 + #1452 下沉/电报化后 10KB 可达。
import { statSync } from "node:fs";

const HARD = 14 * 1024;
const SOFT = 10 * 1024;

const agentsPath = new URL("../AGENTS.md", import.meta.url);
const size = statSync(agentsPath).size;
const kb = (size / 1024).toFixed(1);

if (size > HARD) {
  console.error(
    `[agents-budget] ✗ AGENTS.md ${size}B(${kb}KB)超硬闸 ${HARD / 1024}KB——新增须等量置换旧文,闸口径见 docs/adr/0033 修订节`,
  );
  process.exit(1);
}
if (size > SOFT) {
  console.log(`[agents-budget] ⚠ AGENTS.md ${kb}KB 超方向性预算 10KB(硬闸内放行;增量优先置换旧文)`);
} else {
  console.log(`[agents-budget] ✓ AGENTS.md ${kb}KB,在方向性预算内`);
}
