// 属性图标(#253 布局骨架):程序化 SVG——圣旨卷轴=委任 / 城楼=城 / 墨竹=声望 /
// 玉璧=珍宝 / 战盔=名将(2026-10-19 中式化改版:勋章/宝石/令旗退役),自绘路径零
// 素材依赖,currentColor 吃属性色(--color-attr-* token)。
// 纸色细节线走 --color-paper-hi(SVG 表现属性不吃 var(),经 style 注入)。
// 手牌徽章不是单图标:迷你牌背组(MiniBacks,漆木底+漆金描边,同锦囊牌背语言;
// 0 张时出一张虚线空牌背占位,图标恒在)。
export type AttrIconKind = "warrant" | "city" | "rep" | "gem" | "hero";

const PAPER = "var(--color-paper-hi)";

/** 珍宝/名将几何单源:裸 d 串,绘制属性各消费方自理——AttrIcon 出 fill 面,
 *  牌架入口(HandRack EntryIcon)出漆金线稿。改形只动这里,两处同步。 */
export const ATTR_ENTRY_D: Record<"gem" | "hero", string[]> = {
  // 玉璧:外缘 r6.2 + 好孔 r2.5(evenodd 一笔出环)+ 贴缘中圈 r5.05 细线(重圈璧)
  gem: [
    "M8 1.8A6.2 6.2 0 1 0 8 14.2A6.2 6.2 0 1 0 8 1.8ZM8 5.5A2.5 2.5 0 1 1 8 10.5A2.5 2.5 0 1 1 8 5.5Z",
    "M8 2.95A5.05 5.05 0 1 0 8 13.05A5.05 5.05 0 1 0 8 2.95Z",
  ],
  // 战盔:兜鍪正面剪影(盔缨 / 盔体+长护耳+拱形脸门 / 盔体内部线)
  hero: [
    "M8 .8C6.9 1.5 6.9 2.5 8 3.2C9.1 2.5 9.1 1.5 8 .8Z",
    "M3 9.2C3 5.4 5.2 3 8 3C10.8 3 13 5.4 13 9.2L13.1 10.6L11.6 10.6L11.6 13.4L9.4 13.4L9.4 11.6C9.4 11 8.8 10.6 8 10.6C7.2 10.6 6.6 11 6.6 11.6L6.6 13.4L4.4 13.4L4.4 10.6L2.9 10.6Z",
    "M4.8 8.9C4.8 6.3 6.2 4.7 8 4.7C9.8 4.7 11.2 6.3 11.2 8.9",
  ],
};

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
        /* 墨竹:竹节=气节——三节秆 + 三叶 */
        <>
          <rect x="6.8" y="1.6" width="2.4" height="4" rx="1" fill="currentColor" />
          <rect x="6.8" y="6.1" width="2.4" height="4.1" rx="1" fill="currentColor" />
          <rect x="6.8" y="10.7" width="2.4" height="3.7" rx="1" fill="currentColor" />
          <path d="M6.8 3.4C5.2 2.8 3.7 3.2 2.6 4.4C4.2 4.9 5.8 4.5 6.8 3.4Z" fill="currentColor" />
          <path
            d="M9.2 6.6C11 6 12.6 6.4 13.7 7.6C12.1 8.1 10.4 7.7 9.2 6.6Z"
            fill="currentColor"
          />
          <path
            d="M6.8 10.2C5.3 9.7 3.8 10.1 2.8 11.3C4.3 11.8 5.9 11.3 6.8 10.2Z"
            fill="currentColor"
          />
        </>
      )}
      {kind === "gem" && (
        /* 玉璧:环面 fill + 中圈纸色细线(重圈璧) */
        <>
          <path d={ATTR_ENTRY_D.gem[0]} fill="currentColor" fillRule="evenodd" />
          <path d={ATTR_ENTRY_D.gem[1]} style={{ stroke: PAPER }} strokeWidth=".8" fill="none" />
        </>
      )}
      {kind === "hero" && (
        /* 战盔:盔缨+盔体 fill,盔体内部线纸色 */
        <>
          <path d={ATTR_ENTRY_D.hero[0]} fill="currentColor" />
          <path d={ATTR_ENTRY_D.hero[1]} fill="currentColor" />
          <path d={ATTR_ENTRY_D.hero[2]} style={{ stroke: PAPER }} strokeWidth=".8" fill="none" />
        </>
      )}
    </svg>
  );
}

/** 迷你牌背组:手牌计数徽章的「牌背」可视化(暗牌语义;计数本身裸排在外)。
 *  联机他人手牌内容不到端,只显背面 + 数量(ADR-0016 投影口径);
 *  手牌无上限(#250)后背面至多示意 3 张,真实数量以数字为准;
 *  0 张时出一张虚线空牌背,图标恒在、空态可读(2026-10-19 拷问裁决)。 */
export function MiniBacks({ count }: { count: number }) {
  const empty = count === 0;
  const shown = empty ? 1 : Math.min(count, 3);
  return (
    <span className="mini-backs" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className={empty ? "mini-back mini-back-empty" : "mini-back"} />
      ))}
    </span>
  );
}
