// 伪加粗残尾检查(2026-11-01,#955 retro 落地):五族离线镜像全是 400 单字重,任何
// 500-700 声明 = 浏览器合成加粗,小字号笔画糊死内白(DESIGN §4.3 伪加粗规约)。
// 清零史:CSS 侧 #936 拔 14 处,TSX 工具类 #955 拔 15 处(探查代理还漏报过
// SoloSetupScreen 214 行,靠实施期 grep 兜住)——两次人工走查都靠「记得扫」,本脚本
// 把清零口径变成一条命令:字重工具类与 500-700 声明,src/ 全扫,命中即红。
//
// 豁免口径:同一行带清理叙事标记(退役/拔除/清尾/规约/实锤/翻面)= 历史叙事或
// 清理记录本身,合法保留——与 check-retired-phrases 的翻面标记同款约定。
//
// 范围:jj 跟踪集 src/ 下 .ts/.tsx/.css(UI 真相源;test/scripts 不渲染字体)。
// 用法:bun scripts/check-fake-bold.ts
// 退出码:0=全绿;1=有残留;2=自身运行出错

import { readFileSync } from "node:fs";

if (process.argv.length > 2) {
  console.error("[fake-bold] 不接受参数;用法:bun scripts/check-fake-bold.ts");
  process.exit(2);
}

function jj(...jjArgs: string[]): string {
  const proc = Bun.spawnSync(["jj", ...jjArgs], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    console.error(`[fake-bold] jj ${jjArgs.join(" ")} 失败:\n${proc.stderr.toString()}`);
    process.exit(2);
  }
  return proc.stdout.toString();
}

const PATTERNS: { re: RegExp; note: string }[] = [
  { re: /\bfont-(bold|semibold|extrabold|black|medium)\b/, note: "字重工具类" },
  { re: /\bfont-\[(?:bold|[5-9]00)\]/, note: "任意值字重类" },
  { re: /font-[Ww]eight\s*[:=]\s*[{"']?\s*(?:bold["']?|[5-9]00)/, note: "500-700/bold 声明" },
];

// 行内清理叙事标记:命中即视为历史叙事,合法保留(同 check-retired 约定)
const EXEMPT = /(退役|拔除|清尾|规约|实锤|翻面)/;

const files = jj("file", "list")
  .split("\n")
  .filter(Boolean)
  .map((p) => p.replace(/\\/g, "/"))
  .filter((f) => /^src\/.+\.(ts|tsx|css)$/.test(f));

type Hit = { file: string; line: number; note: string; text: string };
const hits: Hit[] = [];

for (const file of files) {
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((text, i) => {
      if (EXEMPT.test(text)) return;
      for (const { re, note } of PATTERNS) {
        if (re.test(text)) hits.push({ file, line: i + 1, note, text });
      }
    });
}

if (hits.length === 0) {
  console.log(`[fake-bold] 全绿:${files.length} 个 src 文件,伪加粗零残留(五族皆 400 单字重)。`);
  process.exit(0);
}
for (const hit of hits) {
  console.error(`${hit.file}:${hit.line} → ${hit.note}\n    ${hit.text.trim()}`);
}
console.error(
  `[fake-bold] ${hits.length} 处伪加粗残留——五族皆 400 单字重,字重声明即合成加粗(DESIGN §4.3 规约);清理叙事行请带退役/拔除/清尾标记。`,
);
process.exit(1);
