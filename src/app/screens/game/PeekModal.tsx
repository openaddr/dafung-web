// 窥探弹层(#575,军情密探即时窥探):viewer-only 一次性演出层——开关态单源
// fxStore.peek(peekApplied 表现事件驱动,关闭即清、无任何残留);仅 viewer=本座的
// 客户端渲染(他座窥探零演出,组件按 viewerSeat 自门);壳复用藏品弹层 PileShell
// (题名「军情密探」+朱印小章「探」+副题「窥 {国号} 营锦囊」),内容=被窥者锦囊
// 手牌 JinnangCardFace 标准档横排,牌背→翻面 stagger 入场(时长/缓动走 --dur-*/
// --ease-* token;一次性入场,reduced-motion 由 app.css M-4 全局兜层压瞬时);
// 点击任意处(遮罩/内容区)或右上 X 关闭。空手牌=「囊中空空」浅印空态——真业务态
// (目标有效性对手牌数无守卫,#477),非兜底。
// 手牌内容不走快照:随 peekApplied 事件走(redactEvents 逐座位裁,viewer 之外恒空,
// ADR-0016)——单机(内存直连)与联机(per-seat 投影)同一事件通路,演出自洽。
// 样式在 peek-modal.css(经 Portal 渲染在 body,.game-layout 罩不到——peek-* 前缀
// 防串扰,pile-*/war-* 同先例)。
import type { CSSProperties } from "react";
import { JinnangCardBack, JinnangCardFace } from "@app/components/card/JinnangCardFace";
import { useFxStore } from "@app/fx/fxStore";
import { PileShell } from "./PileModal";
import { TESTIDS } from "./testids";
import "./peek-modal.css";

/** 窥探弹层:fxStore.peek 驱动(表现事件 peekRevealed → sink.revealPeek),本组件
 *  只做「viewer 自门 + 壳与内容装配」;关闭一律 closePeek(清 store,零残留)。 */
export function PeekModal({ selfSeat }: { selfSeat: number }) {
  const peek = useFxStore((s) => s.peek);
  const closePeek = useFxStore((s) => s.closePeek);
  if (peek == null || peek.viewerSeat !== selfSeat) return null;
  return (
    <PileShell
      key={peek.id}
      title="军情密探"
      seal="探"
      sub={`窥 ${peek.guohao} 营锦囊`}
      testid={TESTIDS.peekModal}
      ariaLabel={`军情密探 · 窥 ${peek.guohao} 营锦囊`}
      className="peek-modal"
      onClose={closePeek}
    >
      {/* 点击内容区即关闭(遮罩点击/Esc 归底件,X 归壳)——「点击任意处关闭」口径 */}
      <div className="peek-body" onClick={closePeek}>
        {peek.hand.length > 0 ? (
          peek.hand.map((cardId, i) => (
            <div
              className="peek-flip"
              key={`${peek.id}-${i}`}
              style={{ ["--peek-i" as string]: i } as CSSProperties}
            >
              <div className="peek-flip-inner">
                <JinnangCardBack className="peek-back" />
                <JinnangCardFace
                  cardId={cardId}
                  className="peek-face"
                  data-testid={TESTIDS.peekCard(cardId)}
                />
              </div>
            </div>
          ))
        ) : (
          <span className="peek-empty-seal" data-testid={TESTIDS.peekEmpty}>
            囊中空空
          </span>
        )}
      </div>
    </PileShell>
  );
}
