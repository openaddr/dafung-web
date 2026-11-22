// 组件收口:研读弹层复用 PileShell→ui/dialog，选将与固定底部操作走 Base UI Button。
import { useState } from "react";
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
  /** 可学者(槽位序,core skillBookLearners 单源产出)。 */
  learners: HeroSlot[];
  locked: boolean;
  onConfirm: (heroId: string) => void;
  onClose: () => void;
}

export function SkillBookLearnModal({
  bookName,
  skillId,
  learners,
  locked,
  onConfirm,
  onClose,
}: SkillBookLearnModalProps) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = learners.find((slot) => slot.heroId === pickedId);
  if (pickedId !== null && picked === undefined) setPickedId(null);
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
            disabled={locked || picked === undefined}
            onClick={() => {
              if (!locked && picked !== undefined) onConfirm(picked.heroId);
            }}
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
            aria-pressed={slot.heroId === pickedId}
            disabled={locked}
            onClick={() => setPickedId(slot.heroId)}
            className="pile-hero-cell"
          >
            <HeroCardFace heroId={slot.heroId} skillIds={slot.skillIds} size="detail" />
          </Button>
        ))}
      </div>
    </PileShell>
  );
}
