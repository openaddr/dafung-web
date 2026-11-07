// 用书学技·多名可学弹窗(#1146):珍宝弹层点技能书后,麾下「池含此技且未习得」者
// 多于一名时的选人叠层——PileShell 壳(藏品弹层同族,#361 制式)+ 名将卡面网格,
// 点谁谁学(一键拍板,无二段确认:学技无银钱过手、误学可读战报溯源,与交涉成交
// 的二段式不可逆语境不同权)。壳走 ui/dialog 底件(PileShell 内建,焦点陷阱/Esc/
// 点外关闭白拿);挂载不夺焦 = PileShell 既有口径。可学者序 = 槽位序
// (core skillBookLearners 单源,bot 贪心取首同源)。
import { PileShell, PileZone } from "./PileModal";
import { HeroCardFace } from "@app/components/card/HeroCardFace";
import type { HeroSlot } from "@core/roster";
import { heroById } from "@core/heroes";
import { skillById } from "@core/skills";
import { TESTIDS } from "./testids";

export interface SkillBookLearnModalProps {
  /** 被研读的技能书名(「技能书·X」,题名语境行)。 */
  bookName: string;
  /** 书承载的技 id(副题语境:学的是哪条技)。 */
  skillId: string;
  /** 可学者(槽位序,core skillBookLearners 单源产出)。 */
  learners: HeroSlot[];
  /** 拍板:heroId 直落用书命令(命令通路在 GameScreen)。 */
  onPick: (heroId: string) => void;
  onClose: () => void;
}

/** 多名可学弹窗:麾下卡面各一钮,点卡=该书授此将。 */
export function SkillBookLearnModal({
  bookName,
  skillId,
  learners,
  onPick,
  onClose,
}: SkillBookLearnModalProps) {
  return (
    <PileShell
      title="用书学技"
      seal="技"
      sub={`${bookName} · 麾下 ${learners.length} 人可习「${skillById(skillId).name}」`}
      testid={TESTIDS.bookLearnModal}
      ariaLabel={`用书学技 · ${bookName}`}
      onClose={onClose}
    >
      <PileZone>
        可学者 · {learners.length} 席<small>(点将习得,书随用随耗)</small>
      </PileZone>
      <div className="pile-hero-grid">
        {learners.map((slot) => (
          <button
            type="button"
            key={slot.heroId}
            data-testid={TESTIDS.bookLearnItem(slot.heroId)}
            aria-label={`令 ${heroById(slot.heroId).name} 习得${skillById(skillId).name}`}
            onClick={() => onPick(slot.heroId)}
            className="pile-hero-cell"
          >
            <HeroCardFace heroId={slot.heroId} skillIds={slot.skillIds} size="detail" />
          </button>
        ))}
      </div>
    </PileShell>
  );
}
