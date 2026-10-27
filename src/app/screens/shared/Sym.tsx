// 符号表(ui-symbols.md)的内联 SVG 渲染。
// 为什么不直接排字符:← ↶ ↷ ◎ ♪ 这类字形不在离线中文字体子集(马善政/小薇/文楷)里,
// 裸排会回落系统字体甚至出豆腐块(大厅「返回■首页」、编辑器「■撤销」实拍翻车);
// SVG 路径任何字体栈下都稳定,颜色走 currentColor 跟随文字。
// 新增用途先在 docs/reference/界面符号.md 登记,再在此加 path。
import type { ReactNode } from "react";

export type SymName =
  | "back"
  | "undo"
  | "redo"
  | "sound"
  | "muted"
  | "play"
  | "close"
  | "expand"
  | "overview"
  | "settings";

const PATHS: Record<SymName, ReactNode> = {
  // 返回 ←
  back: <path d="M11 4 L5 8 L11 12 M5 8 H15" fill="none" />,
  // 撤销 ↶(逆时针回弯箭头)
  undo: (
    <path d="M5 7 V12 H10 M5.4 11.6 C6.5 7.8 9.2 5.6 12.6 5.6 C15 5.6 17 7 17.6 9" fill="none" />
  ),
  // 重做 ↷(顺时针回弯箭头,与 undo 镜像)
  redo: (
    <path d="M17 7 V12 H12 M16.6 11.6 C15.5 7.8 12.8 5.6 9.4 5.6 C7 5.6 5 7 4.4 9" fill="none" />
  ),
  // 静音(开音)♪:符尾 + 音头 + 笔杆
  sound: (
    <>
      <path d="M8 12.5 V3.5 L15 2 V11" fill="none" />
      <ellipse cx="6" cy="12.6" rx="2.2" ry="1.7" />
      <ellipse cx="13" cy="11.1" rx="2.2" ry="1.7" />
    </>
  ),
  // 已静音 ♪̶:♪ + 斜删线
  muted: (
    <>
      <path d="M8 12.5 V3.5 L15 2 V11" fill="none" />
      <ellipse cx="6" cy="12.6" rx="2.2" ry="1.7" />
      <ellipse cx="13" cy="11.1" rx="2.2" ry="1.7" />
      <path d="M3 14 L18 1" fill="none" />
    </>
  ),
  // 播放 ▶
  play: <path d="M6 2.5 L17 8 L6 13.5 Z" />,
  // 关闭 ×
  close: <path d="M4 4 L16 14 M16 4 L4 14" fill="none" />,
  // 展开/下拉 ▾
  expand: <path d="M4 6 L10 11.5 L16 6" fill="none" />,
  // 总览 ☰(三横册页,诸侯总览弹窗入口,#700 顶钮左移)
  overview: (
    <>
      <path d="M4.5 4.5 H17.5" fill="none" />
      <path d="M4.5 8 H17.5" fill="none" />
      <path d="M4.5 11.5 H17.5" fill="none" />
    </>
  ),
  // 设置 ⚙(齿圈:中环 + 八向齿,设置弹层入口,#700 顶钮左移)
  settings: (
    <>
      <circle cx="11" cy="8" r="2.6" fill="none" />
      <path
        d="M11 2.4 V4.4 M11 11.6 V13.6 M5.4 8 H7.4 M14.6 8 H16.6 M7 4 L8.4 5.4 M13.6 10.6 L15 12 M15 4 L13.6 5.4 M8.4 10.6 L7 12"
        fill="none"
      />
    </>
  ),
};

export function Sym({
  name,
  size = 14,
  className,
  strokeWidth = 1.6,
}: {
  name: SymName;
  /** 渲染边长(px);viewBox 22×14~16 视符号而定,等比缩放。 */
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 22 16"
      width={size * (22 / 16)}
      height={size}
      className={className}
      style={{ verticalAlign: "-0.125em" }}
    >
      <g
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
      >
        {PATHS[name]}
      </g>
    </svg>
  );
}
