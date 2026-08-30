// 招贤纳士卷轴:三选一,无「不取」——旧版同款:AwaitingHeroPick 相位引擎不接受 endDecision
// (submitCommand 守卫 assertPhase("AwaitingDecision","EndDecision")),必须三选其一。
// X9(#28):竖排三选项卡——画像位(3:4 双金边框,样式对照 CardDetailScroll 的 PORTRAIT_FRAME)
// + 名/title + desc 两行 line-clamp;快捷键 1/2/3 直选(G-19 口径,角标仅展示键位);
// 卡片 title 带全文,desc 截断不丢信息。
import { useEffect, useRef, useState } from "react";
import type { GameCommand } from "@core/types";
import { ScrollShell } from "./ScrollShell";
import { SCROLL_TESTIDS as T } from "./testids";

/** 候选名士的最小展示形状(snapshot.offeredHeroes 就是这个形状,含 image)。 */
export interface HeroOfferInfo {
  id: string;
  name: string;
  title: string;
  desc: string;
  /** 画像路径(本地资源,3:4 竖版;加载失败显式「像」占位,可感知不静默)。 */
  image: string;
}

export interface HeroPickScrollProps {
  /** 候选名士(通常 3 个)。 */
  offered: HeroOfferInfo[];
  onCommand: (cmd: GameCommand) => void;
}

/** 画像位外框:与 CardDetailScroll 的 PORTRAIT_FRAME 同款(双金边圆角 + 宣纸底),
 *  尺寸缩到候选卡内 w-16;色走 tokens:gold/paper/ink。 */
const PORTRAIT_FRAME =
  "relative w-16 shrink-0 overflow-hidden rounded-md border-[3px] border-double border-gold bg-paper-lo shadow-sm aspect-[3/4] outline outline-1 outline-offset-2 outline-gold/20 sepia-[.35] saturate-[.85] contrast-[.92]";

/** 候选画像:object-cover 裁成 3:4;失败态显式「像」字占位(与 CardDetailScroll 同口径)。
 *  R3-D3(#101) 照片做旧:框上 sepia 族滤镜 + img multiply 融宣纸底,与详情画像位一致。 */
function OfferPortrait({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={PORTRAIT_FRAME}>
      {failed ? (
        <span className="flex h-full w-full items-center justify-center font-brush text-lg text-ink-dim">像</span>
      ) : (
        <img
          src={src}
          alt={`${name}画像`}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover mix-blend-multiply"
          draggable={false}
        />
      )}
    </div>
  );
}

/** G-19 同口径:数字键 1..count 直选候选(卡片角标即键位);挂载绑、卸载解。 */
function useNumberShortcuts(count: number, pick: (index: number) => void) {
  const ref = useRef(pick);
  ref.current = pick;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= count) ref.current(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);
}

export function HeroPickScroll({ offered, onCommand }: HeroPickScrollProps) {
  if (!offered.length) return null; // 与旧 showHeroPickScroll 一致:无候选不弹
  return <HeroPickOptions offered={offered} onCommand={onCommand} />;
}

/** 拆内层组件:hooks 不能挂在「无候选早退」的条件之后。 */
function HeroPickOptions({ offered, onCommand }: HeroPickScrollProps) {
  useNumberShortcuts(offered.length, (i) => onCommand({ type: "resolveHeroPick", index: i }));
  return (
    <ScrollShell title="招贤纳士" testid={T.heroPickScroll}>
      <div className="flex flex-col gap-2.5">
        {offered.map((h, i) => (
          <button
            key={h.id}
            type="button"
            data-testid={T.heroPickOption(i)}
            title={`${h.name}·${h.title} — ${h.desc}`}
            onClick={() => onCommand({ type: "resolveHeroPick", index: i })}
            className="relative flex items-center gap-3 rounded-md border-2 border-gold/60 bg-panel-hi p-2.5 text-left cursor-pointer transition-colors hover:border-gold hover:bg-gold/15"
          >
            <OfferPortrait src={h.image} name={h.name} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="font-brush text-xl text-ink">{h.name}</span>
                <span className="text-sm text-ink-dim">{h.title}</span>
              </span>
              <span className="mt-1 line-clamp-2 text-sm leading-snug text-ink-dim">{h.desc}</span>
            </span>
            {/* G-19:快捷键角标(1/2/3),仅展示,监听在本文件 useNumberShortcuts */}
            <span aria-hidden="true" className="absolute top-1 right-1.5 font-deco text-[10px] leading-none text-ink-dim">
              {i + 1}
            </span>
          </button>
        ))}
      </div>
    </ScrollShell>
  );
}
