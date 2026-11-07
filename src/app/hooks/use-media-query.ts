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
 *  ② 的 500px 与矮横屏档 SHORT_LANDSCAPE_QUERY 同值(断点值对齐,语义不同:此处是
 *  触屏窄屏判据,那边是形态分档)。勿另抄查询串。 */
export const IS_NARROW_QUERY = "(max-width: 767px), (pointer: coarse) and (max-height: 500px)";

/** 窄屏:见 IS_NARROW_QUERY。 */
export const useIsNarrow = () => useMediaQuery(IS_NARROW_QUERY);

/** 矮横屏档(#751/S1 形态分档,ADR-0018/#703):全浮层紧凑档断点,844×390 一类
 *  矮横屏视口。JS 结构分支四家共用本常量(HomeScreen/LobbyScreen/SoloSetupScreen/
 *  TreasurePickModal);CSS 侧同串 media 开口在各屏 css(开口头注指认本单源)——
 *  改断点先改这里,JS/CSS 各档随之。 */
export const SHORT_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 500px)";

/** 矮横屏档:见 SHORT_LANDSCAPE_QUERY。 */
export const useIsShortLandscape = () => useMediaQuery(SHORT_LANDSCAPE_QUERY);
