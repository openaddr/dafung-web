const PASSIVE_SKILL_ID = "taishici-yicong";
const ACTIVE_SKILL_ID = "taishici-pozhen";
const FLAG_URL = "/extensions/hero-taishici/assets/flag.svg";
function anchorOf(engine, seat) {
  const p = engine.players[seat];
  const pos = engine.board.positionOf(p.position);
  return { x: pos.x, y: pos.y, atTile: p.position };
}
const contribution = {
  animations: [
    ({ engine, events }) => {
      const out = [];
      for (const ev of events) {
        if (ev.seat == null) continue;
        if (ev.kind === "skillFired" && ev.skillId === PASSIVE_SKILL_ID) {
          const a = anchorOf(engine, ev.seat);
          out.push({ kind: "sealStamped", tileIndex: a.atTile, char: "义" });
          out.push({
            kind: "textFloat",
            playerId: engine.players[ev.seat].id,
            text: "义从归心,来投之礼 +100 两",
            ...a
          });
        }
        if (ev.kind === "heroSkillActivated" && ev.skillId === ACTIVE_SKILL_ID) {
          const a = anchorOf(engine, ev.seat);
          out.push({
            kind: "textFloat",
            playerId: engine.players[ev.seat].id,
            text: "破阵!擂鼓进军(步数 +1)",
            ...a
          });
        }
      }
      return out;
    }
  ],
  render: {
    /** 名将专属将旗:太史慈卡面(招贤三选一/军师幕技卡/府库详情)挂旗。 */
    heroFlag: (heroId) => heroId === "taishici" ? { url: FLAG_URL, alt: "太史慈将旗" } : null
  },
  interactions: {
    /** 问询呈现意图(#410):盲选问询以牌背呈现——选项 label 是序号不是牌面,
     *  渲染层按意图画牌背+序号(消费挂点归 UI 票);其余问询无定制,走通用卷轴。 */
    inquiryPresentation: (inquiryId) => inquiryId === "taishici-blind-pick" ? { blindCards: true } : null
  }
};
var client_default = contribution;
export {
  client_default as default
};
