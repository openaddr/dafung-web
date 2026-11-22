import { skillById } from "@dafung/core/engine/skills";
import { SKILL_BOOK_ID_PREFIX, TREASURES, type TreasureDef } from "@dafung/core/engine/treasures";

type ArtSubject = Pick<TreasureDef, "id" | "kind" | "skillId">;

const SKILL_BOOK_IMAGE = "/assets/treasures/skill-book.webp";

export const TREASURE_ART_URLS = [...TREASURES.map((t) => t.image), SKILL_BOOK_IMAGE];

/** 同款珍宝按目录 id 归组，同技能多册共用未经截尾的书 id。 */
export function treasureArtId(id: string): string {
  return id.startsWith(SKILL_BOOK_ID_PREFIX) ? id : id.replace(/-\d+$/u, "");
}

export function treasureArtOf({ id, kind, skillId }: ArtSubject): {
  id: string;
  image: string;
  bookTitle: string | null;
} {
  if (kind === "book") {
    if (skillId === undefined) throw new Error(`技能书实例 ${id} 缺少 skillId`);
    if (id !== `${SKILL_BOOK_ID_PREFIX}${skillId}`) {
      throw new Error(`技能书实例 ${id} 与 skillId ${skillId} 不符`);
    }
    return { id: "skill-book", image: SKILL_BOOK_IMAGE, bookTitle: skillById(skillId).name };
  }

  if (skillId !== undefined || id.startsWith(SKILL_BOOK_ID_PREFIX)) {
    throw new Error(`技能书实例 ${id} 要求 kind 为 book`);
  }
  const catalogId = treasureArtId(id);
  const def = TREASURES.find((t) => t.id === catalogId);
  if (def == null) throw new Error(`珍宝实例 ${id} 不在 TREASURES 目录`);
  return { id: catalogId, image: def.image, bookTitle: null };
}
