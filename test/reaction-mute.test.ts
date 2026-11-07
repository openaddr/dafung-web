// 降噪口静默状态机单测(#284,ADR-0017 §4;#1181 自浏览器 e2e 迁入):
// 原承载 = e2e/react-reaction.spec.ts「降噪口」+ react-reaction-online.spec.ts「联机降噪口」
// 的静默语义面(点「本回合不再询问」→ 当窗代发不用 + 同回合静默 + 换回合解除)。
// 状态机本体 = src/app/screens/game/reaction-mute.ts(纯函数,零 React);「当窗代发
// 不用」的命令发出与按钮点击链是 UI 通路(壳,留浏览器),此处钉判词与状态转移:
// 静默记按下时的行动者,仅对该行动者的当前在位期生效;行动者任何变更即解除,
// 回到原行动者不复燃(A→B→A,原 useEffect([activeIndex]) 清空的隐式语义)。
import { describe, it, expect } from "bun:test";
import {
  reactionMuteEngage,
  reactionMuteInitial,
  reactionMuteOnActor,
  reactionMuted,
} from "@app/screens/game/reaction-mute";

describe("降噪口静默状态机(#284 · reaction-mute)", () => {
  it("初始未静默:任何行动者下都不静默", () => {
    expect(reactionMuted(reactionMuteInitial, 0)).toBe(false);
    expect(reactionMuted(reactionMuteInitial, 3)).toBe(false);
  });

  it("按下降噪口=当回合静默:仅对被记行动者为真(横幅隐、静默代发判词同源)", () => {
    const s = reactionMuteEngage(1);
    expect(reactionMuted(s, 1)).toBe(true);
    expect(reactionMuted(s, 0)).toBe(false);
    expect(reactionMuted(s, 2)).toBe(false);
  });

  it("同回合持续:行动者未变的重渲保持静默(同回合连续窗也代发,seq 递增不解除)", () => {
    let s = reactionMuteEngage(2);
    s = reactionMuteOnActor(s, 2); // 同行动者重渲:状态原样
    expect(reactionMuted(s, 2)).toBe(true);
  });

  it("换回合解除:行动者变更即清,对新旧行动者皆不静默", () => {
    const s = reactionMuteOnActor(reactionMuteEngage(1), 2);
    expect(reactionMuted(s, 2)).toBe(false);
    expect(reactionMuted(s, 1)).toBe(false);
  });

  it("回到原行动者不复燃(A→B→A):解除后的甲回合不是被记的那个在位期", () => {
    let s = reactionMuteEngage(1);
    s = reactionMuteOnActor(s, 2); // 甲→乙:解除
    s = reactionMuteOnActor(s, 1); // 乙→甲:不复燃
    expect(reactionMuted(s, 1)).toBe(false);
  });

  it("解除后可再按:新一回合重新 engage 即对新行动者静默", () => {
    let s = reactionMuteEngage(1);
    s = reactionMuteOnActor(s, 2);
    s = reactionMuteEngage(2);
    expect(reactionMuted(s, 2)).toBe(true);
    expect(reactionMuted(s, 1)).toBe(false);
  });
});
