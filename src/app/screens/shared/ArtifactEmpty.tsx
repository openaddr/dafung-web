// 空态器物件(#768,2026-10-29 移动端审计拍板):「一行小字」式空态退役,换器物
// 语言——斜放朱印+短注(列表空)、墨滴呼吸三点(清单加载中)。语言对齐手牌空态
// 「斜放牌背」先例(DESIGN §5 动效哲学:器物物理,零插画依赖)。
// 消费方:地图条带(MapStrip)与选图面板(MapSelectPanel)——两处同一「地图清单」
// 语境,制式单源本件;战报空笺(空白笺+虚线格)结构为抽屉独有,留
// WarReportDrawer + layout.css 战报段,不并入本件。
// 制式细节在 artifact-empty.css;朱印字色/渐变沿用 app.css note-head 沉朱印同款手筋。
import "./artifact-empty.css";

/** 斜放朱印空态:印文 char(单字)+ 短注 note;title 为可达名(视觉即器物,语义走它)。 */
export function SealEmpty({ char, note, title }: { char: string; note: string; title: string }) {
  return (
    <span className="seal-empty" role="img" aria-label={title} title={title}>
      <i className="seal-empty-mark" aria-hidden="true">
        {char}
      </i>
      <span className="seal-empty-note" aria-hidden="true">
        {note}
      </span>
    </span>
  );
}

/** 墨滴呼吸三点(加载中):--dur-ambient 半频、三点 1/3 周期错相(相位在 css);
 *  role=status + aria-label 承载语义,视觉纯器物零文字。 */
export function InkBreathe({ title }: { title: string }) {
  return (
    <span className="ink-breathe" role="status" aria-label={title}>
      <i />
      <i />
      <i />
    </span>
  );
}
