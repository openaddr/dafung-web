// 右下三圆钮(#700 全浮层骨架,原型 tmp/席位侧列原型.html ①gembtns 判决移植):
// 锦囊 / 珍宝 / 名将,44px 圆 + 朱砂计数角标(名将含上限 x/3,HERO_CAPACITY;
// 零值角标隐藏 #743 G——0 挂警示色是全程噪声,非零维持现状)。
// 锦囊钮 = 牌架显隐开关(亮=架显示中,.on 金描边亮态;收起时战斗区最大化)——
// #1006 立会话内临时态(GameScreen 持 rackHidden,不落盘;2026-11-07 改「回合
// 联动+决策保底」:规则沿自动同步,沿间本钮收/开=手动临时态),本件只呈现与
// 回传,钮亮随 rackHidden 走。
// 呼吸金光(#1006):窗态在场且架收起时挂 .breathe——「有活决策被收起来了」
// (墨金系呼吸光晕,节奏同 reaction-banner 危急档 2Hz 脉冲;reduced-motion 退动效
// 留静态金晕);非窗态不呼吸。aria-pressed/aria-label 跟有效显隐(rackVisible)。
// 收起态点「出牌」未选牌(#751 B1 脉冲重定向,#1006):原架牌金圈脉冲的目标在暗处,
// GameScreen 只在架收起时把 playNudge 计数接到本件——变更一次=钮闪一拍(.nudge
// 一次性脉冲,动画完即净);架在场时不接线,架牌脉冲(HandRack usablePulse)照旧。
// 锦囊钮角标(#751 C3,#744 判词:三钮中唯一没有 .cnt 的;收起后新牌入手只剩地图
// 浮字 transient,错过即不可知):非零常驻计数,单源=快照 jinnangHand.length。
// 珍宝/名将钮 = 藏品弹层入口(#361 牌架双入口的接替者:点谁开谁的层,PileModal
// 壳与陈列原样)——计数单源快照,与牌架旧入口同一读数。
import { memo, useState } from "react";
import { HERO_CAPACITY } from "@core/constants";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { usePulseOnce } from "@app/hooks/use-pulse-once";
import { PileModal, type PileModalKind } from "./PileModal";
import { TESTIDS } from "./testids";
import "./layout.css";

interface PileButtonsProps {
  /** 本地视角玩家(对局屏挂载期恒在座)。 */
  player: SnapshotPlayer;
  /** 牌架当前有效显隐(亮=显示;GameScreen 计算:!rackHidden——窗态不再强制)。 */
  rackVisible: boolean;
  /** 呼吸金光(#1006):窗态在场且架收起(GameScreen 计算,本件只挂 class)。 */
  breathe?: boolean;
  /** 收起态「出牌」未选牌的脉冲计数(#751 B1 重定向,#1006):架收起时才由
   *  GameScreen 接线,变更一次=钮闪一拍;架在场时缺省(不闪,架牌脉冲照旧)。 */
  nudgePulse?: number;
  /** 锦囊开关回传(GameScreen 写会话内临时态 rackHidden,不落盘,#1006)。 */
  onToggleRack: () => void;
  /** 用书学技通路(#1146):treasureId+heroId 直落 useBookSkill 命令(GameScreen 包装
   *  dispatchCommand);缺省=珍宝弹层书恒不可点态(无命令通路的挂载语境)。 */
  onUseBook?: (treasureId: string, heroId: string) => void;
  /** 用书可点窗口(#1146):己方出牌阶段卡牌段(GameScreen 计算 junshiUp && !targeting);
   *  缺省=false——书恒陈列不可点。 */
  bookPlayReady?: boolean;
  /** 遣散可点窗口(#1147):己方回合(GameScreen 计算);缺省=false——遣散钮恒禁用态。 */
  dismissReady?: boolean;
  /** 遣散命令通路(#1147,dismissHero 直落):缺省=无通路,遣散钮恒禁用态。 */
  onDismiss?: (heroId: string) => void;
}

/** 三圆钮(锦囊开关 + 藏品双入口)。
 *  重渲口径(#1140 渲染税):player(GameScreenLive 值等复用)+标量 props+
 *  useCallback 回调——演出期三圆钮区不再随每拍 sync 重渲(呼吸金光是 CSS 动画,
 *  不吃重渲)。 */
export const PileButtons = memo(function PileButtons({
  player,
  rackVisible,
  breathe = false,
  nudgePulse,
  onToggleRack,
  onUseBook,
  bookPlayReady = false,
  dismissReady = false,
  onDismiss,
}: PileButtonsProps) {
  // 藏品弹层开合态(null=全收;一次一层,点钮开、Esc/点外/X 关)——从牌架迁来
  // (#361 双入口退役):收起手牌后藏品弹层必须仍可达,账本随钮不随架。
  const [pileModal, setPileModal] = useState<PileModalKind | null>(null);
  // 脉冲重定向闪拍(#1006,#751 B1 族单源 usePulseOnce):计数变更一次=钮闪一拍;
  // 只在架收起时由 GameScreen 接线,首次接线拍只对账不闪(收起动作本身不触发)。
  const nudge = usePulseOnce(nudgePulse);
  // 锦囊计数角标非零显示(#751 C3):0 张不挂(空手是常态非事件;「有牌」才值得常驻)。
  const handCount = player.jinnangHand.length;

  return (
    <>
      <div className="pilebtns" data-testid={TESTIDS.pileButtons}>
        <button
          type="button"
          data-testid={TESTIDS.jinnangToggle}
          aria-label={rackVisible ? "收起锦囊手牌" : "显示锦囊手牌"}
          aria-pressed={rackVisible}
          onClick={onToggleRack}
          className={
            "gbtn" +
            (rackVisible ? " on" : "") +
            (breathe ? " breathe" : "") +
            (nudge ? " nudge" : "")
          }
        >
          锦
          <br />囊
          {handCount > 0 && (
            <i className="cnt" aria-hidden="true">
              {handCount}
            </i>
          )}
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
          {/* 零值角标隐藏(#743 G):0 挂朱砂=警示色零信息常驻,稀释真警示;
              非零维持现状(名将 3/3 满员仍朱砂=「满仓」警示)。 */}
          {player.treasures.length > 0 && (
            <i className="cnt" aria-hidden="true">
              {player.treasures.length}
            </i>
          )}
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
          {player.heroes.length > 0 && (
            <i className="cnt" aria-hidden="true">
              {player.heroes.length}/{HERO_CAPACITY}
            </i>
          )}
        </button>
      </div>
      {/* 藏品弹层(#361 接替):壳与陈列归 PileModal,标题随入口;用书通路(#1146)
          仅对局屏挂载语境传入,书在己方出牌阶段可点;遣散通路(#1147)同语境传入,
          遣散钮在己方回合可点 */}
      {pileModal !== null && (
        <PileModal
          kind={pileModal}
          player={player}
          bookPlayReady={bookPlayReady}
          onUseBook={onUseBook}
          dismissReady={dismissReady}
          onDismiss={onDismiss}
          onClose={() => setPileModal(null)}
        />
      )}
    </>
  );
});
