// 使用真实棋盘接线，控制解码完成的先后次序。平台替身只记录最终提交到可见画布的次数。
import { expect, it } from "bun:test";
import { act } from "react";
import { loadMap } from "@dafung/core/engine/board-loader";
import { CanvasBoard } from "@app/components/board/CanvasBoard";
import { computeFitView } from "@app/components/board/board-viewport";
import type { CityScene } from "@app/components/board/city-scene";
import mapData from "../../packages/core/maps/zhongyuan.json";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

it("棋盘仅提交最新城池贴图，地图背景跨城池更新复用", async () => {
  ensureHappyDom();
  const { createRoot } = await import("react-dom/client");
  const { board, catalog } = loadMap(mapData);
  const tile = board.tiles.find((tile) => tile.event === undefined)!;
  const { tier } = catalog.get(tile.propertyId)!;
  const fit = computeFitView(board.tiles);
  const initial: CityScene = {
    tile,
    tier,
    state: {
      ownerColorIndex: null,
      ownerGuohao: null,
      capitalColorIndex: null,
      capitalGuohao: null,
      isActive: false,
      isTaken: false,
      isSelectable: false,
      capitalCandidateOrder: null,
      isCityTarget: false,
      isCityPicked: false,
      defense: null,
      level: null,
      fireMarks: 0,
      fireProgress: 0,
    },
  };

  const container = document.createElement("div");
  document.body.append(container);
  document.documentElement.style.setProperty("--font-deco", "serif");
  const root = createRoot(container);
  const svgRef = { current: null as SVGSVGElement | null };
  const oldFetch = globalThis.fetch;
  const oldDecode = Image.prototype.decode;
  const oldContext = HTMLCanvasElement.prototype.getContext;
  const oldRequestFrame = window.requestAnimationFrame;
  const oldCancelFrame = window.cancelAnimationFrame;
  const oldCreateURL = URL.createObjectURL;
  const oldRevokeURL = URL.revokeObjectURL;

  let frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let nextURL = 0;
  let terrainDecodes = 0;
  let visiblePaints = 0;
  const firstPaintReports: (string | undefined)[] = [];
  const reportFirstPaint = (error?: string) => firstPaintReports.push(error);
  const blobs = new Map<string, Blob>();
  const cityDecodes: (() => void)[] = [];
  const queuedCities = Promise.withResolvers<void>();
  const firstPaint = Promise.withResolvers<void>();

  window.requestAnimationFrame = (callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  globalThis.fetch = Object.assign(
    async () => new Response("山水", { headers: { "Content-Type": "image/webp" } }),
    oldFetch,
  );
  URL.createObjectURL = (blob) => {
    if (!(blob instanceof Blob)) throw new Error("预期 SVG Blob");
    const url = "blob:board-test/" + ++nextURL;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    blobs.delete(url);
  };

  Image.prototype.decode = async function () {
    const markup = await blobs.get(this.src)!.text();
    if (!markup.includes("data-city-art")) {
      terrainDecodes++;
      return;
    }
    const decoding = Promise.withResolvers<void>();
    cityDecodes.push(decoding.resolve);
    if (cityDecodes.length === 2) queuedCities.resolve();
    await decoding.promise;
  };

  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value(this: HTMLCanvasElement) {
      const visible = container.contains(this);
      return {
        setTransform() {},
        transform() {},
        clearRect() {
          if (visible) {
            visiblePaints++;
            firstPaint.resolve();
          }
        },
        drawImage() {},
        save() {},
        restore() {},
        fillText() {},
        strokeText() {},
      };
    },
  });

  function runFrames() {
    const queued = frames;
    frames = new Map();
    for (const callback of queued.values()) callback(0);
  }

  try {
    act(() =>
      root.render(
        <CanvasBoard
          svgRef={svgRef}
          board={board}
          fit={fit}
          cities={[initial]}
          onFirstPaint={reportFirstPaint}
        />,
      ),
    );
    const deck = container.firstElementChild!;
    Object.defineProperties(deck, {
      clientWidth: { value: 744 },
      clientHeight: { value: 390 },
    });
    act(runFrames);
    const active = { ...initial, state: { ...initial.state, isActive: true } };
    act(() =>
      root.render(
        <CanvasBoard
          svgRef={svgRef}
          board={board}
          fit={fit}
          cities={[active]}
          onFirstPaint={reportFirstPaint}
        />,
      ),
    );
    await act(async () => {
      runFrames();
      await queuedCities.promise;
    });

    expect(firstPaintReports).toStrictEqual([]);
    expect(deck.querySelector("canvas")?.hidden).toBe(true);

    await act(async () => {
      cityDecodes[1]();
      await firstPaint.promise;
    });
    expect(visiblePaints).toBe(1);
    expect(deck.getAttribute("aria-busy")).toBe("false");

    await act(async () => {
      cityDecodes[0]();
      await Bun.sleep(0);
    });
    expect(visiblePaints).toBe(1);
    expect(terrainDecodes).toBe(1);
    expect(firstPaintReports).toStrictEqual([undefined]);
  } finally {
    act(() => root.unmount());
    window.requestAnimationFrame = oldRequestFrame;
    window.cancelAnimationFrame = oldCancelFrame;
    globalThis.fetch = oldFetch;
    Image.prototype.decode = oldDecode;
    HTMLCanvasElement.prototype.getContext = oldContext;
    URL.createObjectURL = oldCreateURL;
    URL.revokeObjectURL = oldRevokeURL;
    container.remove();
    await releaseHappyDom();
  }
});
