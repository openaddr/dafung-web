// e2e 选择器单源门禁(#664 落地,#717 扩面,仿 check:core/check:links 先例):
// AGENTS.md「e2e 选择器 = 各屏 testids.ts 单源,勿硬编码字符串」从评审人肉变可执行
// 检查——扫 e2e/*.spec.ts + react-helpers.ts(helpers 是共享单源,泄漏放大到所有
// 消费 spec,故与 spec 同扫),flag 三类硬编码,违规列文件行号退出 1:
//   A. getByTestId("<字符串直接量>")(传 TESTIDS.x 等常量或模板插值放行)
//   B. [data-testid="<无插值字面量>"] 属性选择器(选中段含 ${…} 插值放行)
//   C. getByTestId(<裸标识符>):变量形态口径——标识符名须含 tid(大小写不敏感,
//      tid/testid 家族),循环/参数集中喂单源常量(home-strip 先例:
//      for (const tid of [TESTIDS.x…]) / 助手函数收 testid 参由调用方传常量);
//      其余裸标识符(f 一类)flag。TESTIDS.x 等成员访问与 getXxx() 工厂调用不属
//      裸标识符,不在此列。
// 口径:
// - 先剥注释(块+行)再扫——红线禁的是「使用」,注释提及不算。剥离是字符串感知的
//   状态机,但不识别正则字面量:现役 spec 的正则均不含引号与 //(门禁够用即可,
//   同 check:core 口径,出现再议)。
// - C 的口径边界:tid 命名变量的取值来源(声明处/实参)不做数据流追踪——给 tid 变
//   喂字面量数组属绕过口径,机械门禁不追,评审把关(同「正则字面量不识别」的门禁
//   够用口径,出现再议)。
// - 行内豁免 `// testids:allow <理由>`(同一行,理由必填——无理由的标记不豁免),
//   只留给确属结构性需要的场合:退役 testid 零残留断言(常量已随核销删除,无单源
//   可引)一类;新增选择器一律走 testids.ts 单源,不许新添豁免。
import { Glob } from "bun";

const E2E_DIR = `${import.meta.dir}/../e2e`;
// 豁免标记必须带理由(`testids:allow` 后跟非空白),无理由不豁免。
const ALLOW = /\/\/\s*testids:allow\s+\S/;

interface Violation {
  rel: string;
  line: number;
  text: string;
  message: string;
}

const violations: Violation[] = [];
let files = 0;

// 字符串感知的注释剥离:状态机逐字符走,"..." / '...' / `...`(含 \\ 转义)内不认
// 注释;输出仅保留代码字符,其余换空格保持行号对齐。
function stripComments(src: string): string {
  let out = "";
  // normal | line | block | " | ' | `
  let state = "normal";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (state === "normal") {
      if (ch === "/" && next === "/") {
        state = "line";
        out += "  ";
        i++;
      } else if (ch === "/" && next === "*") {
        state = "block";
        out += "  ";
        i++;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        state = ch;
        out += ch;
      } else {
        out += ch;
      }
    } else if (state === "line") {
      if (ch === "\n") {
        state = "normal";
        out += ch;
      } else {
        out += " ";
      }
    } else if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "normal";
        out += "  ";
        i++;
      } else {
        out += ch === "\n" ? "\n" : " ";
      }
    } else {
      // 字符串字面量内部:转义对原样双拷贝,闭引号回 normal。
      if (ch === "\\") {
        out += src.slice(i, i + 2);
        i++;
      } else if (ch === state) {
        state = "normal";
        out += ch;
      } else {
        out += ch;
      }
    }
  }
  return out;
}

// #717 扩面:helpers 与 spec 同扫(fixtures/global-setup 无选择器使用点,不入集)。
const targets = [...new Glob("*.spec.ts").scanSync({ cwd: E2E_DIR }), "react-helpers.ts"];
for (const path of targets) {
  files++;
  const full = `${E2E_DIR}/${path}`;
  const rawLines = (await Bun.file(full).text()).split("\n");
  const allowed = new Set(rawLines.flatMap((l, i) => (ALLOW.test(l) ? [i] : [])));
  const codeLines = stripComments(rawLines.join("\n")).split("\n");
  const rel = `e2e/${path}`;
  codeLines.forEach((line, i) => {
    if (allowed.has(i)) return;
    // A. getByTestId("<字面量>"):单双引号直接量即违规;模板插值(`…${…}…`)放行,
    //    无插值的模板与裸字符串同为硬编码,一样 flag。
    for (const m of line.matchAll(/getByTestId\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g)) {
      if (m[1] === "`" && m[2].includes("${")) continue;
      violations.push({
        rel,
        line: i + 1,
        text: m[0],
        message: "getByTestId 硬编码字符串(单源=各屏 testids.ts;常量引用/模板插值放行)",
      });
    }
    // C. getByTestId(<裸标识符>):变量形态口径——命名须含 tid(大小写不敏感),
    //    循环/参数集中喂单源常量;其余裸标识符 flag(成员访问/工厂调用不匹配此形)。
    for (const m of line.matchAll(/getByTestId\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
      if (/tid/i.test(m[1])) continue;
      violations.push({
        rel,
        line: i + 1,
        text: m[0],
        message:
          "getByTestId(变量) 命名不含 tid 语义(变量形态口径:集中喂单源常量且命名含 tid/testid)",
      });
    }
    // B. [data-testid="<字面量>"] 属性选择器:值段含 ${…} 插值放行。
    for (const m of line.matchAll(/\[data-testid\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const value = m[1] ?? m[2];
      if (value.includes("${")) continue;
      violations.push({
        rel,
        line: i + 1,
        text: m[0],
        message: "data-testid 属性选择器硬编码(单源=各屏 testids.ts)",
      });
    }
  });
}

if (violations.length > 0) {
  console.error(
    `e2e testid 单源门禁: ${violations.length} 处硬编码(AGENTS.md「e2e 选择器 = 各屏 testids.ts 单源」;结构性需要用行内 // testids:allow <理由> 豁免)\n`,
  );
  for (const v of violations) console.error(`  ${v.rel}:${v.line}  ${v.message}:${v.text}`);
  process.exit(1);
}
console.log(`e2e testid 单源 OK: ${files} 个文件(spec + react-helpers)零硬编码选择器`);
