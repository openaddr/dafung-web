// 组件收口:人物卷复用 PileShell→ui/dialog,画像签/遣散走 Base UI Button,
// 正文内滚走 ui/scroll-area;自己与只读入口共用同一呈现(#1446)。
import { useState } from "react";
import { Button } from "@base-ui/react/button";
import { Lihui } from "@app/components/card/HeroCardFace";
import { ScrollArea } from "@app/components/ui/scroll-area";
import { SealEmpty } from "@app/screens/shared/ArtifactEmpty";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { heroById } from "@core/heroes";
import { isActiveSkill, skillById } from "@core/skills";
import { PileShell } from "./PileModal";
import { TESTIDS } from "./testids";
import "./hero-inspection.css";

interface HeroInspectionModalProps {
  player: SnapshotPlayer;
  testid: string;
  dismissReady?: boolean;
  onDismiss?: (heroId: string) => void;
  onClose: () => void;
}

function Portrait({ heroId }: { heroId: string }) {
  const hero = heroById(heroId);
  return (
    <div className="hero-inspection-portrait">
      <Lihui key={heroId} src={hero.image} name={hero.name} />
    </div>
  );
}

/** 身份键只管会话选择;槽位与技能每拍直接读当前名册,不缓存 HeroSlot。 */
function HeroInspection({
  player,
  testid,
  dismissReady = false,
  onDismiss,
  onClose,
}: HeroInspectionModalProps) {
  const rosterKey = player.heroes.map((slot) => slot.heroId).join("|");
  const [stored, setStored] = useState(() => ({
    rosterKey,
    dismissReady,
    selectedId: player.heroes.length === 0 ? null : player.heroes[0]!.heroId,
    armedId: null as string | null,
  }));
  let selection = stored;
  if (stored.rosterKey !== rosterKey || stored.dismissReady !== dismissReady) {
    // 成员消失/名册清空是正常业务变化:仍在麾下则保留选择,否则选当前首将。
    // 任何成员/顺序/操作窗口变化都解除确认,不让旧确认作用于新名册。
    selection = {
      rosterKey,
      dismissReady,
      selectedId: player.heroes.some((slot) => slot.heroId === stored.selectedId)
        ? stored.selectedId
        : player.heroes.length === 0
          ? null
          : player.heroes[0]!.heroId,
      armedId: null,
    };
    setStored(selection);
  }
  const current =
    player.heroes.length === 0
      ? null
      : player.heroes.find((slot) => slot.heroId === selection.selectedId)!;
  const armed = current !== null && selection.armedId === current.heroId;
  return (
    <PileShell
      title="名将"
      seal="将"
      sub={`${player.guohao} · 麾下名将 · ${player.heroes.length} 席`}
      testid={testid}
      ariaLabel={`名将 · ${player.guohao}`}
      className="hero-inspection"
      onClose={onClose}
    >
      {current === null ? (
        <div className="hero-inspection-empty">
          <SealEmpty char="将" note="虚位以待" title="暂无名将" />
        </div>
      ) : (
        <div className="hero-inspection-volume">
          <ScrollArea className="hero-inspection-tabs" data-testid={TESTIDS.heroInspectionRoster}>
            <nav aria-label="切换名将">
              {player.heroes.map((slot) => (
                <Button
                  key={slot.heroId}
                  className="hero-inspection-tab"
                  data-testid={TESTIDS.heroInspectionSelect(slot.heroId)}
                  aria-label={`查看${heroById(slot.heroId).name}`}
                  aria-pressed={slot.heroId === current.heroId}
                  onClick={() =>
                    setStored({ ...selection, selectedId: slot.heroId, armedId: null })
                  }
                >
                  <Portrait heroId={slot.heroId} />
                  <span>{heroById(slot.heroId).name}</span>
                </Button>
              ))}
            </nav>
          </ScrollArea>
          <div className="hero-inspection-person" data-testid={TESTIDS.heroInspectionPortrait}>
            <Portrait heroId={current.heroId} />
            <h2 data-testid={TESTIDS.heroInspectionName}>{heroById(current.heroId).name}</h2>
          </div>
          <div className="hero-inspection-copy">
            <ScrollArea
              key={current.heroId}
              className="hero-inspection-reading"
              data-testid={TESTIDS.heroInspectionSkills}
              aria-label={`${heroById(current.heroId).name}实授技能`}
            >
              {current.skillIds.map(skillById).map((skill) => (
                <section
                  className="hero-inspection-skill"
                  key={skill.id}
                  data-testid={TESTIDS.heroInspectionSkill(skill.id)}
                >
                  <div className="hero-inspection-skill-head">
                    <i className={isActiveSkill(skill) ? "is-active" : ""} aria-hidden="true" />
                    <h3>{skill.name}</h3>
                    {isActiveSkill(skill) && <span>冷却 {skill.cooldown} 轮</span>}
                  </div>
                  <p>{skill.desc}</p>
                </section>
              ))}
            </ScrollArea>
            {onDismiss !== undefined && (
              <div className="hero-inspection-actions" data-testid={TESTIDS.heroInspectionActions}>
                <Button
                  data-testid={TESTIDS.heroDismiss(current.heroId)}
                  className={"hero-inspection-dismiss" + (armed ? " armed" : "")}
                  disabled={!dismissReady}
                  title={!dismissReady ? "己方回合可遣散" : armed ? undefined : "再点一次确认"}
                  aria-label={`${armed ? "确认遣散" : "遣散"}${heroById(current.heroId).name}`}
                  onClick={() => {
                    if (armed) {
                      setStored({ ...selection, armedId: null });
                      onDismiss(current.heroId);
                    } else {
                      setStored({ ...selection, armedId: current.heroId });
                    }
                  }}
                >
                  {armed ? "确认遣散" : "遣散"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </PileShell>
  );
}

/** 屏前玩家切换时重开会话,不带入上一人的选择与确认。 */
export function HeroInspectionModal(props: HeroInspectionModalProps) {
  return <HeroInspection key={props.player.id} {...props} />;
}
