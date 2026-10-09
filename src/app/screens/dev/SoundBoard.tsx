// 音效试听台(dev 工具,?dev=sound 直达,不进 store 路由):全量 SoundEvent 一行一条,
// 点行出声——音效是唯一无法自动验收的维度,听感裁决归人耳;本页把「进对局等触发点」
// 的验收成本折成一次点击。行集 = Record<SoundEvent,…> 按联合穷尽:加事件漏登记此处
// 编译期红。标注(素材/合成/裁剪)读 audio.ts 导出的运行时表,不另造第二事实源。
// 图标走 Sym 符号表、标题走 font-wenkai(DESIGN §4.3 字体/符号收口)。
import { AudioProvider, useAudio } from "@app/fx/AudioProvider";
import { AUDIO_FILES, FILE_TRIM, getAudio, type SoundEvent } from "@app/fx/audio";
import { Sym } from "@app/screens/shared/Sym";

/** 每个音效事件的试听行:label = 界面名,when = 真实触发时机(听感必须挂在因果上才有意义)。 */
const ROWS: Record<SoundEvent, { label: string; when: string }> = {
  diceRoll: { label: "掷骰", when: "每次掷骰起手(合成沙锤瞬态;旧鼓滚奏 #26 已撤)" },
  diceHit: { label: "骰子碰撞", when: "3D 骰物理撞击(60ms 节流,随冲击强度)" },
  diceLand: { label: "落骰", when: "骰子停定(木叩,播放侧截 0.65s)" },
  marchStart: { label: "行军启动", when: "棋子起步(轻嗒;50ms 去重+连发衰减)" },
  coin: { label: "收入叮", when: "批内有正收入浮字(每批一次,缀首个浮字前)" },
  pay: { label: "支出闷响", when: "批内有负向浮字且非购地批(收叮付闷对位)" },
  stamp: { label: "印章", when: "定都/据城/驻跸/出牌确认/终局落印" },
  banner: { label: "回合横幅", when: "每次换手(合成 whoosh;鼓滚奏已撤,审计元凶)" },
  buy: { label: "购地成交", when: "买城成功(摇钱袋,播放侧截 1.6s)" },
  upgrade: { label: "扩军", when: "城池升级(木叩,播放侧截 0.65s)" },
  treasure: { label: "得珍宝", when: "珍宝事件(古琴双弹乐句,不截)" },
  bankrupt: { label: "破产", when: "破产清算收尾(长锣,不截)" },
  victory: { label: "胜利号角", when: "终局 700ms 接棒(完整号角,不截)" },
  victoryDrum: { label: "终局鼓点", when: "终局屏 0ms 起势(鼓滚奏唯一保留位)" },
  scrollOpen: { label: "卷轴展开", when: "卷轴挂载(纸响,播放侧截 1.8s)" },
  jinnangDraw: { label: "锦囊入手", when: "手牌架新牌落架(木叩,播放侧截 0.65s)" },
  jinnangSelect: { label: "选牌轻嗒", when: "军师幕/反应窗点选牌面(极轻瞬态)" },
};

function Board() {
  // 与 GameTopBar.MuteSqButton 同口径:context 直读,Provider 外不渲染(非兜底点)
  const audio = useAudio();
  if (!audio) return null;
  const play = (event: SoundEvent) => {
    // diceHit 带中档冲击强度(0~1),其余事件走默认
    getAudio().play(event, event === "diceHit" ? { intensity: 0.6 } : undefined);
  };
  return (
    <div className="m-auto flex w-[min(680px,94vw)] flex-col gap-y-3 p-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-wenkai text-2xl text-ink">音效试听台</h1>
        <button
          type="button"
          title={audio.muted ? "开音" : "静音"}
          aria-label={audio.muted ? "开音" : "静音"}
          onClick={audio.toggleMuted}
          className="note-btn flex items-center rounded px-3 py-1.5"
        >
          <Sym name={audio.muted ? "muted" : "sound"} size={15} />
        </button>
      </div>
      <p className="text-sm text-ink-dim">
        标注读运行时映射表(素材文件/合成/播放侧裁剪);首次点击即解锁声音。仅 dev 工具,?dev=sound
        直达。
      </p>
      <ul>
        {(Object.entries(ROWS) as [SoundEvent, { label: string; when: string }][]).map(
          ([event, row]) => {
            const file = AUDIO_FILES[event];
            const trim = FILE_TRIM[event];
            return (
              <li
                key={event}
                className="flex items-center gap-x-3 border-t border-ink/15 py-2 first:border-t-0"
              >
                <button
                  type="button"
                  onClick={() => play(event)}
                  aria-label={`试听 ${row.label}`}
                  className="note-btn flex min-w-24 shrink-0 items-center gap-x-1.5 rounded px-3 py-1.5 text-sm"
                >
                  <Sym name="play" size={11} />
                  {row.label}
                </button>
                <span className="min-w-0 flex-1 text-sm text-ink-dim">{row.when}</span>
                <span className="shrink-0 text-xs text-ink-dim">
                  {file ? (
                    <>
                      素材 {file.split("/").pop()}
                      {trim ? ` ·截${trim.stopAt}s` : ""}
                    </>
                  ) : (
                    "合成"
                  )}
                </span>
              </li>
            );
          },
        )}
      </ul>
    </div>
  );
}

export function SoundBoard() {
  return (
    <AudioProvider>
      <Board />
    </AudioProvider>
  );
}
