// 属性图标(#253 布局骨架):程序化 SVG,从原型 tmp/prototype-layout.html 的
// <symbol> defs 原样移植——圣旨卷轴=委任 / 城楼=城 / 勋章=声望 / 宝石=珍宝 /
// 令旗=名将,自绘路径零素材依赖,currentColor 吃属性色(--color-attr-* token)。
// 纸色细节线走 --color-paper-hi(SVG 表现属性不吃 var(),经 style 注入)。
// 手牌徽章不是单图标:迷你牌背组(MiniBacks,漆木底+漆金描边,同锦囊牌背语言)。
export type AttrIconKind = "warrant" | "city" | "rep" | "gem" | "hero";

const PAPER = "var(--color-paper-hi)";

export function AttrIcon({ kind, size = 14 }: { kind: AttrIconKind; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      {kind === "warrant" && (
        /* 圣旨卷轴:双轴 + 展开的旨文 */
        <>
          <rect x="2" y="3.5" width="2.8" height="9" rx="1.4" fill="currentColor" />
          <rect x="11.2" y="3.5" width="2.8" height="9" rx="1.4" fill="currentColor" />
          <rect x="4.4" y="5.2" width="7.2" height="5.6" fill="currentColor" opacity=".72" />
          <path d="M5.6 6.6h4.8M5.6 9.2h4.8" style={{ stroke: PAPER }} strokeWidth=".9" />
        </>
      )}
      {kind === "city" && (
        /* 城楼:雉堞墙线 + 门洞 */
        <>
          <path d="M2 13.5V7h2.2V4.8h2.4V7h2.8V4.8h2.4V7H14v6.5z" fill="currentColor" />
          <rect x="6.6" y="9.4" width="2.8" height="4.1" style={{ fill: PAPER }} />
        </>
      )}
      {kind === "rep" && (
        /* 勋章:章头 + 绶带 */
        <>
          <circle cx="8" cy="5.6" r="3.1" fill="currentColor" />
          <path d="M6.2 8.2 4.8 14l3.2-1.9L11.2 14 9.8 8.2z" fill="currentColor" />
        </>
      )}
      {kind === "gem" && (
        /* 宝石:菱形台面 + 刻面线 */
        <>
          <path d="M8 1.8 13 6.2 8 14.2 3 6.2z" fill="currentColor" />
          <path
            d="M3 6.2h10M8 1.8 6 6.2l2 8 2-8z"
            style={{ stroke: PAPER }}
            strokeWidth=".8"
            fill="none"
          />
        </>
      )}
      {kind === "hero" && (
        /* 令旗:旗杆 + 燕尾旗面 */
        <>
          <path
            d="M4 1.8v12.4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
          <path d="M4.8 2.6h8.4l-2.6 3.2 2.6 3.2H4.8z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/** 迷你牌背组:手牌计数徽章的「牌背」可视化(暗牌语义;计数本身裸排在外)。
 *  联机他人手牌内容不到端,只显背面 + 数量(ADR-0016 投影口径);
 *  手牌无上限(#250)后背面至多示意 3 张,真实数量以数字为准。 */
export function MiniBacks({ count }: { count: number }) {
  const shown = Math.min(count, 3);
  return (
    <span className="mini-backs" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className="mini-back" />
      ))}
    </span>
  );
}
