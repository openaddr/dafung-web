// UI 符号注册表(单源,#1351;前身 docs/reference/界面符号.md 已退役,git 考古)。
// 一用途一符号:新增用途=在此加 SymName+PATHS+用途判词注释,一步完成,勿另立符号表。
// 渲染口径:符号一律经本组件内联 SVG——← ↶ ◎ ♪ 等字形不在离线中文字体子集里,
// 裸排会回落系统字体出豆腐块(大厅「返回■首页」实拍翻车);SVG 任何字体栈稳定,
// 颜色走 currentColor 跟随文字。
// 属性图标轨墓碑:AttrIcon(城楼/墨竹/玉璧/战盔)已整轨退役(#1128,9-10px 下形
// 不可辨,席位格改汉字五账式);要属性图标先立新件并在此登记判词。
import type { ReactNode } from "react";

type SymName = "back" | "sound" | "muted" | "play" | "close" | "expand" | "overview" | "settings";

const PATHS: Record<SymName, ReactNode> = {
  // 返回 ←:所有「返回/回退」按钮统一用此,勿混近义形
  back: <path d="M11 4 L5 8 L11 12 M5 8 H15" fill="none" />,
  // 静音(开音)♪:符尾+音头+笔杆。现役唯一消费=音效试听台 SoundBoard(dev 工具);
  // 对局内静音入口=设置弹层「音效」开关(Base UI Switch,无符号,#700 旧顶栏退役)
  sound: (
    <>
      <path d="M8 12.5 V3.5 L15 2 V11" fill="none" />
      <ellipse cx="6" cy="12.6" rx="2.2" ry="1.7" />
      <ellipse cx="13" cy="11.1" rx="2.2" ry="1.7" />
    </>
  ),
  // 已静音 ♪̶:♪ + 组合删除线;消费同 ♪(仅 SoundBoard)
  muted: (
    <>
      <path d="M8 12.5 V3.5 L15 2 V11" fill="none" />
      <ellipse cx="6" cy="12.6" rx="2.2" ry="1.7" />
      <ellipse cx="13" cy="11.1" rx="2.2" ry="1.7" />
      <path d="M3 14 L18 1" fill="none" />
    </>
  ),
  // 播放 ▶:SoundBoard 试听钮(editor 专属用途已随 #947 退役,试听台复用此符)
  play: <path d="M6 2.5 L17 8 L6 13.5 Z" />,
  // 关闭 ×:凡可放弃的卷轴均显示——详情类(TileDetailScroll)与可关只读面板(珍宝
  // 交涉访客视角/战报抽屉)必须保留;必须决策的卷轴(购地/扩军/招贤/破产/交涉城主)
  // 不渲染(不传 onClose,hideClose 仅为此保留)
  close: <path d="M4 4 L16 14 M16 4 L4 14" fill="none" />,
  // 展开/下拉 ▾:行尾「还有下级可选」提示(地图行尾/设置分组)
  expand: <path d="M4 6 L10 11.5 L16 6" fill="none" />,
  // 详情 ☰(三横册页):诸侯详情弹窗入口(GameTopBar 左上;#732 正名,前称「诸侯总览」已废)
  overview: (
    <>
      <path d="M4.5 4.5 H17.5" fill="none" />
      <path d="M4.5 8 H17.5" fill="none" />
      <path d="M4.5 11.5 H17.5" fill="none" />
    </>
  ),
  // 设置 ⚙(齿圈:中环+八向齿):设置弹层入口(GameTopBar 左上;战报/静音入口降级入设置弹层)
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
