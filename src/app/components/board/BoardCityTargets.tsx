import { memo } from "react";
import { rgba, Theme } from "@core/theme";
import {
  CITY_FRAME,
  CITY_HIT_RADIUS,
  cityOpacity,
  cityTransform,
  type CityScene,
} from "./city-scene";
import { CityLevelPips } from "./Tile";

export const BoardCityTargets = memo(function BoardCityTargets({
  cities,
  onTileClick,
  paintedCities,
}: {
  cities: readonly CityScene[];
  paintedCities: readonly CityScene[];
  onTileClick?: (index: number) => void;
}) {
  const focused = paintedCities.some(({ state }) => state.isSelectable);
  return (
    <g
      id="bv-tiles"
      onClick={(event) => {
        const target = (event.target as Element).closest("[data-tile]");
        if (target) onTileClick?.(Number(target.getAttribute("data-tile")));
      }}
    >
      {cities.map((city, index) => {
        const { tile, state } = city;
        const painted = paintedCities[index];
        return (
          <g
            className={
              state.isSelectable ? "bv-tile bv-city-target bv-selectable" : "bv-tile bv-city-target"
            }
            key={tile.index}
            data-tile={tile.index}
            data-name={tile.name}
            data-city-target={state.isCityTarget || undefined}
            data-city-target-selected={state.isCityPicked || undefined}
            role={onTileClick ? "button" : undefined}
            aria-label={tile.name}
            aria-pressed={state.isCityTarget ? state.isCityPicked : undefined}
            tabIndex={onTileClick ? 0 : undefined}
            transform={cityTransform(tile.position)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              if (!event.repeat) onTileClick?.(tile.index);
            }}
          >
            <circle r={CITY_HIT_RADIUS} fill={rgba(Theme.gold)} className="bv-city-press-halo" />
            <rect
              {...CITY_FRAME}
              className="bv-city-press"
              fill="transparent"
              stroke={rgba(Theme.goldBright)}
            />
            {painted && painted.state.level > 0 ? (
              <g aria-hidden="true" pointerEvents="none" opacity={cityOpacity(painted, focused)}>
                <CityLevelPips
                  tileIndex={tile.index}
                  level={painted.state.level}
                  maxLevel={painted.maxLevel}
                />
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
});
