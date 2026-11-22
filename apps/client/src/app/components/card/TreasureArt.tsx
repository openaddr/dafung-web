// 组件收口:纯视觉画心，共用静态珍宝图和运行时技能书题签。
import type { TreasureDef } from "@dafung/core/engine/treasures";
import { cn } from "@app/utils/cn";
import { treasureArtOf } from "./treasure-art";
import "./treasure-art.css";

export function TreasureArt({
  treasure,
  alt = "",
  className,
}: {
  treasure: Pick<TreasureDef, "id" | "kind" | "skillId">;
  alt?: string;
  className?: string;
}) {
  const { id, image, bookTitle } = treasureArtOf(treasure);
  return (
    <span className={cn("treasure-art", className)} data-treasure-art={id}>
      <span className="treasure-art-scene">
        <img className="treasure-art-image" src={image} alt={alt} />
        {bookTitle !== null && (
          <span
            className="treasure-art-book-title"
            style={{ ["--book-title-length" as string]: [...bookTitle].length }}
            aria-hidden="true"
          >
            {bookTitle}
          </span>
        )}
      </span>
    </span>
  );
}
