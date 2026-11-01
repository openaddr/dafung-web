// 常驻回合胶囊(回合宣告唯一形制;#762 立,#958 全幅横幅退役):fxStore.announceTurn
// 语义单点钉死——回合宣告只刷新胶囊(重挂,id 单调),不入知会队列(槽内瞬态位归都城
// 停条带独占),「谁在打」永有答案;resetFx 换局才清。
// e2e 不做窗内计数断言(ADR-0029 吸附档丢知会的观测性竞速,#732 同口径),机制归此处。
import { describe, it, expect, beforeEach } from "bun:test";
import { useFxStore } from "../src/app/fx/fxStore";

/** 捷径:重置后宣告一次回合,取槽内状态。 */
function announce(guohao: string, round: number) {
  useFxStore.getState().announceTurn(guohao, "rgba(1, 2, 3, 1)", round, 0);
  const s = useFxStore.getState();
  return { notice: s.notice, queued: s.noticeQueue.length, capsule: s.turnCapsule };
}

beforeEach(() => {
  useFxStore.getState().resetFx();
});

describe("常驻回合胶囊(回合宣告唯一形制,#958)", () => {
  it("回合宣告只刷新胶囊:不入知会队列(槽内/队内零回合知会)", () => {
    const r = announce("魏", 1);
    expect(r.notice).toBeNull();
    expect(r.queued).toBe(0);
    expect(r.capsule).toMatchObject({ guohao: "魏", round: 1 });
  });

  it("连续宣告(含同一玩家)胶囊换装:id 单调递增(重挂重播入场过渡)", () => {
    const first = announce("魏", 1);
    const second = announce("魏", 1); // 同一玩家连续回合也要重挂(过渡重播)
    expect(first.capsule!.id).toBeLessThan(second.capsule!.id);
    expect(second.capsule).toMatchObject({ guohao: "魏", round: 1 });
  });

  it("跨轮宣告轮次刷新:胶囊「第 N 轮」随宣告走", () => {
    announce("魏", 1);
    const next = announce("蜀", 2);
    expect(next.capsule).toMatchObject({ guohao: "蜀", round: 2 });
  });

  it("都城停条带不受影响:照旧入知会队列(槽内瞬态位归它独占)", () => {
    useFxStore.getState().showHaltBanner("魏", "rgba(1, 2, 3, 1)", "长安");
    const s = useFxStore.getState();
    expect(s.notice?.kind).toBe("halt");
    expect(s.turnCapsule).toBeNull();
  });

  it("resetFx 清胶囊:新局从零起(选都期胶囊未立)", () => {
    announce("魏", 3);
    useFxStore.getState().resetFx();
    expect(useFxStore.getState().turnCapsule).toBeNull();
  });
});
