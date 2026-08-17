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

// ── 区域底色晕染 ──
// 玩家不读区域名也能"感知"地域:每个地理区域(中原/荆楚/…)铺一层极淡的
// 区域色 radial 晕染(峰值 opacity 8%,边缘渐隐到 0),城池/道路可读性不降。
// 区域中心不写死布局,而是从 board.tiles 的 region(中文名,两张内置图均随
// group 一起配置)反查 Theme.groupNames 得到 a–h,再取该区域城池坐标的
// 几何中心 → 历史图 sanguo / 天下图 chessboard 自适应,自定义地图同样生效。
/** 区域名(中原…)→ 分组键(a–h),预计算反查表。 */
const REGION_TO_GROUP: ReadonlyMap<string, string> = new Map(
  Object.entries(Theme.groupNames).map(([g, name]) => [name, g]),
);

interface RegionBlob {
  group: string;
  cx: number;
  cy: number;
  r: number;
}

/** 按 group 聚合城池坐标 → 每区域一个 {中心, 半径}。
 *  半径 = 城池到中心最大距离 × 1.7(铺满整段区域带),再夹在 [240, 640]:
 *  下限保证稀疏区域(如西凉 3 城)仍有成片色感,上限防大扩散糊到邻区。 */
function regionBlobs(tiles: readonly { region: string | null; position: { x: number; y: number } }[]): RegionBlob[] {
  const byGroup = new Map<string, { x: number; y: number }[]>();
  for (const t of tiles) {
    const g = t.region ? REGION_TO_GROUP.get(t.region) : undefined;
    if (!g) continue; // 非地产格 / 未知区域名不参与晕染
    let arr = byGroup.get(g);
    if (!arr) byGroup.set(g, (arr = []));
    arr.push(t.position);
  }
  const blobs: RegionBlob[] = [];
  for (const [group, pts] of byGroup) {
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const maxDist = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
    blobs.push({ group, cx, cy, r: Math.min(640, Math.max(240, maxDist * 1.7)) });
  }
  return blobs;
}

/** 区域底色层:8 个静态 radialGradient rect(无动画,渲染开销可忽略)。
 *  渲染在 RoadsLayer 组内最前 = 宣纸底之上、道路之下——道路压色而不被色糊。 */
const RegionTintLayer = memo(function RegionTintLayer({ board }: { board: Board }) {
  const blobs = regionBlobs(board.tiles);
  if (!blobs.length) return null;
  return (
    <g id="bv-region-tint">
      {blobs.map((b) => (
        // gradientUnits=userSpaceOnUse:圆心即区域几何中心,不随 rect 尺寸缩放
        <radialGradient key={b.group} id={`bv-tint-${b.group}`} gradientUnits="userSpaceOnUse" cx={b.cx} cy={b.cy} r={b.r}>
          <stop offset="0%" style={{ stopColor: `var(--color-group-${b.group})` }} stopOpacity={0.08} />
          <stop offset="70%" style={{ stopColor: `var(--color-group-${b.group})` }} stopOpacity={0.04} />
          <stop offset="100%" style={{ stopColor: `var(--color-group-${b.group})` }} stopOpacity={0} />
        </radialGradient>
      ))}
      {blobs.map((b) => (
        // 整幅 viewBox rect 填充渐变:渐变自带半径控制范围,rect 只是"画布"
        <rect key={`r-${b.group}`} x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill={`url(#bv-tint-${b.group})`} />
      ))}
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
      {/* 区域底色先画,主/辅路压在其上 */}
      <RegionTintLayer board={board} />
      {segments}
      {branchEls}
    </g>
  );
});
