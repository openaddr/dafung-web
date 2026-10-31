// 特殊城池两字徽标(#823/#828 AC)组件级断言:五类徽标按 event 渲染、普通城无徽标。
// 不下沉 e2e:徽标是纯静态 SVG(EventSeal 无 hooks),renderToStaticMarkup 直出
// 标记即可断言;可读性(844×390 两字可辨)走 shot.mjs 截图自证,自动化不管视觉。
// 词表 TileEvent→印文与 Tile.tsx 同源导入(exhaustiveness 断言防五类漂移)。
import { describe, it, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TILE_EVENTS } from "@core/board";
import type { TileDef } from "@core/board";
import { EventSeal, TILE_EVENT_BADGES, TILE_SCALE, Tile } from "@app/components/board/Tile";

const tile = (event?: TileDef["event"]): TileDef => ({
  index: 7,
  type: "Property",
  name: "测试城",
  position: { x: 0, y: 0 },
  propertyId: "prop-test",
  isCapitalEligible: true,
  ...(event != null ? { event } : {}),
});

const IDLE_STATE = {
  ownerColorIndex: null,
  ownerGuohao: null,
  level: 0,
  capitalColorIndex: null,
  capitalGuohao: null,
  isActive: false,
  isTaken: false,
  isSelectable: false,
  capitalCandidateOrder: null,
};

describe("特殊城池两字徽标(#828)", () => {
  it("词表恰覆盖 TILE_EVENTS 五类,印文一律两字(奖励域词表漂移当场红)", () => {
    expect(Object.keys(TILE_EVENT_BADGES).sort()).toEqual([...TILE_EVENTS].sort());
    for (const [event, badge] of Object.entries(TILE_EVENT_BADGES)) {
      expect([...badge], `event=${event}`).toHaveLength(2);
    }
  });

  it.each([...TILE_EVENTS])("event=%s → 印出对应两字,family=bv-event-seal", (event) => {
    const markup = renderToStaticMarkup(<EventSeal event={event} />);
    expect(markup).toContain("bv-event-seal");
    for (const c of TILE_EVENT_BADGES[event]) {
      expect(markup).toContain(`>${c}<`);
    }
  });

  it("特殊城渲染徽标、普通城(无 event)无徽标(全 Tile SSR 口径)", () => {
    const special = renderToStaticMarkup(
      <Tile tile={tile("fate")} group="a" maxLevel={3} state={IDLE_STATE} />,
    );
    expect(special).toContain("bv-event-seal");
    expect(special).toContain(">声<");
    const normal = renderToStaticMarkup(
      <Tile tile={tile()} group="a" maxLevel={3} state={IDLE_STATE} />,
    );
    expect(normal).not.toContain("bv-event-seal");
  });

  it("印随 TILE_SCALE 整体缩放(旧宝印独立系已收编)", () => {
    // EventSeal 挂在 Tile 的 translate/scale(TILE_SCALE) 组内,自身不再带比例——
    // 钉住「屏上尺寸 = 逻辑尺寸 × TILE_SCALE」的单源口径,防未来私自加 scale。
    const markup = renderToStaticMarkup(<EventSeal event="treasure" />);
    expect(markup).not.toContain("scale");
    expect(TILE_SCALE).toBe(2.2);
  });
});
