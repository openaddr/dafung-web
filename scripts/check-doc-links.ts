// 文档死链检查(2026-10-11):全仓 md 相对链接 + 锚点校验。
// 缘起:DoD「全仓库无死链」一直靠肉眼;路径迁移大扫除已三轮(#367 目录归拢、
// ADR-0021 对局日志归档、#460 CONTEXT→GLOSSARY 改名),引用清扫复盘里两轮
// 漏网都靠人肉复读兜底。本脚本把「清扫后残留」从仪式变成一条命令:文档重 PR
// (改名/搬目录/大扫除)收口前跑一次,有死链直接红,零兜底。
//
// 范围与口径:
//   - 扫 jj 跟踪(工作副本 @ 树)的全部 .md;走 jj file list,天然跳过 gitignore 的
//     tmp/、node_modules,未提交新文件也在扫描集里(#533 jj 化:git ls-files -z 退役,
//     jj workspace 无 .git 也能跑)
//   - 只查 [](...) 内链:目标必须在 jj 跟踪集里(链接到未跟踪文件=别的机器上
//     就是死链,同样算红);目录链接按「跟踪集里有其后代文件」判活
//   - #锚点对目标文件标题(GitHub slug 仿真);纯 #锚点按同页标题校验
//   - 围栏代码块(```/~~~)内的链接不查——示例不是导航
//   - 已知盲区:HTML <a href>、引用式链接([][ref])不查——本仓未用,出现再收
//
// 用法:bun scripts/check-doc-links.ts
// 退出码:0=全绿;1=有死链(逐条 文件:行 列出);2=自身运行出错

import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path/posix";

if (process.argv.length > 2) {
  console.error("[doc-links] 不接受参数;用法:bun scripts/check-doc-links.ts");
  process.exit(2);
}

function jj(...jjArgs: string[]): string {
  const proc = Bun.spawnSync(["jj", ...jjArgs], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    console.error(`[doc-links] jj ${jjArgs.join(" ")} 失败:\n${proc.stderr.toString()}`);
    process.exit(2);
  }
  return proc.stdout.toString();
}

// jj file list:每行一个仓库相对路径,UTF-8 原样输出(无 git quotePath 的八进制转义,
// 旧版 -z NUL 解析随之退役);Windows 上分隔符是反斜杠,归一成 / 与下方 posix 链接
// 解析对齐(本仓文件名不含字面反斜杠,归一零风险)
const allTracked = jj("file", "list")
  .split("\n")
  .filter(Boolean)
  .map((p) => p.replace(/\\/g, "/"));
const tracked = new Set(allTracked);
const mdFiles = allTracked.filter((f) => f.toLowerCase().endsWith(".md"));
const trackedDirs = new Set<string>();
for (const file of allTracked) {
  const parts = file.split("/");
  parts.pop();
  let dir = "";
  for (const part of parts) {
    dir = dir ? `${dir}/${part}` : part;
    trackedDirs.add(dir);
  }
}

// GitHub slug 仿真:小写、剔除标点(\p{L}/\p{N}/空白/连字符/下划线保留,CJK 归
// \p{L}),空白折叠为 -。与 github-slugger 在中文标题上的表现一致。
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

const headingsByFile = new Map<string, Set<string>>();
function headingsOf(file: string): Set<string> {
  let set = headingsByFile.get(file);
  if (!set) {
    set = new Set<string>();
    let inFence = false;
    for (const line of readLines(file)) {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (inFence) continue;
      const heading = line.match(/^#{1,6} (.+)$/);
      if (heading) set.add(slugify(heading[1]));
    }
    headingsByFile.set(file, set);
  }
  return set;
}

function readLines(file: string): string[] {
  return readFileSync(file, "utf8").split(/\r?\n/);
}

// 链接目标解析:相对 URL 解码(失败=死链)+ posix 归一。返回 null 表示 URL 本身坏。
function resolveTarget(fromFile: string, raw: string): string | null {
  let decoded = raw;
  if (decoded.includes("%")) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return null;
    }
  }
  return normalize(join(dirname(fromFile), decoded));
}

type DeadLink = { file: string; line: number; target: string; reason: string };
const dead: DeadLink[] = [];
const LINK = /(!?)\[([^\]]*)\]\(\s*([^\s)]*)[^)]*\)/g;

for (const file of mdFiles) {
  let inFence = false;
  readLines(file).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) return;
    for (const match of line.matchAll(LINK)) {
      // CommonMark 允许 <目标> 包裹(含空格/括号的路径);剥掉再判
      const target = match[3].replace(/^</, "");
      if (!target) continue;
      if (/^(https?:|mailto:)/.test(target)) continue;
      // 裸词目标(无 / . #)不判:数学记法 `[0,4](对家顶中)` 一类散文括号形似链接;
      // 真相对链接至少含路径分隔/扩展名/锚点之一
      if (!/[/.#]/.test(target)) continue;
      const [rawPath, anchor] = target.split("#");
      const resolved = rawPath ? resolveTarget(file, rawPath) : file;
      if (resolved === null) {
        dead.push({ file, line: i + 1, target, reason: "URL 编码非法" });
        continue;
      }
      if (rawPath) {
        const last = resolved.split("/").pop() ?? "";
        const pointsAtDir = rawPath.endsWith("/") || !last.includes(".");
        const alive = pointsAtDir
          ? trackedDirs.has(resolved.replace(/\/$/, ""))
          : tracked.has(resolved);
        if (!alive) {
          dead.push({ file, line: i + 1, target, reason: "目标不在 jj 跟踪集" });
          continue;
        }
      }
      if (anchor) {
        const titles = resolved.endsWith(".md") ? headingsOf(resolved) : new Set<string>();
        if (!titles.has(anchor) && !titles.has(decodeURIComponentSafe(anchor))) {
          dead.push({ file, line: i + 1, target, reason: "锚点无对应标题" });
        }
      }
    }
  });
}

function decodeURIComponentSafe(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

if (dead.length === 0) {
  console.log(`[doc-links] 全绿:${mdFiles.length} 个 md 文件,内链与锚点全部可解析。`);
  process.exit(0);
}
const byFile = new Map<string, DeadLink[]>();
for (const link of dead) {
  const list = byFile.get(link.file) ?? [];
  list.push(link);
  byFile.set(link.file, list);
}
for (const [file, links] of byFile) {
  for (const link of links) {
    console.error(`${file}:${link.line} → ${link.target} —— ${link.reason}`);
  }
}
console.error(`[doc-links] ${dead.length} 处死链,分布 ${byFile.size} 个文件。`);
process.exit(1);
