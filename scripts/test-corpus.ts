// 无头语料单源(全波评审必修收口,#1160):票一测试(test/whole-game/headless-whole-game)与黄金
// 台账(scripts/check-goldens)、bot 基准(scripts/sim-bench)消费同一套地图清单与座位
// 工厂——此前三处复制,「台账与测试语料必须同套」的契约靠「两处同步维护」注释人肉
// 保证;这里收口成单源后契约由 import 结构自证。种子区间各票自持不收编:票一/二语料
// 3001-3010(逐位门+台账),基准 4001-4050(分布区间),语义不同册。
import guanzhongData from "../public/maps/guanzhong.json" with { type: "json" };
import zhongyuanData from "../public/maps/zhongyuan.json" with { type: "json" };
import yanzhouData from "../test/fixtures/maps/yanzhou.json" with { type: "json" };
import type { SeatConfig } from "../src/core/authority";

/** 语料图清单(原始 JSON 数据,消费方各自 loadMap;内置图仅两张,夹具 yanzhou 补足第三图,判词见 ADR-0052)。 */
export const CORPUS_MAPS = [
  { id: "guanzhong", data: guanzhongData },
  { id: "zhongyuan", data: zhongyuanData },
  { id: "yanzhou", data: yanzhouData },
] as const;

/** 黄金台账/两跑门语料种子(与 sim-bench 的基准种子 4001-4050 分册,互不混用)。 */
export const GOLDEN_SEEDS = [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010];

/** 标准 bot 座位表(guohao 留空由 doDraftRoll 从字池分配,与 cli new 同口径)。 */
export function botSeats(n: number): SeatConfig[] {
  return Array.from({ length: n }, (_, i) => ({ name: `诸侯 ${i + 1}`, isBot: true }));
}
