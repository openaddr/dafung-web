// 扫描会触发合成粗体的字重声明。字体约束见 DESIGN 的字体规范。
// 清零史:CSS 侧 #936 拔 14 处,TSX 工具类 #955 拔 15 处(探查代理还漏报过
// SoloSetupScreen 214 行,靠实施期 grep 兜住)——两次人工走查都靠「记得扫」,本脚本
// 把清零口径变成一条命令:扫描客户端的字重工具类与 500–900 声明。
//
// 豁免口径:同一行带清理叙事标记(退役/拔除/清尾/规约/实锤/翻面)= 历史叙事或
// 清理记录本身,合法保留——与 check-retired-phrases 的翻面标记同款约定。
//
// 范围:jj 跟踪的客户端 .ts/.tsx/.css。
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
  { re: /font-[Ww]eight\s*[:=]\s*[{"']?\s*(?:bold["']?|[5-9]00)/, note: "500–900 或 bold 声明" },
];

// 行内清理叙事标记:命中即视为历史叙事,合法保留(同 check-retired 约定)
const EXEMPT = /(退役|拔除|清尾|规约|实锤|翻面)/;

const files = jj("file", "list")
  .split("\n")
  .filter(Boolean)
  .map((p) => p.replace(/\\/g, "/"))
  .filter((f) => /^apps\/client\/src\/.+\.(ts|tsx|css)$/.test(f));
if (files.length === 0) throw new Error("[fake-bold] 未找到客户端源文件，请检查扫描路径");

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
  console.log(`[fake-bold] 全绿:${files.length} 个客户端源文件，伪加粗零残留。`);
  process.exit(0);
}
for (const hit of hits) {
  console.error(`${hit.file}:${hit.line} → ${hit.note}\n    ${hit.text.trim()}`);
}
console.error(`[fake-bold] ${hits.length} 处可能触发合成粗体的声明。字体规则见 DESIGN §4.3。`);
process.exit(1);
