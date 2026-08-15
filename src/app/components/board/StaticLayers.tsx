// 静态层:宣纸滤镜 defs、远山河川、暗角、驿道(主路+辅路)。
// 忠实移植自 src/render/board.ts 的 drawMountainsAndRivers / drawRoads / defs 段,
// 地图不变即不变 → 整个组件 React.memo,players 变化不会重渲这里。
import { memo } from "react";
import type { Board } from "@core/board";
import { Theme, rgba } from "@core/theme";

// viewBox 常量与旧 board.ts / usePanZoom FIT_VIEW 保持一致
const VB = { x: -1050, y: -660, w: 2300, h: 1380 } as const;

/** 点列 → path d(M/L 折线),与 render/svg-util.polylinePath 同式。 */
function poly(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

// ── defs:宣纸噪点滤镜 + 暗角渐变 ──
export const BoardDefs = memo(function BoardDefs() {
  return (
    <defs>
      <filter id="bv-paper" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves={2} seed={7} result="n" />
        <feColorMatrix
          in="n"
          type="matrix"
          values="0 0 0 0 0.55  0 0 0 0 0.45  0 0 0 0 0.28  0 0 0 0.06 0"
        />
      </filter>
      <radialGradient id="bv-vignette" cx="50%" cy="50%" r="62%">
        <stop offset="60%" stopColor="#e8dcc0" stopOpacity={0} />
        <stop offset="100%" stopColor="#6b4f28" stopOpacity={0.28} />
      </radialGradient>
    </defs>
  );
});

// ── 背景:宣纸底 + 噪点 + 淡墨远山/江河 + 暗角 ──
export const TerrainLayer = memo(function TerrainLayer() {
  // 淡墨远山(太行/燕山意象,压低存在感)
  const hills: Array<[string, string]> = [
    ["-1100,-680 -700,-720 -500,-660 -300,-700 -100,-660 100,-690 100,-560 -1100,-560", "rgba(120,100,70,0.5)"],
    ["300,-700 600,-680 900,-700 1200,-660 1200,-560 300,-560", "rgba(110,95,65,0.4)"],
    ["-1100,500 -800,470 -500,500 -200,470 100,500 100,620 -1100,620", "rgba(110,95,65,0.35)"],
  ];
  return (
    <g>
      <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="#e8dcc0" />
      <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="url(#bv-paper)" opacity={0.5} />
      <g opacity={0.12}>
        {hills.map(([pts, fill], i) => (
          <path key={i} d={`M${pts} Z`} fill={fill} />
        ))}
      </g>
      <g
        fill="none"
        stroke="rgba(70,110,140,0.28)"
        strokeWidth={10}
        strokeLinecap="round"
        opacity={0.45}
      >
        <path d="M -1000,260 Q -600,300 -300,250 T 200,280 T 700,300 T 1200,260" />
        <path
          d="M -1000,-200 Q -500,-160 0,-210 T 600,-180 T 1200,-220"
          strokeWidth={8}
          opacity={0.5}
        />
      </g>
      <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="url(#bv-vignette)" />
    </g>
  );
});

// ── 驿道:主路(粗褐,逐段带避城弧线途经点)+ 辅路(虚赭橙 + 格子图标 + 起点⇄) ──
export const RoadsLayer = memo(function RoadsLayer({ board }: { board: Board }) {
  const segments: React.ReactNode[] = [];
  const n = board.count;
  for (let i = 0; i < n; i++) {
    const to = (i + 1) % n;
    const a = board.positionOf(i);
    const b = board.positionOf(to);
    const pts = [a, ...board.edgeWaypoints(i, to), b];
    segments.push(
      <path key={`seg-${i}`} className="bv-road-main stroke-road-main" d={poly(pts)} data-segment={`${i}-${to}`} />,
    );
  }

  const branch = board.branch;
  let branchEls: React.ReactNode = null;
  if (branch) {
    const start = board.positionOf(branch.startNode);
    const end = board.positionOf(branch.endNode);
    const pts = [start, ...branch.cells.map((c) => c.position), end];
    branchEls = (
      <>
        <path className="bv-road-branch stroke-road-side" d={poly(pts)} data-branch={branch.id} />
        {branch.cells.map((c, i) => {
          const color =
            c.kind === "treasure" ? Theme.goldBright : c.kind === "event" ? Theme.gold : Theme.danger;
          const icon = c.kind === "treasure" ? "宝" : c.kind === "event" ? "囊" : "伏";
          return (
            <g key={`bc-${i}`} data-branch-cell={i} transform={`translate(${c.position.x} ${c.position.y})`}>
              <circle r={18} fill={rgba(Theme.panel)} stroke={rgba(color)} strokeWidth={2} />
              <text
                textAnchor="middle"
                y={6}
                fontFamily="var(--font-brush)"
                fontSize={18}
                fontWeight={700}
                fill={rgba(color)}
              >
                {icon}
              </text>
            </g>
          );
        })}
        {/* 起点⇄标记:辅路入口记号 */}
        <g transform={`translate(${start.x + 44} ${start.y - 34})`}>
          <text fontSize={28} fill={rgba(Theme.roadSide)} fontWeight={700}>
            ⇄
          </text>
        </g>
      </>
    );
  }

  return (
    <g id="bv-roads">
      {segments}
      {branchEls}
    </g>
  );
});
