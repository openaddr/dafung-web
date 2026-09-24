// 三个常规决策卷轴(岔口/购地/扩军):从旧侧栏 ActionInline 迁入卷轴体系。
// 交互重构原则:所有需要玩家权衡的选择一律走卷轴弹层,侧栏手牌区不再有决策按钮;
// 卷轴轮到即自动弹出(DecisionScrollLayer 按相位路由),且无可关 ×——决策相位必须选择。
// 按钮 testid 沿用旧 action-* 命名(action-buy/…),文案与语义不变,
// 只是位置从侧栏搬进卷轴,e2e 断言零语义变化。
// (经过都城必停后「驻跸或行进」卷轴已删:引擎直接结算,无玩家抉择。)
// spec #107 C1(UI 半边选项集消费缝):三个卷轴的可用性/不可用原因一律从快照
// choices(choices.ts 注册表产出,ADR-0013)读取,UI 不再重推 canBuy/maxed/reason
// ——全游戏不可购原因只有引擎一处口径。
import { useContext, useEffect, useRef, useState } from "react";
import type { GameCommand } from "@core/types";
import type { ChoiceOption } from "@core/choices";
import { formatMoney } from "@core/money";
import { getAudio } from "@app/fx/audio";
import { ScrollShell, ScrollButton, ScrollGhostContext } from "./ScrollShell";
import { ValueTable } from "./ValueTable";
import { JinnangCardFace } from "@app/components/card/JinnangCardFace";
import { JinnangLingjian } from "./JinnangLingjian";
import { SCROLL_TESTIDS as T } from "./testids";
import { TESTIDS } from "../testids";

/** G-19:数字快捷键(1/2/3)触发选项 —— 挂载绑、卸载解;actions 顺序即角标顺序。
 *  Esc 不做(决策不可关是产品设定)。回调里的 disabled 判断由各卷轴自行收口。 */
function useNumberShortcuts(actions: Array<() => void>) {
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= ref.current.length) ref.current[n - 1]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** 牌面微旋角(#239 T4,方案 §4 P2-E TablePile 质感 ±1.5° 收敛):按 cardId+下标
 *  派生的确定性值——同一张牌任意重渲染/重开卷轴恒为同角,不许每帧抖动;选中放大时
 *  消费方以 --tilt:0deg 归零(放大态要正,细节档读字)。消费方:scroll.css 的
 *  .jn-card-btn / .jin-buyong(transform: rotate(var(--tilt)))。 */
function jnTilt(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return `${(((Math.abs(h) % 31) - 15) / 10).toFixed(1)}deg`;
}

// ── 军师幕卷轴(AwaitingJinnang,#122/T2 锦囊 + #188 档 3 名将主动技,统一决策窗)──
// #237 牌面化:选项从行按钮改横排牌面——锦囊=JinnangCardFace、就绪主动技=令笺变体
// (JinnangLingjian)、「今不用」竖笺钮殿后。交互口径(2026-09-24 拍板,方案 §7.5):
// 点牌=选中(不即发命令),选中即放大 1.6× 详情档(.sel 金描边,样式单源 jinnang-card.css);
// 点它牌切换、再点/右键/长按(500ms 无位移)取消;「落印」墨钮确认后才发命令——
// 选择与确认彻底分离,落印禁用态=未选中。牌面内容(牌名/标签/纹样)由组件回查目录
// 渲染(本端快照本就含目录,与判定无关);可用性/原因只读 choices(单源,ADR-0013),
// 技能文案随 choices 载荷过网(UI 不回查名将目录)。灰置项照列(暗置博弈:看见自己
// 有什么、为何不能用):下沉置灰 + 原因印条,不可选中。testid 族(scroll-jinnang*)
// 沿用旧名原义,e2e 零漂移;仅新增 jinnangConfirm(落印)。
export function JinnangScroll({
  choices,
  pendingCardId,
  pendingSkillId,
  onCommand,
}: {
  /** 锦囊目标段时=被选中的牌(作罢/提交目标都以其名义发命令);卡牌段=null。 */
  pendingCardId: string | null;
  /** 技能目标段时=被选中的技(#188 档 3);卡牌段=null。与 pendingCardId 互斥。 */
  pendingSkillId: string | null;
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // 目标段:候选座位 + 作罢(牌保留/技不记冷却);卡牌段:锦囊牌面 + 令笺 + 今不用
  const targeting = choices.some((o) => o.targetSeat != null);
  // 目标段座位选项(targetSeat 由 filter 保证非空,收口一处;引擎目标段选项恒带座位)
  const seatOptions = targeting
    ? (choices.filter((o) => o.targetSeat != null) as Array<ChoiceOption & { targetSeat: number }>)
    : [];
  // 卡牌段选项(锦囊 + 主动技;pass/cancel 是动作钮不算牌)
  const options = targeting ? [] : choices.filter((o) => o.id !== "pass" && o.id !== "cancel");
  // 可用项序(G-19 计数与落印之外的一切判定只认可用项;灰置照列但跳过计数)
  const avail = options.filter((o) => o.available);
  const subtitle = targeting
    ? pendingSkillId != null
      ? "此技指向何人?"
      : "此计指向何人?"
    : "军师在侧,计谋在囊。可出一计一技,或留待来日——掷骰之前,且慢行军。";

  // 选中态(#237):点牌只选中,落印才发命令;进目标段/作罢返回即清空重选
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => setSelectedId(null), [targeting]);
  const selected = selectedId != null ? options.find((o) => o.id === selectedId && o.available) : undefined;
  // 幽灵退场帧(#90):本组件整树会在退场帧重挂一遍,入场级联必须抑制(scroll.css
  // .jn-ghost 关 animation),否则收卷 210ms 里牌面又逐张飘进来。
  const isGhost = useContext(ScrollGhostContext);

  // 选中入口(#239 T4):点牌与数字键共用——选中瞬间落一枚极轻嗒(合成,见 audio.ts);
  // 取消选中是撤销不是动作,不出声。
  const selectCard = (id: string) => {
    setSelectedId(id);
    getAudio().play("jinnangSelect");
  };

  // 落印确认:选中项发命令(技=useHeroSkill;牌=useJinnang 发卡 id——one/two-others
  // 的牌由此进引擎目标段,目标段交互与 testid 不变)。落印即盖章(#239 T4 音效):
  // 复用既有 stamp 事件(stamp-seal.ogg/木石 thump),与棋盘「据/驻」印同一质感语言。
  const confirmSelected = () => {
    if (selected == null) return;
    getAudio().play("stamp");
    onCommand(
      selected.skillId != null
        ? { type: "useHeroSkill", skillId: selected.skillId }
        : { type: "useJinnang", cardId: selected.id },
    );
  };
  // 目标段命令(座位段交互口径不变,座位钮与数字键共用)
  const seatCmd = (targetSeat: number): GameCommand =>
    pendingSkillId != null
      ? { type: "useHeroSkill", skillId: pendingSkillId, targets: [targetSeat] }
      : { type: "useJinnang", cardId: pendingCardId, targets: [targetSeat] };

  // G-19(#237 新口径):卡牌段——数字 1..n = 选中第 n 个「可用」选项(灰置项跳过计数;
  // 只选中不发送,确认一律过落印钮),Enter = 落印;目标段沿用旧口径:数字直发座位命令
  // (与座位钮角标同序)。Enter preventDefault 压掉焦点钮的原生激活——有选中时回车只有
  // 一个语义(落印);无选中时放行原生点击,焦点在「今不用」上回车仍可跳过(键盘可达)。
  // 快捷键读 ref 不进依赖:choices 每快照新引用,监听器只挂一次。
  const kb = useRef({ targeting, seatOptions, avail, selected, seatCmd, confirmSelected, selectCard, onCommand });
  kb.current = { targeting, seatOptions, avail, selected, seatCmd, confirmSelected, selectCard, onCommand };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = kb.current;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1) {
        if (k.targeting) {
          const hit = k.seatOptions.filter((o) => o.available)[n - 1];
          if (hit != null) k.onCommand(k.seatCmd(hit.targetSeat));
        } else {
          const hit = k.avail[n - 1];
          if (hit != null) k.selectCard(hit.id);
        }
      } else if (e.key === "Enter" && k.selected != null) {
        e.preventDefault();
        k.confirmSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 长按取消(#237 拍板口径):按住已选中的牌 500ms 无位移即取消选中;位移 >8px 视为
  // 滚动/拖拽不触发;触发后抑制紧随而来的 click(触屏长按抬起会补发)。500ms 是交互
  // 阈值非演出时长,刻意字面量不进倍率(ScrollShell 210ms 收起出口同先例)。
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean }>({
    timer: null,
    x: 0,
    y: 0,
    fired: false,
  });
  const clearPress = () => {
    if (press.current.timer !== null) {
      clearTimeout(press.current.timer);
      press.current.timer = null;
    }
  };
  useEffect(() => clearPress, []);

  return (
    <ScrollShell title="军师幕" testid={T.jinnangScroll} width="lg">
      {/* 副题:目标段=问句(信息),卡牌段=助兴文案(唐)。jn-sub-card 供短横屏降档
          隐藏(scroll.css media query)——390px 高的壳内滚区装不下它+全牌+落印钮。 */}
      <p
        className={`jn-sub${targeting ? "" : " jn-sub-card"} m-1 mb-1 text-center text-sm text-ink-dim font-wenkai`}
      >
        {subtitle}
      </p>
      {targeting ? (
        <div className="flex flex-col gap-2 px-1 pb-1 pt-2">
          {seatOptions.map((o, i) => (
            <ScrollButton
              key={o.id}
              testid={T.jinnangOption(o.id)}
              disabled={!o.available}
              title={o.available ? undefined : o.reason}
              shortcut={i + 1}
              onClick={() => onCommand(seatCmd(o.targetSeat))}
            >
              <span className="font-wenkai">{o.label}</span>
            </ScrollButton>
          ))}
          <ScrollButton
            testid={T.jinnangCancel}
            onClick={() =>
              pendingSkillId != null
                ? onCommand({ type: "useHeroSkill", skillId: pendingSkillId, cancel: true })
                : onCommand({ type: "useJinnang", cardId: pendingCardId, cancel: true })
            }
          >
            作罢
          </ScrollButton>
        </div>
      ) : (
        <>
          <div
            className={`jn-stage${selected != null ? " jn-has-sel" : ""}${isGhost ? " jn-ghost" : ""}`}
          >
            {options.map((o, i) => (
              <button
                key={`${o.id}:${i}`} // 手牌可持同名两张(每牌库 2 份),key 带 index 防撞;段内顺序稳定
                type="button"
                data-testid={T.jinnangOption(o.id)}
                disabled={!o.available}
                aria-pressed={o.available ? selectedId === o.id : undefined}
                className="jn-card-btn"
                /* 微旋角(#239 T4):cardId+下标派生的确定性值(jnTilt),选中归零
                    (放大态要正);--i 供入场级联错峰(scroll.css jn-card-in)。 */
                style={{
                  ["--tilt" as string]: selectedId === o.id ? "0deg" : jnTilt(`${o.id}:${i}`),
                  ["--i" as string]: i,
                }}
                onPointerDown={(e) => {
                  clearPress();
                  if (selectedId !== o.id) return; // 长按只服务「取消选中」
                  press.current = {
                    timer: setTimeout(() => {
                      press.current.timer = null;
                      press.current.fired = true;
                      setSelectedId(null);
                    }, 500),
                    x: e.clientX,
                    y: e.clientY,
                    fired: false,
                  };
                }}
                onPointerMove={(e) => {
                  const p = press.current;
                  if (p.timer !== null && (Math.abs(e.clientX - p.x) > 8 || Math.abs(e.clientY - p.y) > 8)) clearPress();
                }}
                onPointerUp={clearPress}
                onPointerCancel={clearPress}
                onPointerLeave={clearPress}
                onContextMenu={(e) => {
                  e.preventDefault(); // 右键=取消选中,不弹浏览器菜单
                  if (selectedId === o.id) setSelectedId(null);
                }}
                onClick={() => {
                  if (press.current.fired) {
                    press.current.fired = false; // 长按已取消选中,吞掉补发 click
                    return;
                  }
                  if (selectedId === o.id) setSelectedId(null);
                  else selectCard(o.id);
                }}
              >
                {o.skillId != null ? (
                  <JinnangLingjian
                    hero={o.skillHero!}
                    name={o.label.slice(o.skillHero!.length + 1)}
                    text={o.skillText!}
                    className={!o.available ? "off" : selectedId === o.id ? "sel" : ""}
                  >
                    {!o.available && <span className="reason">{o.reason}</span>}
                  </JinnangLingjian>
                ) : (
                  <JinnangCardFace
                    cardId={o.id}
                    className={!o.available ? "off" : selectedId === o.id ? "sel" : ""}
                  >
                    {!o.available && <span className="reason">{o.reason}</span>}
                  </JinnangCardFace>
                )}
              </button>
            ))}
            <button
              type="button"
              data-testid={T.jinnangPass}
              className="jin-buyong"
              style={{ ["--i" as string]: options.length }} // 级联殿后:牌面走完一轮才轮到它
              onClick={() => onCommand({ type: "useJinnang", cardId: null })}
            >
              <span>今</span>
              <span>不</span>
              <span>用</span>
              <span className="sub">跳过</span>
            </button>
          </div>
          {/* jn-confirm-row:短横屏降档钩子(scroll.css media query 收紧间距/墨钮 padding) */}
          <div className="jn-confirm-row mt-2 flex justify-center">
            <ScrollButton primary testid={T.jinnangConfirm} disabled={selected == null} onClick={confirmSelected}>
              落印
            </ScrollButton>
          </div>
        </>
      )}
    </ScrollShell>
  );
}

// ── 驿道岔口(AwaitingBranch)──
export function BranchDecisionScroll({
  choices,
  onCommand,
}: {
  /** 当前相位选项集(快照透出):走大路/入辅路的 available/reason 单源引擎注册表。 */
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // 选项集消费缝(spec #107 C1):两选当前恒可用,可用性仍只读注册表产出——未来技能
  // 改动选项可用性时卷轴随之,UI 不私自判定。选项缺失 = 相位与注册表不符(数据 bug),
  // 非空断言让其抛(零兜底,与 Layer 对 catalog 的断言同款)。
  const main = choices.find((o) => o.id === "main")!;
  const branch = choices.find((o) => o.id === "branch")!;
  // G-19:1=大路 2=辅路(不可选的选项按键无效,与购地卷轴口径一致)
  useNumberShortcuts([
    () => { if (main.available) onCommand({ type: "selectBranch", kind: "Main" }); },
    () => { if (branch.available) onCommand({ type: "selectBranch", kind: "Branch" }); },
  ]);
  return (
    <ScrollShell title="驿道岔口" testid={T.branchScroll}>
      {/* A4(#51):事件描述正文用霞鹜文楷(font-wenkai,接入点示意) */}
      <p className="m-1 mb-3.5 text-center text-sm text-ink-dim font-wenkai">
        驿道至此分岔:大路平坦快捷,辅路僻静多机。入辅路者本回合就此扎营,来日掷骰进发。
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <ScrollButton
          primary
          shortcut={1}
          disabled={!main.available}
          title={main.available ? undefined : main.reason}
          testid={TESTIDS.actionButton("main")}
          onClick={() => onCommand({ type: "selectBranch", kind: "Main" })}
        >
          走大路
        </ScrollButton>
        <ScrollButton
          shortcut={2}
          disabled={!branch.available}
          title={branch.available ? undefined : branch.reason}
          testid={TESTIDS.actionButton("branch")}
          onClick={() => onCommand({ type: "selectBranch", kind: "Branch" })}
        >
          入辅路
        </ScrollButton>
      </div>
    </ScrollShell>
  );
}

// ── 抉择机遇(AwaitingEncounter,#124):机遇文段 + 目录选项按钮 ──
// 数据单源快照 choices(choices.ts 注册表产出):encounterId/encounterText 随选项携带,
// label=选项原文,available/reason=引擎口径(如以宝换贤的「珍宝不足」),UI 不自行判定。
// 选项下标 = snapshot.choices 数组下标 = def.choices 下标(resolveEncounterChoice 按此结算)。
export function EncounterChoiceScroll({
  encounterId,
  encounterText,
  choices,
  onCommand,
}: {
  encounterId: string;
  encounterText: string;
  /** 当前相位选项集(快照透出):顺序即机遇目录选项序,含不可用项(禁用 + reason)。 */
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // G-19 同口径:数字键 1..n 直选(不可选的选项按键无效)
  useNumberShortcuts(
    choices.map((o, i) => () => {
      if (o.available) onCommand({ type: "resolveEncounterChoice", index: i });
    }),
  );
  return (
    <ScrollShell title={`机遇 · ${encounterId}`} testid={T.encounterScroll}>
      {/* 机遇文段:事件描述正文用霞鹜文楷(与岔口卷轴同款) */}
      <p className="m-1 mb-3.5 text-center text-sm text-ink-dim font-wenkai">{encounterText}</p>
      <div className="flex flex-col gap-2.5">
        {choices.map((o, i) => (
          <ScrollButton
            key={o.id}
            primary={i === 0}
            shortcut={i + 1}
            disabled={!o.available}
            title={o.available ? undefined : o.reason}
            testid={T.encounterOption(i)}
            onClick={() => onCommand({ type: "resolveEncounterChoice", index: i })}
          >
            {o.label}
          </ScrollButton>
        ))}
      </div>
      {choices.some((o) => !o.available) && (
        <p className="mt-2 text-center text-xs text-ink-dim">
          {choices.find((o) => !o.available)?.reason}
        </p>
      )}
    </ScrollShell>
  );
}

// ── 体力耗竭(AwaitingExhaustion,#130)──
// label=选项原文(「城名」降 1 级 / 失去城池),available 恒 true(失去选项排除都城由引擎口径保证)。
// 选项下标 = snapshot.choices 数组下标(resolveExhaustionChoice 按此结算)。
export function ExhaustionChoiceScroll({
  choices,
  onCommand,
}: {
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // G-19 同口径:数字键 1..n 直选
  useNumberShortcuts(
    choices.map((o, i) => () => {
      if (o.available) onCommand({ type: "resolveExhaustionChoice", index: i });
    }),
  );
  return (
    <ScrollShell title="体力耗竭" testid={T.exhaustionScroll}>
      <p className="m-1 mb-3.5 text-center text-sm text-ink-dim font-wenkai">
        体力耗竭,倒地不起!择一座城池弃之苟活:降 1 级,或失去整座。歇罢这阵,体力自会回满。
      </p>
      <div className="flex flex-col gap-2.5">
        {choices.map((o, i) => (
          <ScrollButton
            key={o.id}
            primary={i === 0}
            shortcut={i + 1}
            disabled={!o.available}
            title={o.available ? undefined : o.reason}
            testid={T.exhaustionOption(i)}
            onClick={() => onCommand({ type: "resolveExhaustionChoice", index: i })}
          >
            {o.label}
          </ScrollButton>
        ))}
      </div>
    </ScrollShell>
  );
}

// ── 购地抉择(AwaitingDecision + PropertyAvailable)──
export function BuyDecisionScroll({
  tileName,
  region,
  property,
  cash,
  choices,
  onCommand,
}: {
  tileName: string;
  region: string;
  property: { purchasePrice: number; maxLevel: number; valueByLevel: number[] };
  cash: number;
  /** 当前相位选项集(快照透出):buy 项的 available/reason 单源引擎注册表。 */
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // 选项集单源(spec #107 C1 / ADR-0013):可购与否与原因只读引擎注册表产出
  // (「无委任状」/「银两不足」,委任优先报),UI 不再重推 cash/warrants 判定——
  // 旧手抄「委任状不足」与引擎「无委任状」的文案漂移在此绝根。选项缺失 = 相位与
  // 注册表不符(数据 bug),非空断言让其抛(零兜底)。
  const buy = choices.find((o) => o.id === "buy")!;
  // G-20:买不起时价值表默认折叠(决策已不可行,全表只是噪音);可点开查看
  const [showValues, setShowValues] = useState(buy.available);
  // G-19:1=购地(不可购时无效)2=不取
  useNumberShortcuts([
    () => { if (buy.available) onCommand({ type: "buyProperty" }); },
    () => onCommand({ type: "endDecision" }),
  ]);
  // G-20:资产行 —— 一眼看清持有/需付/差额(负差红字)
  const diff = cash - property.purchasePrice;
  return (
    <ScrollShell title="购地抉择" testid={T.buyScroll}>
      <p className="m-1 text-center text-sm text-ink-dim">
        「{tileName}」{region ? ` · ${region}` : ""} · 无主 · 购入 {formatMoney(property.purchasePrice)} · 耗 1 委任状
      </p>
      <p className="m-1 mb-2.5 text-center text-sm text-ink">
        持有 {formatMoney(cash)} · 需 {formatMoney(property.purchasePrice)} · 差{" "}
        <span className={diff < 0 ? "text-danger" : undefined}>{formatMoney(diff)}</span>
      </p>
      {/* 复用城池详情的等级价值表:买地的权衡核心是逐级价值(升级免费,Lv0 起逐级升)。
          #92:买入即落 Lv.0(升级由到达免费触发),高亮购入档 */}
      {showValues ? (
        <ValueTable property={property} highlight={{ level: 0, label: "购入档" }} />
      ) : (
        <button
          type="button"
          onClick={() => setShowValues(true)}
          className="mx-auto mb-1 block font-deco text-xs text-gold-deep underline cursor-pointer hover:text-ink"
        >
          查看等级价值
        </button>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <ScrollButton
          primary
          disabled={!buy.available}
          title={buy.available ? undefined : buy.reason}
          shortcut={1}
          testid={TESTIDS.actionButton("buy")}
          onClick={() => onCommand({ type: "buyProperty" })}
        >
          购地 {formatMoney(property.purchasePrice)}·1委任
        </ScrollButton>
        <ScrollButton
          shortcut={2}
          testid={TESTIDS.actionButton("skip")}
          onClick={() => onCommand({ type: "endDecision" })}
        >
          不取
        </ScrollButton>
      </div>
      {!buy.available && <p className="mt-2 text-center text-xs text-ink-dim">{buy.reason}</p>}
    </ScrollShell>
  );
}

// ── 扩军抉择(AwaitingDecision + OwnProperty;升级免费,由到达己城触发)──
export function UpgradeDecisionScroll({
  tileName,
  level,
  property,
  choices,
  onCommand,
}: {
  tileName: string;
  level: number;
  property: { maxLevel: number; valueByLevel: number[] };
  /** 当前相位选项集(快照透出):upgrade 项的 available/reason 单源引擎注册表。 */
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}) {
  // 选项集单源(spec #107 C1 / ADR-0013):可否扩军与原因(「已满级」)只读引擎注册表
  // 产出,UI 不再重推 level >= maxLevel(升级免费,无银两门槛)。选项缺失 = 相位与
  // 注册表不符(数据 bug),非空断言让其抛(零兜底)。
  const upgrade = choices.find((o) => o.id === "upgrade")!;
  // 价值变化 = 当前级 → 下一级城池价值(下标 = 等级)
  const valueNow = property.valueByLevel[level] ?? 0;
  const valueNext = upgrade.available ? property.valueByLevel[level + 1] ?? valueNow : valueNow;
  // G-19:1=扩军(不可升时无效)2=按兵不动
  useNumberShortcuts([
    () => { if (upgrade.available) onCommand({ type: "upgradeProperty" }); },
    () => onCommand({ type: "endDecision" }),
  ]);
  return (
    <ScrollShell title="扩军抉择" testid={T.upgradeScroll}>
      <p className="m-1 text-center text-sm text-ink-dim">
        「{tileName}」当前 Lv.{level} · 扩军免费
      </p>
      <p className="m-1 mb-3 text-center text-sm text-ink-dim">
        城池价值:{formatMoney(valueNow)} →{" "}
        {upgrade.available ? formatMoney(valueNext) : `(${upgrade.reason})`}
      </p>
      {/* #92:扩军权衡也上同一张表,高亮「扩军后」档(当前级+1;满级时下标越界,自然无命中行) */}
      <ValueTable property={property} highlight={{ level: level + 1, label: "扩军后" }} />
      <div className="flex flex-wrap items-center justify-center gap-3">
        <ScrollButton
          primary
          disabled={!upgrade.available}
          title={upgrade.available ? undefined : upgrade.reason}
          shortcut={1}
          testid={TESTIDS.actionButton("upgrade")}
          onClick={() => onCommand({ type: "upgradeProperty" })}
        >
          扩军(免费)
        </ScrollButton>
        <ScrollButton
          shortcut={2}
          testid={TESTIDS.actionButton("skip")}
          onClick={() => onCommand({ type: "endDecision" })}
        >
          按兵不动
        </ScrollButton>
      </div>
      {!upgrade.available && (
        <p className="mt-2 text-center text-xs text-ink-dim">{upgrade.reason}</p>
      )}
    </ScrollShell>
  );
}
