// 静态层:玄墨地形底(feTurbulence 暗纹+纸纤维噪点+龚贤远山带+四角晕影)、
// 驿道(主路漆金细线+路肩细线+箭羽)。
// 驿道忠实移植自旧 src/render/board.ts 的 drawRoads / defs 段,
// 地图不变即不变 → 整个组件 React.memo,players 变化不会重渲这里。
// #512 玄墨深底化(方案一「重调色保留」):地形底从宣纸浅底换玄墨深底(bg 系 token)。
// 2026-10-24 拷问:装饰性江河双线与区域底色晕染双双退役——江河被用户判「没啥用」,
// 晕染实拍 A/B 近零感知;区域视觉待机制化时重新设计(分组色板随之退役)。
// #844 景深与肌理:纸纤维噪点 pattern(零图片资产)+ 龚贤《山水图卷》远山横带
// (素材管线入库,叠 10% 做远景衬)+ 路肩 0.8px 平行细线——深 zoom 不再纯平涂。
import { memo } from "react";
import type { Board } from "@core/board";
import type { ViewBox } from "./usePanZoom";
import { Theme, rgba } from "@core/theme";

// 地形画布随图走(ADR-0027):不再钉死 viewBox 常量,由 BoardView 把
// computeFitView 推导的总览视口传进来,延展画布 = 总览 + EDGE_PAD 渐隐带。

// #24/#38 边缘连续性:地形宣纸向外延展的画布(比总览大一圈),配 mask 四边线性渐隐——
// 纸面在总览边界之外 EDGE_PAD 带宽内渐隐为透明,透出页面背景,消除边界的硬切。
// #38 根因教训:旧实现用单个椭圆 radial 渐隐,渐隐带起点超出了 pan 钳制可达范围
// (OVER=140),用户永远平移不到渐变区 → 效果完全不可感知;
// 且暗角 rect 裁在总览上,平移到边缘时反而是它制造了新的硬切线。
// 现:①渐隐带从总览边界**起算**(四边独立线性渐变,带宽即 EDGE_PAD);
// ②OVER(usePanZoom)放宽到带宽的一半,pan 到极限时正处渐变中段;
// ③暗角 rect 一并扩到 O,不再有总览边界的裁切线。
const EDGE_PAD = 700;
const canvasOf = (fit: ViewBox) => ({
  x: fit.x - EDGE_PAD,
  y: fit.y - EDGE_PAD,
  w: fit.w + EDGE_PAD * 2,
  h: fit.h + EDGE_PAD * 2,
});

// #844 纸纤维噪点 pattern 的 tile 边长(user units):256 档在总览读作细密纤维、
// 深 zoom 放大后仍连续不断纹;feTurbulence stitchTiles 缝合 tile 边界,平铺无缝。
const FIBER_TILE = 256;

// #844 远景带几何:上/下缘各铺一条,高 = 总览视口的 18%(旧溪山清远档位,
// #100/#516 在役期验收过的比例),透明度 10%(票面 8-12% 档中值)。
const SCENE_BAND_RATIO = 0.18;
const SCENE_BAND_OPACITY = 0.1;
const GONGXIAN_BAND_HREF = "/assets/textures/texture-gongxian-shanshui.webp";

// #844 路肩:.bv-road-main 路身宽 10,肩线以同弧线加宽 2×0.8 垫底实现,
// 两侧各露 0.8px 平行细线(user units,随 zoom 同步缩放)。
const ROAD_SHOULDER_W = 11.6;

// #512 深底装饰色(无对应 token 的阴影向色,收敛此块;金/墨/纸语义色一律走 Theme)
const VIGNETTE_EDGE = "rgba(6,4,2,0.55)"; // 四角晕影(比 bgDeep 更沉的纯阴影,不读色相)

/** 点列 → path d(M/L 折线),与 render/svg-util.polylinePath 同式。 */
function poly(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

// ── defs:玄墨噪点滤镜 + 晕影渐变 ──
export const BoardDefs = memo(function BoardDefs({ fit }: { fit: ViewBox }) {
  const O = canvasOf(fit);
  const sceneBandH = Math.round(fit.h * SCENE_BAND_RATIO);
  return (
    <defs>
      {/* 玄墨暗纹(#512):feTurbulence 出墨金细纹(goldWash 色相,低 alpha),压在深底上
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
      {/* #844 纸纤维噪点:fractalNoise 高频灰阶磨砂,feTurbulence stitchTiles=stitch
          让 256 tile 边界噪声缝合、pattern 平铺无缝——SVG 一次生成零图片资产,
          深 zoom 的格间空白不再是纯平涂。fractalNoise 原始输出对比度天然压缩
          (±0.2 上下),不扩直接叠会被 0.05 音量彻底埋没(实测穿帮):灰阶去饱和后
          feComponentTransfer 双向扩幅——RGB 绕均值 0.5 ×3.5 扩幅、alpha 抬到近满幅
          (turbulence 自带 alpha 噪声均值 ≈0.5,不抬则音量再砍半);对比度在 filter
          内做满,音量由消费 rect 的 opacity(0.05)统一压住,两处职责分开。 */}
      <filter id="bv-fiber-noise" x="0" y="0" width="100%" height="100%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.9"
          numOctaves={2}
          seed={11}
          stitchTiles="stitch"
          result="n"
        />
        <feColorMatrix in="n" type="saturate" values="0" result="g" />
        <feComponentTransfer in="g">
          <feFuncR type="linear" slope={3.5} intercept={-1.25} />
          <feFuncG type="linear" slope={3.5} intercept={-1.25} />
          <feFuncB type="linear" slope={3.5} intercept={-1.25} />
          <feFuncA type="linear" slope={3} intercept={-0.5} />
        </feComponentTransfer>
      </filter>
      <pattern id="bv-fiber" width={FIBER_TILE} height={FIBER_TILE} patternUnits="userSpaceOnUse">
        <rect width={FIBER_TILE} height={FIBER_TILE} filter="url(#bv-fiber-noise)" />
      </pattern>
      {/* #844 远景带内容渐隐 mask(旧 #100 结构随素材复活):带外缘贴 fit 边界
          (pan 出界的渐隐由外层 bv-edge-mask 统一负责),内缘朝棋盘中心渐隐——
          外缘 55% 全显、余下 45% 线性淡出到 0,避免带底留一条硬切线。 */}
      <linearGradient id="bv-scene-fade-t" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" />
        <stop offset="0.55" stopColor="#fff" />
        <stop offset="1" stopColor="#fff" stopOpacity={0} />
      </linearGradient>
      <linearGradient id="bv-scene-fade-b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity={0} />
        <stop offset="0.55" stopColor="#fff" />
        <stop offset="1" stopColor="#fff" />
      </linearGradient>
      <mask
        id="bv-scene-mask"
        maskUnits="userSpaceOnUse"
        x={fit.x}
        y={fit.y}
        width={fit.w}
        height={fit.h}
      >
        <rect x={fit.x} y={fit.y} width={fit.w} height={sceneBandH} fill="url(#bv-scene-fade-t)" />
        <rect
          x={fit.x}
          y={fit.y + fit.h - sceneBandH}
          width={fit.w}
          height={sceneBandH}
          fill="url(#bv-scene-fade-b)"
        />
      </mask>
    </defs>
  );
});

// ── 背景:玄墨底 + 噪点暗纹 + 纸纤维 + 龚贤远山带 + 四角晕影 ──
export const TerrainLayer = memo(function TerrainLayer({ fit }: { fit: ViewBox }) {
  const O = canvasOf(fit);
  const sceneBandH = Math.round(fit.h * SCENE_BAND_RATIO);
  return (
    // #24:整组地形(底色/噪点/纤维/远山带/晕影)套边缘渐隐 mask——画布从 VB 扩到 O,
    // mask 让外围平滑淡出至页面背景,消除外缘硬切。
    <g mask="url(#bv-edge-mask)">
      {/* 玄墨地形底(#512):bg token 铺底(与页面深底同族,边缘渐隐后无缝),
          暗纹 = feTurbulence 墨金细纹,低音量。 */}
      <rect x={O.x} y={O.y} width={O.w} height={O.h} fill={rgba(Theme.bg)} />
      <rect x={O.x} y={O.y} width={O.w} height={O.h} fill="url(#bv-paper)" opacity={0.55} />
      {/* #844 纸纤维噪点:高频灰阶 pattern 平铺,opacity 0.05——「漆为纸」的磨砂纤维,
          深 zoom 下格间空白读得出肌理;铺在暗纹之上、远山带之下。 */}
      <rect x={O.x} y={O.y} width={O.w} height={O.h} fill="url(#bv-fiber)" opacity={0.05} />
      {/* #844 远景衬(旧 #100 挂点随素材复活,#516 退役口径反转):龚贤《山水图卷》
          (清,PD,浓墨长卷最贴「漆黑为纸」)中段横带铺棋盘上/下缘,高 18%、
          group opacity 0.10,压在城池/驿道之下不抢棋盘。下带水平镜像,避免总览时
          上下两带同构;内缘渐隐由 bv-scene-mask 负责。素材管线记账见
          public/assets/manifest.json texture:gongxian-shanshui。 */}
      <g mask="url(#bv-scene-mask)" opacity={SCENE_BAND_OPACITY}>
        <image
          href={GONGXIAN_BAND_HREF}
          x={fit.x}
          y={fit.y}
          width={fit.w}
          height={sceneBandH}
          preserveAspectRatio="xMidYMid slice"
        />
        <image
          href={GONGXIAN_BAND_HREF}
          x={fit.x}
          y={fit.y + fit.h - sceneBandH}
          width={fit.w}
          height={sceneBandH}
          preserveAspectRatio="xMidYMid slice"
          transform={`translate(${2 * (fit.x + fit.w / 2)} 0) scale(-1 1)`}
        />
      </g>
      {/* 装饰性江河双线(两条贝塞尔蓝灰波浪,旧画布坐标手绘)已随 2026-10-24 拷问
          退役——用户判词「没啥用」;重铺须连 DESIGN.md 江河条一并重议。 */}
      {/* 四角晕影铺满延展画布 O(不再裁在 VB 上——#38:VB 边界的晕影矩形切线就是用户看到的硬边),
          晕影集中在四角、恰好落在渐隐带内,与 mask 叠加后自然消隐。 */}
      <rect x={O.x} y={O.y} width={O.w} height={O.h} fill="url(#bv-vignette)" />
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
      // #844 路肩:同弧线加宽一档垫底(宽 11.6 vs 路身 10),两侧各露 0.8px 平行细线,
      // 色 = roadMain 40%(rgba(Theme.roadMain, 0.4),单源 token,等价票面
      // color-mix(roadMain 40%));深 zoom 下驿道两侧不再直接切在玄墨底上。
      <path
        key={`shoulder-${i}`}
        className="bv-road-shoulder"
        d={d}
        fill="none"
        stroke={rgba(Theme.roadMain, 0.4)}
        strokeWidth={ROAD_SHOULDER_W}
        strokeLinecap="round"
        strokeLinejoin="round"
      />,
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
    // 首段画双羽,环路行进方向自首段起读(旧起点「起」印已随 2026-10-19 拷问退役:
    // 游戏无共同起点,选都后各人行军自都城始)。
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
      {segments}
      {/* 箭羽画在全部主路之上(#73),不被后续段的路笔压住 */}
      {feathers}
    </g>
  );
});
