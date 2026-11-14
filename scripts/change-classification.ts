// 固定版本内容的 TS/JS 语法分类;不读取工作副本,也不把删注释后的文本当作语法。
import ts from "typescript";

export type ChangeClassification = "comment-only" | "substantive";

interface Directive {
  readonly range: ts.TextRange;
}

// TypeScript 解析器同时产出的诊断/指令元数据未在公开 SourceFile 声明中列出。
interface ParsedSource extends ts.SourceFile {
  readonly parseDiagnostics: readonly ts.DiagnosticWithLocation[];
  readonly pragmas: ReadonlyMap<string, Directive | readonly Directive[]>;
  readonly commentDirectives?: readonly Directive[];
}

function syntax(path: string, text: string): string | null {
  const source = ts.createSourceFile(
    path,
    text,
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseAll },
    true,
  ) as ParsedSource;
  if (source.parseDiagnostics.length > 0) {
    const diagnostic = source.parseDiagnostics[0]!;
    throw new Error(
      `${path}: TypeScript 解析失败: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
    );
  }
  // 行抑制指令覆盖整条源码行,换行也可能改变诊断;含指令的变更保守按实质变更处理。
  if (source.commentDirectives && source.commentDirectives.length > 0) return null;
  type Syntax = [number, string | Syntax[]];
  const tokenStarts: number[] = [];
  const ranges = new Map<number, ts.TextRange>();
  function retainAnnotations(comments: ts.CommentRange[] | undefined): void {
    if (!comments) return;
    for (const range of comments) {
      const raw = text.slice(range.pos, range.end);
      // parser token 边界上的注释范围,也保守保留 bundler 的 @/# 注解(如 __PURE__)。
      if (raw.includes("@") || raw.startsWith("//#") || raw.startsWith("/*#"))
        ranges.set(range.pos, range);
    }
  }
  function visit(node: ts.Node): Syntax | null {
    // 普通 JSDoc 说明可忽略;带标签的原文保守保留,包含类型/可选参数等非子节点语义。
    if (ts.isJSDoc(node)) return node.tags ? [node.kind, node.getText(source)] : null;
    const children = node
      .getChildren(source)
      .map(visit)
      .filter((child): child is Syntax => child !== null);
    if (children.length === 0) {
      tokenStarts.push(node.getStart(source));
      retainAnnotations(ts.getLeadingCommentRanges(text, node.pos));
      retainAnnotations(ts.getTrailingCommentRanges(text, node.end));
    }
    return [
      node.kind,
      children.length > 0
        ? children
        : ts.isJsxText(node)
          ? text.slice(node.pos, node.end)
          : node.getText(source),
    ];
  }
  const tree = visit(source);
  for (const pragma of source.pragmas.values())
    for (const directive of Array.isArray(pragma) ? pragma : [pragma])
      ranges.set(directive.range.pos, directive.range);
  // 其余编译/工具注解保留原文及后继 token 位置;空白挪动不影响锚点,跨语句挪动会变。
  const directives = [...ranges.values()]
    .sort((a, b) => a.pos - b.pos)
    .map(({ pos, end }) => [text.slice(pos, end), tokenStarts.findIndex((start) => start >= end)]);
  return JSON.stringify({ tree, directives });
}

export function classifyChange(
  path: string,
  before: string | null,
  after: string | null,
): ChangeClassification {
  if (before === null || after === null || !/\.[cm]?[jt]sx?$/.test(path)) return "substantive";
  const beforeSyntax = syntax(path, before);
  const afterSyntax = syntax(path, after);
  return beforeSyntax !== null && beforeSyntax === afterSyntax ? "comment-only" : "substantive";
}
