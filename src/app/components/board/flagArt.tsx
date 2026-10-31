// 旗面形制单源(ADR-0039):旗杆/双描边三角旌旗/国号字/底座印玺的原语集。
// 两个容器共用同一份美术——
//   棋子层 TokenFlag(<g> 容器,行军换装期显示,金边拖影由 board.css 挂 .bv-token-marching);
//   氛围层 AmbientFlag(<svg> 容器,静止期常驻,摇曳动画 ambient.css)。
// 两处各自渲染会导致美术漂移,故抽本文件强制同源(#608 同源纪律同款)。
import { Theme, playerColor, rgba } from "@core/theme";
import type { BoardPlayer } from "./BoardView";

export function FlagShapes({ p }: { p: BoardPlayer }) {
  const c = playerColor(p.colorIndex);
  return (
    <>
      {/* 旗杆(#512 深底适配:暗金装饰线 goldWash,深色杆在玄墨底上不可见) */}
      <line x1={0} y1={0} x2={0} y2={-34} stroke={rgba(Theme.goldWash, 0.85)} strokeWidth={2.5} />
      {/* 三角旌旗(玩家色)。B2:纸色描边一圈——棋子是"人",要在城旗(燕尾)/王旗(双层大三角)
          之外第一眼可辨,纸色边在任何底色上勾出旗形轮廓;内侧玄墨细线再压一层层次。 */}
      <polygon
        points="0,-34 26,-26 0,-16"
        fill={rgba(c)}
        stroke={rgba(Theme.paper, 0.95)}
        strokeWidth={1.6}
      />
      <polygon
        points="0,-34 26,-26 0,-16"
        fill="none"
        stroke={rgba(Theme.bgDeep, 0.6)}
        strokeWidth={0.6}
      />
      {/* 国号字(#512:纸色字 + 玄墨衬底描边,任意玩家色旗面上可读) */}
      <text
        x={9}
        y={-23}
        textAnchor="middle"
        fontFamily="var(--font-brush)"
        fontSize={13}
        fontWeight={700}
        fill={rgba(Theme.paper)}
        stroke={rgba(Theme.bgDeep, 0.85)}
        strokeWidth={2}
        paintOrder="stroke"
      >
        {p.guohao || "?"}
      </text>
      {/* 底座印玺 */}
      <circle
        cx={0}
        cy={2}
        r={6}
        fill={rgba(c)}
        stroke={rgba(Theme.bgDeep, 0.85)}
        strokeWidth={1.5}
      />
    </>
  );
}
