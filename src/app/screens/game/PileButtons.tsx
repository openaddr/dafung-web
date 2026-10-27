// 右下三圆钮(#700 全浮层骨架,原型 tmp/席位侧列原型.html ①gembtns 判决移植):
// 锦囊 / 珍宝 / 名将,44px 圆 + 朱砂计数角标(名将含上限 x/3,HERO_CAPACITY)。
// 锦囊钮 = 手牌区显隐开关(亮=显示,.on 金描边亮态;收起时战斗区最大化)——开关
// 状态对局内记忆、重进恢复(localStorage,GameScreen 持账本,本件只呈现与回传);
// 出牌阶段/反应窗等窗态下手牌区被强制显示(GameScreen 口径),钮亮随有效显隐走。
// 珍宝/名将钮 = 藏品弹层入口(#361 牌架双入口的接替者:点谁开谁的层,PileModal
// 壳与陈列原样)——计数单源快照,与牌架旧入口同一读数。
// 观战(未入座)不渲染整列:三钮全部以「自己的」藏品/手牌为对象,观战无座即无对象。
import { useState } from "react";
import { HERO_CAPACITY } from "@core/constants";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { PileModal, type PileModalKind } from "./PileModal";
import { TESTIDS } from "./testids";
import "./layout.css";

export interface PileButtonsProps {
  /** 本地视角玩家(null = 观战/未入座,整列不渲染)。 */
  player: SnapshotPlayer | null;
  /** 手牌区当前有效显隐(亮=显示;GameScreen 计算:偏好 ∥ 窗态强制)。 */
  handVisible: boolean;
  /** 锦囊开关回传(GameScreen 写 localStorage 账本)。 */
  onToggleHand: () => void;
}

/** 三圆钮(锦囊开关 + 藏品双入口)。 */
export function PileButtons({ player, handVisible, onToggleHand }: PileButtonsProps) {
  // 藏品弹层开合态(null=全收;一次一层,点钮开、Esc/点外/X 关)——从牌架迁来
  // (#361 双入口退役):收起手牌后藏品弹层必须仍可达,账本随钮不随架。
  const [pileModal, setPileModal] = useState<PileModalKind | null>(null);
  if (!player) return null; // 观战无座,三钮无对象(不是兜底:观战是显式业务态)

  return (
    <>
      <div className="pilebtns" data-testid={TESTIDS.pileButtons}>
        <button
          type="button"
          data-testid={TESTIDS.jinnangToggle}
          aria-label={handVisible ? "收起锦囊手牌" : "显示锦囊手牌"}
          aria-pressed={handVisible}
          onClick={onToggleHand}
          className={"gbtn" + (handVisible ? " on" : "")}
        >
          锦
          <br />囊
        </button>
        <button
          type="button"
          data-testid={TESTIDS.pileTreasures}
          aria-label={`珍宝 ${player.treasures.length}`}
          aria-haspopup="dialog"
          onClick={() => setPileModal("treasures")}
          className="gbtn"
        >
          珍
          <br />宝
          <i className="cnt" aria-hidden="true">
            {player.treasures.length}
          </i>
        </button>
        <button
          type="button"
          data-testid={TESTIDS.pileHeroes}
          aria-label={`名将 ${player.heroes.length}/${HERO_CAPACITY}`}
          aria-haspopup="dialog"
          onClick={() => setPileModal("heroes")}
          className="gbtn"
        >
          名
          <br />将
          <i className="cnt" aria-hidden="true">
            {player.heroes.length}/{HERO_CAPACITY}
          </i>
        </button>
      </div>
      {/* 藏品弹层(#361 接替):壳与陈列归 PileModal,标题随入口 */}
      {pileModal !== null && (
        <PileModal kind={pileModal} player={player} onClose={() => setPileModal(null)} />
      )}
    </>
  );
}
