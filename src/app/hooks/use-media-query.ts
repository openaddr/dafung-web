// 媒体查询 hook(M-1 窄屏布局基础设施):matchMedia + change 监听,
// 视口跨越断点时驱动重渲染(本项目纯 CSR,无 SSR 顾虑)。
import { useEffect, useState } from "react";

/** 任意媒体查询是否命中;query 变更时重挂监听,卸载时移除(cleanup 齐全)。 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** 窄屏(X6 #25):覆盖式抽屉生效的断点——① 宽 <768px(Tailwind md,竖屏手机/窄窗口);
 *  ② 触屏且矮视口(横屏手机 844×390 这类:宽度过 md 但握持形态就是手机,侧栏并排会把棋盘挤没)。
 *  桌面(pointer:fine)与竖屏平板不受 ② 影响,照旧按宽度判定。
 *  命令式取值处(如 GameScreen 抽屉首访默认)共用本常量,勿另抄查询串。 */
export const IS_NARROW_QUERY = "(max-width: 767px), (pointer: coarse) and (max-height: 500px)";

/** 窄屏:见 IS_NARROW_QUERY。 */
export const useIsNarrow = () => useMediaQuery(IS_NARROW_QUERY);

/** 横屏:后续棋盘/弹层横竖适配共用。 */
export const useIsLandscape = () => useMediaQuery("(orientation: landscape)");
