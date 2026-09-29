// 城池建筑程序化精绘(票 #328 自 Tile.tsx 抽出):Building 只吃纯几何/风格参数
// (size/level/tint/group/growNonce),不吃 TileProps、不订阅任何域外状态;归属色与宣告
// nonce 由 Tile 主组件换算为 props 传入。塔几何/形制变体/装饰子件随组件闭环,
// 不反向依赖 Tile.tsx。
import type { ReactNode } from "react";
import { rgba, Theme } from "@core/theme";

// ── 城池建筑:程序化精绘 ──
// 三档形制:重镇 = 夯土城台(梯形收分/砖缝/拱门/台顶木栏)+ 两层木构城楼(朱柱/直棂窗)
// + 重檐飞檐青瓦;县城 = 单层城楼踞矮墙(雉堞);村落/关隘 = 坡顶小屋。
// 飞檐是实心屋面 path(eavesRoof):近脊陡、檐口平、檐角回勾上翘——古建轮廓的辨识核心,
// 替换旧「矩形 + 直角三角」的简笔画。
//
// 地域变体(#风土形制):两张内置地图全部城池都是 large(valueByLevel ≥20),单靠规模档
// 分不出形制,同盘 31 座同模子必单调。按区域分组字母(Theme.groupNames 的 a–h)选风格:
//   north(默认 a/f/g 等)官式:暖白墙 + 朱柱 + 青灰瓦,中原/幽燕/青徐的礼制气象;
//   south(b/c/d/h)粉墙黛瓦:墙身提白、柱转深棕,荆楚/江东/岭南/巴蜀的水乡底色;
//   desert(e)土堡平顶:夯土堡身 + 平顶雉堞、无木构楼阁,西凉边地的营造。
// 形制差异是总览下「区域轮廓」的第一层信号,精确区域仍交给色带;自定义地图未知分组
// 一律回落 north,不崩。

// ── 城楼加层(等级语言·形状通道):层数 = 城池等级 ──
// 旧表现(0-3 面小旌旗)总览下趋近不可辨,改为建筑本体生长:楼身之上逐层收分加飞檐
// (塔状层檐),楼越高等级越高——「高低 + 宽窄」双变化是总览即可读的形状信号;精确对级
// 交给铭牌左下的等级印(LevelSeal),满级金顶收束(下)。
//
// 锚定色带上沿(TOWER_BASE)而非各档屋脊:色带是不透明横条、总盖住 -44..-34,
// 自屋脊起叠的话首层会整段落进色带背后不可见;锚 -44 让「露出高度」成为直接设计参数,
// 且三档规模共用同一规格——塔形只读作等级,不与规模档位混淆。
// 竖向预算(不得再加高):chessboard 最近上下邻城同列 196,上邻铭牌底 ≈ -118(board),
// 再往上是上邻价格字区(不可压),折算 building-local(都城另有 1.08 抬升)≈ -61.3;
// Lv3 檐尖(-61)+ 刹珠压线即止。
const TOWER_BASE = -44;
/** 各层檐口:hw = 半宽(逐层收分出塔姿),apex = 脊顶 y,roofH = 脊到檐角的落差。
 *  步高下大上小(8/5/4):总览下「无塔↔首层」差最大(有无判断最敏感),高等级的区分
 *  转由收分骤变(13/8.6/6.5)+ Lv3 金顶承担,不纯靠高度。 */
const STORY_ROOFS = [
  { hw: 13, apex: -52, roofH: 4.5 },
  { hw: 8.6, apex: -57, roofH: 3.6 },
  { hw: 6.5, apex: -61, roofH: 3.2 },
] as const;

interface TowerGeom {
  /** 塔身核心矩形(深瓦色剪影,藏于各层檐面之后贯通)。 */
  core: { x: number; y: number; w: number; h: number };
  /** 各层飞檐 path d(染瓦层复用同串,保证逐点对齐)。 */
  roofs: string[];
  /** 顶层脊顶 y(金顶收束用)。 */
  topApex: number;
}

/** 飞檐屋面(实心体块):r = 脊口半宽,w = 檐角半宽,apex = 脊顶 y,tipY = 檐角 y。
 *  两侧 Q 弧做「檐口平缓、近脊陡峻」的凹曲檐线,底缘浅弧下垂成檐口厚度、并在两端
 *  回勾出翘角。染瓦层复用同一 d 串,生长动画期间玩家色染层与屋面逐帧对齐。 */
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

/** 檐口阴影:沿屋面底缘的同一弧线补一笔深线,压出檐口厚度与进深(置于染瓦之上——
 *  染瓦为实色,画在其下会被整片盖掉,有主/无主城一侧有影一侧没有,不一致)。 */
function eaveShadow(w: number, tipY: number): string {
  const l = w - 3;
  return `M ${-l},${tipY + 4.5} Q 0,${tipY + 8} ${l},${tipY + 4.5}`;
}

/** 檐下红灯笼:吊线 + 朱红灯身 + 灯穗,呼应商市格的灯笼语言(静态点缀,不参与染瓦)。 */
function Lantern({ x }: { x: number }) {
  return (
    <g>
      <line x1={x} y1={-14} x2={x} y2={-10} stroke="rgba(50,35,15,0.7)" strokeWidth={1} />
      <ellipse
        cx={x}
        cy={-6.5}
        rx={3.2}
        ry={4}
        fill="rgba(178,44,34,0.92)"
        stroke="rgba(120,20,15,0.7)"
        strokeWidth={0.8}
      />
      <line x1={x} y1={-2.5} x2={x} y2={1.5} stroke="rgba(200,60,40,0.8)" strokeWidth={0.8} />
    </g>
  );
}

/** 正脊 + 吻兽:脊顶一条收边压顶,两端小卷作吻(r = 脊口半宽,apex = 脊顶 y)。 */
function RoofRidge({ r, apex }: { r: number; apex: number }) {
  const half = r + 1.5;
  return (
    <g fill={ROOF_STROKE}>
      <rect x={-half} y={apex - 1.8} width={half * 2} height={2.2} rx={1} />
      <path d={`M ${-half - 0.6},${apex - 1.2} q -2.2,-0.4 -2.6,-2.4 q 2.2,0.2 3.2,1.6 z`} />
      <path d={`M ${half + 0.6},${apex - 1.2} q 2.2,-0.4 2.6,-2.4 q -2.2,0.2 -3.2,1.6 z`} />
    </g>
  );
}

/** 生成加层几何(层数 = 等级,Lv0 → null 正常态):窄塔身自色带后贯通至顶层檐下,
 *  檐面自下而上逐层收分叠盖其上——上层墙脚沉入下层檐面,无悬浮接缝,读作同一座楼长高。 */
function cityTower(level: number): TowerGeom | null {
  if (level === 0) return null;
  const specs: (typeof STORY_ROOFS)[number][] = [];
  for (let i = 0; i < level; i++) specs.push(STORY_ROOFS[i]); // level > 3 = 配置越界,当场崩出(零兜底)
  const top = specs[level - 1];
  const coreTop = top.apex + top.roofH + 4;
  return {
    // 核心沉至 -39(而非恰贴色带上缘):都城建筑另有 1.08 抬升,-41 会被抬出色带外露悬空缝
    core: { x: -top.hw * 0.75, y: coreTop, w: top.hw * 1.5, h: TOWER_BASE + 5 - coreTop },
    roofs: specs.map(({ hw, apex, roofH }) => eavesRoof(hw * 0.42, hw * 1.7, apex, apex + roofH)),
    topApex: top.apex,
  };
}

// ── 建筑表现色(集中常量;渐变本体挂 BoardDefs 的 bv-roof-grad / bv-wall-grad——
//    每城内联 defs 会产生重复 id 冲突,统一在 StaticLayers 声明)──
const ROOF_FILL = "url(#bv-roof-grad)"; // 青瓦/黛瓦(冷灰蓝:宣纸暖底上的对比层,替代旧红褐)
const ROOF_STROKE = "rgba(56,64,75,0.9)"; // 瓦脊深线
const PLATFORM_FILL = "url(#bv-wall-grad)"; // 夯土城台
const PLATFORM_STROKE = "rgba(90,70,40,0.55)";
const BODY_STROKE = "rgba(90,70,40,0.55)";
const LATTICE_FILL = "#7a5a3a"; // 直棂窗
const GATE_FILL = "#4a3826"; // 门洞深影
const RAIL_FILL = "#c9b58c"; // 台顶木栏杆
const GROUND_SHADOW = "rgba(90,70,40,0.2)"; // 建筑落地投影(整卡的"重量"来源)

/** 风格变体的墙/柱配色:body = 墙身,column = 木柱。 */
interface BuildingStyle {
  body: string;
  column: string;
}
const STYLE_NORTH: BuildingStyle = { body: "#eee2c2", column: "#9e3b32" }; // 官式:暖白墙朱柱
const STYLE_SOUTH: BuildingStyle = { body: "#f5f2e8", column: "#5c4331" }; // 粉墙黛瓦:提白墙深棕柱
const STYLE_DESERT: BuildingStyle = { body: "#e6d2a8", column: "#8a5a3a" }; // 土堡:夯土色
/** 南方水乡系分组(荆楚 b/岭南 c/巴蜀 d/江东 h)→ 粉墙黛瓦;西凉 e → 土堡;其余官式。 */
function buildingStyle(group: string): BuildingStyle {
  if (group === "e") return STYLE_DESERT;
  return group === "b" || group === "c" || group === "d" || group === "h"
    ? STYLE_SOUTH
    : STYLE_NORTH;
}
const DESERT_ROOF = "#8a7a5e"; // 土堡平顶檐口(暖土灰,不入青瓦渐变)

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
        stroke="rgba(60,40,20,0.6)"
        strokeWidth={0.7}
      />
      <g stroke="rgba(238,222,180,0.55)" strokeWidth={0.7}>
        <line x1={cx - winW * 0.22} y1={y + 2} x2={cx - winW * 0.22} y2={y + 2 + winH} />
        <line x1={cx} y1={y + 2} x2={cx} y2={y + 2 + winH} />
        <line x1={cx + winW * 0.22} y1={y + 2} x2={cx + winW * 0.22} y2={y + 2 + winH} />
      </g>
    </>
  );
}

/** growNonce:本城扩军宣告 nonce(fxStore.announces,ADR-0015)。0 = 未宣告(开局
 *  铺盘/快照恢复)静置;>0 时受影响元素挂生长动画类,nonce 变化即重挂(key)重播。 */
export function Building({
  size,
  level,
  tint,
  group,
  growNonce,
}: {
  size: "large" | "medium" | "small";
  level: number;
  /** 染瓦实色(玩家色混瓦色暗端,null=无主不染)。 */
  tint?: string | null;
  /** 区域分组字母(a–h,地域变体用;未知/缺失回落官式)。 */
  group: string;
  growNonce: number;
}) {
  const style = buildingStyle(group);
  const isDesert = group === "e";
  // 加层(层数=等级)+ 满级金顶收束:顶层檐面金填 + 脊顶刹珠。
  // 金只收在楼顶一处、全静态——脉动金环/金台座是都城的既有语言(环形/座形,位置互斥),
  // 不与之争;乘法城棋盘上无专属造型,金顶不会与之混淆。
  const tower = cityTower(level);
  const storyEls = tower ? (
    <>
      <rect
        className="bv-city-core"
        x={tower.core.x}
        y={tower.core.y}
        width={tower.core.w}
        height={tower.core.h}
        fill="#4a5260"
        opacity={0.95}
      />
      {/* #96/ADR-0015 扩军瞬间:只有新晋最顶层檐面重播 bv-build-grow 生长(board.css,
          scale 0.6→1 自底边中心)——key 取宣告 nonce(播放器经 sink 下发,非 props diff),
          nonce 变化即重挂重播,其余层 key 不变原地复用,不整楼重播;nonce=0 静置不播。 */}
      {tower.roofs.map((d, i) => {
        const isTopStory = i === tower.roofs.length - 1;
        return (
          <path
            key={isTopStory ? `top-story-${growNonce}` : i}
            className={
              isTopStory ? `bv-city-story${growNonce > 0 ? " bv-build-grow" : ""}` : "bv-city-story"
            }
            d={d}
            fill={isDesert ? DESERT_ROOF : ROOF_FILL}
            stroke={ROOF_STROKE}
            strokeWidth={1}
            strokeLinejoin="round"
          />
        );
      })}
    </>
  ) : null;
  const finial =
    tower && level >= STORY_ROOFS.length ? (
      // #96 满级金顶与顶层檐面同形叠加:升到 Lv3 的宣告 nonce 已 >0(同拍下发),
      // 挂载即与顶层同拍 bv-build-grow 生长(同形同步缩放,不会露底稿),无需 key;
      // 快照恢复的满级城 nonce=0,静置全形。
      <g className={`bv-city-finial${growNonce > 0 ? " bv-build-grow" : ""}`}>
        <path
          d={tower.roofs[level - 1]}
          fill={rgba(Theme.goldBright, 0.96)}
          stroke="rgba(60,30,15,0.65)"
          strokeWidth={1.2}
        />
        <circle
          cx={0}
          cy={tower.topApex + 2}
          r={2.2}
          fill={rgba(Theme.goldBright)}
          stroke="rgba(60,30,15,0.7)"
          strokeWidth={0.7}
        />
      </g>
    ) : null;
  // 各档屋面轮廓(供染瓦叠加用):染层直接复用底稿 d 串,保证形状逐点对齐;
  // 加层檐面一并入列——玩家色染瓦须盖住整座楼(含加层),归属色不断层。
  let baseRoofs: string[] = [];
  let eaveShadows: string[] = [];
  let decor: ReactNode = null;
  let structure: ReactNode = null;
  if (size === "small") {
    // 坡顶小屋(村落/关隘):木身 + 挑檐青瓦 + 门与直棂窗;加层自色带上沿起叠
    const roof = eavesRoof(6.5, 25, -19, -8.5);
    baseRoofs = [roof];
    eaveShadows = [eaveShadow(25, -8.5)];
    decor = <RoofRidge r={6.5} apex={-19} />;
    structure = (
      <>
        <ellipse cx={0} cy={13} rx={30} ry={4} fill={GROUND_SHADOW} />
        <rect
          x={-18}
          y={-1}
          width={36}
          height={13}
          fill={style.body}
          stroke={BODY_STROKE}
          strokeWidth={1.3}
        />
        <rect x={-5} y={3} width={10} height={9} fill={GATE_FILL} />
        <rect x={8} y={3} width={6} height={6} fill={LATTICE_FILL} />
        <path
          d={roof}
          fill={isDesert ? DESERT_ROOF : ROOF_FILL}
          stroke={ROOF_STROKE}
          strokeWidth={1.1}
          strokeLinejoin="round"
        />
        <path
          d={roofSheen(25, -8.5)}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={0.7}
        />
      </>
    );
  } else if (size === "medium") {
    // 县城:夯土矮墙(雉堞/拱门/砖缝)+ 单层城楼 + 飞檐青瓦
    const roof = eavesRoof(8, 27, -26, -16.5);
    baseRoofs = [roof];
    eaveShadows = [eaveShadow(27, -16.5)];
    decor = <RoofRidge r={8} apex={-26} />;
    structure = (
      <>
        <ellipse cx={0} cy={13} rx={40} ry={4.5} fill={GROUND_SHADOW} />
        <polygon
          points="-36,12 36,12 31.5,-2 -31.5,-2"
          fill={PLATFORM_FILL}
          stroke={PLATFORM_STROKE}
          strokeWidth={1.3}
        />
        <g stroke="rgba(90,70,40,0.18)" strokeWidth={0.7}>
          <line x1={-32} y1={3} x2={32} y2={3} />
          <line x1={-34} y1={8} x2={34} y2={8} />
          <line x1={-20} y1={3} x2={-20} y2={8} />
          <line x1={22} y1={-2} x2={22} y2={3} />
        </g>
        {/* 雉堞(墙头两侧) */}
        <g fill="rgba(90,70,40,0.45)">
          <rect x={-29} y={-5} width={6} height={3.5} />
          <rect x={-20.5} y={-5} width={6} height={3.5} />
          <rect x={14.5} y={-5} width={6} height={3.5} />
          <rect x={23} y={-5} width={6} height={3.5} />
        </g>
        <path
          d="M -6.5,12 L -6.5,2 Q -6.5,-2.5 0,-2.5 Q 6.5,-2.5 6.5,2 L 6.5,12 Z"
          fill={GATE_FILL}
          stroke="rgba(212,175,105,0.5)"
          strokeWidth={1}
        />
        <PillaredBay x={-15} y={-17} w={30} h={15} winH={7} style={style} />
        <path
          d={roof}
          fill={isDesert ? DESERT_ROOF : ROOF_FILL}
          stroke={ROOF_STROKE}
          strokeWidth={1.1}
          strokeLinejoin="round"
        />
        <path
          d={roofSheen(27, -16.5)}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={0.7}
        />
      </>
    );
  } else if (isDesert) {
    // 西凉土堡(large):夯土堡身 + 平顶檐口 + 雉堞,无木构楼阁——边地营造的另一路形制。
    // 染瓦通道改染平顶檐口条(堡顶即"瓦位"),归属色仍盖住建筑主体。
    const slab = "M -33,-20.5 L 33,-20.5 L 33,-17.5 L -33,-17.5 Z";
    baseRoofs = [slab]; // 土堡平顶:无飞檐(无 eaveShadows/decor)
    structure = (
      <>
        <ellipse cx={0} cy={14.5} rx={52} ry={5.5} fill={GROUND_SHADOW} />
        <polygon
          points="-49,14 49,14 44,-4 -44,-4"
          fill={PLATFORM_FILL}
          stroke={PLATFORM_STROKE}
          strokeWidth={1.4}
        />
        <g stroke="rgba(90,70,40,0.18)" strokeWidth={0.7}>
          <line x1={-45} y1={2} x2={45} y2={2} />
          <line x1={-47} y1={8} x2={47} y2={8} />
          <line x1={-24} y1={2} x2={-24} y2={8} />
          <line x1={26} y1={-4} x2={26} y2={2} />
          <line x1={-38} y1={8} x2={-38} y2={14} />
        </g>
        <path
          d="M -8,14 L -8,1 Q -8,-5 0,-5 Q 8,-5 8,1 L 8,14 Z"
          fill={GATE_FILL}
          stroke="rgba(212,175,105,0.5)"
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
        <line x1={-30} y1={-8} x2={30} y2={-8} stroke="rgba(90,70,40,0.15)" strokeWidth={0.7} />
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
    // large:夯土城台(梯形收分/砖缝/拱门/台顶木栏)+ 两层木构城楼 + 重檐飞檐(重镇/州治)
    const lower = eavesRoof(9, 40, -30, -21);
    const upper = eavesRoof(8, 25, -40, -32);
    baseRoofs = [lower, upper];
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
        <g stroke="rgba(90,70,40,0.18)" strokeWidth={0.7}>
          <line x1={-45} y1={2} x2={45} y2={2} />
          <line x1={-47} y1={8} x2={47} y2={8} />
          <line x1={-24} y1={2} x2={-24} y2={8} />
          <line x1={26} y1={-4} x2={26} y2={2} />
          <line x1={-38} y1={8} x2={-38} y2={14} />
        </g>
        <path
          d="M -8,14 L -8,1 Q -8,-5 0,-5 Q 8,-5 8,1 L 8,14 Z"
          fill={GATE_FILL}
          stroke="rgba(212,175,105,0.5)"
          strokeWidth={1.1}
        />
        <g fill={RAIL_FILL} stroke="rgba(90,70,40,0.4)" strokeWidth={0.5}>
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
        <path
          d={roofSheen(40, -21)}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={0.8}
        />
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
  const roofTint = tint ? (
    <g className="bv-roof-tint">
      {[...baseRoofs, ...(tower ? tower.roofs : [])].map((d, i) => {
        const isTopStory = tower != null && i === baseRoofs.length + tower.roofs.length - 1;
        return (
          <path
            key={isTopStory ? `top-story-${growNonce}` : i}
            className={isTopStory && growNonce > 0 ? "bv-build-grow" : undefined}
            d={d}
            fill={tint}
          />
        );
      })}
    </g>
  ) : null;
  return (
    <>
      {structure}
      {storyEls}
      {roofTint}
      {/* 檐口阴影/正脊吻兽/灯笼:恒画在染瓦之上(染瓦实色会盖掉其下的细节,
          之下则「有主城无阴影」不一致)。 */}
      {eaveShadows.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="rgba(35,40,48,0.5)"
          strokeWidth={1}
          strokeLinecap="round"
        />
      ))}
      {decor}
      {finial}
    </>
  );
}
