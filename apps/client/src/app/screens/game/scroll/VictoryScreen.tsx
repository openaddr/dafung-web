// 组件收口:全屏终局沿用 DialogFocusScope 与 BannerButton。
import { memo, useEffect, useState } from "react";
import type { VictoryReason } from "@dafung/core/engine/authority";
import type { Board } from "@dafung/core/engine/board";
import type { MapCatalog } from "@dafung/core/engine/board-loader";
import { heroById } from "@dafung/core/engine/heroes";
import { formatMoney } from "@dafung/core/engine/money";
import { rgba, playerColor } from "@dafung/core/engine/theme";
import { Lihui } from "@app/components/card/HeroCardFace";
import { getAudio } from "@app/fx/audio";
import { finishPresentation } from "@app/fx/orchestrator";
import { UI } from "@app/fx/timings";
import { usePrefersReducedMotion } from "@app/hooks/use-media-query";
import { DialogFocusScope } from "@app/screens/shared/DialogFocusScope";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { TileThumb } from "../TileThumb";
import { BannerButton } from "./BannerShell";
import { SCROLL_TESTIDS as T } from "./testids";
import "./victory.css";

type VictoryResult = {
  winReason: Exclude<VictoryReason, "None" | "aborted">;
  winner: SnapshotPlayer;
  players: SnapshotPlayer[];
  round: number;
  context: { board: Board; catalog: MapCatalog };
};

type VictoryScreenProps = (VictoryResult | { winReason: "aborted" }) & {
  onRestart: () => void;
};

// 烟花配色(S3/S4 收编):主体五色引用 tokens.css 的 var(--color-*),单源 core/theme.ts;
// 剩两色是"烟花表现专用色"(亮蓝闪点/纯白高光),不入 theme.ts 以免污染语义色板,集中在此注释。
const FW_COLORS = [
  "var(--color-gold-bright)", // 金
  "var(--color-danger)", // 朱砂
  "var(--color-money)", // 青绿
  "var(--color-road-side)", // 赭橙
  "#2980b9", // 亮蓝闪点:仅烟花使用,非语义色
  "#fff", // 纯白高光:仅烟花使用,非语义色
];

/** E3 烟花尺度基准宽:以 1280px 视口为 1.0,大屏放大/小屏缩到 0.7~1.8。 */
const FW_BASE_VW = 1280;
const FW_SCALE_MIN = 0.7;
const FW_SCALE_MAX = 1.8;

interface Particle {
  key: string;
  /** 圆心:容器百分比(S4 自适应,不再用 200-600px magic number)。 */
  cxPct: number;
  cyPct: number;
  dx: number;
  dy: number;
  color: string;
  dur: number;
  /** #837:是否本波「大雨滴」主星(12px 金色大粒,挂 .firework-particle-main)。
   *  必填——逐粒构造点显式给值,不留可选字段让「漏传静默回落普通粒」漂过。 */
  main: boolean;
}

/** 一波烟花:围绕随机圆心生成 28~40 个粒子(#837 终局亮化:旧 16~26 粒+4px 在飞
 *  只见微尘,提密度提粒径才撑得起终局「哇」时刻)。3% 概率额外一枚「大雨滴」主星:
 *  12px 金色,自圆心小幅横漂+下坠(重物坠落收势),时长略长于本波碎星压轴。
 *  圆心用容器百分比(水平 15%-85%、垂直 12%-60%),任意窗口尺寸都不贴边/不挤中。
 *  E3:飞散距离(60-140px 基准)与时长按视口宽缩放——大屏不再显小,小屏不再爆开。
 *  返回本波粒子与最长滞留时长(ms,供清理定时器跟随缩放,不提前掐灭)。 */
function spawnBurst(keyPrefix: number): { burst: Particle[]; lingerMs: number } {
  const cxPct = 15 + Math.random() * 70;
  const cyPct = 12 + Math.random() * 48;
  const count = 28 + Math.floor(Math.random() * 13);
  const scale = Math.min(FW_SCALE_MAX, Math.max(FW_SCALE_MIN, window.innerWidth / FW_BASE_VW));
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const dist = (60 + Math.random() * 80) * scale;
    out.push({
      key: `${keyPrefix}-${i}`,
      cxPct,
      cyPct,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      color: FW_COLORS[Math.floor(Math.random() * FW_COLORS.length)],
      dur: (1.2 + Math.random() * 0.6) * Math.sqrt(scale),
      main: false,
    });
  }
  if (Math.random() < 0.03) {
    out.push({
      key: `${keyPrefix}-main`,
      cxPct,
      cyPct,
      dx: (Math.random() * 24 - 12) * scale,
      dy: (30 + Math.random() * 40) * scale,
      color: "var(--color-gold-bright)",
      dur: (1.5 + Math.random() * 0.4) * Math.sqrt(scale),
      main: true,
    });
  }
  // 最长 dur(碎星上限 1.8、主星上限 1.9 × sqrt(scale))取本波实测最大,粒子飞完
  // 再清,留 200ms 余量——清理定时器跟着本波真实组成走,主星在场不被提前掐灭。
  const lingerMs = Math.max(...out.map((p) => p.dur)) * 1000 + 200;
  return { burst: out, lingerMs };
}

/** 粒子自持到期清理，切换减少动态效果时整层卸载。 */
function VictoryFireworks() {
  const [particles, setParticles] = useState<Particle[]>([]);
  useEffect(() => {
    let wave = 0;
    const removals = new Set<number>();
    const spawner = window.setInterval(() => {
      const { burst, lingerMs } = spawnBurst(wave++);
      setParticles((prev) => [...prev.slice(-260), ...burst]);
      const removal = window.setTimeout(() => {
        removals.delete(removal);
        setParticles((prev) => prev.filter((particle) => !burst.includes(particle)));
      }, lingerMs);
      removals.add(removal);
    }, 1000);
    return () => {
      window.clearInterval(spawner);
      for (const removal of removals) window.clearTimeout(removal);
    };
  }, []);

  return (
    <div className="victory-fireworks" aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.key}
          className={p.main ? "firework-particle firework-particle-main" : "firework-particle"}
          style={{
            left: `${p.cxPct}%`,
            top: `${p.cyPct}%`,
            background: p.color,
            color: p.color,
            ["--dx" as string]: `${p.dx}px`,
            ["--dy" as string]: `${p.dy}px`,
            ["--fw-dur" as string]: `${p.dur}s`,
          }}
        />
      ))}
    </div>
  );
}

function VictoryCapital({
  winner,
  players,
  context,
}: Pick<VictoryResult, "winner" | "players" | "context">) {
  const { capitalIndex } = winner;
  // 极端自定义图可在选都时轮空。-1 是未立都城，不能交给环形地图取模。
  if (capitalIndex === -1) return <p className="victory-capital">未立都城</p>;
  const { board, catalog } = context;
  if (capitalIndex < 0 || capitalIndex >= board.count) {
    throw new Error(`终局都城索引无效 ${capitalIndex}`);
  }
  const tile = board.at(capitalIndex);
  const def = catalog.get(tile.propertyId);
  if (def === null) throw new Error(`终局都城 ${tile.propertyId} 不在城表`);
  return (
    <figure className="victory-capital">
      <TileThumb tile={tile} def={def} tileIndex={capitalIndex} players={players} />
      <figcaption>都城 {tile.name}</figcaption>
    </figure>
  );
}

function VictoryStandings({ players, winner }: Pick<VictoryResult, "players" | "winner">) {
  const standings = [...players].sort(
    (a, b) => b.netWorth - a.netWorth || Number(b.id === winner.id) - Number(a.id === winner.id),
  );
  return (
    <section className="victory-standings" aria-label="终榜" data-testid={T.victoryStandings}>
      <header className="victory-standings-head">
        <h2>终榜</h2>
        <span>身价</span>
      </header>
      <ol className="victory-ranks" role="list">
        {standings.map((seat, rank) => (
          <li
            key={seat.id}
            className={seat.id === winner.id ? "victory-rank is-winner" : "victory-rank"}
          >
            <span className="victory-rank-order" aria-hidden="true">
              {rank + 1}
            </span>
            <span className="victory-rank-name">
              <i
                aria-hidden="true"
                style={{ backgroundColor: rgba(playerColor(seat.colorIndex)) }}
              />
              {seat.id === winner.id && <span className="sr-only">胜者 </span>}
              {seat.guohao}
            </span>
            {seat.isBankrupt && <span className="victory-rank-bankrupt">破产</span>}
            <span className="victory-rank-money">{formatMoney(seat.netWorth)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** players 由路由层值等稳定，终局封场后无关交互拍不会重建画卷。 */
export const VictoryScreen = memo(function VictoryScreen(props: VictoryScreenProps) {
  const aborted = props.winReason === "aborted";
  const reducedMotion = usePrefersReducedMotion();
  const revealImmediately = !aborted && reducedMotion;
  const [actionsReady, setActionsReady] = useState(false);
  const showActions = actionsReady || revealImmediately;
  useEffect(() => {
    if (actionsReady) return;
    if (revealImmediately) {
      // 一旦亮出，恢复动态效果也不撤回终榜或已聚焦的再战。
      setActionsReady(true);
      return;
    }
    const delay = aborted ? UI.abortedRestartMs : UI.victoryStandingsMs;
    const timer = window.setTimeout(() => setActionsReady(true), delay);
    return () => window.clearTimeout(timer);
  }, [aborted, revealImmediately, actionsReady]);
  useEffect(() => {
    finishPresentation();
    if (aborted) return;
    // 鼓点起势、朱印落定时鸣锣、号角接棒。系统动效偏好变化不重放音组。
    const audio = getAudio();
    audio.play("victoryDrum");
    const stampT = window.setTimeout(() => audio.play("stamp"), 450);
    const fanfareT = window.setTimeout(() => audio.play("victory"), 700);
    return () => {
      window.clearTimeout(stampT);
      window.clearTimeout(fanfareT);
    };
  }, [aborted]);

  if (props.winReason === "aborted") {
    return (
      <DialogFocusScope asChild>
        <div
          data-testid={T.victoryScreen}
          role="dialog"
          aria-modal="true"
          aria-label="终局"
          className="victory-anim-overlay fixed inset-0 z-40 flex flex-col items-center justify-center"
        >
          <h1
            data-testid={T.victoryAbortedTitle}
            className="victory-step m-0 font-title text-danger"
            style={{
              fontSize: "clamp(40px, 11vw, 80px)",
              letterSpacing: "clamp(6px, 2.5vw, 20px)",
            }}
          >
            对局作废
          </h1>
          <div
            data-testid={T.victoryAbortedNote}
            className="victory-step victory-step-info mt-4 text-base"
            style={{ color: "rgba(255, 240, 200, 0.85)" }}
          >
            内部错误导致对局终止,详情见对局日志
          </div>
          <div className="victory-step-btn mt-6">
            {showActions && (
              <BannerButton primary testid={T.victoryRestart} onClick={props.onRestart}>
                再战一局
              </BannerButton>
            )}
          </div>
        </div>
      </DialogFocusScope>
    );
  }

  const { winner, players, round, winReason, onRestart } = props;
  const heroes = winner.heroes.map(({ heroId }) => heroById(heroId));
  return (
    <DialogFocusScope asChild>
      <div
        data-testid={T.victoryScreen}
        role="dialog"
        aria-modal="true"
        aria-label="终局"
        className="victory-anim-overlay fixed inset-0 z-40"
      >
        {!reducedMotion && <VictoryFireworks />}
        <div className="victory-layout">
          <div className="victory-body">
            <section className="victory-scroll">
              <div className={heroes.length === 0 ? "victory-art" : "victory-art has-heroes"}>
                <header className="victory-identity">
                  <h1
                    data-testid={T.victoryTitle}
                    data-text="天下归一"
                    aria-label="天下归一"
                    className="victory-anim-title font-title"
                  >
                    天下归一
                  </h1>
                  <div className="victory-emperor">
                    <p
                      data-testid={T.victorySub}
                      className="victory-step victory-step-sub font-brush"
                      style={{ color: rgba(playerColor(winner.colorIndex)) }}
                    >
                      {winner.guohao}称帝
                    </p>
                    <span className="victory-stamp-seal font-title" aria-hidden="true">
                      {Array.from(winner.guohao)[0]}
                    </span>
                  </div>
                </header>
                <VictoryCapital winner={winner} players={players} context={props.context} />
                {heroes.length > 0 && (
                  <div className="victory-heroes victory-step victory-step-sub">
                    {heroes.map((hero) => (
                      <figure key={hero.id} className="victory-hero">
                        <Lihui src={hero.image} name={hero.name} />
                        <figcaption>{hero.name}</figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </div>
              <div
                data-testid={T.victoryInfo}
                className="victory-facts victory-step victory-step-info"
              >
                <p>
                  终局身价 <span>{formatMoney(winner.netWorth)}</span>
                </p>
                <span>{winReason === "LastStanding" ? "群雄尽灭" : "富甲天下"}</span>
                <span>第 {round} 轮</span>
              </div>
            </section>
            {showActions && <VictoryStandings players={players} winner={winner} />}
          </div>
          <footer className="victory-restart">
            {showActions && (
              <BannerButton primary testid={T.victoryRestart} onClick={onRestart}>
                再战一局
              </BannerButton>
            )}
          </footer>
        </div>
      </div>
    </DialogFocusScope>
  );
});
