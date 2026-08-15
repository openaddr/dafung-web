// 胜利全屏:对照旧 createVictory —— 天下归一大字(金辉呼吸+弹跳入场)+ 国号称帝 +
// 终局信息 + 再战按钮 + 烟花粒子(React 状态驱动,粒子动画用 scroll.css keyframe)。
import { useEffect, useState } from "react";
import { rgba, playerColor } from "@core/theme";
import { ScrollButton } from "./ScrollShell";
import { SCROLL_TESTIDS as T } from "./testids";

export interface VictoryScreenProps {
  /** 胜者国号(单字大展示)。 */
  guohao: string;
  /** 胜者颜色索引(国号称帝行的着色)。 */
  colorIndex: number;
  /** 终局身价(已格式化或原始值皆可,这里收数字自己格式化口径由主线定 → 收字符串最稳)。 */
  finalNetWorthLabel: string;
  /** 用时(回合数)。 */
  turnNumber: number;
  winReason: "LastStanding" | "NetWorth" | string;
  onRestart: () => void;
}

// 旧版烟花配色
const FW_COLORS = ["#d4af37", "#b23a2e", "#4a7a4a", "#2980b9", "#c47a2a", "#fff"];

interface Particle {
  key: string;
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  color: string;
  dur: number;
}

/** 一波烟花:围绕随机圆心生成 16~26 个粒子(对照旧 spawnFireworkBurst)。 */
function spawnBurst(keyPrefix: number): Particle[] {
  const cx = 200 + Math.random() * 400;
  const cy = 150 + Math.random() * 250;
  const count = 16 + Math.floor(Math.random() * 10);
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const dist = 60 + Math.random() * 80;
    out.push({
      key: `${keyPrefix}-${i}`,
      cx,
      cy,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      color: FW_COLORS[Math.floor(Math.random() * FW_COLORS.length)],
      dur: 1.2 + Math.random() * 0.6,
    });
  }
  return out;
}

export function VictoryScreen({
  guohao,
  colorIndex,
  finalNetWorthLabel,
  turnNumber,
  winReason,
  onRestart,
}: VictoryScreenProps) {
  // 烟花粒子队列:定时放波,2 秒后清(与旧版 setTimeout remove 等价)。
  // 相比旧版只放 5 波,这里循环放——庆祝屏停留时间由玩家决定,不烟花会冷场。
  const [particles, setParticles] = useState<Particle[]>([]);
  useEffect(() => {
    let wave = 0;
    const spawner = window.setInterval(() => {
      const burst = spawnBurst(wave++);
      setParticles((prev) => [...prev.slice(-260), ...burst]); // 上限裁剪防 DOM 无限膨胀
      window.setTimeout(() => {
        setParticles((prev) => prev.filter((p) => !burst.includes(p)));
      }, 2000);
    }, 700);
    return () => window.clearInterval(spawner);
  }, []);

  return (
    <div
      data-testid={T.victoryScreen}
      className="victory-anim-overlay absolute inset-0 z-40 flex flex-col items-center justify-center bg-[radial-gradient(circle,rgba(40,30,10,0.75),rgba(20,15,5,0.92))]"
    >
      {particles.map((p) => (
        <span
          key={p.key}
          className="firework-particle"
          style={{
            left: `${p.cx}px`,
            top: `${p.cy}px`,
            background: p.color,
            ["--dx" as string]: `${p.dx}px`,
            ["--dy" as string]: `${p.dy}px`,
            ["--fw-dur" as string]: `${p.dur}s`,
          }}
        />
      ))}
      <h1
        data-testid={T.victoryTitle}
        className="victory-anim-title m-0 font-brush text-[80px] tracking-[20px] text-gold-bright"
      >
        天下归一
      </h1>
      <div
        data-testid={T.victorySub}
        className="mt-2.5 font-brush text-[34px] tracking-[6px] text-white"
        style={{ color: rgba(playerColor(colorIndex)) }}
      >
        「{guohao}」称帝
      </div>
      <div data-testid={T.victoryInfo} className="mt-4 text-base text-[rgba(255,240,200,0.85)]">
        终局身价 {finalNetWorthLabel} · 用时 {turnNumber} 回合 ·{" "}
        {winReason === "LastStanding" ? "群雄尽灭" : "富甲天下"}
      </div>
      <div className="mt-6">
        <ScrollButton primary testid={T.victoryRestart} onClick={onRestart}>
          再战一局
        </ScrollButton>
      </div>
    </div>
  );
}
