// 设置屏缺省单源(#1211 QC 抽取):SoloSetupScreen(旅程)与 registry.seedSolo(调试桥
// 快路径)共用同一组缺省——防两路开出不同的缺省局(字面量第二配置,#1201 同族陷阱)。
// 纯常量与纯函数,零 React 依赖,桥可安全引用。
import type { SeatConfig } from "@core/authority";

export const DEFAULT_SEAT_COUNT = 4;
export const DEFAULT_TARGET_NET_WORTH = 30000; // 「标准」档(TARGET_OPTIONS 中位)
export const DEFAULT_GUOHAO = "魏";

/** 座位表缺省形:首行真人(诸侯1,自带国号),其余电脑。 */
export function defaultSetupSeats(
  guohao: string,
  seatCount: number = DEFAULT_SEAT_COUNT,
): SeatConfig[] {
  const seats: SeatConfig[] = [{ name: "诸侯1", isBot: false, guohao }];
  for (let i = 1; i < seatCount; i++) {
    seats.push({ name: `诸侯${i + 1}`, isBot: true });
  }
  return seats;
}
