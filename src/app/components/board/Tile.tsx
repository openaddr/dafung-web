// 单座城池。静态结构(建筑/文字)按 tile 数据声明;状态(归属/都城/等级/焦点)由 props 驱动,
// React.memo 保证仅状态变化的城池重渲。建筑为程序化精绘(Building:飞檐青瓦/城台/朱柱,
// 按区域分形制变体)。
// 宣告动效(ADR-0015):扩军(印重钤/楼生长)与易主(流光)的「何时播」归表现事件流——
// 播放器经 sink 在 fxStore 下发宣告 nonce,本组件订阅重播;组件内不做 props diff 自触发
// (R3 的 key={level} 重挂 / useOwnerChangeFlash 上一值钩子已删)。动画 keyframes 本体
// 仍在 board.css/fx.css,CSS 只承担「怎么播」。
import { memo, type ReactNode } from "react";
import type { TileDef } from "@core/types";
import { Theme, groupColor, playerColor, rgba, type Rgb } from "@core/theme";
import { useFxStore } from "@app/fx/fxStore";

/** 玩家色加深(f<1):领地铭牌要"深底白字",直接用原玩家色做底则与描边/旗同明度
 *  缺乏层次,统一乘暗系数得到同色相的深底(zoom-out 后"色块=地盘"仍按色相可辨)。 */
function shade(c: { r: number; g: number; b: number }, f: number) {
  return { r: Math.round(c.r * f), g: Math.round(c.g * f), b: Math.round(c.b * f) };
}

/** 染瓦实色:玩家色 60% 混入浅宣纸 40%。往深瓦里混会让冷色玩家(紫/蓝)闷成近黑、
 *  色相读不出;往浅里混得到"彩瓦"——有主城瓦亮而带色,无主城瓦是墨青,对比即归属,
 *  色相在总览下也可辨,且实色不随底层渐变漂移。 */
function roofTintOf(c: Rgb): string {
  const k = 0.6;
  const base = { r: 231, g: 220, b: 190 };
  return rgba({
    r: Math.round(c.r * k + base.r * (1 - k)),
    g: Math.round(c.g * k + base.g * (1 - k)),
    b: Math.round(c.b * k + base.b * (1 - k)),
  });
}

export interface TileVisualState {
  /** 持有者 colorIndex(null=无主)。 */
  ownerColorIndex: number | null;
  /** 持有者国号(小旌旗文字)。 */
  ownerGuohao: string | null;
  /** 该城等级(0=未持有)。 */
  level: number;
  /** 是否某玩家都城 + 都城主 colorIndex(王旗)。 */
  capitalColorIndex: number | null;
  capitalGuohao: string | null;
  /** 当前回合玩家所在城(脉动金环)。 */
  isActive: boolean;
  /** 选都阶段已被选(标灰禁用)。 */
  isTaken: boolean;
  /** 可交互高亮(轮到本地选都的候选集,呼吸脉冲金圈)。 */
  isSelectable: boolean;
  /** X4(#23) 选都候选序号(1 基,引擎滚出顺序;null=非候选)。候选集全座位可见:
   *  静态低透明金圈(bv-candidate)是旁观档,本地可点脉冲由 isSelectable 升档。 */
  capitalCandidateOrder: number | null;
}

interface TileProps {
  tile: TileDef;
  group: string; // 地产分组(catalog.get(propertyId).group),区域色带用
  price: string; // formatMoney 后的购入价
  state: TileVisualState;
  onClick?: (index: number) => void;
}

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
      <ellipse cx={x} cy={-6.5} rx={3.2} ry={4} fill="rgba(178,44,34,0.92)" stroke="rgba(120,20,15,0.7)" strokeWidth={0.8} />
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
  return group === "b" || group === "c" || group === "d" || group === "h" ? STYLE_SOUTH : STYLE_NORTH;
}
const DESERT_ROOF = "#8a7a5e"; // 土堡平顶檐口(暖土灰,不入青瓦渐变)

/** 朱柱直棂窗开间:墙身 + 四柱 + 中央直棂窗(窗棂三笔)。
 *  x/y/w/h 为墙身矩形,winH 为窗高;柱贴墙两缘与窗两侧,大小两档楼身共用。 */
function PillaredBay({ x, y, w, h, winH, style }: { x: number; y: number; w: number; h: number; winH: number; style: BuildingStyle }) {
  const winW = Math.min(13, w * 0.3);
  const cx = x + w / 2;
  const colW = 2.6;
  return (
    <>
      <rect x={x} y={y} width={w} height={h} fill={style.body} stroke={BODY_STROKE} strokeWidth={1.2} />
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
function Building({
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
            className={isTopStory ? `bv-city-story${growNonce > 0 ? " bv-build-grow" : ""}` : "bv-city-story"}
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
        <circle cx={0} cy={tower.topApex + 2} r={2.2} fill={rgba(Theme.goldBright)} stroke="rgba(60,30,15,0.7)" strokeWidth={0.7} />
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
        <rect x={-18} y={-1} width={36} height={13} fill={style.body} stroke={BODY_STROKE} strokeWidth={1.3} />
        <rect x={-5} y={3} width={10} height={9} fill={GATE_FILL} />
        <rect x={8} y={3} width={6} height={6} fill={LATTICE_FILL} />
        <path d={roof} fill={isDesert ? DESERT_ROOF : ROOF_FILL} stroke={ROOF_STROKE} strokeWidth={1.1} strokeLinejoin="round" />
        <path d={roofSheen(25, -8.5)} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={0.7} />
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
        <polygon points="-36,12 36,12 31.5,-2 -31.5,-2" fill={PLATFORM_FILL} stroke={PLATFORM_STROKE} strokeWidth={1.3} />
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
        <path d="M -6.5,12 L -6.5,2 Q -6.5,-2.5 0,-2.5 Q 6.5,-2.5 6.5,2 L 6.5,12 Z" fill={GATE_FILL} stroke="rgba(212,175,105,0.5)" strokeWidth={1} />
        <PillaredBay x={-15} y={-17} w={30} h={15} winH={7} style={style} />
        <path d={roof} fill={isDesert ? DESERT_ROOF : ROOF_FILL} stroke={ROOF_STROKE} strokeWidth={1.1} strokeLinejoin="round" />
        <path d={roofSheen(27, -16.5)} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={0.7} />
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
        <polygon points="-49,14 49,14 44,-4 -44,-4" fill={PLATFORM_FILL} stroke={PLATFORM_STROKE} strokeWidth={1.4} />
        <g stroke="rgba(90,70,40,0.18)" strokeWidth={0.7}>
          <line x1={-45} y1={2} x2={45} y2={2} />
          <line x1={-47} y1={8} x2={47} y2={8} />
          <line x1={-24} y1={2} x2={-24} y2={8} />
          <line x1={26} y1={-4} x2={26} y2={2} />
          <line x1={-38} y1={8} x2={-38} y2={14} />
        </g>
        <path d="M -8,14 L -8,1 Q -8,-5 0,-5 Q 8,-5 8,1 L 8,14 Z" fill={GATE_FILL} stroke="rgba(212,175,105,0.5)" strokeWidth={1.1} />
        <rect x={-30} y={-17.5} width={60} height={14} fill={style.body} stroke={BODY_STROKE} strokeWidth={1.2} />
        {/* 高窗两笔 + 堡身夯土横缝 */}
        <rect x={-16} y={-12} width={8} height={6} fill={LATTICE_FILL} />
        <rect x={8} y={-12} width={8} height={6} fill={LATTICE_FILL} />
        <line x1={-30} y1={-8} x2={30} y2={-8} stroke="rgba(90,70,40,0.15)" strokeWidth={0.7} />
        <rect x={-33} y={-20.5} width={66} height={3} fill={DESERT_ROOF} stroke={ROOF_STROKE} strokeWidth={0.8} />
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
        <polygon points="-49,14 49,14 44,-4 -44,-4" fill={PLATFORM_FILL} stroke={PLATFORM_STROKE} strokeWidth={1.4} />
        <g stroke="rgba(90,70,40,0.18)" strokeWidth={0.7}>
          <line x1={-45} y1={2} x2={45} y2={2} />
          <line x1={-47} y1={8} x2={47} y2={8} />
          <line x1={-24} y1={2} x2={-24} y2={8} />
          <line x1={26} y1={-4} x2={26} y2={2} />
          <line x1={-38} y1={8} x2={-38} y2={14} />
        </g>
        <path d="M -8,14 L -8,1 Q -8,-5 0,-5 Q 8,-5 8,1 L 8,14 Z" fill={GATE_FILL} stroke="rgba(212,175,105,0.5)" strokeWidth={1.1} />
        <g fill={RAIL_FILL} stroke="rgba(90,70,40,0.4)" strokeWidth={0.5}>
          <rect x={-34} y={-7.5} width={68} height={1.8} />
          {[-32, -20, -8, 6, 18, 30].map((x) => (
            <rect key={x} x={x} y={-5.8} width={1.8} height={2.8} />
          ))}
        </g>
        <PillaredBay x={-20} y={-22} w={40} h={15} winH={8} style={style} />
        <path d={lower} fill={ROOF_FILL} stroke={ROOF_STROKE} strokeWidth={1.2} strokeLinejoin="round" />
        <path d={roofSheen(40, -21)} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} />
        <PillaredBay x={-13} y={-29} w={26} h={9} winH={4} style={style} />
        <path d={upper} fill={ROOF_FILL} stroke={ROOF_STROKE} strokeWidth={1.1} strokeLinejoin="round" />
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
        <path key={i} d={d} fill="none" stroke="rgba(35,40,48,0.5)" strokeWidth={1} strokeLinecap="round" />
      ))}
      {decor}
      {finial}
    </>
  );
}

// ── #25/#39/#58 城池全局放大比例 ──
// 旗/匾/印/价格签等所有元素随 <g> 整体 scale(等比,视觉口径统一;点击热区与
// hover 重排随 SVG transform 同步放大,无需另调)。
// 屏幕上的净大小 = TILE_SCALE / 画布放大倍数(1.4x):#58 蛇形重排后网格步距
// 列 400/行 310,城池再放大:1.96→2.2(净 2.2/1.4≈1.57x)。
// 压盖校验:铭牌外缘 ~104×2.2≈229 < 行距 310 < 列距 400(chessboard 蛇形网格步距)。
const TILE_SCALE = 2.2;

// ── 竖排木匾城名 ──
// 局部常量:深木底 + 暖金边/铆钉,集中在此便于整体调色。
const PLANK_FILL = "#3a2a1a";
const PLANK_EDGE = "rgba(212,175,105,0.9)";

/**
 * 竖排木匾(挂建筑右侧):深木底 + 1px 金边 + 顶部两枚铆钉;都城匾加宽 + 金底墨字 + 底部两缕流苏。
 * 方案取舍:选"逐字纵排"而非 SVG writing-mode(后者 Firefox/Safari 对 tb 支持参差,逐字定位最稳)。
 *
 * 两级可读设计(B1):总览(FIT_VIEW 2300 宽 → ~1000px 容器,缩放系数 ≈0.43)下
 * 任何城名字都只有 ~6-8px——总览不指望读字,靠「色带=区域色相 / 旗形=归属」的形状层辨认
 * (viewBox 是命令式更新、不触发 React 渲染,Tile 感知不到 zoom,做不了真 LOD 切换);
 * 放大后才进入「读字」层级,此时满字号应 ≥13px 等效红线:
 * large 20(×1)、medium 21(×0.9=18.9)、small 23(×0.8=18.4)——小城字号下限抬高补回缩放损失。
 * (#58 城池再放大 2.2x 后匾额字另加一档:17/18/20 → 20/21/23,≈+15%。)
 */
function NamePlaque({ name, capital, size }: { name: string; capital: boolean; size: "large" | "medium" | "small" }) {
  const chars = [...name].slice(0, 3); // 城名 2-3 字
  const w = capital ? 34 : 26;
  const fs = size === "small" ? 23 : size === "medium" ? 21 : 20;
  const step = fs + 3; // B5:字距留缝(20→23),三字匾整体高度随之 +6
  const h = chars.length * step + 12;
  const x = 40 - w / 2; // 匾中心 x=40(建筑右侧、铭牌内),不与色带/王旗/小旌旗重叠
  const y0 = -22;
  return (
    <g className="bv-tile-plaque">
      <rect
        x={x}
        y={y0}
        width={w}
        height={h}
        rx={3}
        fill={capital ? rgba(Theme.goldBright, 0.95) : PLANK_FILL}
        stroke={PLANK_EDGE}
        strokeWidth={1}
      />
      {/* 顶部两枚铆钉圆点(固定匾额的钉帽,细节让 zoom-out 后仍是"色块有细节") */}
      <circle cx={x + 5} cy={y0 + 5} r={1.6} fill={PLANK_EDGE} />
      <circle cx={x + w - 5} cy={y0 + 5} r={1.6} fill={PLANK_EDGE} />
      {chars.map((c, i) => (
        <text
          key={i}
          x={40}
          y={y0 + 15 + i * step}
          textAnchor="middle"
          fontFamily="var(--font-deco)"
          fontSize={fs}
          fontWeight={700}
          fill={capital ? rgba(Theme.ink) : "rgba(238,210,140,0.96)"}
        >
          {c}
        </text>
      ))}
      {/* 都城匾底部两缕流苏(曲线收尖),与王旗描金同调 */}
      {capital ? (
        <>
          <path d={`M ${x + 11} ${y0 + h} q -3 5 -2 9 l 2.5 3 z`} fill={PLANK_EDGE} />
          <path d={`M ${x + w - 11} ${y0 + h} q 3 5 2 9 l -2.5 3 z`} fill={PLANK_EDGE} />
        </>
      ) : null}
    </g>
  );
}

// ── 等级印(铭牌左下小方章):大写数字壹/贰/叁,Lv0 无印 ──
// 精确读级通道(形状通道 = Building 城楼加层)。有主铭牌是深玩家色底,亮纸方章总览即
// 一粒浅色方点(有/无 = 扩没扩军),放大后读数字对级;与都城「都」印(右上、朱底金字)
// 位置与配色互斥不撞车。纸底墨字取无主宣纸铭牌同色系——等级印只在有主(Lv≥1 必有主)
// 城上出现,不落在宣纸底上。
const LEVEL_SEAL_CHARS = ["", "壹", "贰", "叁"] as const;

// #96/ADR-0015 出场钤章:bv-level-seal-pop(board.css,盖章归一后引用 fx.css 的共享
// 落章弧 fx-seal-slam)scale 2.2→1 回弹落章。replay=true(本城有过扩军宣告)才挂
// 动画类;key 由调用方取宣告 nonce,nonce 变化重挂重播;平时(含快照恢复)静置不播。
function LevelSeal({ level, replay }: { level: number; replay: boolean }) {
  return (
    <g className={`bv-level-seal${replay ? " bv-level-seal-pop" : ""}`} transform="translate(-41 31)">
      <rect
        x={-8}
        y={-8}
        width={16}
        height={16}
        rx={2}
        fill={rgba(Theme.paperHi, 0.96)}
        stroke="rgba(60,45,20,0.5)"
        strokeWidth={1}
      />
      <text
        y={4.2}
        textAnchor="middle"
        fontFamily="var(--font-brush)"
        fontSize={12}
        fontWeight={700}
        fill={rgba(Theme.ink)}
      >
        {LEVEL_SEAL_CHARS[level]}
      </text>
    </g>
  );
}

// ── X4(#23) 选都候选序号印:壹/贰/叁(引擎滚出顺序=第几候选)──
// 复用 LevelSeal 方章形制(16×16 圆角方 + 笔书大字),描金变体:墨底金框金字——
// 与「都」印(朱底金字)同读作「印=特殊城」,又以底色相区分。候选期无主无等级,
// 与 LevelSeal 同锚点(-41 31)而时段互斥(Setup 期 Lv 恒 0),不叠印;总览下是
// 一粒金边方点,与脉冲金圈构成「三城仪式组」,放大后读序号(「我选叁号城」)。
function CandidateSeal({ order }: { order: number }) {
  return (
    <g className="bv-candidate-seal" transform="translate(-41 31)">
      <rect
        x={-8}
        y={-8}
        width={16}
        height={16}
        rx={2}
        fill="rgba(35,25,12,0.88)"
        stroke={rgba(Theme.goldBright)}
        strokeWidth={1.2}
      />
      <text
        y={4.2}
        textAnchor="middle"
        fontFamily="var(--font-brush)"
        fontSize={12}
        fontWeight={700}
        fill={rgba(Theme.goldBright)}
      >
        {LEVEL_SEAL_CHARS[order]}
      </text>
    </g>
  );
}

/** 非城池格(锦囊/天命/税关/商市/卧龙岗)的大字 icon 配色。 */
const ICON_THEME: Partial<Record<TileDef["type"], { color: string; icon: string }>> = {
  Wolong: { color: "goldBright", icon: "龙" },
  Chance: { color: "goldBright", icon: "吉" },
  Fate: { color: "danger", icon: "凶" },
  Tax: { color: "danger", icon: "税" },
  Stock: { color: "money", icon: "市" },
};

// ── #96 易主检测已收编(ADR-0015)──
// 旧 useOwnerChangeFlash(props diff 上一值快照)删除:易主宣告由引擎结算留痕 →
// 表现事件流 → sink → fxStore.announces 下发 nonce,Tile 在组件内订阅本城记录重播,
// 触发源是播放器/sink 而非组件自 diff(易主在破产清算/变卖等结算点发生,props diff
// 无法区分「易主」与「终态加载」)。

export const Tile = memo(function Tile({ tile, group, price, state, onClick }: TileProps) {
  // ADR-0015 城池宣告信号:selector 按本城 tileIndex 取记录,他城宣告不触发本城重渲。
  // nonce 单调递增、播完自然过期(无清理定时器);0 = 该维从未宣告,静置。
  const announce = useFxStore((s) => s.announces.get(tile.index));
  const growNonce = announce?.level ?? 0;
  // 易主流光仅在有过易主宣告后渲染(开局铺盘不闪);key=nonce 每次易主重挂重播。
  const ownFlash = announce != null && announce.owner > 0 ? announce : null;
  const sizeScale = tile.size === "small" ? 0.8 : tile.size === "medium" ? 0.9 : 1;
  const isCapital = state.capitalColorIndex != null;
  const isIconTile = tile.type in ICON_THEME;
  const ownerRgb = state.ownerColorIndex != null ? playerColor(state.ownerColorIndex) : null;
  // #74 色带恒用区域分组色(groupColors):玩家色板与分组色板高度同源(石青≈荆楚、
  // 朱砂≈幽燕…),有主城染玩家色会与异地无主城撞色、误读区域归属;归属辨识交由
  // 铭牌深底/屋顶染瓦/城主旗承担,色带专职「区域色相」导航。
  const bandFill = tile.propertyId
    ? rgba(groupColor(group))
    : isIconTile
      ? rgba(Theme[ICON_THEME[tile.type]!.color as "goldBright" | "danger" | "money"])
      : "rgba(140,110,60,0.5)";

  const cls = [
    "bv-tile",
    isCapital ? "bv-capital" : "",
    state.isActive ? "bv-active" : "",
    state.isTaken ? "opacity-40 grayscale" : "",
    // X4(#23) 候选集全座位可见:静态低透明金圈;本地可点(bv-selectable)脉冲升级
    state.capitalCandidateOrder != null ? "bv-candidate" : "",
    state.isSelectable ? "bv-selectable" : "",
    // 需求2·无主档:整城 0.92 安静感(城池格专属;isTaken 的 40% 灰阶更强,让位不叠加)
    !ownerRgb && !state.isTaken && !isIconTile ? "bv-unowned" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <g
      className={cls}
      id={`tile-${tile.index}`}
      data-tile={tile.index}
      data-name={tile.name}
      transform={`translate(${tile.position.x} ${tile.position.y}) scale(${sizeScale * TILE_SCALE})`}
      onClick={onClick ? () => onClick(tile.index) : undefined}
    >
      {/* 命中高亮底 + 都城/焦点光晕 */}
      <circle className="bv-tile-hilite" r={62} fill={rgba(Theme.gold)} />
      {/* F2:光晕改 radialGradient 圆(BoardDefs 定义,中心亮→边缘 0),去掉常驻 blur(9px)
          滤镜——滤镜在 zoom 时每帧重算,渐变只是普通填充;脉动仍由 board.css 的 opacity
          keyframe 驱动(bv-pulse-glow),视觉节奏不变。 */}
      <circle className="bv-capital-glow" r={70} fill="url(#bv-capital-glow-grad)" />
      {/* #75 活跃格虚线环:独立于都城金晕——虚线环=「轮到谁」(回合所属),
          金晕=「哪是都城」,两语义一眼可分。r=80×2.2≈176 逻辑半径 < 310 行距,
          不碰邻格;虚线沿圆周行进(board.css 用 dashoffset 而非 rotate,
          旋转会改变 AABB 令点选稳定性检查超时)。 */}
      {state.isActive ? (
        <circle
          className="bv-active-ring"
          r={80}
          fill="none"
          stroke="rgba(212,175,55,0.9)"
          strokeWidth={3}
          strokeDasharray="12 9"
        />
      ) : null}

      {/* 铭牌底(需求2 三档):无主=宣纸底淡墨边(低显著);有主(含都城)=深玩家色整块
          染底 ≥85% 不透明——zoom-out 扫描时"色块=地盘"按色相即读,不依赖细节。 */}
      <rect
        className="bv-tile-border"
        x={-52}
        y={-44}
        width={104}
        height={88}
        rx={10}
        fill={ownerRgb ? rgba(shade(ownerRgb, 0.58), 0.92) : "rgba(247,236,208,0.92)"}
        fillOpacity={ownerRgb ? 0.92 : 1}
        stroke={
          state.isActive
            ? rgba(Theme.goldBright)
            : ownerRgb
              ? rgba(ownerRgb)
              : "rgba(60,45,20,0.25)"
        }
        strokeOpacity={ownerRgb ? 0.95 : 0.5}
        strokeWidth={ownerRgb ? 4 : 2.5}
      />

      {isIconTile ? (
        <>
          <rect className="bv-tile-band" x={-46} y={-44} width={92} height={10} rx={2} fill={bandFill} stroke="rgba(40,28,12,0.45)" strokeWidth={1} />
          {/* 类型点缀物(静态 path,无动画):每种格一两笔剪影,克制不喧宾。
              珍宝格的宝/囊/伏图标在 StaticLayers 辅路格上,此处不重复画。 */}
          {tile.type === "Stock" ? (
            // 商市:大字两侧挂一对红灯笼(圆 + 穗),暖色点缀商业氛围
            [-34, 34].map((lx) => (
              <g key={lx}>
                <line x1={lx} y1={-36} x2={lx} y2={-4} stroke="rgba(50,35,15,0.7)" strokeWidth={1} />
                <ellipse cx={lx} cy={4} rx={6} ry={8} fill="rgba(178,44,34,0.92)" stroke="rgba(120,20,15,0.7)" strokeWidth={1} />
                <line x1={lx} y1={12} x2={lx} y2={18} stroke="rgba(200,60,40,0.8)" strokeWidth={1} />
                <line x1={lx - 2} y1={12} x2={lx - 3} y2={17} stroke="rgba(200,60,40,0.6)" strokeWidth={0.8} />
                <line x1={lx + 2} y1={12} x2={lx + 3} y2={17} stroke="rgba(200,60,40,0.6)" strokeWidth={0.8} />
              </g>
            ))
          ) : null}
          {tile.type === "Chance" ? (
            // 锦囊:大字下方一具横卷轴(轴身 + 两端轴杆),陪衬"吉"字
            <g>
              <rect x={-13} y={32} width={26} height={7} rx={2} fill="rgba(240,224,180,0.9)" stroke="rgba(120,86,45,0.8)" strokeWidth={0.8} />
              <rect x={-17} y={30.5} width={4} height={10} rx={1.5} fill="rgba(150,110,60,0.9)" />
              <rect x={13} y={30.5} width={4} height={10} rx={1.5} fill="rgba(150,110,60,0.9)" />
            </g>
          ) : null}
          {tile.type === "Fate" ? (
            // 天命:大字下两三笔云纹弧线托底,呼应"天意"意象
            <g fill="none" stroke="rgba(90,70,50,0.55)" strokeWidth={1.2}>
              <path d="M -24 34 q 7 -7 14 0 q 7 7 14 0 q 7 -7 14 0" />
              <path d="M -10 41 q 7 -6 14 0" />
            </g>
          ) : null}
          <text
            x={0}
            y={22}
            textAnchor="middle"
            fontFamily="var(--font-brush)"
            fontSize={48}
            fontWeight={700}
            fill={rgba(Theme[ICON_THEME[tile.type]!.color as "goldBright" | "danger" | "money"])}
          >
            {ICON_THEME[tile.type]!.icon}
          </text>
          <text
            className="bv-tile-name"
            x={0}
            y={-16}
            textAnchor="middle"
            fontFamily="var(--font-deco)"
            fontSize={16}
            fill={rgba(Theme.inkDim)}
          >
            {tile.name}
          </text>
        </>
      ) : (
        <>
          {/* 需求2·都城① 金色城台底座:建筑脚下两层 rect(暗金座身+亮金座面,模拟上下渐变)。
              不用 linearGradient:defs 在 StaticLayers(独占勿动),每城内联 defs 会产生重复 id 冲突。 */}
          {isCapital ? (
            <g className="bv-capital-pedestal">
              <rect x={-62} y={9} width={124} height={12} rx={2} fill="rgba(178,140,50,0.6)" stroke="rgba(50,35,15,0.8)" strokeWidth={1.5} />
              <rect x={-62} y={9} width={124} height={5.5} rx={2} fill="rgba(212,175,55,0.9)" />
            </g>
          ) : null}
          {/* 建筑整体 scale 1.08(都城):以城脚(y=12)为锚,只向上长高="微抬升",
              不踩进底座;无主/领地保持原尺度。 */}
          <g transform={isCapital ? "translate(0 12) scale(1.08) translate(0 -12)" : undefined}>
            {/* 有主城染瓦:玩家色混瓦色实色盖住全部屋面(含加层),与铭牌描边/城旗同源
                (沿用 playerColor props,无新通道);group 传入驱动地域形制变体。 */}
            <Building
              size={tile.size ?? "medium"}
              level={state.level}
              tint={ownerRgb ? roofTintOf(ownerRgb) : null}
              group={group}
              growNonce={growNonce}
            />
          </g>
          {/* 分组色带(顶部):恒用区域色(#74,不再随持有者染玩家色)。
              B1 两级设计:总览读不了字,色带是"形状层"信号——加高一档并描深边,
              让远看时色带在宣纸/铭牌底上仍有清晰的色块轮廓可辨。 */}
          <rect
            className="bv-tile-band"
            x={-46}
            y={-44}
            width={92}
            height={10}
            rx={2}
            fill={bandFill}
            stroke="rgba(40,28,12,0.45)"
            strokeWidth={1}
          />
          {/* #96/ADR-0015 易主流光:归属变更(A 破产清算回无主 / 转玩家 B / 变卖给银行)
              时铭牌带闪一道玩家色流光一次(回无主一档无玩家色,用金色——金=既有事件强调
              语言)。宣告 nonce 经事件流下发;key=nonce 每次易主重挂重播,动画播完停在
              基态 opacity 0,平时(开局铺盘/快照恢复,nonce=0)不渲染。 */}
          {ownFlash ? (
            <line
              key={ownFlash.owner}
              className="bv-own-flash"
              x1={-46}
              y1={-39}
              x2={46}
              y2={-39}
              stroke={ownFlash.ownerColorIndex != null ? rgba(playerColor(ownFlash.ownerColorIndex)) : rgba(Theme.gold)}
              strokeWidth={8}
            />
          ) : null}
          {/* 城名竖排木匾(挂建筑右侧):都城金底墨字 + 流苏,普通城深木底金字 */}
          <NamePlaque name={tile.name} capital={isCapital} size={tile.size ?? "medium"} />
          {/* 价格字(#40 S7):仅无主城渲染——有主城铭牌已是深玩家色底,购入价纯属
              噪声(等级/归属才是持续信息),不再输出;无主宣纸底保持墨字不变。 */}
          {!ownerRgb && (
            <text
              x={0}
              y={42}
              textAnchor="middle"
              fontFamily="var(--font-deco)"
              fontSize={16}
              fill={rgba(Theme.inkDim)}
            >
              {price}
            </text>
          )}
          {/* #96 等级=城楼加层(Building 内,层数即等级)+ 等级印(铭牌左下,壹/贰/叁,Lv0 无印)。
              双通道:形状(高低)总览可读,印章放大后精确对级;替换旧的 0-3 面旌旗(总览不可辨,已删)。
              扩军瞬间双拍(ADR-0015):宣告 nonce 经事件流下发,新顶层屋檐生长 + 印章重钤
              均以 nonce 为 key 重挂重播;nonce 不变时等级印随 props 静态更新,不重播。 */}
          {state.level > 0 ? <LevelSeal key={growNonce} level={state.level} replay={growNonce > 0} /> : null}
          {/* X4(#23) 选都候选序号印(铭牌左下,壹/贰/叁):与等级印同形制描金变体,
              Setup 期与等级印时段互斥;旁观席位同见(仪式感是全座的,可点只在本地)。 */}
          {state.capitalCandidateOrder != null ? <CandidateSeal order={state.capitalCandidateOrder} /> : null}
          {/* 王旗(都城):旗杆 + 旗顶缨 + 玩家色三角(描金边)+ 国号。
              需求2·都城② 旗面加宽至 1.4 倍 + 双层(后层深色衬底)——大旗是 zoom-out 后
              仍可辨的形状级王权信号,不依赖文字/描边细节。
              旗杆基点固定 -40:城楼加层长高后旗杆「立于楼中」(城头立旗),旗面高度不变,
              不加重与邻城铭牌的既有避让余量(chessboard 存在同列 196 的近距上下邻城)。 */}
          {isCapital && state.capitalColorIndex != null ? (
            <g className="bv-tile-flag">
              <line x1={0} y1={-40} x2={0} y2={-88} stroke="rgba(50,35,15,0.8)" strokeWidth={2} />
              {/* 旗杆顶缨:金珠 + 三笔红缨,静态点缀 */}
              <circle cx={0} cy={-89} r={2.2} fill={rgba(Theme.goldBright)} />
              <g stroke="rgba(178,44,34,0.85)" strokeWidth={1}>
                <line x1={0} y1={-87} x2={-3} y2={-84} />
                <line x1={0} y1={-87} x2={0} y2={-83} />
                <line x1={0} y1={-87} x2={3} y2={-84} />
              </g>
              {/* 后层深色衬:略大略低一笔,让前层旗面在任何底色上都"浮"出来 */}
              <polygon points="0,-90 47,-77.5 0,-65" fill="rgba(35,25,12,0.6)" />
              <polygon
                points="0,-88 45,-76.5 0,-65"
                fill={rgba(playerColor(state.capitalColorIndex))}
                stroke={rgba(Theme.goldBright)}
                strokeWidth={1.5}
              />
              {/* B3:三角尖端窄,文字锚点从 x=15 右移到形心偏内 x=19,避免国号挤向尖端溢出 */}
              <text
                x={19}
                y={-74}
                textAnchor="middle"
                fontFamily="var(--font-brush)"
                fontSize={17}
                fill="#fff"
              >
                {state.capitalGuohao}
              </text>
            </g>
          ) : null}
          {/* 需求2·都城③ 朱底金字方印「都」:右上角、旋转 -6°(手钤印的随意感)、金边框;
              B4:14→20——总览(≈0.43 系数)下 14px 印已趋不可见,放大到 20 让远距仍是一粒
              可辨的朱红方点;与领地区分"这是都城"的第二冗余信号(王旗之外印也认得)。 */}
          {isCapital ? (
            <g className="bv-capital-seal" transform="translate(49 -33) rotate(-6)">
              <rect x={-10} y={-10} width={20} height={20} rx={2} fill={rgba(Theme.danger)} stroke={rgba(Theme.goldBright)} strokeWidth={1.4} />
              <text x={0} y={5} textAnchor="middle" fontFamily="var(--font-brush)" fontSize={14} fontWeight={700} fill={rgba(Theme.goldBright)}>
                都
              </text>
            </g>
          ) : null}
          {/* #73 起点印:起始城(tileIndex 0,长安)铭牌右上盖「起」字朱印——制式与
              「都」印同族(20×20 圆角方 + 朱底金边 + -6° 手钤),字为「起」;与主路
              首段双箭羽互为表里,总览下即知行进自哪城始。 */}
          {tile.index === 0 ? (
            <g className="bv-start-seal" transform="translate(49 -33) rotate(-6)">
              <rect x={-10} y={-10} width={20} height={20} rx={2} fill={rgba(Theme.danger)} stroke={rgba(Theme.goldBright)} strokeWidth={1.4} />
              <text x={0} y={5} textAnchor="middle" fontFamily="var(--font-brush)" fontSize={14} fontWeight={700} fill={rgba(Theme.goldBright)}>
                起
              </text>
            </g>
          ) : null}
          {/* B2 三旗语法分化:持有者城旗改「燕尾旗」(矩形 + 飞端 V 形缺口)——
              与棋子的三角旗(人)、王旗的双层大三角(都)三形互斥,远看旗形即分类;
              深描边压住轮廓,保证浅色玩家色旗面在宣纸上也可辨。 */}
          {!isCapital && ownerRgb ? (
            <g className="bv-tile-owner-flag">
              <line x1={40} y1={-28} x2={40} y2={-50} stroke="rgba(50,35,15,0.8)" strokeWidth={1.5} />
              <polygon
                points="40,-50 62,-50 55,-45 62,-40 40,-40"
                fill={rgba(ownerRgb)}
                stroke="rgba(40,28,12,0.55)"
                strokeWidth={1}
              />
              <text
                x={50}
                y={-41.5}
                textAnchor="middle"
                fontFamily="var(--font-brush)"
                fontSize={10.5}
                fill="#fff"
              >
                {state.ownerGuohao}
              </text>
            </g>
          ) : null}
        </>
      )}
    </g>
  );
});
