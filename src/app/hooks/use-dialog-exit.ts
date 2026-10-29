// 底件系弹层退场协议(#767 弹窗详情族⑤):「播完再移除」——关闭请求先置 closing
// (壳挂退场类、遮罩淡出),--dur-fast 150ms 动画走完后 210ms 出口再调真 onClose
// 卸载,与横幅系 BannerShell 收起出口同一条时间轴(150 + 60 余量,与幽灵帧协议
// GHOST.frameMs/timings.ts 同一条 210)。刻意字面量不进倍率:地板 100ms 会砍断退场
// 动画并与幽灵帧同刻竞速(#117 评审实测并行两连挂)。
// 关半路重复出口(Esc 连按/遮罩二次点击/再点 ×)由计时器在途守卫挡掉;关半路被外部
// 直卸(钻入式换层/整屏切换)由卸载清理收计时器,重开即全新实例、零残影。
// 拍板钮(确认/成交/返回)不走本协议:决策即时生效,不陪动画(横幅系 footer 钮同口径)。
import { useCallback, useEffect, useRef, useState } from "react";

export function useDialogExit(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestClose = useCallback(() => {
    // 计时器在途 = 已在收起,忽略重复出口
    if (timerRef.current !== null) return;
    setClosing(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onClose();
    }, 210); // 收起出口 = 退场 150ms(--dur-fast)+ 60 余量,见文件头
  }, [onClose]);
  // 收起途中组件被外部直接卸载时清理计时器
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );
  return { closing, requestClose };
}
