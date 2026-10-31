// 首页矮横屏档地图选择条带(#707):MapSelectPanel 的横排替代件,只在
// 矮横屏档(landscape + max-height:500px,与对局屏 layout.css A 档同口径)挂载。
// 为什么不是弹层:844×390 一类视口下二级弹层被裁切、换图开局不可达(#684 实拍
// tmp/mobile-audit/home-844x390.png)——选图改首页内联:左右滑动全部地图可达,
// 点选即选中(金框选中态,DESIGN §4.6 状态表达不文字化),选择+开局一屏完成零滚动。
// 交互语义口径:滑动 = 原生 overflow-x + scroll-snap(平台滚动行为,非手搓 swipe);
// 条目 = 裸钮 aria-pressed 切换语义(同 MapSelectPanel S-9 / SegmentedSelect 先例,
// 组件收口附表「保留现实现」同族:非弹层/下拉/确认框,不涉 shadcn 底件)。
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { MapEntry, MapSource } from "@core/map-source";
import { formatMoney } from "@core/money";
import { InkBreathe, SealEmpty } from "@app/screens/shared/ArtifactEmpty";
import { HOME_TID } from "./testids";

export interface MapStripProps {
  /** 地图源(宿主 HomeScreen 透传,与 MapSelectPanel 同一实例)。 */
  mapSource: MapSource;
  /** 当前选中地图 id(外层单一事实源,条带不做临时选中态——点选即生效)。 */
  selectedMapId: string;
  /** 点选回调:外层回写 selectedMapId + 持久化(同弹层确认路径的 onMapChange)。 */
  onSelect: (mapId: string) => void;
}

/** 条目弹性宽度(#751/H3,#742 判词):`flex:1 0 160px`——160px 基准保窄签制式,
 *  图少时均分填满行(消「没排满」的未完成感);图多时 280px 封顶——边缘裁半卡
 *  即「还有图」的滑动暗示(§4.6:可达性由裁切状态本身表达,不加箭头/文字提示)。
 *  max-w 解除条件(#843/P2-1):条目数×168(基准 160 + gap 8)≤ 容器宽——
 *  即全部条目按基准排也填得满一行时,均分拉伸到右缘(与按钮列容器对齐,
 *  条带容器与按钮列同为 w-[min(600px,92vw)],右缘对齐 = 条目填满容器);
 *  反之(基准排就溢出)维持 280px 封顶。 */

export function MapStrip({ mapSource, selectedMapId, onSelect }: MapStripProps) {
  const [entries, setEntries] = useState<MapEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // S-4 同口径:清单拉取失败给「重试」(显式向用户报错,非静默兜底)
  const [reloadKey, setReloadKey] = useState(0);

  // 条带容器宽实测(#843):max-w 解除判据(条目数×168≤容器宽)的宽度侧,不复制
  // min(600px,92vw) 算式——safe-area/未来布局调整自动跟随。元素经 callback ref 进
  // state(条带只在 entries 就绪的分支渲染,加载/空态挂载时先拿 null,拿元素后
  // 效果重跑补测);useLayoutEffect 同步首测(首帧就对,不闪 max-w 态),
  // RO 管后续视口变化(HandRack 同款先例)。
  const [stripEl, setStripEl] = useState<HTMLDivElement | null>(null);
  const [stripWidth, setStripWidth] = useState(0);
  useLayoutEffect(() => {
    if (!stripEl) return;
    const read = () => setStripWidth(stripEl.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(stripEl);
    return () => ro.disconnect();
  }, [stripEl]);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);
    mapSource.listMaps().then(
      (list) => alive && setEntries(list),
      (err: Error) => alive && setError(err.message),
    );
    return () => {
      alive = false;
    };
  }, [mapSource, reloadKey]);

  // 选中卡挂载即滚入可视区:localStorage 记忆的图可能排在条带中后段,不滚则选中态
  // 藏在屏外,违背「选中态清晰」。稳定 callback ref(恒 identity)只在按钮挂载时
  // 触发——换选点选的目标必在可视区内,nearest 即原位 no-op,不劫持用户滚动位置。
  const revealRef = useCallback((el: HTMLButtonElement | null) => {
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, []);

  if (error) {
    return (
      <div data-testid={HOME_TID.mapStrip} className="flex items-center gap-3 py-2">
        <p className="font-wenkai text-danger text-sm">加载失败:{error}</p>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="note-btn min-h-[40px] cursor-pointer rounded-[3px] px-4 font-wenkai text-paper"
        >
          重试
        </button>
      </div>
    );
  }
  if (!entries) {
    // 加载态(#768 空态器物化):「载入地图清单…」一行小字退役,换墨滴呼吸三点
    //(语义走 role=status aria-label,视觉纯器物零文字)。
    return (
      <div data-testid={HOME_TID.mapStrip} className="flex items-center py-2">
        <InkBreathe title="载入地图清单" />
      </div>
    );
  }
  if (entries.length === 0) {
    // 空态(#768 空态器物化):斜放朱印+短注(「暂无可用地图。」纯文字行退役;
    // 清单空是正常业务态,可达名保留直陈语义)。
    return (
      <div data-testid={HOME_TID.mapStrip} className="flex items-center py-2">
        <SealEmpty char="空" note="尚无图志" title="暂无可用地图" />
      </div>
    );
  }

  // max-w 解除判据(#843,见头注):168 = 条目基准 160px + gap 8px(类名字面量,
  // 与 flex-[1_0_160px]/gap-2 同源,改条目制式时同改)。
  const fitByBasis = entries.length * 168 <= stripWidth;

  return (
    <div
      role="group"
      aria-label="选择地图"
      data-testid={HOME_TID.mapStrip}
      ref={setStripEl}
      className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-0.5 py-1"
    >
      {entries.map((e) => {
        const selected = e.id === selectedMapId;
        return (
          <button
            key={e.id}
            type="button"
            ref={selected ? revealRef : undefined}
            data-testid={HOME_TID.mapStripItem(e.id)}
            aria-pressed={selected}
            onClick={() => onSelect(e.id)}
            className={
              // py-1.5(#761 ⑥):条带整块带高压到 62px 档(原 py-2 ≈66-70px,
              // 844×360 零滚动预算),字级行高不动
              "min-w-0 shrink-0 snap-start rounded-[3px] border px-2.5 py-1.5 text-left transition-colors cursor-pointer " +
              // H3(#751):flex 1 0 160px;max-w 280 仅在基准排溢出时保留(#843,见头注)
              (fitByBasis ? "flex-[1_0_160px] " : "flex-[1_0_160px] max-w-[280px] ") +
              // 选中语言与 MapSelectPanel/SegmentedSelect 统一:金框 + gold/25 势档
              (selected
                ? "border-gold bg-gold/25"
                : "border-paper/25 bg-bg/60 hover:border-gold/60")
            }
          >
            <div className="flex items-baseline justify-between gap-1">
              <span className="font-wenkai text-[14px] font-bold text-paper">{e.name}</span>
              {e.custom ? <span className="text-[10px] text-paper-dim">自建</span> : null}
            </div>
            <div className="mt-0.5 text-[11px] whitespace-nowrap text-paper-dim">
              {e.tileCount} 城 · 目标 {formatMoney(e.targetNetWorth)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
