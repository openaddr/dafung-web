// 声望三档概率条(#1096 决议4,工单 #1099):好运/中性/霉运三段横条,段宽由
// core/encounters 的 tierShares(reputation) softmax 现算(app→core 方向合法,
// 引擎零改动)——负声望天然镜像(霉运段肥,tierShares(−s) 好运霉运互换),零声望
// 三等分。段色吃 theme token 单源(好运=青绿 --color-money/中性=黛青
// --color-seal-qing/霉运=朱砂 --color-danger,token 名以 styles/tokens.css 为准;
// 票面 「sealQing」 经核实实际注册名是连字 --color-seal-qing)。纯展示非交互
// (豁免 Base UI 收口,组件收口附表口径),两档尺寸:row=行内 52×8(诸侯详情
// 声列)/modal=弹层 210×10(声望明细)。整条 aria-hidden:行内声望数值与弹层
// 三档百分比明文已承语义,条是纯视觉状态(DESIGN §4.6)。样式全内联:段宽动态、
// 尺寸两档皆 prop 数据,无独立样式表可计(程序化件同法)。
import { tierShares } from "@core/encounters";

/** 三档段色单源:条段与弹层百分比明文同吃本表,改色只动这里。 */
export const REP_TIER_COLORS = {
  good: "var(--color-money)",
  neutral: "var(--color-seal-qing)",
  bad: "var(--color-danger)",
} as const;

/** 明文用整数百分比(Math.round;三数各自取整,和可差 ±1,明文只求直观不重归一)。 */
export function repTierPct(reputation: number): { good: number; neutral: number; bad: number } {
  const s = tierShares(reputation);
  return { good: Math.round(s.good), neutral: Math.round(s.neutral), bad: Math.round(s.bad) };
}

const SIZES = { row: { width: 52, height: 8 }, modal: { width: 210, height: 10 } } as const;

export function RepProbBar({ reputation, size }: { reputation: number; size: keyof typeof SIZES }) {
  const { width, height } = SIZES[size];
  const s = tierShares(reputation);
  return (
    <span
      className="rep-prob-bar"
      aria-hidden="true"
      style={{
        width,
        height,
        display: "flex",
        overflow: "hidden",
        borderRadius: 2,
        flex: "none",
        background: "color-mix(in srgb, var(--color-paper) 14%, transparent)",
      }}
    >
      <i style={{ width: `${s.good}%`, flex: "none", background: REP_TIER_COLORS.good }} />
      <i style={{ width: `${s.neutral}%`, flex: "none", background: REP_TIER_COLORS.neutral }} />
      <i style={{ width: `${s.bad}%`, flex: "none", background: REP_TIER_COLORS.bad }} />
    </span>
  );
}
