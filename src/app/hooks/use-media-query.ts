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

/** 窄屏(<768px):P0-7 覆盖式抽屉生效的断点,与 Tailwind md 对齐。 */
export const useIsNarrow = () => useMediaQuery("(max-width: 767px)");

/** 横屏:后续棋盘/弹层横竖适配共用。 */
export const useIsLandscape = () => useMediaQuery("(orientation: landscape)");
