// 奇遇金穗纹饰(#1155 奇遇演出):宽卷题行两端的金色麦穗侧饰——奇遇身份全靠形制
// 传达(不立任何文字牌,ADR-0051 不变),金穗点染、不喧宾。纯 SVG 内绘不引外部图;
// 静态无动画(演出纪律:零新增动画机制,出场分量交给既有 banner-drop 节奏与宽卷一号)。
// 色取 core/theme 金族单源(--color-gold-bright/gold/gold-deep):SVG 表现属性不吃
// var(),经 style 消费(banner.css 同一 token 通道,零新色);左右成对镜像由本件
// 自排,宿主(BannerShell 题行侧饰槽)只管落位。
import { SCROLL_TESTIDS as T } from "./testids";

/** 单朵麦穗:茎线一根 + 四站对生麦粒(粒基贴茎、穗向排布)+ 穗尖一粒,穗头朝右
 *  (左位实例经镜像朝左)。尺寸 44×22(题行两端的点缀档,844×390 横屏实拍校准)。 */
function WheatSpray({ mirrored = false }: { mirrored?: boolean }) {
  return (
    <svg
      width="44"
      height="22"
      viewBox="0 0 44 22"
      aria-hidden="true"
      className={mirrored ? "-scale-x-100" : undefined}
    >
      {/* 茎线:自左下向右上挑起的弧线(漆金带上以熟金描,弱一档让麦粒出挑) */}
      <path
        d="M2 18 C 13 17, 26 13, 40 5"
        fill="none"
        strokeWidth="1.3"
        strokeLinecap="round"
        style={{ stroke: "var(--color-gold-deep)" }}
      />
      {/* 四站对生麦粒:上粒亮金/鎏金交替、下粒鎏金,沿茎线由疏到密再收尖 */}
      <g style={{ fill: "var(--color-gold-bright)" }}>
        <ellipse rx="4" ry="1.9" transform="translate(11.5,14.4) rotate(-38)" />
        <ellipse rx="3.6" ry="1.7" transform="translate(27.5,9.7) rotate(-38)" />
      </g>
      <g style={{ fill: "var(--color-gold)" }}>
        <ellipse rx="3.6" ry="1.7" transform="translate(12.5,18.6) rotate(30)" />
        <ellipse rx="4" ry="1.9" transform="translate(19.5,12.4) rotate(-38)" />
        <ellipse rx="3.6" ry="1.7" transform="translate(20.5,16.6) rotate(30)" />
        <ellipse rx="3.6" ry="1.7" transform="translate(28.5,13.9) rotate(30)" />
        <ellipse rx="3.2" ry="1.5" transform="translate(34.5,6.8) rotate(-38)" />
        <ellipse rx="3" ry="1.4" transform="translate(35,11) rotate(30)" />
      </g>
      {/* 穗尖一粒:顺茎线走向收头 */}
      <ellipse
        rx="4.2"
        ry="2"
        transform="translate(40.2,3.2) rotate(-30)"
        style={{ fill: "var(--color-gold-bright)" }}
      />
    </svg>
  );
}

/** 奇遇金穗纹饰成对宿主:题行两端各一朵,穗头相向朝向中央题名(原朵穗头朝右,
 *  故左位用原朵、右位镜像)。绝对定位不占排版、pointer-events-none 不碰拖拽把手,
 *  挂 BannerShell 题行的侧饰槽;testid 供 e2e 断言奇遇形制(普通卷轴无此件)。 */
export function EncounterGoldSprays() {
  return (
    <div
      aria-hidden="true"
      data-testid={T.encounterSpray}
      className="pointer-events-none absolute inset-x-5 top-1/2 flex -translate-y-1/2 items-center justify-between opacity-80"
    >
      <WheatSpray />
      <WheatSpray mirrored />
    </div>
  );
}
