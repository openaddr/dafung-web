// 退役口径词检查(2026-10-18,#586 复审实锤驱动):纪律/口径翻面后,旧口径词残留在
// 活文档里 = 说谎的现行指令——#581 翻面「主树直改」时漏扫派单模板「代理 jj 速查」
// 第 4 条,旧口径以现行指令身份又活了两小时,靠 Standards 复审才抓到。本脚本把
// 「翻面后残留」从仪式变成一条命令:RETIRE 清单里的词,全仓 md 扫描,命中即红。
//
// 豁免口径:同一行带翻面标记(退役/收窄/取代/已废/翻面/实锤)= 历史叙事或退役记录
// 本身,合法保留——与 GLOSSARY _Avoid_「已撤」标记同款约定。
// 翻面操作配方:旧词登记进 RETIRE → 全扫三处口径家(AGENTS.md / docs/how-to/
// 开发与测试.md / docs/agents/派单模板.md)改写 → 本脚本红转绿(派单模板 QC 检查单
// 有同款行)。
//
// 范围:jj 跟踪集全部 .md(同 check-doc-links 的遍历;gitignore 的 tmp/ 天然排除)。
// 用法:bun scripts/check-retired-phrases.ts
// 退出码:0=全绿;1=有残留;2=自身运行出错

import { readFileSync } from "node:fs";

if (process.argv.length > 2) {
  console.error("[retired] 不接受参数;用法:bun scripts/check-retired-phrases.ts");
  process.exit(2);
}

function jj(...jjArgs: string[]): string {
  const proc = Bun.spawnSync(["jj", ...jjArgs], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    console.error(`[retired] jj ${jjArgs.join(" ")} 失败:\n${proc.stderr.toString()}`);
    process.exit(2);
  }
  return proc.stdout.toString();
}

const RETIRED: { phrase: string; note: string }[] = [
  { phrase: "@ 即提交", note: "S2 收窄:主树 @ 只做停靠位(#581)" },
  { phrase: "主树就地直改", note: "S2:任何改动先开工作区(#581)" },
  { phrase: "主树直改", note: "S2:任何改动先开工作区(#581)" },
  { phrase: "小体量零构建", note: "S2:不分体量一律 workspace(#581)" },
  { phrase: "小体量纯文档", note: "S2:不分体量一律 workspace(#581)" },
  { phrase: "jj 优先", note: "口径升级:一律先开工作区(#581)" },
  { phrase: "点席位即出", note: "#417 目标选择统一口径:点席位=选中/再点取消,打出走动作条「出」" },
  { phrase: "点卡即出", note: "#417 同上(席位卡词条旧口径,#633 勘误时人工发现漏网)" },
];

// 行内翻面标记:命中即视为历史叙事/退役记录,合法保留
const RETIRE_MARK = /(退役|收窄|取代|已废|翻面|实锤)/;

const mdFiles = jj("file", "list")
  .split("\n")
  .filter(Boolean)
  .map((p) => p.replace(/\\/g, "/"))
  .filter((f) => f.toLowerCase().endsWith(".md"));

type Hit = { file: string; line: number; phrase: string; note: string; text: string };
const hits: Hit[] = [];

for (const file of mdFiles) {
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((text, i) => {
      if (RETIRE_MARK.test(text)) return;
      for (const { phrase, note } of RETIRED) {
        if (text.includes(phrase)) hits.push({ file, line: i + 1, phrase, note, text });
      }
    });
}

if (hits.length === 0) {
  console.log(`[retired] 全绿:${mdFiles.length} 个 md 文件,退役口径词零残留。`);
  process.exit(0);
}
for (const hit of hits) {
  console.error(`${hit.file}:${hit.line} → 「${hit.phrase}」(${hit.note})\n    ${hit.text.trim()}`);
}
console.error(`[retired] ${hits.length} 处退役口径词残留——翻面未完成或该行缺翻面标记。`);
process.exit(1);
