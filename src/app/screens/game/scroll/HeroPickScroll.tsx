// 招贤纳士卷轴:对照旧 client-controller showHeroPickScroll。
// 三选一,无「不取」——旧版同款:AwaitingHeroPick 相位引擎不接受 endDecision
// (submitCommand 守卫 assertPhase("AwaitingDecision","EndDecision")),必须三选其一。
import type { GameCommand } from "@core/types";
import { ScrollShell, ScrollButton } from "./ScrollShell";
import { SCROLL_TESTIDS as T } from "./testids";

/** 候选名士的最小展示形状(snapshot.offeredHeroes 就是这个形状,无 skill 字段)。 */
export interface HeroOfferInfo {
  id: string;
  name: string;
  title: string;
  desc: string;
}

export interface HeroPickScrollProps {
  /** 候选名士(通常 3 个)。 */
  offered: HeroOfferInfo[];
  onCommand: (cmd: GameCommand) => void;
}

export function HeroPickScroll({ offered, onCommand }: HeroPickScrollProps) {
  if (!offered.length) return null; // 与旧 showHeroPickScroll 一致:无候选不弹
  return (
    <ScrollShell title="招贤纳士" testid={T.heroPickScroll}>
      <div className="mb-3.5 text-center text-sm text-ink-dim">
        {offered.map((h, i) => (
          <span key={h.id}>
            {i > 0 && " ／ "}
            {i + 1}. {h.name}·{h.title} — {h.desc}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {offered.map((h, i) => (
          <ScrollButton
            key={h.id}
            primary={i === 0}
            testid={T.heroPickOption(i)}
            onClick={() => onCommand({ type: "resolveHeroPick", index: i })}
          >
            {h.name}
          </ScrollButton>
        ))}
      </div>
    </ScrollShell>
  );
}
