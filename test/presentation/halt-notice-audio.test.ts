import { expect, it } from "bun:test";
import { withGlobal } from "@sinonjs/fake-timers";
import { setAudio } from "@app/fx/audio";
import { useFxStore } from "@app/fx/fxStore";
import { createEngineSink } from "@app/fx/sinks";
import { FX } from "@app/fx/timings";
import { recordAudio } from "../wiring/record-audio";

it("驻跸条带每次首次显示响一次，抢占后重现静默", () => {
  const clock = withGlobal(globalThis).install({
    toFake: ["performance", "setTimeout", "clearTimeout"],
  });
  const fx = useFxStore.getState();
  const sounds = recordAudio();
  const { showHaltBanner } = createEngineSink();
  const halt = {
    kind: "haltBanner",
    playerId: "mover",
    guohao: "魏",
    colorIndex: 0,
    cityName: "长安",
  } as const;
  try {
    fx.setNoticeSlotOccupied(true);
    showHaltBanner(halt);
    expect(useFxStore.getState().notice).toBeNull();
    expect(sounds).toEqual([]);

    fx.setNoticeSlotOccupied(false);
    expect(useFxStore.getState().notice?.cityName).toBe("长安");
    expect(sounds).toEqual(["haltLatch"]);
    fx.setNoticeSlotOccupied(true);
    fx.setNoticeSlotOccupied(false);
    expect(sounds).toEqual(["haltLatch"]);

    fx.setNoticeSlotOccupied(true);
    showHaltBanner({ ...halt, cityName: "洛阳" });
    clock.tick(FX.haltHoldMs);
    fx.setNoticeSlotOccupied(false);
    clock.tick(FX.haltBannerMs);
    expect(useFxStore.getState().notice?.cityName).toBe("洛阳");
    expect(sounds).toEqual(["haltLatch", "haltLatch"]);
  } finally {
    fx.resetFx();
    fx.setNoticeSlotOccupied(false);
    setAudio(null);
    clock.uninstall();
  }
});
