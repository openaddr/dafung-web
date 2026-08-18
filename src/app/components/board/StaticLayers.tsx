// 静态层:宣纸滤镜 defs、远山河川、暗角、驿道(主路+辅路)。
// 忠实移植自 src/render/board.ts 的 drawMountainsAndRivers / drawRoads / defs 段,
// 地图不变即不变 → 整个组件 React.memo,players 变化不会重渲这里。
import { memo } from "react";
import type { Board } from "@core/board";
import { Theme, rgba } from "@core/theme";

// viewBox 常量与旧 board.ts / usePanZoom FIT_VIEW 保持一致。
// #39:城池间距 1.4x 重排(三张地图坐标同步放大)→ 逻辑画布以 (100,30) 为心等比 1.4x:
// 2300×1380 → 3220×1932,远山河川由 TERRAIN_SCALE 变换跟随。
const TERRAIN_SCALE = 1.4;
const VB = { x: -1510, y: -936, w: 3220, h: 1932 } as const;

// #24/#38 边缘连续性:地形宣纸向外延展的画布(比 VB 大一圈),配 mask 四边线性渐隐——
// 纸面在 VB 边界之外 EDGE_PAD 带宽内渐隐为透明,透出页面背景,消除边界的硬切。
// #38 根因教训:旧实现用单个椭圆 radial 渐隐,渐隐带起点(约在 VB 边界外 260~410 单位)
// 超出了 pan 钳制可达范围(OVER=140),用户永远平移不到渐变区 → 效果完全不可感知;
// 且暗角/区域晕染 rect 裁在 VB 上,平移到边缘时反而是它们制造了新的硬切线。
// 现:①渐隐带从 VB 边界**起算**(四边独立线性渐变,带宽即 EDGE_PAD);
// ②OVER(usePanZoom)放宽到带宽的一半,pan 到极限时正处渐变中段;
// ③暗角/区域晕染 rect 一并扩到 O,不再有 VB 边界的裁切线。
const EDGE_PAD = 700;
const O = { x: VB.x - EDGE_PAD, y: VB.y - EDGE_PAD, w: VB.w + EDGE_PAD * 2, h: VB.h + EDGE_PAD * 2 } as const;

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
      {/* F2 都城光晕:金色中心 → 边缘渐 0(替代 Tile 内联 filter:blur(9px)——
          blur 滤镜随 zoom 每帧重算,渐变填充近零开销;脉动仍走 CSS opacity)。 */}
      {/* #38 边缘渐隐 mask:白底全显 + 四边各一条 EDGE_PAD 宽的线性渐变带
          (外缘黑=透明 → 内缘白=可见),渐变从 VB 边界起算。objectBoundingBox 单位
          相对各自 band rect,天然横/纵向独立、无椭圆长短轴失配。四角处两条带
          叠加(alpha 合成近似相乘)只会更快趋黑,无亮缝。白色=可见,luminance 语义。 */}
      <linearGradient id="bv-edge-fade-l" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#000" />
        <stop offset="1" stopColor="#fff" />
      </linearGradient>
      <linearGradient id="bv-edge-fade-r" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fff" />
        <stop offset="1" stopColor="#000" />
      </linearGradient>
      <linearGradient id="bv-edge-fade-t" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#000" />
        <stop offset="1" stopColor="#fff" />
      </linearGradient>
      <linearGradient id="bv-edge-fade-b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" />
        <stop offset="1" stopColor="#000" />
      </linearGradient>
      <mask id="bv-edge-mask" maskUnits="userSpaceOnUse" x={O.x} y={O.y} width={O.w} height={O.h}>
        <rect x={O.x} y={O.y} width={O.w} height={O.h} fill="#fff" />
        <rect x={O.x} y={O.y} width={EDGE_PAD} height={O.h} fill="url(#bv-edge-fade-l)" />
        <rect x={VB.x} y={O.y} width={EDGE_PAD} height={O.h} fill="url(#bv-edge-fade-r)" />
        <rect x={O.x} y={O.y} width={O.w} height={EDGE_PAD} fill="url(#bv-edge-fade-t)" />
        <rect x={O.x} y={VB.y} width={O.w} height={EDGE_PAD} fill="url(#bv-edge-fade-b)" />
      </mask>
      <radialGradient id="bv-capital-glow-grad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#d4af37" stopOpacity={0.55} />
        <stop offset="55%" stopColor="#d4af37" stopOpacity={0.28} />
        <stop offset="100%" stopColor="#d4af37" stopOpacity={0} />
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
    // #24:整组地形(纸底/噪点/远山/江河/暗角)套边缘渐隐 mask——纸面画布从 VB
    // 扩到 O,mask 让外围 ~560 逻辑单位平滑淡出至页面背景,消除外缘硬切。
    <g mask="url(#bv-edge-mask)">
      <rect x={O.x} y={O.y} width={O.w} height={O.h} fill="#e8dcc0" />
      <rect x={O.x} y={O.y} width={O.w} height={O.h} fill="url(#bv-paper)" opacity={0.5} />
      {/* #39 画布 1.4x:远山/江河仍按旧画布坐标手绘,整组以画布中心 (100,30) 等比放大跟随。 */}
      <g transform={`translate(100 30) scale(${TERRAIN_SCALE}) translate(-100 -30)`}>
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
      </g>
      {/* 暗角铺满延展画布 O(不再裁在 VB 上——#38:VB 边界的暗角矩形切线就是用户看到的硬边),
          其暗角集中在四角、恰好落在渐隐带内,与 mask 叠加后自然消隐。 */}
      <rect x={O.x} y={O.y} width={O.w} height={O.h} fill="url(#bv-vignette)" />
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
 *  半径 = 城池到中心最大距离 × 系数,再夹在 [240, 640]:
 *  下限保证稀疏区域(如西凉 3 城)仍有成片色感,上限防大扩散糊到邻区。
 *  A3:系数 1.7 → 1.3——8 层全幅渐变在棋盘中央叠糊,收紧后每片晕染基本只罩
 *  本区域城池带,中央让位给江河水墨;峰值 8% → 边缘 0 的渐变口径不变。 */
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
    blobs.push({ group, cx, cy, r: Math.min(640, Math.max(240, maxDist * 1.3)) });
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
        // 整幅延展画布 rect 填充渐变:渐变自带半径控制范围,rect 只是"画布"
        // (#38:铺到 O 而非 VB,避免 rect 在 VB 边界留下晕染断层线)
        <rect key={`r-${b.group}`} x={O.x} y={O.y} width={O.w} height={O.h} fill={`url(#bv-tint-${b.group})`} />
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
        {/* A4 辅路入口记号:碑亭剪影(几笔水墨 path:宝顶+翘角亭盖+双柱+基座),
            替代与水墨语境脱节的「⇄」字符;位置沿辅路首段走向偏移,并取背离棋盘
            中心的法向侧,记号永远落在路外侧、不压主路。 */}
        {(() => {
          const first = branch.cells[0]?.position ?? end;
          const dx = first.x - start.x;
          const dy = first.y - start.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          // 法向两个候选,取与"起点→棋盘中心反向"更一致的一侧(朝路外)
          const nx = -uy;
          const ny = ux;
          const side = nx * start.x + ny * start.y >= 0 ? 1 : -1;
          const mx = start.x + ux * 46 + nx * side * 30;
          const my = start.y + uy * 46 + ny * side * 30;
          const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
          return (
            <g
              transform={`translate(${mx} ${my}) rotate(${ang})`}
              fill="none"
              stroke={rgba(Theme.roadSide)}
              strokeWidth={2.2}
              strokeLinecap="round"
              opacity={0.9}
            >
              {/* 宝顶 */}
              <circle cx={0} cy={-12} r={1.8} fill={rgba(Theme.roadSide)} stroke="none" />
              {/* 翘角亭盖(两笔弧) */}
              <path d="M -12,-2 Q -8,-8 0,-9 Q 8,-8 12,-2" />
              <path d="M -12,-2 Q -14,0 -15,2 M 12,-2 Q 14,0 15,2" strokeWidth={1.4} />
              {/* 双柱 + 基座 */}
              <line x1={-7} y1={-2} x2={-7} y2={9} />
              <line x1={7} y1={-2} x2={7} y2={9} />
              <path d="M -11,10 L 11,10" />
              {/* 柱间一竖碑(点出"碑"亭) */}
              <rect x={-1.5} y={0} width={3} height={8} fill={rgba(Theme.roadSide, 0.85)} stroke="none" />
            </g>
          );
        })()}
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
