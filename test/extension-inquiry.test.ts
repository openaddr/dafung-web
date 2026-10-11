// 定制问询挂点端到端(#432,ADR-0022 词汇接通):假 inquiry 包三点断言——
//  1. askPlayer 出选项:askInquiry 挂起后,无匹配 choices 相位的 choicesFor 按 id 回调
//     注册问询出选项集(决策归属座位与 params 如实送达 handler);
//  2. 快照 choices 带 id:选项统一盖 inquiryId 章,serializeGame 透出、恢复后重算一致
//     (挂起载荷随快照走,联机/恢复不丢问询);
//  3. 呈现意图查得到:快照选项的 inquiryId 经客户端呈现读口命中注册意图(占位变 seam)。
// 另钉两条口径:相位计算器优先(handler 只接管 choices 无法自然表达的问询,ADR-0022
// 咬合口径);零兜底(挂起 id 查无注册问询当场炸,不静默跳过)。
// 注册是模块级全局态:假包 id 随机唯一,用例自清理,不向同进程其他测试文件泄漏。
import { describe, it, expect, afterEach } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import {
  registerExtensionAuthorityModule,
  unregisterExtensionPackage,
} from "@core/extension-registry";
import type { ExtensionAuthorityModule } from "@core/extension-contract";
import type { ChoiceOption } from "@core/choices";
import {
  extensionInquiryPresentationOf,
  registerExtensionClientPackage,
  unregisterExtensionClientPackage,
} from "@app/extensions/registry";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(sanguoData);

const SEATS2: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: true },
];

function makeEngine(seed = 7, seats: SeatConfig[] = SEATS2): GameEngine {
  const cfg: EngineConfig = { seats, targetNetWorth: 30000 };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

/** 开好局并清掉开局锦囊卷轴,回到无匹配 choices 的常规相位(Roll)。 */
function prepared(seed?: number, seats?: SeatConfig[]) {
  const e = makeEngine(seed, seats);
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) {
      e.aiSetupStep();
    } else {
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
    }
  }
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return e;
}

// ── 假 inquiry 包(权威侧问询 + 客户端呈现意图,随机唯一 id 防跨文件冲突)──
const seq = Math.random().toString(36).slice(2, 8);
const INQUIRY_ID = `test-blind-pick-${seq}`;
const PKG_ID = `test-inquiry-pkg-${seq}`;

/** 盲选问询:params.n 张暗牌,label 是序号不是牌面(脱敏先例同示例包);
 *  params 缺项 handler 自己炸出(包作者纪律,contract 口径)。 */
function fakeInquiryModule(captured: { seat: number }[]): ExtensionAuthorityModule {
  return {
    manifest: { id: PKG_ID, name: "假问询包", version: "0.0.1", entry: "index.js" },
    inquiries: [
      {
        id: INQUIRY_ID,
        askPlayer: (ctx) => {
          captured.push({ seat: ctx.seat });
          if (ctx.params.n == null) throw new Error(`问询 ${INQUIRY_ID}:缺必填 params.n`);
          return Array.from({ length: ctx.params.n }, (_, i): ChoiceOption => ({
            id: `blind:${i}`,
            label: `暗牌·第${i + 1}张`,
            available: true,
          }));
        },
      },
    ],
  };
}

const loadedPkgs: string[] = [];
const loadedClientPkgs: string[] = [];
afterEach(() => {
  while (loadedPkgs.length > 0) unregisterExtensionPackage(loadedPkgs.pop()!);
  while (loadedClientPkgs.length > 0) unregisterExtensionClientPackage(loadedClientPkgs.pop()!);
});

/** 装载假问询包(权威侧 + 客户端呈现意图一并注册,返回捕获 handler 入参的间谍位)。 */
function loadFakeInquiry(): { captured: { seat: number }[] } {
  const captured: { seat: number }[] = [];
  registerExtensionAuthorityModule(fakeInquiryModule(captured));
  loadedPkgs.push(PKG_ID);
  registerExtensionClientPackage(
    { id: PKG_ID, name: "假问询包", version: "0.0.1", entry: "index.js" },
    {
      interactions: {
        inquiryPresentation: (id) => (id === INQUIRY_ID ? { blindCards: true } : null),
      },
    },
  );
  loadedClientPkgs.push(PKG_ID);
  return { captured };
}

describe("定制问询挂点(#432 端到端)", () => {
  it("askPlayer 出选项 → 快照 choices 带 inquiryId → 呈现意图查得到;恢复 round-trip 不丢", () => {
    const { captured } = loadFakeInquiry();
    const e = prepared();
    e.askInquiry(INQUIRY_ID, { n: 2 });

    // 1. 无匹配 choices 相位(Roll)按 id 回调:选项集来自 askPlayer
    const choices = e.choicesFor();
    expect(choices).toEqual([
      { id: "blind:0", label: "暗牌·第1张", available: true, inquiryId: INQUIRY_ID },
      { id: "blind:1", label: "暗牌·第2张", available: true, inquiryId: INQUIRY_ID },
    ]);
    // 决策归属座位如实送达 handler(单机人类在座)
    expect(captured).toEqual([{ seat: e.decisionOwner }]);

    // 2. 快照 choices 带 id;挂起载荷随快照走,恢复后重算一致(联机/恢复不丢问询)
    const snap = e.snapshot();
    expect(snap.choices).toEqual(choices);
    const e2 = makeEngine();
    e2.restoreFromSnapshot(snap);
    expect(e2.choicesFor()).toEqual(choices);

    // 3. 呈现意图:客户端读口按快照选项携带的 inquiryId 命中牌背意图
    const inquiryId = snap.choices[0]!.inquiryId;
    if (inquiryId == null) throw new Error("快照选项未携带 inquiryId(词汇断链)");
    expect(extensionInquiryPresentationOf(inquiryId)).toEqual({ blindCards: true });
    expect(extensionInquiryPresentationOf("no-such-inquiry")).toBeNull();
  });

  it("相位计算器优先:handler 只接管 choices 无法自然表达的问询(注册相位不回调)", () => {
    loadFakeInquiry();
    const e = prepared();
    e.askInquiry(INQUIRY_ID, { n: 2 });
    // 已注册决策相位的选项集照常产出,不被问询劫持
    e.turnPhase = "AwaitingTreasureOwner";
    const choices = e.choicesFor();
    expect(choices.map((o) => o.id)).toEqual(["fair", "premium", "decline"]);
    expect(choices.every((o) => o.inquiryId === undefined)).toBe(true);
    // 回到无匹配 choices 相位,挂起问询重新接管
    e.turnPhase = "Roll";
    expect(e.choicesFor().every((o) => o.inquiryId === INQUIRY_ID)).toBe(true);
  });

  it("零兜底:未注册 id 发起即炸;挂起后卸包查无注册问询当场炸(不静默跳过)", () => {
    const e = prepared();
    expect(() => e.askInquiry("no-such-inquiry")).toThrow(/无注册问询/);

    loadFakeInquiry();
    e.askInquiry(INQUIRY_ID, { n: 1 });
    expect(e.choicesFor()).toHaveLength(1);
    // 对局中途卸包 = 挂起 id 悬空,读选项集必须炸出而不是静默回空
    unregisterExtensionPackage(PKG_ID);
    loadedPkgs.pop();
    expect(() => e.choicesFor()).toThrow(/查无注册问询/);
  });
});
