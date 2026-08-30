// 胜利全屏:对照旧 createVictory —— 天下归一大字(金辉呼吸+弹跳入场)+ 国号称帝 +
// 终局信息 + 再战按钮 + 烟花粒子(React 状态驱动,粒子动画用 scroll.css keyframe)。
// E1/E2:入场演出有声有叙——banner 鼓点起势 + 大字落定时 stamp 锣声重音 + victory 号角,
// 与视觉阶梯(0/300/600ms)对齐;再战按钮 1800ms 后才挂载防误触。
import { useEffect, useState } from "react";
import type { VictoryReason } from "@core/types";
import { rgba, playerColor } from "@core/theme";
import { getAudio } from "@app/fx/audio";
import { finishDiceOverlay } from "@app/fx/ThreeDice";
import { ScrollButton } from "./ScrollShell";
import { SCROLL_TESTIDS as T } from "./testids";
import "./victory.css";

/** E4(#16):终榜一行条目(身价降序;破产者带标注)。数据由 DecisionScrollLayer 从快照算好传入。 */
export interface VictoryStanding {
  guohao: string;
  colorIndex: number;
  netWorthLabel: string;
  bankrupt: boolean;
}

export interface VictoryScreenProps {
  /** 胜者国号(单字大展示)。 */
  guohao: string;
  /** 胜者颜色索引(国号称帝行的着色)。 */
  colorIndex: number;
  /** 终局身价(已格式化或原始值皆可,这里收数字自己格式化口径由主线定 → 收字符串最稳)。 */
  finalNetWorthLabel: string;
  /** 用时(回合数)。 */
  turnNumber: number;
  /** E4(#16):胜因透传引擎 VictoryReason 快照真值(No 长度硬编码"NetWorth"——引擎值为 TargetNetWorth)。 */
  winReason: VictoryReason;
  /** E4(#16):终榜(身价降序 + 破产标注),victory-step 第 4 拍。 */
  standings: VictoryStanding[];
  onRestart: () => void;
  /** ADR-0014:导出对局日志(该局完整 jsonl 落文件,复盘/重放用);不传则不渲染该按钮。 */
  onExportLog?: () => void;
}

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

// 信息文字色:庆祝屏专属氛围色(暗金墨晕),不进 theme 语义色板,集中常量。
// 底色(含 A6 千里江山图山水带的多层背景)统一在 victory.css 的 .victory-anim-overlay。
const INFO_TEXT = "rgba(255, 240, 200, 0.85)";

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
}

/** 一波烟花:围绕随机圆心生成 16~26 个粒子(对照旧 spawnFireworkBurst)。
 *  圆心用容器百分比(水平 15%-85%、垂直 12%-60%),任意窗口尺寸都不贴边/不挤中。
 *  E3:飞散距离(60-140px 基准)与时长按视口宽缩放——大屏不再显小,小屏不再爆开。
 *  返回本波粒子与最长滞留时长(ms,供清理定时器跟随缩放,不提前掐灭)。 */
function spawnBurst(keyPrefix: number): { burst: Particle[]; lingerMs: number } {
  const cxPct = 15 + Math.random() * 70;
  const cyPct = 12 + Math.random() * 48;
  const count = 16 + Math.floor(Math.random() * 10);
  const scale = Math.min(
    FW_SCALE_MAX,
    Math.max(FW_SCALE_MIN, window.innerWidth / FW_BASE_VW),
  );
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
    });
  }
  // 最长 dur = 1.8 × sqrt(scale),粒子飞完再清,留 200ms 余量。
  return { burst: out, lingerMs: 1.8 * Math.sqrt(scale) * 1000 + 200 };
}

export function VictoryScreen({
  guohao,
  colorIndex,
  finalNetWorthLabel,
  turnNumber,
  winReason,
  standings,
  onRestart,
  onExportLog,
}: VictoryScreenProps) {
  // 烟花粒子队列:定时放波,2 秒后清(与旧版 setTimeout remove 等价)。
  // 相比旧版只放 5 波,这里循环放——庆祝屏停留时间由玩家决定,不烟花会冷场。
  const [particles, setParticles] = useState<Particle[]>([]);
  // E2:再战按钮延后挂载(防演出高潮期误触重开)。
  const [showButton, setShowButton] = useState(false);
  useEffect(() => {
    // D2:终局瞬间切屏可能赶在骰子 holdMs 隐藏定时器之前,先清残留 overlay(z-45 压屏)。
    finishDiceOverlay();
    // E1:入场音组——0ms 鼓点起势(banner),450ms 大字落定配锣声重音(stamp),
    // 700ms 号角(victory)接棒,与下方视觉阶梯 0/300/600ms 同一节奏轨道。
    const audio = getAudio();
    audio.play("banner");
    const stampT = window.setTimeout(() => audio.play("stamp"), 450);
    const fanfareT = window.setTimeout(() => audio.play("victory"), 700);
    const buttonT = window.setTimeout(() => setShowButton(true), 1800);
    let wave = 0;
    // E3:波间隔 700→1000ms(原节奏在大屏上密度过高,观感吵)。
    const spawner = window.setInterval(() => {
      const { burst, lingerMs } = spawnBurst(wave++);
      setParticles((prev) => [...prev.slice(-260), ...burst]); // 上限裁剪防 DOM 无限膨胀
      window.setTimeout(() => {
        setParticles((prev) => prev.filter((p) => !burst.includes(p)));
      }, lingerMs);
    }, 1000);
    return () => {
      window.clearTimeout(stampT);
      window.clearTimeout(fanfareT);
      window.clearTimeout(buttonT);
      window.clearInterval(spawner);
    };
  }, []);

  return (
    <div
      data-testid={T.victoryScreen}
      className="victory-anim-overlay absolute inset-0 z-40 flex flex-col items-center justify-center"
    >
      {particles.map((p) => (
        <span
          key={p.key}
          className="firework-particle"
          style={{
            left: `${p.cxPct}%`,
            top: `${p.cyPct}%`,
            background: p.color,
            ["--dx" as string]: `${p.dx}px`,
            ["--dy" as string]: `${p.dy}px`,
            ["--fw-dur" as string]: `${p.dur}s`,
          }}
        />
      ))}
      {/* E4(#16):窄屏标题 clamp——80px/20px 字距在窄屏溢出,按视口宽缩放(下限保证单行可读) */}
      <h1
        data-testid={T.victoryTitle}
        className="victory-anim-title m-0 font-brush text-gold-bright"
        style={{ fontSize: "clamp(40px, 11vw, 80px)", letterSpacing: "clamp(6px, 2.5vw, 20px)" }}
      >
        天下归一
      </h1>
      <div
        data-testid={T.victorySub}
        className="victory-step victory-step-sub mt-2.5 font-brush text-[34px] tracking-[6px] text-white"
        style={{ color: rgba(playerColor(colorIndex)) }}
      >
        「{guohao}」称帝
      </div>
      <div
        data-testid={T.victoryInfo}
        className="victory-step victory-step-info mt-4 text-base"
        style={{ color: INFO_TEXT }}
      >
        终局身价 {finalNetWorthLabel} · 用时 {turnNumber} 回合 ·{" "}
        {winReason === "LastStanding" ? "群雄尽灭" : "富甲天下"}
      </div>
      {/* E4(#16):终榜一行(身价降序 + 破产标注),第 4 拍入场 */}
      <div
        data-testid={T.victoryStandings}
        className="victory-step victory-step-standings mt-2 flex max-w-[92vw] flex-wrap items-baseline justify-center gap-x-3 font-deco text-sm"
        style={{ color: INFO_TEXT }}
      >
        <span className="text-ink-dim">终榜</span>
        {standings.map((s, i) => (
          <span key={`${s.guohao}-${i}`} className="whitespace-nowrap">
            <span style={{ color: rgba(playerColor(s.colorIndex)) }}>{s.guohao}</span>{" "}
            {s.netWorthLabel}
            {s.bankrupt && <span className="text-danger">(破)</span>}
          </span>
        ))}
      </div>
      <div className="victory-step-btn mt-6">
        {showButton && (
          /* ADR-0014:对局日志终局在此一键导出(完整 jsonl,复盘/重放用);
             与「再战一局」同挂 showButton 延时,防演出高潮期误触。 */
          <div className="flex items-center justify-center gap-3">
            <ScrollButton primary testid={T.victoryRestart} onClick={onRestart}>
              再战一局
            </ScrollButton>
            {onExportLog && (
              <ScrollButton testid={T.logExport} onClick={onExportLog}>
                导出日志
              </ScrollButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
