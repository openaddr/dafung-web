// AGENTS.md 体量闸(ADR-0033 修订节;#1337 拍板、#1338 落地):双档机械制。
//   硬闸 14KB:超闸禁合并——净增长须等量置换(挤掉等量旧文),「冻结+置换」为反复胖机制。
//   方向性 10KB:超线提醒不拦,逐行裁断优先于凑数(原 ADR-0033 口径)。
// 2026-11-09 实测诚实底线 13.8KB:10KB 经全量去重不可达(红线本体合法增长),取冻结达标而非凑数达标。
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
