import { skillById } from "@core/skills";
import { SKILL_BOOK_ID_PREFIX, TREASURES, type TreasureDef } from "@core/treasures";

type ArtSubject = Pick<TreasureDef, "id" | "kind" | "skillId">;

const SKILL_BOOK_IMAGE = "/assets/treasures/skill-book.webp";

export const TREASURE_ART_URLS = [...TREASURES.map((t) => t.image), SKILL_BOOK_IMAGE];

/** 同款珍宝按目录 id 归组，同技能多册共用未经截尾的书 id。 */
export function treasureArtId(id: string): string {
  return id.startsWith(SKILL_BOOK_ID_PREFIX) ? id : id.replace(/-\d+$/u, "");
}

export function treasureArtOf(treasure: ArtSubject): {
  id: string;
  image: string;
  bookTitle: string | null;
} {
  if (treasure.id.startsWith(SKILL_BOOK_ID_PREFIX)) {
    const encodedSkillId = treasure.id.slice(SKILL_BOOK_ID_PREFIX.length);
    // 旧展示快照只有实例 id；新快照同时携带权威 skillId。
    const skillId = treasure.skillId === undefined ? encodedSkillId : treasure.skillId;
    if (skillId !== encodedSkillId) {
      throw new Error(`珍宝实例 ${treasure.id} 的技能 id 与书不符：${skillId}`);
    }
    return { id: "skill-book", image: SKILL_BOOK_IMAGE, bookTitle: skillById(skillId).name };
  }

  const id = treasureArtId(treasure.id);
  const def = TREASURES.find((t) => t.id === id);
  if (def == null || treasure.kind === "book") {
    throw new Error(`珍宝实例 ${treasure.id} 不在 TREASURES 目录`);
  }
  return { id, image: def.image, bookTitle: null };
}
