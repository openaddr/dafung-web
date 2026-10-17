// 静态层:玄墨地形底(feTurbulence 暗纹+四角晕影)、江河、驿道(主路漆金细线+箭羽)。
// 江河/驿道忠实移植自 src/render/board.ts 的 drawMountainsAndRivers / drawRoads / defs 段,
// 地图不变即不变 → 整个组件 React.memo,players 变化不会重渲这里。
// #512 玄墨深底化(方案一「重调色保留」):地形底从宣纸浅底换玄墨深底(bg 系 token),
// 溪山清远远景横带本票先摘除(S10 换新素材,挂点见 TerrainLayer TODO);区域晕染降音量。
import { memo } from "react";
import type { Board } from "@core/board";
import type { ViewBox } from "./usePanZoom";
import { Theme, rgba } from "@core/theme";

// 地形画布随图走(ADR-0027):不再钉死 viewBox 常量,由 BoardView 把
// computeFitView 推导的总览视口传进来,延展画布 = 总览 + EDGE_PAD 渐隐带。
// #39 江河仍按旧画布坐标手绘,整组以旧画布心 (100,30) 等比 1.4x 跟随
// (纯装饰水墨,内容横带 ±1600 覆盖任何内置图,位置不必随图重排)。
const TERRAIN_SCALE = 1.4;

// #24/#38 边缘连续性:地形宣纸向外延展的画布(比总览大一圈),配 mask 四边线性渐隐——
// 纸面在总览边界之外 EDGE_PAD 带宽内渐隐为透明,透出页面背景,消除边界的硬切。
// #38 根因教训:旧实现用单个椭圆 radial 渐隐,渐隐带起点超出了 pan 钳制可达范围
// (OVER=140),用户永远平移不到渐变区 → 效果完全不可感知;
// 且暗角/区域晕染 rect 裁在总览上,平移到边缘时反而是它们制造了新的硬切线。
// 现:①渐隐带从总览边界**起算**(四边独立线性渐变,带宽即 EDGE_PAD);
// ②OVER(usePanZoom)放宽到带宽的一半,pan 到极限时正处渐变中段;
// ③暗角/区域晕染 rect 一并扩到 O,不再有总览边界的裁切线。
const EDGE_PAD = 700;
const canvasOf = (fit: ViewBox) => ({
  x: fit.x - EDGE_PAD,
  y: fit.y - EDGE_PAD,
  w: fit.w + EDGE_PAD * 2,
  h: fit.h + EDGE_PAD * 2,
});

// #512 深底装饰色(无对应 token 的阴影向/水面色,收敛此块;金/墨/纸语义色一律走 Theme)
const VIGNETTE_EDGE = "rgba(6,4,2,0.55)"; // 四角晕影(比 bgDeep 更沉的纯阴影,不读色相)
const RIVER_HAZE = "rgba(86,118,148,0.26)"; // 江河氤氲水汽(宽淡线)
const RIVER_CORE = "rgba(112,146,178,0.42)"; // 江河水流浓芯(细线)

/** 点列 → path d(M/L 折线),与 render/svg-util.polylinePath 同式。 */
function poly(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

// ── defs:玄墨噪点滤镜 + 晕影渐变 ──
export const BoardDefs = memo(function BoardDefs({ fit }: { fit: ViewBox }) {
  const O = canvasOf(fit);
  return (
    <defs>
      {/* 玄墨暗纹(#512):feTurbulence 出墨金细纹(inkwash 色相,低 alpha),压在深底上
          读作「漆面的磨砂暗纹」而非纸纹;旧宣纸暖噪点(0.55/0.45/0.28)随浅底退役。 */}
      <filter id="bv-paper" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.012 0.018"
          numOctaves={2}
          seed={7}
          result="n"
        />
        <feColorMatrix
          in="n"
          type="matrix"
          values="0 0 0 0 0.61  0 0 0 0 0.54  0 0 0 0 0.37  0 0 0 0.07 0"
        />
      </filter>
      {/* 四角晕影:中心透明 → 边缘沉向纯阴影(#512 阴影向;深底上晕影只加进深不加色) */}
      <radialGradient id="bv-vignette" cx="50%" cy="50%" r="62%">
        <stop offset="55%" stopColor="var(--color-bg)" stopOpacity={0} />
        <stop offset="100%" stopColor={VIGNETTE_EDGE} stopOpacity={0.55} />
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
        <rect x={fit.x} y={O.y} width={EDGE_PAD} height={O.h} fill="url(#bv-edge-fade-r)" />
        <rect x={O.x} y={O.y} width={O.w} height={EDGE_PAD} fill="url(#bv-edge-fade-t)" />
        <rect x={O.x} y={fit.y} width={O.w} height={EDGE_PAD} fill="url(#bv-edge-fade-b)" />
      </mask>
      {/* F2 都城光晕(#512 克制档):金色中心 → 边缘渐 0;峰值压到 0.4(旧 0.55)——
          深底上金晕天然显眼,「美观且不炫目」验收词下收一档;脉动仍走 CSS opacity。 */}
      <radialGradient id="bv-capital-glow-grad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="var(--color-gold)" stopOpacity={0.4} />
        <stop offset="55%" stopColor="var(--color-gold)" stopOpacity={0.2} />
        <stop offset="100%" stopColor="var(--color-gold)" stopOpacity={0} />
      </radialGradient>
      {/* 城池建筑共享渐变(AB 混合·B 精绘,#512 深底档):墨青瓦屋面与夯土城台。
          每城内联 defs 会产生重复 id 冲突,统一挂这里,Tile 以 url(#…) 引用;
          gradientUnits 默认 objectBoundingBox = 各自屋面/墙身的包围盒,多档建筑共用同一份定义。 */}
      <linearGradient id="bv-roof-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#51606c" />
        <stop offset="1" stopColor="#3a4550" />
      </linearGradient>
      <linearGradient id="bv-wall-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#b59c74" />
        <stop offset="1" stopColor="#8a714c" />
      </linearGradient>
    </defs>
  );
});

// ── 背景:玄墨底 + 噪点暗纹 + 江河 + 四角晕影 ──
export const TerrainLayer = memo(function TerrainLayer({ fit }: { fit: ViewBox }) {
  const O = canvasOf(fit);
  return (
    // #24:整组地形(底色/噪点/江河/晕影)套边缘渐隐 mask——画布从 VB 扩到 O,
    // mask 让外围平滑淡出至页面背景,消除外缘硬切。
    <g mask="url(#bv-edge-mask)">
      {/* 玄墨地形底(#512):bg token 铺底(与页面深底同族,边缘渐隐后无缝),
          暗纹 = feTurbulence 墨金细纹,低音量。 */}
      <rect x={O.x} y={O.y} width={O.w} height={O.h} fill={rgba(Theme.bg)} />
      <rect x={O.x} y={O.y} width={O.w} height={O.h} fill="url(#bv-paper)" opacity={0.55} />
      {/* TODO(S10 古画退役+新素材):旧溪山清远远景横带已随玄墨深底化摘除(#512,
          浅底真迹在漆黑上发灰争辉);远景山意象待 S10 换新素材后在此挂点重铺
          (层级:暗纹之上、江河之下,内缘渐隐 mask 一并恢复)。 */}
      {/* #39 画布 1.4x:两条贝塞尔江河仍按旧画布坐标手绘,整组以画布中心 (100,30) 等比放大跟随。
          视觉重做 v2:水面加一笔浓芯(双线笔触)——淡宽线是氤氲水汽,浓细线是水流本身,
          两笔同弧线叠出「岸线晕、水线清」的水墨层次;#512 提亮一档配玄墨深底。 */}
      <g transform={`translate(100 30) scale(${TERRAIN_SCALE}) translate(-100 -30)`}>
        <g fill="none" strokeLinecap="round" opacity={0.45}>
          <path
            d="M -1000,260 Q -600,300 -300,250 T 200,280 T 700,300 T 1200,260"
            stroke={RIVER_HAZE}
            strokeWidth={10}
          />
          <path
            d="M -1000,260 Q -600,300 -300,250 T 200,280 T 700,300 T 1200,260"
            stroke={RIVER_CORE}
            strokeWidth={2.6}
          />
          <path
            d="M -1000,-200 Q -500,-160 0,-210 T 600,-180 T 1200,-220"
            stroke={RIVER_HAZE}
            strokeWidth={8}
          />
          <path
            d="M -1000,-200 Q -500,-160 0,-210 T 600,-180 T 1200,-220"
            stroke={RIVER_CORE}
            strokeWidth={2.2}
          />
        </g>
      </g>
      {/* 四角晕影铺满延展画布 O(不再裁在 VB 上——#38:VB 边界的晕影矩形切线就是用户看到的硬边),
          晕影集中在四角、恰好落在渐隐带内,与 mask 叠加后自然消隐。 */}
      <rect x={O.x} y={O.y} width={O.w} height={O.h} fill="url(#bv-vignette)" />
    </g>
  );
});

// ── 区域底色晕染 ──
// 玩家不读区域名也能"感知"地域:每个地理区域(中原/荆楚/…)铺一层极淡的
// 区域色 radial 晕染,城池/道路可读性不降。#512 深底适配:深底上彩色晕染天然
// 显眼(加色模式观感),「区域低音量」压到峰值 10%(70% 处 5%),只余色相推移
// 不成「光斑」——美观且不炫目。
// 区域中心不写死布局,而是从 board.tiles 的 region(中文名,两张内置图均随
// group 一起配置)反查 Theme.groupNames 得到 a–h,再取该区域城池坐标的
// 几何中心 → 内置图(huanyou/zhongyuan)自适应,自定义地图同样生效。
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
 *  本区域城池带,中央让位给江河水墨;#77 峰值 8% → 15%(70% 处 4% → 8%),
 *  边缘 0 的渐变口径不变,半径系数 1.3 亦不动。 */
function regionBlobs(
  tiles: readonly { region: string | null; position: { x: number; y: number } }[],
): RegionBlob[] {
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
        <radialGradient
          key={b.group}
          id={`bv-tint-${b.group}`}
          gradientUnits="userSpaceOnUse"
          cx={b.cx}
          cy={b.cy}
          r={b.r}
        >
          {/* #512 深底低音量:峰值 10%、70% 处 5%(浅底时代 15%/8%)——相邻区域交界
              仍能看出色相推移,但在玄墨底上不再读作彩色光斑;仍明显弱于道路与铭牌。 */}
          <stop
            offset="0%"
            style={{ stopColor: `var(--color-group-${b.group})` }}
            stopOpacity={0.1}
          />
          <stop
            offset="70%"
            style={{ stopColor: `var(--color-group-${b.group})` }}
            stopOpacity={0.05}
          />
          <stop
            offset="100%"
            style={{ stopColor: `var(--color-group-${b.group})` }}
            stopOpacity={0}
          />
        </radialGradient>
      ))}
      {blobs.map((b) => (
        // 渐变 rect 只铺本 blob 的圆域 bbox(外接正方形),不再铺满整幅延展画布:
        // 8 组各铺一张 O 大小的半透明 rect 时,渐变止点(r 外全透明)之外的像素虽是
        // 全透明,但 8 张 4620×3332 的层叠让「有色区/无色区」的包络边缘在浅纸面上
        // 读作一块错位的「重影」(dogfood 2026-09-28 ISSUE-009:编辑器画布重影实锤,
        // 遮挡实验逐层定位到本层;游戏屏同码但因视角/缩放不显)。圆域 bbox 裁剪后,
        // rect 边缘恰在渐变 fully-transparent 半径上,视觉无差异;区域感不丢。
        <rect
          key={`r-${b.group}`}
          x={b.cx - b.r}
          y={b.cy - b.r}
          width={b.r * 2}
          height={b.r * 2}
          fill={`url(#bv-tint-${b.group})`}
        />
      ))}
    </g>
  );
});

// ── 驿道:主路(漆木路身+漆金细线芯,逐段带避城弧线途经点)+ 箭羽行进向 ──
// #512:主路从「宽墨褐带」改「漆金细线」——roadMain 路身压底(窄档),其上 roadSide
// 细线芯走亮赭(S3 备好的两枚 token 同框);箭羽换熟金(goldDeep),深底上读作鎏金行进向。

/** 箭羽形状(#73):一枚人字形羽(尖朝 +x 行进向),挂在段中点、旋向行进方向。 */
const ROAD_ARROW_D = "M -9,-7 L 5,0 L -9,7";

export const RoadsLayer = memo(function RoadsLayer({ board }: { board: Board }) {
  const segments: React.ReactNode[] = [];
  const feathers: React.ReactNode[] = [];
  const n = board.count;
  for (let i = 0; i < n; i++) {
    const to = (i + 1) % n;
    const a = board.positionOf(i);
    const b = board.positionOf(to);
    const pts = [a, ...board.edgeWaypoints(i, to), b];
    const d = poly(pts);
    segments.push(
      <path
        key={`seg-${i}`}
        className="bv-road-main stroke-road-main"
        d={d}
        data-segment={`${i}-${to}`}
      />,
      // 漆金细线芯:叠在路身同弧线上,#512 深底化口径(stroke 色在 board.css 消费 token)
      <path key={`core-${i}`} className="bv-road-core" d={d} />,
    );
    // #73 主路箭羽:取途经点列正中两点的中点为锚(U 弯=edgeWaypoints 两点中点,
    // 直段=a/b 中点),连线方向即该处行进向——总览下箭羽成节奏点列,U 弯方向可读;
    // 首段(自起点长安出发)画双羽,与起点「起」印一起标识行进起点。
    const mi = Math.floor((pts.length - 1) / 2);
    const m0 = pts[mi];
    const m1 = pts[mi + 1];
    const mx = (m0.x + m1.x) / 2;
    const my = (m0.y + m1.y) / 2;
    const ang = (Math.atan2(m1.y - m0.y, m1.x - m0.x) * 180) / Math.PI;
    for (const off of i === 0 ? [-8, 8] : [0]) {
      feathers.push(
        <path
          key={`arrow-${i}-${off}`}
          className="bv-road-arrow"
          d={ROAD_ARROW_D}
          fill="none"
          stroke={rgba(Theme.goldDeep, 0.6)}
          strokeWidth={4}
          strokeLinecap="round"
          transform={`translate(${mx} ${my}) rotate(${ang}) translate(${off} 0)`}
        />,
      );
    }
  }

  return (
    <g id="bv-roads">
      {/* 区域底色先画,主路压在其上 */}
      <RegionTintLayer board={board} />
      {segments}
      {/* 箭羽画在全部主路之上(#73),不被后续段的路笔压住 */}
      {feathers}
    </g>
  );
});
