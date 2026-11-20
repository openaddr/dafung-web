// 媒体查询 hook(M-1 窄屏布局基础设施):matchMedia + change 监听,
// 视口跨越断点时驱动重渲染(本项目纯 CSR,无 SSR 顾虑)。
import { useEffect, useState } from "react";

/** 任意媒体查询是否命中;query 变更时重挂监听,卸载时移除(cleanup 齐全)。 */
function useMediaQuery(query: string): boolean {
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

/** 窄屏(X6 #25):覆盖式抽屉按可用空间判断，宽不超过 767px 或高不超过 500px。
 *  横屏手机即使宽度超过 767px，高度仍可能需要抽屉；输入设备不改变布局。
 *  500px 与矮横屏档 SHORT_LANDSCAPE_QUERY 同值，两者语义分别为抽屉与形态分档。 */
export const IS_NARROW_QUERY = "(max-width: 767px), (max-height: 500px)";

/** 窄屏:见 IS_NARROW_QUERY。 */
export const useIsNarrow = () => useMediaQuery(IS_NARROW_QUERY);

/** 矮横屏档(#751/S1 形态分档,ADR-0018/#703):全浮层紧凑档断点,844×390 一类
 *  矮横屏视口。JS 结构分支两家共用本常量(HomeScreen/LobbyScreen);
 *  CSS 侧同串 media 开口在各屏 css(开口头注指认本单源)——
 *  改断点先改这里,JS/CSS 各档随之。 */
export const SHORT_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 500px)";

/** 矮横屏档:见 SHORT_LANDSCAPE_QUERY。 */
export const useIsShortLandscape = () => useMediaQuery(SHORT_LANDSCAPE_QUERY);

/** 系统减少动态效果的偏好，可在对局期间改变。 */
export const usePrefersReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");
