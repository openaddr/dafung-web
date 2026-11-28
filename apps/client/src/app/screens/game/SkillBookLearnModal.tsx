// 组件收口:研读弹层复用 PileShell→ui/dialog，选将与固定底部操作走 Base UI Button。
import { Button } from "@base-ui/react/button";
import { PileShell } from "./PileModal";
import { HeroCardFace } from "@app/components/card/HeroCardFace";
import type { HeroSlot } from "@dafung/core/engine/roster";
import { heroById } from "@dafung/core/engine/heroes";
import { skillById } from "@dafung/core/engine/skills";
import { TESTIDS } from "./testids";
import "./skill-book-learn.css";

interface SkillBookLearnModalProps {
  /** 被研读的技能书名(「技能书·X」,题名语境行)。 */
  bookName: string;
  /** 书承载的技能。 */
  skillId: string;
  /** 权威座位选项交付的可学者，按麾下顺序。 */
  learners: HeroSlot[];
  learnerHeroId: string | null;
  locked: boolean;
  canConfirm: boolean;
  onSelect: (heroId: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function SkillBookLearnModal({
  bookName,
  skillId,
  learners,
  learnerHeroId,
  locked,
  canConfirm,
  onSelect,
  onConfirm,
  onClose,
}: SkillBookLearnModalProps) {
  const skillName = skillById(skillId).name;
  return (
    <PileShell
      title="用书学技"
      seal="技"
      sub={bookName}
      testid={TESTIDS.bookLearnModal}
      ariaLabel={`用书学技 · ${bookName}`}
      className="skill-book-learn"
      onClose={onClose}
      footer={
        <div className="skill-book-learn-actions">
          <Button type="button" data-testid={TESTIDS.bookLearnCancel} onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            data-testid={TESTIDS.bookLearnConfirm}
            className="skill-book-learn-confirm"
            disabled={locked || !canConfirm}
            onClick={onConfirm}
          >
            确认研读
          </Button>
        </div>
      }
    >
      <div className="pile-hero-grid">
        {learners.map((slot) => (
          <Button
            type="button"
            key={slot.heroId}
            data-testid={TESTIDS.bookLearnItem(slot.heroId)}
            aria-label={`令${heroById(slot.heroId).name}习得${skillName}`}
            aria-pressed={slot.heroId === learnerHeroId}
            disabled={locked}
            onClick={() => onSelect(slot.heroId)}
            className="pile-hero-cell"
          >
            <HeroCardFace heroId={slot.heroId} skillIds={slot.skillIds} size="detail" />
          </Button>
        ))}
      </div>
    </PileShell>
  );
}
