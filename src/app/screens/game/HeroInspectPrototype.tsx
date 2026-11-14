// 组件收口：原型交互用 Base UI Button；弹层、滚动与学技选人复用现役底件。
// PROTOTYPE #1400：现役名将检视入口内三案，?variant=A/B/C；不接任何引擎变更命令。
// 所有名将/技能文案与图片来自现役目录；下面的授技组合是明确布景，不代表随机授技概率。
import { useEffect, useState } from "react";
import { Button } from "@base-ui/react/button";
import { heroById } from "@core/heroes";
import { isActiveSkill, skillById } from "@core/skills";
import { skillBookLearners, type HeroSlot } from "@core/roster";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { Lihui } from "@app/components/card/HeroCardFace";
import { ScrollArea } from "@app/components/ui/scroll-area";
import { SealEmpty } from "@app/screens/shared/ArtifactEmpty";
import { Sym } from "@app/screens/shared/Sym";
import { PileShell } from "./PileModal";
import { SkillBookLearnModal } from "./SkillBookLearnModal";
import { TESTIDS } from "./testids";
import "./hero-inspect-prototype.css";

const VARIANTS = ["A", "B", "C"] as const;
type Variant = (typeof VARIANTS)[number];
const NAMES = { A: "人物卷", B: "左录右鉴", C: "技能行册" };
const SCENES = [
  "trio",
  "single",
  "long",
  "empty",
  "readonly",
  "offturn",
  "book-single",
  "book-multi",
] as const;
type Scene = (typeof SCENES)[number];
const SCENE_NAMES: Record<Scene, string> = {
  trio: "三将",
  single: "单将",
  long: "长技能",
  empty: "空态",
  readonly: "他人只读",
  offturn: "非己回合",
  "book-single": "一人可学",
  "book-multi": "多人可学",
};
const BOOK_SKILL = "suifeng";

function slot(heroId: string, skillIds = heroById(heroId).skillPool): HeroSlot {
  return { heroId, skillIds: [...skillIds], lastFired: {}, marks: {} };
}
function sceneRoster(scene: Scene): HeroSlot[] {
  if (scene === "empty") return [];
  if (scene === "single") return [slot("zhouyu")];
  if (scene === "book-single") return [slot("simayi", ["taoguangyanghui"])];
  if (scene === "book-multi")
    return [slot("simayi", ["taoguangyanghui"]), slot("dengai", ["tuntian"])];
  if (scene === "long") return [slot("caopi"), slot("simayi"), slot("zhouyu")];
  return [
    slot("caopi"),
    slot("simayi", ["taoguangyanghui", "saiwengshima"]),
    slot("dengai", ["tuntian", "chubianbujing"]),
  ];
}
function readVariant(): Variant {
  const value = new URLSearchParams(location.search).get("variant");
  if (value === null) return "A";
  if (value !== "A" && value !== "B" && value !== "C") throw new Error(`未知原型方案：${value}`);
  return value;
}
function readScene(): Scene {
  const value = new URLSearchParams(location.search).get("scene");
  if (value === null) return "trio";
  const scene = SCENES.find((s) => s === value);
  if (scene === undefined) throw new Error(`未知原型场景：${value}`);
  return scene;
}

function Portrait({ heroId }: { heroId: string }) {
  const hero = heroById(heroId);
  return (
    <div className="hip-portrait">
      <Lihui src={hero.image} name={hero.name} />
    </div>
  );
}
function Skills({ skillIds }: { skillIds: string[] }) {
  return (
    <div className="hip-skills">
      {skillIds.map(skillById).map((skill) => (
        <section className="hip-skill" key={skill.id}>
          <div className="hip-skill-head">
            <span
              className={isActiveSkill(skill) ? "hip-mark is-active" : "hip-mark"}
              aria-hidden="true"
            />
            <h3>{skill.name}</h3>
            {isActiveSkill(skill) && <span className="hip-cooldown">冷却 {skill.cooldown} 轮</span>}
          </div>
          <p>{skill.desc}</p>
        </section>
      ))}
    </div>
  );
}

interface VariantProps {
  roster: HeroSlot[];
  selected: string;
  select: (id: string) => void;
  dismiss: (id: string) => void;
  armed: string | null;
  readOnly: boolean;
  dismissReady: boolean;
}
function Dismiss({
  id,
  dismiss,
  armed,
  readOnly,
  dismissReady,
}: Pick<VariantProps, "dismiss" | "armed" | "readOnly" | "dismissReady"> & { id: string }) {
  if (readOnly) return null;
  const name = heroById(id).name;
  return (
    <Button
      className={"hip-dismiss" + (armed === id ? " is-armed" : "")}
      data-testid={TESTIDS.heroDismiss(id)}
      disabled={!dismissReady}
      title={dismissReady ? (armed === id ? "再点一次确认遣散" : "再点一次确认") : "己方回合可遣散"}
      aria-label={`${armed === id ? "确认遣散" : "遣散"}${name}`}
      onClick={() => dismiss(id)}
    >
      {armed === id ? "确认遣散" : "遣散"}
    </Button>
  );
}

// A：一将占一整卷；侧边以画像切换，完整竖幅画像与技能文稿等权。
function VariantA(props: VariantProps) {
  const current = props.roster.find((s) => s.heroId === props.selected)!;
  return (
    <div className="hip-variant hip-a">
      <nav className="hip-seals" aria-label="切换名将">
        {props.roster.map((s) => (
          <Button
            key={s.heroId}
            className="hip-seal"
            aria-pressed={s.heroId === props.selected}
            onClick={() => props.select(s.heroId)}
            aria-label={`查看${heroById(s.heroId).name}`}
          >
            <Portrait heroId={s.heroId} />
            <span>{heroById(s.heroId).name}</span>
          </Button>
        ))}
      </nav>
      <div className="hip-a-hero">
        <Portrait heroId={current.heroId} />
        <h2>{heroById(current.heroId).name}</h2>
      </div>
      <div className="hip-a-copy">
        <ScrollArea className="hip-reading">
          <Skills skillIds={current.skillIds} />
        </ScrollArea>
        <div className="hip-actions">
          <Dismiss {...props} id={current.heroId} />
        </div>
      </div>
    </div>
  );
}

// B：名册始终露出所有将与已授技名，右侧全文可滚、操作钉底。
function VariantB(props: VariantProps) {
  const current = props.roster.find((s) => s.heroId === props.selected)!;
  return (
    <div className="hip-variant hip-b">
      <nav className="hip-roster" aria-label="切换名将">
        {props.roster.map((s) => (
          <Button
            key={s.heroId}
            className="hip-roster-item"
            aria-pressed={s.heroId === props.selected}
            onClick={() => props.select(s.heroId)}
            aria-label={`查看${heroById(s.heroId).name}`}
          >
            <Portrait heroId={s.heroId} />
            <span>
              <span className="hip-roster-name">{heroById(s.heroId).name}</span>
              <span className="hip-roster-skills">
                {s.skillIds.map((id) => skillById(id).name).join(" · ")}
              </span>
            </span>
          </Button>
        ))}
      </nav>
      <div className="hip-b-detail">
        <div className="hip-b-title">
          <h2>{heroById(current.heroId).name}</h2>
          <span>实授技能 · {current.skillIds.length}</span>
        </div>
        <ScrollArea className="hip-reading">
          <Skills skillIds={current.skillIds} />
        </ScrollArea>
        <div className="hip-actions">
          <Dismiss {...props} id={current.heroId} />
        </div>
      </div>
    </div>
  );
}

// C：所有将与全文同册，直接逐行读与比较，不设“选中将”的第二阅读状态。
function VariantC(props: VariantProps) {
  return (
    <ScrollArea className="hip-variant hip-c" aria-label="名将技能行册">
      {props.roster.map((s) => (
        <article className="hip-row" key={s.heroId}>
          <div className="hip-row-id">
            <Portrait heroId={s.heroId} />
            <h2>{heroById(s.heroId).name}</h2>
          </div>
          <Skills skillIds={s.skillIds} />
          <div className="hip-row-action">
            <Dismiss {...props} id={s.heroId} />
          </div>
        </article>
      ))}
    </ScrollArea>
  );
}

export default function HeroInspectPrototype({
  player,
  onClose,
}: {
  player: SnapshotPlayer;
  onClose: () => void;
}) {
  const [variant, setVariant] = useState<Variant>(readVariant);
  const [scene, setScene] = useState<Scene>(readScene);
  const [roster, setRoster] = useState(() => sceneRoster(readScene()));
  const [selected, setSelected] = useState(() => {
    const initial = sceneRoster(readScene());
    return initial.length === 0 ? "" : initial[0]!.heroId;
  });
  const [armed, setArmed] = useState<string | null>(null);
  const [learnOpen, setLearnOpen] = useState(false);
  const [bookSpent, setBookSpent] = useState(false);
  const [note, setNote] = useState("操作仅在原型内演练");
  const present = new URLSearchParams(location.search).get("present") === "1";
  const readOnly = scene === "readonly";
  const dismissReady = !readOnly && scene !== "offturn";
  const learners = skillBookLearners({ heroes: roster }, BOOK_SKILL);

  function changeVariant(next: Variant) {
    setVariant(next);
    setArmed(null);
    const url = new URL(location.href);
    url.searchParams.set("variant", next);
    history.replaceState(null, "", url);
  }
  function cycleVariant(delta: number) {
    changeVariant(
      VARIANTS[(VARIANTS.indexOf(readVariant()) + delta + VARIANTS.length) % VARIANTS.length]!,
    );
  }
  function changeScene(next: Scene) {
    const nextRoster = sceneRoster(next);
    setScene(next);
    setRoster(nextRoster);
    setSelected(nextRoster.length === 0 ? "" : nextRoster[0]!.heroId);
    setArmed(null);
    setLearnOpen(false);
    setBookSpent(false);
    setNote("操作仅在原型内演练");
    const url = new URL(location.href);
    url.searchParams.set("scene", next);
    history.replaceState(null, "", url);
  }
  function select(id: string) {
    setSelected(id);
    setArmed(null);
  }
  function dismiss(id: string) {
    if (armed !== id) {
      setArmed(id);
      return;
    }
    const next = roster.filter((s) => s.heroId !== id);
    setRoster(next);
    setSelected(next.length === 0 ? "" : next[0]!.heroId);
    setArmed(null);
    setNote(`已演练遣散${heroById(id).name}，对局未改`);
  }
  function learn(id: string) {
    setRoster(
      roster.map((s) =>
        s.heroId === id
          ? {
              ...s,
              skillIds: heroById(id).skillPool.filter(
                (sid) => sid === BOOK_SKILL || s.skillIds.includes(sid),
              ),
            }
          : s,
      ),
    );
    setLearnOpen(false);
    setBookSpent(true);
    setSelected(id);
    setNote(`已演练${heroById(id).name}习得岁俸，对局未改`);
  }
  useEffect(() => {
    if (present) return;
    const keydown = (e: KeyboardEvent) => {
      if (
        learnOpen ||
        e.defaultPrevented ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        cycleVariant(e.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  });
  const props: VariantProps = { roster, selected, select, dismiss, armed, readOnly, dismissReady };
  const learnerCount = learners.length;
  return (
    <>
      <PileShell
        title="名将"
        seal="将"
        sub={`${readOnly ? "魏" : player.guohao} · 麾下名将 · ${roster.length} 席`}
        testid={TESTIDS.heroModal}
        ariaLabel={`名将 · ${readOnly ? "魏" : player.guohao}`}
        className={`hero-inspect-prototype ${present ? "hip-present" : "hip-with-tools"}`}
        footer={
          !present && (
            <aside className="hip-tools" aria-label="原型比选工具">
              <div className="hip-switcher">
                <Button aria-label="上一方案" onClick={() => cycleVariant(-1)}>
                  <Sym name="back" />
                </Button>
                <span>
                  <small>原型</small>
                  {variant} · {NAMES[variant]}
                </span>
                <Button aria-label="下一方案" onClick={() => cycleVariant(1)}>
                  <span className="hip-forward">
                    <Sym name="back" />
                  </span>
                </Button>
              </div>
              <Button
                className="hip-scene"
                title="依次切换三将、单将、长技能、空态、他人只读、非己回合、一人可学、多人可学"
                onClick={() => changeScene(SCENES[(SCENES.indexOf(scene) + 1) % SCENES.length]!)}
              >
                场景：{SCENE_NAMES[scene]}
              </Button>
              <Button
                className="hip-learn"
                disabled={readOnly || scene === "offturn" || learnerCount === 0 || bookSpent}
                onClick={() =>
                  learnerCount === 1 ? learn(learners[0]!.heroId) : setLearnOpen(true)
                }
              >
                {bookSpent ? "技能书已用" : `演练学技 · ${learnerCount}`}
              </Button>
              <Button onClick={() => changeScene(scene)}>重置</Button>
              <span className="hip-note" role="status">
                {note}
              </span>
            </aside>
          )
        }
        onClose={onClose}
      >
        {roster.length === 0 ? (
          <div className="hip-empty">
            <SealEmpty char="将" note="虚位以待" title="暂无名将" />
          </div>
        ) : variant === "A" ? (
          <VariantA {...props} />
        ) : variant === "B" ? (
          <VariantB {...props} />
        ) : (
          <VariantC {...props} />
        )}
      </PileShell>
      {learnOpen && (
        <SkillBookLearnModal
          bookName="技能书·岁俸"
          skillId={BOOK_SKILL}
          learners={learners}
          onPick={learn}
          onClose={() => setLearnOpen(false)}
        />
      )}
    </>
  );
}
