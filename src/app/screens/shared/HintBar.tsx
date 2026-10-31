// F4 统一 hint 渲染小组件:game / lobby / App(setup+solo-setup 兜底)四处共用。
// 为什么要抽:原来三处(四渲染点)各写一份样式与过期定时器,同一 pushHint 在
// 不同屏的样式、存活时长都不一样(1.5s/1.8s/永不过期)——评审 F4 的「三套口径」。
// 过期逻辑已下沉到 store(1.8s 单一定时器),本组件只管「长什么样」:
// error = 红底白字 chip(醒目,失败类提示);info = 原灰面板样式(轻提示)。
// W2 包E(审计 A5):hint 是运行时动态文案,字族迁 wenkai(新文案不落小薇)。
import { TESTIDS } from "@app/screens/game/testids";

export interface HintBarProps {
  hint: string | null;
  level?: "error" | "info";
  /** 渲染位置变体:overlay = 绝对定位居中(棋盘/整屏浮层,原三处口径);
   *  inline = 文档流内(大厅卡片内的提示行,原 lobby 口径)。 */
  variant?: "overlay" | "inline";
  /** overlay 变体的纵距类(#732 评审修复):默认 +12px(lobby/App 无知会槽,
   *  维持原几何);game 屏顶中 +8px 行被知会横幅槽占用,传 +56px 落第二行
   *  (#762 几何修正 +48→+56:给两段式回合横幅的槽区渲染让净距 ≥8px)——
   *  重立旧「hint/等待条上下错开互不叠位」几何契约。整串类名透传(Tailwind
   *  arbitrary value 须静态字面量,不收数字插值)。 */
  overlayTopClass?: string;
}

const OVERLAY_TOP_DEFAULT = "top-[calc(var(--safe-top)+12px)]";

export function HintBar({
  hint,
  level = "error",
  variant = "overlay",
  overlayTopClass = OVERLAY_TOP_DEFAULT,
}: HintBarProps) {
  if (!hint) return null;
  if (variant === "inline") {
    // 大厅卡内:错误红字、信息灰字(保留原 lobby 的轻量行样式)
    return (
      <div
        data-testid={TESTIDS.hint}
        className={
          "text-center font-wenkai text-xs " +
          (level === "error" ? "text-danger" : "text-paper-dim")
        }
      >
        {hint}
      </div>
    );
  }
  // 浮层式:居中顶部。error 升级为红底白字 chip——灰色小字在棋盘上有底图竞争,
  // 失败类提示玩家必须第一眼看到(评审 F4 改法)。
  return (
    <div
      data-testid={TESTIDS.hint}
      className={
        "pointer-events-none absolute left-1/2 -translate-x-1/2 rounded px-4 py-1 shadow " +
        overlayTopClass +
        " " +
        (level === "error"
          ? "bg-danger/95 text-white font-wenkai"
          : "bg-panel/95 text-paper font-wenkai")
      }
    >
      {hint}
    </div>
  );
}
