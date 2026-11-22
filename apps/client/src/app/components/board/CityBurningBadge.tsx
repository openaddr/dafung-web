import { useId } from "react";
import { CITY_BURN_TURNS } from "@dafung/core/engine/constants";
import { CITY_BURN_DAMAGE } from "@dafung/core/engine/defense";
import { rgba, Theme } from "@dafung/core/engine/theme";
import { useFxStore } from "@app/fx/fxStore";

const FLAME_PATH =
  "M 0 -14 C 5 -10 3 -4 6 -3 C 7 -4 8 -6 8 -8 C 13 -2 11 5 7 8 C 4 11 -3 12 -7 8 C -13 3 -10 -5 -6 -8 C -6 -4 -4 -3 -3 -2 C -2 -6 0 -10 0 -14 Z";

/** 与等级徽记和蓝盾同排，留出各自独立的读数。 */
export function CityBurningBadge({ marks, fill }: { marks: number; fill: number }) {
  const fillId = useId();
  const boundary = 1 - fill;
  const flame = rgba(Theme.danger);
  return (
    <g transform="translate(-21 31)" pointerEvents="none" aria-hidden="true">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset={boundary} stopColor={rgba(Theme.bgDeep)} />
          <stop offset={boundary} stopColor={flame} />
        </linearGradient>
      </defs>
      <path d={FLAME_PATH} fill={`url(#${fillId})`} stroke={flame} strokeWidth={1.2} />
      <text
        y={3}
        dominantBaseline="central"
        textAnchor="middle"
        fontFamily="var(--font-wenkai)"
        fontSize={14}
        fill={rgba(Theme.paperHi)}
      >
        {marks}
      </text>
    </g>
  );
}

/** 棋盘显示权威进度，并短暂保留本次到期前的实心火焰。 */
export function BoardCityBurning({
  tileIndex,
  marks,
  progress,
}: {
  tileIndex: number;
  marks: number;
  progress: number;
}) {
  const pulse = useFxStore((state) => state.burningPulses.get(tileIndex));
  if (pulse !== undefined) {
    return (
      <g pointerEvents="none" aria-hidden="true">
        <CityBurningBadge marks={pulse.marks} fill={1} />
        <text
          x={-21}
          y={8}
          dominantBaseline="central"
          textAnchor="middle"
          fontFamily="var(--font-wenkai)"
          fontSize={14}
          fill={rgba(Theme.paperHi)}
          stroke={rgba(Theme.bgDeep)}
          strokeWidth={2}
          paintOrder="stroke"
        >
          -{CITY_BURN_DAMAGE}
        </text>
      </g>
    );
  }
  return marks > 0 ? <CityBurningBadge marks={marks} fill={progress / CITY_BURN_TURNS} /> : null;
}
