import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Board } from "@core/board";
import { fitBoardViewport, type ViewBox } from "./board-viewport";
import { TILE_SCALE, type CityScene } from "./city-scene";
import { canvasContext, paintBoard, rasterizeCity, rasterizeTerrain } from "./board-raster";
import { CityDefs, RoadsLayer, TerrainDefs, TerrainLayer } from "./StaticLayers";
import { Tile } from "./Tile";
import { BoardCityTargets } from "./BoardCityTargets";

const TerrainArt = memo(function TerrainArt({
  terrainRef,
  fit,
  board,
}: {
  terrainRef: React.RefObject<SVGGElement | null>;
  fit: ViewBox;
  board: Board;
}) {
  return (
    <g ref={terrainRef} display="none" aria-hidden="true">
      <TerrainDefs fit={fit} />
      <TerrainLayer fit={fit} />
      <RoadsLayer board={board} />
    </g>
  );
});

interface CitySprite {
  city: CityScene;
  bitmap: Promise<HTMLCanvasElement>;
}

function sameArt(a: CityScene, b: CityScene) {
  if (a.tile !== b.tile || a.tier !== b.tier) return false;
  if (a.state === b.state) return true;
  // 等级徽记在演出层更新，防御盾填充也取当前等级。压暗和灰化在合成时应用。
  const left = a.state;
  const right = b.state;
  return (
    left.ownerColorIndex === right.ownerColorIndex &&
    left.ownerGuohao === right.ownerGuohao &&
    left.capitalColorIndex === right.capitalColorIndex &&
    left.capitalGuohao === right.capitalGuohao &&
    left.isActive === right.isActive &&
    left.capitalCandidateOrder === right.capitalCandidateOrder &&
    left.defense === right.defense &&
    left.level === right.level &&
    left.isCityPicked === right.isCityPicked
  );
}

interface RasterCache {
  board: Board;
  width: number;
  height: number;
  sprites: Map<number, CitySprite>;
  terrain: Promise<HTMLCanvasElement>;
}

export function CanvasBoard({
  svgRef,
  board,
  fit,
  cities,
  onTileClick,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  board: Board;
  fit: ViewBox;
  cities: readonly CityScene[];
  onTileClick?: (index: number) => void;
}) {
  const deckRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terrainRef = useRef<SVGGElement>(null);
  const artRef = useRef<SVGGElement>(null);
  const cache = useRef<RasterCache | null>(null);
  const [painted, setPainted] = useState<{ board: Board; cities: readonly CityScene[] } | null>(
    null,
  );
  const [failure, setFailure] = useState<string>();
  const vectorCities = useMemo(
    () => cities.map((city) => <Tile key={city.tile.index} {...city} rasterSource />),
    [cities],
  );

  useLayoutEffect(() => {
    const deck = deckRef.current!;
    const svg = svgRef.current!;
    const canvas = canvasRef.current!;
    let revision = 0;
    let disposed = false;
    let pending: number | null = null;
    let last: { width: number; height: number; dpr: number } | null = null;

    async function draw(ticket: number) {
      const { clientWidth: cssWidth, clientHeight: cssHeight } = deck;
      if (cssWidth <= 0 || cssHeight <= 0) return;
      const dpr = window.devicePixelRatio;
      if (last?.width === cssWidth && last.height === cssHeight && last.dpr === dpr) return;
      const viewport = fitBoardViewport(fit, cssWidth, cssHeight);
      const width = Math.round(cssWidth * dpr);
      const height = Math.round(cssHeight * dpr);
      let prepared = cache.current;
      if (prepared?.board !== board || prepared.width !== width || prepared.height !== height) {
        prepared = {
          board,
          width,
          height,
          sprites: new Map(),
          terrain: rasterizeTerrain(terrainRef.current!, viewport, width, height),
        };
        cache.current = prepared;
      }
      const art = artRef.current!;
      const defs = svg.querySelector<SVGDefsElement>(":scope > defs")!;
      const images = cities.map((city, index) => {
        const previous = prepared.sprites.get(city.tile.index);
        if (previous && sameArt(previous.city, city)) return previous.bitmap;
        const source = art.children[index] as SVGGElement;
        if (source.getAttribute("data-city-art") !== String(city.tile.index))
          throw new Error("城池贴图与盘面状态顺序不一致");
        const bitmap = rasterizeCity(source, defs, viewport.scale * dpr * TILE_SCALE);
        prepared.sprites.set(city.tile.index, { city, bitmap });
        return bitmap;
      });
      const [terrain, sprites] = await Promise.all([prepared.terrain, Promise.all(images)]);
      // 仅把最新一批完整画面提交到屏幕。
      if (disposed || ticket !== revision || canvasContext(canvas).isContextLost?.()) return;
      paintBoard(canvas, viewport, terrain, width, height, cities, sprites);
      last = { width: cssWidth, height: cssHeight, dpr };
      setPainted({ board, cities });
      setFailure(undefined);
    }

    function refresh() {
      revision++;
      if (pending !== null) return;
      pending = requestAnimationFrame(() => {
        pending = null;
        const ticket = revision;
        void draw(ticket).catch((error: unknown) => {
          if (disposed || ticket !== revision) return;
          cache.current = null;
          setFailure(error instanceof Error ? error.message : String(error));
        });
      });
    }

    function loseContext() {
      revision++;
      setPainted(null);
    }

    function restore() {
      last = null;
      cache.current = null;
      refresh();
    }

    refresh();
    const resize = new ResizeObserver(refresh);
    resize.observe(deck);
    window.addEventListener("resize", refresh);
    canvas.addEventListener("contextlost", loseContext);
    canvas.addEventListener("contextrestored", restore);
    return () => {
      disposed = true;
      if (pending !== null) cancelAnimationFrame(pending);
      resize.disconnect();
      window.removeEventListener("resize", refresh);
      canvas.removeEventListener("contextlost", loseContext);
      canvas.removeEventListener("contextrestored", restore);
    };
  }, [svgRef, board, cities, fit]);

  const ready = failure === undefined && painted?.board === board;
  return (
    <div className="bv-deck" aria-busy={!ready} ref={deckRef}>
      <canvas className="bv-city-canvas" ref={canvasRef} aria-hidden="true" hidden={!ready} />
      <svg
        id="board"
        ref={svgRef}
        viewBox={[fit.x, fit.y, fit.w, fit.h].join(" ")}
        preserveAspectRatio="xMidYMid meet"
        className="bv-city-input"
      >
        <CityDefs />
        <TerrainArt terrainRef={terrainRef} fit={fit} board={board} />
        <g ref={artRef} display="none" aria-hidden="true">
          {vectorCities}
        </g>
        <BoardCityTargets
          cities={cities}
          paintedCities={ready ? painted.cities : []}
          onTileClick={onTileClick}
        />
      </svg>
      {failure !== undefined ? (
        <p className="bv-raster-error" role="alert">
          棋盘绘制失败。{failure}
        </p>
      ) : null}
    </div>
  );
}
