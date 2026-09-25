// 顶部对局条(#253 三区骨架,原型 .topbar 移植):回合 chip(第 N 轮 + 目标身价)+
// 活跃方名 | 牌库/弃牌计数 + 复位/缩放/静音角钮。状态卡(右栏退役)的回合/活跃方
// 信息由本条承担;筹码数字全部直读引擎快照既有字段,不重算。
// 角钮为既有能力平移(复位 ◎ / 缩放 +− / 静音 ♪),不新增功能;40px 触达(W5)。
// 本件挂在 AudioProvider 内(mute 读 context)。
import { rgba, playerColor } from "@core/theme";
import { formatMoney } from "@core/money";
import type { SnapshotPlayer, GameSnapshot } from "@app/store/gameStore";
import { useAudio } from "@app/fx/AudioProvider";
import { Sym } from "@app/screens/shared/Sym";
import { TESTIDS } from "./testids";
import "./layout.css";

export interface GameTopBarProps {
  snapshot: GameSnapshot;
  /** 本方视角玩家(观战=被跟随者;chip 印章即「我在看谁」)。 */
  self: SnapshotPlayer;
  onResetView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

/** 静音角钮:AudioProvider 内才可读 context,随本件同挂(原 MuteButton 并入)。 */
function MuteSqButton() {
  const audio = useAudio();
  if (!audio) return null;
  return (
    <button
      type="button"
      data-testid={TESTIDS.muteButton}
      title={audio.muted ? "开音" : "静音"}
      // #175:Sym 是 aria-hidden SVG,补 aria-label 对齐可达名口径
      aria-label={audio.muted ? "开音" : "静音"}
      onClick={audio.toggleMuted}
      className="sqbtn"
    >
      {/* S6 符号表:有声 ♪ / 静音 ♪̶(Sym SVG 渲染,离线字体零 tofu) */}
      <Sym name={audio.muted ? "muted" : "sound"} size={15} />
    </button>
  );
}

export function GameTopBar({ snapshot, self, onResetView, onZoomIn, onZoomOut }: GameTopBarProps) {
  const playing = snapshot.phase === "Playing";
  const active = playing ? snapshot.players[snapshot.activeIndex] : null;
  const winner =
    snapshot.phase === "GameOver" && snapshot.winner
      ? snapshot.players.find((p) => p.id === snapshot.winner)
      : null;

  return (
    <div className="topbar" data-testid={TESTIDS.topBar}>
      {/* 回合 chip:本方印 + 第 N 轮 + 目标身价(经济 v2:目标=300 两) */}
      <span className="chip">
        <span className="seal-s" style={{ background: rgba(playerColor(self.colorIndex)) }}>
          {self.guohao.charAt(0)}
        </span>
        <span className="t" data-testid={TESTIDS.topbarRound}>
          第 {snapshot.round} 轮
        </span>
        <span className="d" data-testid={TESTIDS.topbarTarget}>
          目标 {formatMoney(snapshot.targetNetWorth)}
        </span>
      </span>
      {/* 活跃方 chip:对局中=「X之回合」;终局=「「X」称帝」(原状态卡两分支收编;
          14px 档与称帝金字收口 layout.css 的 .t-active/.t-win,评审去重撤内联字号) */}
      {active && (
        <span className="chip">
          <span className="t t-active" data-testid={TESTIDS.topbarActive}>
            {active.guohao}之回合
          </span>
        </span>
      )}
      {winner && (
        <span className="chip">
          <span className="t t-win" data-testid={TESTIDS.topbarActive}>
            「{winner.guohao}」称帝
          </span>
        </span>
      )}
      <span className="sp" />
      <div className="misc">
        {/* 锦囊牌库/弃牌计数(#122 公开信息:deckCount 引擎态,弃牌堆内容本就明置) */}
        <span className="chip">
          牌库 <b data-testid={TESTIDS.topbarDeck}>{snapshot.jinnangDeckCount}</b>
        </span>
        <span className="chip">
          弃牌 <b data-testid={TESTIDS.topbarDiscard}>{snapshot.jinnangDiscard.length}</b>
        </span>
        {/* 总览复位 / 缩放(既有能力平移;#98 缩放显式入口保留) */}
        <button
          type="button"
          data-testid={TESTIDS.resetView}
          title="总览复位"
          aria-label="总览复位"
          onClick={onResetView}
          className="sqbtn"
        >
          <Sym name="reset" size={15} />
        </button>
        <button
          type="button"
          title="放大棋盘"
          aria-label="放大棋盘"
          onClick={onZoomIn}
          className="sqbtn"
        >
          +
        </button>
        <button
          type="button"
          title="缩小棋盘"
          aria-label="缩小棋盘"
          onClick={onZoomOut}
          className="sqbtn"
        >
          −
        </button>
        <MuteSqButton />
      </div>
    </div>
  );
}
