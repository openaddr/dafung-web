// 知会槽合并规则 + 常驻回合胶囊(#762,机制论证):fxStore 槽泵的判别语义单点钉死——
// bot→bot 同轮连续回合折叠为胶囊更新(不串播全幅、无横幅音效窗),真人回合/每轮首个
// 宣告仍全幅;无论全幅与否胶囊都刷新(「谁在打」永有答案)。判别条件写死在
// fxStore.showBanner(不留开放配置),本文件就是它的行为规格。
// e2e 不做窗内计数断言(ADR-0029 吸附档丢知会的观测性竞速,#732 同口径),机制归此处。
import { describe, it, expect, beforeEach } from "bun:test";
import { useFxStore } from "../src/app/fx/fxStore";

/** 捷径:重置后以给定元数据宣告一次回合,取返回值(是否全幅)与槽内状态。 */
function announce(guohao: string, meta: { isBot: boolean; round: number }) {
  const full = useFxStore.getState().showBanner(guohao, "rgba(1, 2, 3, 1)", meta, 0);
  const s = useFxStore.getState();
  return { full, notice: s.notice, queued: s.noticeQueue.length, capsule: s.turnCapsule };
}

beforeEach(() => {
  useFxStore.getState().resetFx();
});

describe("知会槽合并规则与常驻回合胶囊(#762)", () => {
  it("首宣告(真人):全幅播出,胶囊随宣告立起", () => {
    const r = announce("魏", { isBot: false, round: 1 });
    expect(r.full).toBe(true);
    expect(r.notice?.kind).toBe("turn");
    expect(r.capsule).toMatchObject({ guohao: "魏", round: 1 });
  });

  it("bot→bot 同轮连续:折叠为胶囊更新(不播全幅、不排队),胶囊内容换装", () => {
    announce("魏", { isBot: false, round: 1 }); // 真人先手(全幅,槽内在播)
    const bot1 = announce("蜀", { isBot: true, round: 1 }); // 真人→bot:全幅(入队候槽)
    expect(bot1.full).toBe(true);
    const bot2 = announce("吴", { isBot: true, round: 1 }); // bot→bot 同轮:合并
    expect(bot2.full).toBe(false);
    // 槽内/队里都不出现吴的全幅(魏在播、蜀候槽是既有互斥/排队语义,与合并无关)
    expect(bot2.notice?.guohao).not.toBe("吴");
    expect(useFxStore.getState().noticeQueue.every((n) => n.guohao !== "吴")).toBe(true);
    expect(bot2.capsule).toMatchObject({ guohao: "吴", round: 1 });
  });

  it("bot 跨轮(每轮首个宣告):仍全幅——上轮末尾的 bot 链不吞新轮宣告", () => {
    announce("魏", { isBot: true, round: 1 });
    announce("蜀", { isBot: true, round: 1 }); // 同轮合并
    const next = announce("魏", { isBot: true, round: 2 });
    expect(next.full).toBe(true);
    expect(next.notice?.kind).toBe("turn");
    expect(next.capsule).toMatchObject({ guohao: "魏", round: 2 });
  });

  it("bot 链中途换真人再回 bot:不误判连续(合并游标追踪上一次宣告,非上一次全幅)", () => {
    announce("魏", { isBot: true, round: 1 });
    announce("蜀", { isBot: false, round: 1 }); // 真人插手(全幅)
    const back = announce("吴", { isBot: true, round: 1 });
    expect(back.full).toBe(true); // 真人→bot 不是 bot→bot 连续
  });

  it("resetFx 清胶囊与合并游标:新局首个宣告恒全幅", () => {
    announce("魏", { isBot: true, round: 3 });
    useFxStore.getState().resetFx();
    expect(useFxStore.getState().turnCapsule).toBeNull();
    const r = announce("蜀", { isBot: true, round: 1 });
    expect(r.full).toBe(true);
  });
});
