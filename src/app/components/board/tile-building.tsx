// 城池建筑程序化精绘(票 #328 自 Tile.tsx 抽出):Building 只吃档位参数(tier),
// 不吃 TileProps、不订阅任何域外状态。形制变体/装饰子件随组件闭环,不反向依赖 Tile.tsx。
// 城池档位形制独占承载(ADR-0042 决策 1):四档四形制——
//   县 = 单檐悬山灰瓦小院:矮夯土台基 + 单层屋身 + 悬山屋面,矮素,总览下明显低于郡城;
//   郡 = 现行重镇画:夯土城台(梯形收分/砖缝/拱门/台顶木栏)+ 两层木构城楼(朱柱/
//        直棂窗)+ 重檐飞檐,零新工;
//   名 = 现行画强化:台基加高一层(下枋,楼身整体抬升)+ 瓦面换翠琉璃(StaticLayers
//        bv-glazed-roof-grad)+ 檐口描金加档(lacquerGold 通道加码);
//   奇 = 关隘特形(PassFortress):夯土墩台横宽矮厚 + 墩顶雉堞 + 通壁门洞 + 墩台
//        戍旗 + 平顶墩楼——军镇营造,与郡/名的官式城楼轮廓一眼可分(雉堞几何自
//        退役的西凉土堡迁移,ADR-0042 决策 2)。
// 区域轴(北官式/南粉墙/西凉土堡)已随 ADR-0042 决策 2 整体退役:group 机制零消费、
// 视觉通道早已半退役(#670 格上色带、2026-10-24 区域晕染先行),墙柱配色按档统一官式;
// 旧「规模三档形制」当年随经济 v2 退役,现由档位形制回归接替(ADR-0042 决策 2 翻案)。
// 等级与归属不上楼(2026-10-17 拷问:一格一语言,重复表达裁单一)——等级归铭牌左下
// 等级珠(Tile.tsx LevelPips),归属归铭牌底染+城旗;楼回归纯规格(档位形制)。
// (#512 玄墨深底重调色:造型/几何不动只换表现色——深底上建筑群=暖色聚落,漆金描檐+
// 金窗灯火点睛,「美观且不炫目」。)
import type { CityTier } from "@core/economy";
import { rgba, Theme } from "@core/theme";

// ── 城池建筑:程序化精绘 ──
// 飞檐是实心屋面 path(eavesRoof):近脊陡、檐口平、檐角回勾上翘——古建轮廓的辨识核心,
// 替换旧「矩形 + 直角三角」的简笔画。

/** 飞檐屋面(实心体块):r = 脊口半宽,w = 檐角半宽,apex = 脊顶 y,tipY = 檐角 y。
 *  两侧 Q 弧做「檐口平缓、近脊陡峻」的凹曲檐线,底缘浅弧下垂成檐口厚度、并在两端
 *  回勾出翘角。 */
function eavesRoof(r: number, w: number, apex: number, tipY: number): string {
  const l = w - 3;
  return (
    `M ${-w},${tipY} ` +
    `Q ${-w * 0.45},${apex + 3} ${-r},${apex} L ${r},${apex} ` +
    `Q ${w * 0.45},${apex + 3} ${w},${tipY} ` +
    `L ${l},${tipY + 4.5} Q 0,${tipY + 8} ${-l},${tipY + 4.5} Z`
  );
}

/** 瓦垄高光:顺檐口弧度的一笔浅线,给屋面一点「瓦」的质感(克制,不画满)。 */
function roofSheen(w: number, tipY: number): string {
  return `M ${-w * 0.75},${tipY + 1.5} Q 0,${tipY + 4.5} ${w * 0.75},${tipY + 1.5}`;
}

/** 檐口阴影:沿屋面底缘的同一弧线补一笔深线,压出檐口厚度与进深。 */
function eaveShadow(w: number, tipY: number): string {
  const l = w - 3;
  return `M ${-l},${tipY + 4.5} Q 0,${tipY + 8} ${l},${tipY + 4.5}`;
}

/** 檐下红灯笼:吊线 + 朱红灯身 + 灯穗,重镇形制点缀(静态,不挂任何格型语义)。 */
function Lantern({ x }: { x: number }) {
  return (
    <g>
      <line x1={x} y1={-14} x2={x} y2={-10} stroke={rgba(Theme.goldWash, 0.55)} strokeWidth={1} />
      <ellipse
        cx={x}
        cy={-6.5}
        rx={3.2}
        ry={4}
        fill={rgba(Theme.danger, 0.92)}
        stroke={rgba(Theme.bgDeep, 0.7)}
        strokeWidth={0.8}
      />
      <line x1={x} y1={-2.5} x2={x} y2={1.5} stroke={rgba(Theme.danger, 0.8)} strokeWidth={0.8} />
    </g>
  );
}

// ── 建筑表现色(#512 玄墨深底重调色,造型不动;集中常量;渐变本体挂 BoardDefs 的
//    bv-roof-grad / bv-wall-grad / bv-glazed-roof-grad——每城内联 defs 会产生重复 id
//    冲突,统一在 StaticLayers 声明)──
// 口径:墙柱=官式暖褐墙+朱柱(区域分支退役,按档统一);瓦面=墨青灰瓦(县/郡)、
// 翠琉璃(名);普遍=漆金描檐(檐口金笔)+金窗灯火,名城描金加档;描边/缝线统一压
// 玄墨,不与深底争。
const ROOF_FILL = "url(#bv-roof-grad)"; // 墨青灰瓦(StaticLayers 渐变,玄墨深底档)
const GLAZED_ROOF_FILL = "url(#bv-glazed-roof-grad)"; // 名城翠琉璃瓦面(StaticLayers 渐变)
const ROOF_STROKE = "rgba(24,30,36,0.9)"; // 瓦脊深线
const PLATFORM_FILL = "url(#bv-wall-grad)"; // 夯土城台
const PLATFORM_STROKE = "rgba(16,12,7,0.7)";
const BODY_STROKE = "rgba(16,12,7,0.7)";
const LATTICE_FILL = "#c08a2e"; // 直棂窗=金窗灯火(暖金窗扇)
const LATTICE_STROKE = "rgba(30,20,8,0.8)"; // 窗框深线
const LATTICE_SHEEN = "rgba(255,224,150,0.55)"; // 窗棂受光(灯火透光)
const GATE_FILL = "#2a2012"; // 门洞深影
const GATE_EDGE = rgba(Theme.lacquerGold, 0.55); // 门洞漆金描边
const RAIL_FILL = "#93794a"; // 台顶木栏杆(沉木色)
const GROUND_SHADOW = "rgba(4,3,2,0.5)"; // 建筑落地投影(整卡的"重量"来源)
const SEAM_STROKE = "rgba(8,6,3,0.4)"; // 砖缝/夯土横缝
const EAVE_SHADOW_STROKE = "rgba(8,10,13,0.65)"; // 檐口阴影
const ROOF_SHEEN_STROKE = rgba(Theme.lacquerGold, 0.3); // 漆金描檐(檐口金笔,克制;郡档)
const ROOF_SHEEN_GLAZED = rgba(Theme.lacquerGold, 0.8); // 名城描金加档(ADR-0042:描金加码)
/** 名城台基加高量:下枋一层的高,楼身整体抬升同一量(ADR-0042 形制阶梯)。 */
const TIER_LIFT = 7;

/** 官式墙柱配色(区域分支退役后的单源):暖褐墙身 + 朱柱,三档楼身共用。 */
const BODY_FILL = "#b09670";
const COLUMN_FILL = "#a84438";

/** 朱柱直棂窗开间:墙身 + 四柱 + 中央直棂窗(窗棂三笔)。
 *  x/y/w/h 为墙身矩形,winH 为窗高;柱贴墙两缘与窗两侧,县/郡/名三档楼身共用。 */
function PillaredBay({
  x,
  y,
  w,
  h,
  winH,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  winH: number;
}) {
  const winW = Math.min(13, w * 0.3);
  const cx = x + w / 2;
  const colW = 2.6;
  return (
    <>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={BODY_FILL}
        stroke={BODY_STROKE}
        strokeWidth={1.2}
      />
      <g fill={COLUMN_FILL}>
        <rect x={x + 1} y={y + 1} width={colW} height={h - 2} />
        <rect x={cx - winW / 2 - colW - 1.2} y={y + 1} width={colW} height={h - 2} />
        <rect x={cx + winW / 2 + 1.2} y={y + 1} width={colW} height={h - 2} />
        <rect x={x + w - 1 - colW} y={y + 1} width={colW} height={h - 2} />
      </g>
      <rect
        x={cx - winW / 2}
        y={y + 2}
        width={winW}
        height={winH}
        fill={LATTICE_FILL}
        stroke={LATTICE_STROKE}
        strokeWidth={0.7}
      />
      <g stroke={LATTICE_SHEEN} strokeWidth={0.7}>
        <line x1={cx - winW * 0.22} y1={y + 2} x2={cx - winW * 0.22} y2={y + 2 + winH} />
        <line x1={cx} y1={y + 2} x2={cx} y2={y + 2 + winH} />
        <line x1={cx + winW * 0.22} y1={y + 2} x2={cx + winW * 0.22} y2={y + 2 + winH} />
      </g>
    </>
  );
}

// ── 县城:单檐悬山灰瓦小院(ADR-0042 形制阶梯「矮、素」档)──
// 矮夯土台基(约郡城四成高)+ 小门洞 + 单层屋身 + 悬山屋面(檐口远出山墙);不描金、
// 不挂灯、无栏杆——总览判据(ADR-0042 决策 5)靠轮廓高度(约为郡城六成)与减法
// 细节可辨;灰瓦与郡城共用墨青灰渐变,素在本色。
function CountyYard() {
  const roof = eavesRoof(7, 24, -16, -5);
  return (
    <>
      <ellipse cx={0} cy={14.5} rx={42} ry={4.5} fill={GROUND_SHADOW} />
      <polygon
        points="-34,14 34,14 31,7 -31,7"
        fill={PLATFORM_FILL}
        stroke={PLATFORM_STROKE}
        strokeWidth={1.2}
      />
      <g stroke={SEAM_STROKE} strokeWidth={0.7}>
        <line x1={-30} y1={10.5} x2={30} y2={10.5} />
      </g>
      {/* 小门洞:县城不描金,深线勾边即可 */}
      <path
        d="M -5,14 L -5,10.5 Q -5,8 0,8 Q 5,8 5,10.5 L 5,14 Z"
        fill={GATE_FILL}
        stroke={BODY_STROKE}
        strokeWidth={1}
      />
      <PillaredBay x={-17} y={-5} w={34} h={12} winH={9} />
      <path
        d={roof}
        fill={ROOF_FILL}
        stroke={ROOF_STROKE}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <path
        d={eaveShadow(24, -5)}
        fill="none"
        stroke={EAVE_SHADOW_STROKE}
        strokeWidth={1}
        strokeLinecap="round"
      />
    </>
  );
}

// ── 郡城/名城:夯土城台 + 两层木构城楼 + 重檐飞檐(现行重镇画)──
// 郡(glazed=false)= 退役前现行画逐像素原样,零新工;名(glazed=true)= 同画强化:
// 台基加高一层(下枋 TIER_LIFT,楼身整体抬升同量)+ 瓦面换翠琉璃 + 檐口描金加档
// (上下两层檐口都走一笔浓金),拱门随台基贯通两层,总览下比郡城高出一头。
function PrefectureComplex({ glazed }: { glazed: boolean }) {
  const roofFill = glazed ? GLAZED_ROOF_FILL : ROOF_FILL;
  const sheen = glazed ? ROOF_SHEEN_GLAZED : ROOF_SHEEN_STROKE;
  const lift = glazed ? TIER_LIFT : 0;
  const lower = eavesRoof(9, 40, -30 - lift, -21 - lift);
  const upper = eavesRoof(8, 25, -40 - lift, -32 - lift);
  const eaveShadows = [eaveShadow(40, -21 - lift), eaveShadow(25, -32 - lift)];
  return (
    <>
      <ellipse cx={0} cy={14.5} rx={glazed ? 56 : 52} ry={5.5} fill={GROUND_SHADOW} />
      {/* 名城台基加高层(下枋):楼身整体抬升 lift,拱门经下层延到地面 */}
      {glazed ? (
        <g>
          <polygon
            points="-52,14 52,14 47,7 -47,7"
            fill={PLATFORM_FILL}
            stroke={PLATFORM_STROKE}
            strokeWidth={1.4}
          />
          <g stroke={SEAM_STROKE} strokeWidth={0.7}>
            <line x1={-46} y1={10.5} x2={46} y2={10.5} />
          </g>
        </g>
      ) : null}
      <g transform={glazed ? `translate(0 ${-lift})` : undefined}>
        <polygon
          points="-49,14 49,14 44,-4 -44,-4"
          fill={PLATFORM_FILL}
          stroke={PLATFORM_STROKE}
          strokeWidth={1.4}
        />
        <g stroke={SEAM_STROKE} strokeWidth={0.7}>
          <line x1={-45} y1={2} x2={45} y2={2} />
          <line x1={-47} y1={8} x2={47} y2={8} />
          <line x1={-24} y1={2} x2={-24} y2={8} />
          <line x1={26} y1={-4} x2={26} y2={2} />
          <line x1={-38} y1={8} x2={-38} y2={14} />
        </g>
        <path
          d="M -8,14 L -8,1 Q -8,-5 0,-5 Q 8,-5 8,1 L 8,14 Z"
          fill={GATE_FILL}
          stroke={GATE_EDGE}
          strokeWidth={1.1}
        />
        <g fill={RAIL_FILL} stroke={rgba(Theme.bgDeep, 0.6)} strokeWidth={0.5}>
          <rect x={-34} y={-7.5} width={68} height={1.8} />
          {[-32, -20, -8, 6, 18, 30].map((x) => (
            <rect key={x} x={x} y={-5.8} width={1.8} height={2.8} />
          ))}
        </g>
        <PillaredBay x={-20} y={-22} w={40} h={15} winH={8} />
        <path
          d={lower}
          fill={roofFill}
          stroke={ROOF_STROKE}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
        <path
          d={roofSheen(40, -21 - lift)}
          fill="none"
          stroke={sheen}
          strokeWidth={glazed ? 1.2 : 0.8}
        />
        <PillaredBay x={-13} y={-29} w={26} h={9} winH={4} />
        <path
          d={upper}
          fill={roofFill}
          stroke={ROOF_STROKE}
          strokeWidth={1.1}
          strokeLinejoin="round"
        />
        {/* 描金加档(仅名):上层檐口也走一笔浓金,与下层同档 */}
        {glazed ? (
          <path d={roofSheen(25, -32 - lift)} fill="none" stroke={sheen} strokeWidth={1.2} />
        ) : null}
        {/* 灯笼挂 ±13.5:城门两侧、匾额(x≥27)遮不到的对称位 */}
        <Lantern x={-13.5} />
        <Lantern x={13.5} />
      </g>
      {/* 名城门洞下层贯通:拱门随加高台基延到地面(fill 自动闭顶,描边只走三边) */}
      {glazed ? (
        <path
          d="M -8,7 L -8,14 L 8,14 L 8,7"
          fill={GATE_FILL}
          stroke={GATE_EDGE}
          strokeWidth={1.1}
        />
      ) : null}
      {/* 檐口阴影画在屋面之后,压出檐口厚度与进深。 */}
      {eaveShadows.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={EAVE_SHADOW_STROKE}
          strokeWidth={1}
          strokeLinecap="round"
        />
      ))}
    </>
  );
}

// ── 奇城:关隘特形(ADR-0042 决策 1:「异类」非「次级」)──
// 五座奇城全是战场关隘(街亭/子午谷/华容道/合肥/赤壁),形制语言=军镇营造,与郡/名
// 的官式城楼(两层木构+重檐飞檐)轮廓截然可分:夯土墩台横宽矮厚(比官式城台更矮更
// 厚)+ 墩顶雉堞(凹凸垛口,矩形阵列自退役西凉土堡的平顶雉堞迁移)+ 通壁拱形门洞 +
// 墩台戍旗 + 平顶墩楼(箭窗小堡,非木构楼阁)。军镇不事描金:无灯笼无金窗,金笔只
// 留门洞描边一线;旗面静态(ADR-0039 常驻动画禁入 SVG),矩形旗面与三旗语法——棋子
// 三角/城旗燕尾/王旗双层大三角——四形互斥。总览可辨判据(ADR-0042 决策 5)走剪影:
// 矮厚锯齿墩台 + 细旗杆,对郡城的高楼重檐,并排一眼可分。
function PassFortress() {
  return (
    <>
      <ellipse cx={0} cy={14.5} rx={54} ry={5.5} fill={GROUND_SHADOW} />
      {/* 夯土墩台:底 ±53/顶 ±49、高 16(官式城台底 ±49/顶 ±44、高 18)——更矮更厚 */}
      <polygon
        points="-53,14 53,14 49,-2 -49,-2"
        fill={PLATFORM_FILL}
        stroke={PLATFORM_STROKE}
        strokeWidth={1.4}
      />
      <g stroke={SEAM_STROKE} strokeWidth={0.7}>
        <line x1={-46} y1={4} x2={46} y2={4} />
        <line x1={-48} y1={10} x2={48} y2={10} />
        <line x1={-20} y1={4} x2={-20} y2={10} />
        <line x1={28} y1={4} x2={28} y2={10} />
        <line x1={-38} y1={10} x2={-38} y2={14} />
        <line x1={14} y1={-2} x2={14} y2={4} />
      </g>
      {/* 通壁拱形门洞:描金只此一线 */}
      <path
        d="M -9,14 L -9,2 Q -9,-2 0,-2 Q 9,-2 9,2 L 9,14 Z"
        fill={GATE_FILL}
        stroke={GATE_EDGE}
        strokeWidth={1.1}
      />
      {/* 墩顶雉堞:门洞上方留垛口缺口,旗杆植于缺口(旗面不压垛口) */}
      <g fill={PLATFORM_FILL} stroke={ROOF_STROKE} strokeWidth={0.5}>
        <rect x={-48} y={-6} width={6} height={4} />
        <rect x={13} y={-6} width={6} height={4} />
        <rect x={25} y={-6} width={6} height={4} />
        <rect x={37} y={-6} width={6} height={4} />
      </g>
      {/* 墩楼:平顶小堡 + 箭窗一孔,坐墩台左段(匾额在右,互不遮挡) */}
      <rect
        x={-42}
        y={-16}
        width={26}
        height={14}
        fill={BODY_FILL}
        stroke={BODY_STROKE}
        strokeWidth={1.2}
      />
      <rect x={-30.7} y={-13} width={3.4} height={8} fill={GATE_FILL} />
      <rect
        x={-44}
        y={-18.5}
        width={30}
        height={2.5}
        fill={ROOF_FILL}
        stroke={ROOF_STROKE}
        strokeWidth={0.8}
      />
      <g fill={PLATFORM_FILL} stroke={ROOF_STROKE} strokeWidth={0.5}>
        <rect x={-41} y={-21.5} width={6} height={3} />
        <rect x={-32} y={-21.5} width={6} height={3} />
        <rect x={-23} y={-21.5} width={6} height={3} />
      </g>
      {/* 戍旗:旗杆走三旗同款暗金(goldWash 旗杆语言),旗面矩形静态 */}
      <line
        x1={22}
        y1={-2}
        x2={22}
        y2={-38.5}
        stroke={rgba(Theme.goldWash, 0.8)}
        strokeWidth={1.5}
      />
      <rect
        x={6.5}
        y={-37}
        width={15.5}
        height={7.5}
        fill={rgba(Theme.danger, 0.92)}
        stroke={rgba(Theme.bgDeep, 0.7)}
        strokeWidth={1}
      />
    </>
  );
}

// ── 城池档位 → 建筑形制(ADR-0042 决策 1,形制是城的恒常属性,状态不上楼)──
export function Building({ tier }: { tier: CityTier }) {
  if (tier === "县") return <CountyYard />;
  if (tier === "奇") return <PassFortress />;
  return <PrefectureComplex glazed={tier === "名"} />;
}
