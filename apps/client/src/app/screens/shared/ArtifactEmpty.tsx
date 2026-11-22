// 共用空态器物(#768)：斜放朱印搭配短注，加载中呈现墨滴呼吸三点。
import "./artifact-empty.css";

/** 斜放朱印空态:印文 char(单字)+ 短注 note;title 为可达名(视觉即器物,语义走它)。 */
export function SealEmpty({ char, note, title }: { char: string; note: string; title: string }) {
  return (
    <span className="seal-empty" role="img" aria-label={title}>
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
