// 太史慈 · 扩展名将包(客户端贡献 TS 源)。分发 = 编译后 JS(包根 client.js):
//   bunx esbuild src/client.ts --format=esm --target=es2022 --outfile=../client.js
// 结构契约见 src/app/extensions/registry.ts(ExtensionClientPackage)。本包演示三能力
// 之二/之三:「动画 handler」吃引擎事件批补演出(义从=义字印+文案浮字,破阵=擂鼓
// 文案浮字);「渲染 hook」供名将专属将旗(assets/flag.svg,站点根相对 URL)。
// 客户端包代码只做表现,不做任何裁决(裁决全在权威侧)。
import type { GameEngine } from "../../../src/core/authority";
import type { PresentationEvent } from "../../../src/app/fx/presentation";
import type { ExtensionClientPackage } from "../../../src/app/extensions/registry";

const PASSIVE_SKILL_ID = "taishici-yicong";
const ACTIVE_SKILL_ID = "taishici-pozhen";
const FLAG_URL = "/extensions/hero-taishici/assets/flag.svg";

/** 玩家锚点(棋盘逻辑坐标 + 语义格;与 fx/event-extract 的 playerAnchor 同式)。 */
function anchorOf(engine: GameEngine, seat: number): { x: number; y: number; atTile: number } {
  const p = engine.players[seat];
  const pos = engine.board.positionOf(p.position);
  return { x: pos.x, y: pos.y, atTile: p.position };
}

const contribution: ExtensionClientPackage = {
  animations: [
    ({ engine, events }): PresentationEvent[] => {
      const out: PresentationEvent[] = [];
      for (const ev of events) {
        if (ev.seat == null) continue;
        if (ev.kind === "skillFired" && ev.skillId === PASSIVE_SKILL_ID) {
          const a = anchorOf(engine, ev.seat);
          out.push({ kind: "sealStamped", tileIndex: a.atTile, char: "义" });
          out.push({
            kind: "textFloat",
            playerId: engine.players[ev.seat].id,
            text: "义从归心,来投之礼 +100 两",
            ...a,
          });
        }
        if (ev.kind === "heroSkillActivated" && ev.skillId === ACTIVE_SKILL_ID) {
          const a = anchorOf(engine, ev.seat);
          out.push({
            kind: "textFloat",
            playerId: engine.players[ev.seat].id,
            text: "破阵!擂鼓进军(步数 +1)",
            ...a,
          });
        }
      }
      return out;
    },
  ],
  render: {
    /** 名将专属将旗:太史慈卡面(招贤三选一/军师幕技卡/府库详情)挂旗。 */
    heroFlag: (heroId) => (heroId === "taishici" ? { url: FLAG_URL, alt: "太史慈将旗" } : null),
  },
};

export default contribution;
