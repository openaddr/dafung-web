// 城池建筑程序化精绘(票 #328 自 Tile.tsx 抽出):Building 只吃纯几何/风格参数
// (group),不吃 TileProps、不订阅任何域外状态。形制变体/装饰子件随组件闭环,
// 不反向依赖 Tile.tsx。
// 等级与归属不上楼(2026-10-17 拷问:一格一语言,重复表达裁单一)——旧「城楼加层」
// 形状通道与「染瓦」归属通道双双退役:等级归铭牌左下档位珠(Tile.tsx LevelPips),
// 归属归铭牌底染+城旗;楼回归纯规格/风味。
import type { ReactNode } from "react";
import { rgba, Theme } from "@core/theme";

// ── 城池建筑:程序化精绘 ──
// 重镇形制:夯土城台(梯形收分/砖缝/拱门/台顶木栏)+ 两层木构城楼(朱柱/直棂窗)
// + 重檐飞檐青瓦;西凉为土堡平顶变体。
// 飞檐是实心屋面 path(eavesRoof):近脊陡、檐口平、檐角回勾上翘——古建轮廓的辨识核心,
// 替换旧「矩形 + 直角三角」的简笔画。
//
// 旧「规模三档形制」(县城/村落小屋)已随经济 v2 退役:两张内置地图全部城池同档,
// 单靠规模分不出形制。多样性走区域分组字母(Theme.groupNames 的 a–h)选风格:
//   north(默认 a/f/g 等)官式:暖褐墙 + 朱柱 + 墨青瓦,中原/幽燕/青徐的礼制气象;
//   south(b/c/d/h)粉墙黛瓦:墙身提亮、柱转深棕,荆楚/江东/岭南/巴蜀的水乡底色;
//   desert(e)土堡平顶:夯土堡身 + 平顶雉堞、无木构楼阁,西凉边地的营造。
// (#512 玄墨深底重调色:造型/几何完全不动,只换表现色——深底上建筑群=暖色聚落,
// 漆金描檐+金窗灯火点睛,「美观且不炫目」。)
// 形制差异是总览下「区域轮廓」的第一层信号,精确区域仍交给色带;自定义地图未知分组
// 一律回落 north,不崩。

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

/** 檐下红灯笼:吊线 + 朱红灯身 + 灯穗,呼应商市格的灯笼语言(静态点缀)。 */
function Lantern({ x }: { x: number }) {
  return (
    <g>
      <line x1={x} y1={-14} x2={x} y2={-10} stroke={rgba(Theme.inkwash, 0.55)} strokeWidth={1} />
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
//    bv-roof-grad / bv-wall-grad——每城内联 defs 会产生重复 id 冲突,统一在 StaticLayers 声明)──
// 口径:官式=暖褐墙+朱柱;南式=提亮粉墙+深棕柱;土堡=夯土+墨青瓦面;普遍=漆金描檐
// (檐口金笔)+金窗灯火(直棂窗暖金);描边/缝线统一压玄墨,不与深底争。
const ROOF_FILL = "url(#bv-roof-grad)"; // 墨青瓦面(StaticLayers 渐变,玄墨深底档)
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
const ROOF_SHEEN_STROKE = rgba(Theme.lacquerGold, 0.3); // 漆金描檐(檐口金笔,克制)

/** 风格变体的墙/柱配色:body = 墙身,column = 木柱。(#512 深底档:墙身压进暖褐/粉调
 *  中明度,柱色保持朱/棕色相——总览下建筑群是深底上的暖色聚落,不与铭牌金边争辉。) */
interface BuildingStyle {
  body: string;
  column: string;
}
const STYLE_NORTH: BuildingStyle = { body: "#b09670", column: "#a84438" }; // 官式:暖褐墙朱柱
const STYLE_SOUTH: BuildingStyle = { body: "#d9cfb9", column: "#6d5339" }; // 粉墙黛瓦:提亮粉墙深棕柱
const STYLE_DESERT: BuildingStyle = { body: "#bfa276", column: "#7d5233" }; // 土堡:夯土色
/** 南方水乡系分组(荆楚 b/岭南 c/巴蜀 d/江东 h)→ 粉墙黛瓦;西凉 e → 土堡;其余官式。 */
function buildingStyle(group: string): BuildingStyle {
  if (group === "e") return STYLE_DESERT;
  return group === "b" || group === "c" || group === "d" || group === "h"
    ? STYLE_SOUTH
    : STYLE_NORTH;
}
const DESERT_ROOF = "#98875f"; // 土堡平顶檐口(暖土灰,不入青瓦渐变)

/** 朱柱直棂窗开间:墙身 + 四柱 + 中央直棂窗(窗棂三笔)。
 *  x/y/w/h 为墙身矩形,winH 为窗高;柱贴墙两缘与窗两侧,大小两档楼身共用。 */
function PillaredBay({
  x,
  y,
  w,
  h,
  winH,
  style,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  winH: number;
  style: BuildingStyle;
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
        fill={style.body}
        stroke={BODY_STROKE}
        strokeWidth={1.2}
      />
      <g fill={style.column}>
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

export function Building({
  group,
}: {
  /** 区域分组字母(a–h,地域变体用;未知/缺失回落官式)。 */
  group: string;
}) {
  const style = buildingStyle(group);
  const isDesert = group === "e";
  let eaveShadows: string[] = [];
  let decor: ReactNode = null;
  let structure: ReactNode = null;
  if (isDesert) {
    // 西凉土堡:夯土堡身 + 平顶檐口 + 雉堞,无木构楼阁——边地营造的另一路形制。
    structure = (
      <>
        <ellipse cx={0} cy={14.5} rx={52} ry={5.5} fill={GROUND_SHADOW} />
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
        <rect
          x={-30}
          y={-17.5}
          width={60}
          height={14}
          fill={style.body}
          stroke={BODY_STROKE}
          strokeWidth={1.2}
        />
        {/* 高窗两笔 + 堡身夯土横缝 */}
        <rect x={-16} y={-12} width={8} height={6} fill={LATTICE_FILL} />
        <rect x={8} y={-12} width={8} height={6} fill={LATTICE_FILL} />
        <line x1={-30} y1={-8} x2={30} y2={-8} stroke={SEAM_STROKE} strokeWidth={0.7} />
        <rect
          x={-33}
          y={-20.5}
          width={66}
          height={3}
          fill={DESERT_ROOF}
          stroke={ROOF_STROKE}
          strokeWidth={0.8}
        />
        <g fill={DESERT_ROOF} stroke={ROOF_STROKE} strokeWidth={0.5}>
          {[-28, -17, -6, 5, 16, 27].map((x) => (
            <rect key={x} x={x} y={-24} width={6} height={3.5} />
          ))}
        </g>
      </>
    );
  } else {
    // 官式重镇:夯土城台(梯形收分/砖缝/拱门/台顶木栏)+ 两层木构城楼 + 重檐飞檐(重镇/州治)
    const lower = eavesRoof(9, 40, -30, -21);
    const upper = eavesRoof(8, 25, -40, -32);
    eaveShadows = [eaveShadow(40, -21), eaveShadow(25, -32)];
    // 灯笼挂 ±13.5:城门两侧、匾额(x≥27)遮不到的对称位
    decor = (
      <g>
        <Lantern x={-13.5} />
        <Lantern x={13.5} />
      </g>
    );
    structure = (
      <>
        <ellipse cx={0} cy={14.5} rx={52} ry={5.5} fill={GROUND_SHADOW} />
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
        <PillaredBay x={-20} y={-22} w={40} h={15} winH={8} style={style} />
        <path
          d={lower}
          fill={ROOF_FILL}
          stroke={ROOF_STROKE}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
        <path d={roofSheen(40, -21)} fill="none" stroke={ROOF_SHEEN_STROKE} strokeWidth={0.8} />
        <PillaredBay x={-13} y={-29} w={26} h={9} winH={4} style={style} />
        <path
          d={upper}
          fill={ROOF_FILL}
          stroke={ROOF_STROKE}
          strokeWidth={1.1}
          strokeLinejoin="round"
        />
      </>
    );
  }
  return (
    <>
      {structure}
      {/* 檐口阴影/正脊吻兽/灯笼:画在屋面之后,压出檐口厚度与进深。 */}
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
      {decor}
    </>
  );
}
