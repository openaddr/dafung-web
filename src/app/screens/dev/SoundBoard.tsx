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
  diceLand: { label: "落骰", when: "S7 两段式签面落定拍(木叩,与大字钤落/金圈/微震同拍;#513)" },
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
  jinnangSelect: { label: "选牌轻嗒", when: "出牌阶段/反应窗点选牌面(极轻瞬态)" },
  coinsBox: { label: "铜钱入匣", when: "S7 破产仪式撒币拍(#513)" },
  rain: { label: "雨声铺底", when: "S7 破产仪式开锣(压档衬底,播放侧截 3s;#513)" },
  haltGong: { label: "都城停号角", when: "都城路过必停条带开拍(狩猎号角,#751 与破产长锣分家)" },
  duelClash: { label: "拼点合击", when: "拼点签面起摇拍(骨牌相击,#751/#746)" },
  verdictChime: {
    label: "判词磬·中性",
    when: "拼点判词拍·中缝印落锤同拍(碗磬一记,截 1.6s;旁观局与平局,#769 分家后保留);#751/#746",
  },
  verdictChimeWin: {
    label: "判词磬·己胜",
    when: "拼点判词拍·本机在签内且己方胜(上行高音双磬,纯合成;#769)",
  },
  verdictChimeLose: {
    label: "判词磬·己败",
    when: "拼点判词拍·本机在签内且己方败(下行低音双磬,纯合成;#769)",
  },
  reactionOpen: { label: "开窗轻叩", when: "反应窗开启(木鱼族一记;#751)" },
  reactionTick: { label: "危急滴答", when: "反应窗末 5 秒每秒一记(短促低音量;#760)" },
};

function Board() {
  // 与 GameTopBar.MuteSqButton 同口径:context 直读,Provider 外不渲染(非兜底点)
  const audio = useAudio();
  if (!audio) return null;
  const play = (event: SoundEvent) => {
    getAudio().play(event);
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
