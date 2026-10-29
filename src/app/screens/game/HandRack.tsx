// 底部常驻手牌架(#238 一期 T3,方案 §4 P1-C):锦囊手牌从侧栏纸签迁到屏幕下缘
// 漆木架——横排大牌面(手牌无上限,#250 删满手作废;>3 张叠加压缩 + hover 挥出
// 全显,#254)、空手牌斜放一张牌背占位(器物空态,无文案)、他人回合同样
// 可见(常驻不收拢:反应窗二期落地前,架先站住「牌始终在线」的位置)。
//
// 视觉基线:tmp/prototype-jinnang-ui.html 其四(.rack / .jia-zhang / .slash),
// 样式在 hand-rack.css;牌面器物件(JinnangCardFace/Back,card/ 目录只读消费)。
//
// 常态交互(已决事项 5:点牌=抽屉,长按同效):点击/长按(按住 500ms)单张牌 → 详情
// 弹层,壳走 ui/dialog 底件(Base UI:焦点陷阱/Esc/点外关闭全部白拿,不自写交互
// 语义);桌面=底部居中面板、窄屏(useIsNarrow)=贴底抽屉(上圆角+抓手上条),
// 一个组件两种皮。挂载不夺焦 = Dialog.Popup initialFocus={false}。
//
// 出牌阶段态(#256,旧弹窗退役):轮到玩家且 hasUsableJinnang 时,架就地进窗态
// ——不弹窗,提示不弹窗。GameScreen 从快照(turnPhase=AwaitingJinnang + choices)
// 派生 junshi 载荷传入,本件只呈现与发手势:
//   卡牌段:可出牌金边上浮(.usable);不可用灰置+原因印条(.off+.reason,原因文案
//   单源 choices,不另写);点牌=选中放大 1.6×(放大态即详情态,.sel 金描边,样式
//   单源 jinnang-card.css,笺脚放开 4 行);点它牌换选、再点同牌/右键/长按取消;
//   数字键 1..n 选中(灰置跳过计数)、Enter 确认(G-19 口径与一期手感一致)。
//   灰置牌可看不可出(#715):点/长按开详情,不进选中/出牌通路(aria-disabled+自门控)。
//   名将技卡(#188 档 3):HeroCardFace 紧凑档混排架中(#360,与招贤/府库同卡面)。
//   目标段(pendingJinnang/pendingSkill 在场):整架退出交互——已出计牌金描边上浮
//   印「已出牌 · 待择目标」,其余牌灰置印「目标段不可换牌」;
//   选目标在席位格(SeatRail targets),本架不再接手势。
// 叠加压缩(#254)窗态下照常工作(状态 transform 与挥出同落 button 层,顺序收口在
// hand-rack.css 的窗态块)。
//
// 藏品双入口(#361)随 #700 退役:接替者=右下三圆钮(PileButtons,珍宝/名将圆钮
// 点开同名藏品弹层,弹层壳与陈列仍在 PileModal.tsx)。
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  JinnangCardBack,
  JinnangCardDetail,
  JinnangCardFace,
} from "@app/components/card/JinnangCardFace";
import { HeroCardFace, skillIdFromClick } from "@app/components/card/HeroCardFace";
import { rackTilt } from "@app/components/card/jinnang-face-data";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { ScrollArea } from "@app/components/ui/scroll-area";
import { DialogDragHandle } from "@app/hooks/use-dialog-drag";
import { Sym } from "@app/screens/shared/Sym";
import { useLongPress } from "@app/hooks/use-long-press";
import { useTapOrLongPress } from "@app/hooks/use-tap-or-long-press";
import { useDigitKeyPick } from "@app/hooks/use-digit-key-pick";
import { useIsNarrow } from "@app/hooks/use-media-query";
import { getAudio } from "@app/fx/audio";
import { useFxStore } from "@app/fx/fxStore";
import { jinnangCardOf } from "@core/jinnang";
import type { HeroSlotRow } from "@core/snapshot";
import type { ChoiceOption } from "@core/choices";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { SkillGlossaryDialog, type SkillGlossaryTarget } from "./SkillGlossaryDialog";
import { TESTIDS } from "./testids";
import "./hand-rack.css";

/** 长按判定窗与位移容差口径已收口 use-long-press.ts(单源)。 */

/** 技→槽反查(#786 槽位原生读):choices 技选项只带 skillId,出牌技卡的将定位走本地
 *  玩家槽位(槽位序首命中,同 roster.readySkillSlot 口径)——共享技(一技入多池,
 *  ADR-0036)后目录反查不再唯一,按目录猜属主会张冠李戴。查无=接线 bug(choices 出了
 *  本地玩家麾下没有的技),炸出零兜底。 */
function heroSlotBySkillId(heroes: HeroSlotRow[], skillId: string): HeroSlotRow {
  const slot = heroes.find((s) => s.skillIds.includes(skillId));
  if (slot == null)
    throw new Error(`出牌技卡:本地玩家麾下无技 ${skillId}(choices 与麾下槽位不符,数据 bug)`);
  return slot;
}

/** 出牌阶段态载荷(#256;GameScreen 派生,null=常态架)。 */
export interface JunshiWindow {
  /** 卡牌段选项(锦囊+技卡,choices 原序,含灰置;目标段传空数组)。 */
  options: ChoiceOption[];
  /** 目标段载荷:pendingJinnang.cardId / pendingSkill.skillId;卡牌段恒 null。 */
  pendingCardId: string | null;
  pendingSkillId: string | null;
  /** 当前选中选项 id(卡牌段;选中可逆)。 */
  selectedId: string | null;
  /** 选中/取消(id=null 取消;选中音效本件自管)。 */
  onSelect: (id: string | null) => void;
  /** Enter/出牌确认(GameScreen 侧校验选中并发命令)。 */
  onConfirm: () => void;
}

/** 窗态下单张手牌的呈现/交互槽(null=常态牌:点/长按开详情)。
 *  onSelect/onDeselect 仅卡牌段有语义;目标段整架退出交互(牌钮恒 disabled,事件
 *  不到达,2026-09-25 评审核实后删去调用侧的 no-op 占位),字段可缺省。
 *  played 字段在场(含 false)即目标段标记:目标段整架原生禁用(#256);卡牌段不传,
 *  灰置牌走 aria-disabled+自门控(#715)——钮层以此区分两段禁用形态。 */
interface RackCardJunshi {
  available: boolean;
  selected: boolean;
  /** 目标段:此牌即已出待择目标的计牌(金描边上浮,非交互,印「已出牌 · 待择目标」)。 */
  played?: boolean;
  /** 原因印条(灰置时展示;文案单源 choices;目标段用原型口径「目标段不可换牌」)。 */
  reason?: string;
  onSelect?: () => void;
  onDeselect?: () => void;
}

/** 详情弹层壳:内容 = JinnangCardDetail 五段面板,壳(定位/遮罩/出口)归本件。
 *  modal=true(默认):焦点陷阱+锁滚+Esc/点遮罩关闭全由底件承担。#530:补 × 关闭钮
 *  (DialogClose 承载交互语义,Sym close 同城池详情制式;此前弹层零按钮,唯一出口
 *  是点背衬,关闭 affordance 与城池详情不一致)。
 *  矮屏规范(#708,弹层族一处口径):最大高 = 视口高 − 64px;壳自身不滚,体部走
 *  ui/scroll-area 内滚(首帧可见滚动提示),牌名行 sticky 钉住(机制在 hand-rack.css)。 */
function JinnangDetailSheet({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const isNarrow = useIsNarrow();
  const def = jinnangCardOf(cardId);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid={TESTIDS.jinnangDetail}
        /* 挂载不夺焦(ScrollShell 先例):详情是只读浮层,焦点留在触发牌上,
            Esc 直关即可;底件 finalFocus 默认还焦触发元素,不另配。 */
        initialFocus={false}
        aria-label={`锦囊详情:${def.id}`}
        // 底件默认屏幕居中(fixed top-1/2 left-1/2 + translate 消费 --drag-x/y),
        // 两形态都改贴底:冲突组(top/translate-y/max-h 等)由 cn(twMerge)按后者覆盖;
        // 桌面形态的 translate-y 改消费拖动变量(#674,缺省 0px = 原贴底)。
        // #708:壳夹高视口−64px、自身 overflow-hidden,滚动归体部 jinnang-detail-scroll。
        className={
          isNarrow
            ? // 窄屏:贴底全宽抽屉(上圆角 + 抓手上条,原型 .xiang-sheet 制式)
              "jinnang-detail-sheet inset-x-0 bottom-0 top-auto translate-x-0 translate-y-0 w-full max-w-full flex flex-col overflow-hidden max-h-[calc(100dvh-64px)] rounded-b-none rounded-t-[14px] px-5 pb-[calc(var(--safe-bottom)+16px)]"
            : // 桌面:底部居中面板(下缘让出安全区)
              "jinnang-detail-sheet bottom-[calc(var(--safe-bottom)+16px)] top-auto translate-y-[var(--drag-y,0px)] w-max max-w-[92vw] flex flex-col overflow-hidden max-h-[calc(100dvh-64px)] px-6 pb-5"
        }
      >
        {/* × 关闭钮(#530):弹层内唯一可见出口,点击语义归底件 DialogClose。
            制式同城池详情题行关闭钮(BannerShell):44px 热区 + 漆金发丝描边圆钮,
            hover 用 group 让整个热区点亮;z-10 恒在拖动把手条之上,热区不受遮。 */}
        <DialogClose
          aria-label="关闭"
          className="group absolute right-1 top-1 z-10 flex h-11 w-11 cursor-pointer items-center justify-center"
        >
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(217,185,92,0.45)] bg-[color-mix(in_srgb,var(--color-paper-hi)_85%,transparent)] text-ink-dim transition-colors group-hover:bg-[rgba(217,185,92,0.18)] group-hover:text-ink"
          >
            <Sym name="close" size={13} />
          </span>
        </DialogClose>
        {/* 可达名:牌名即标题(sr-only,视觉由 JinnangCardDetail 的 dt-ming 承担) */}
        <DialogTitle className="sr-only">{def.id}</DialogTitle>
        {isNarrow && <div aria-hidden="true" className="jinnang-detail-grab" />}
        {/* 桌面形态题名区拖动把手(#674):透明条覆盖牌名行一带(22px 内衬 + 26px
            牌名),hover 显 grab 光标即拖动示意——题名在 JinnangCardDetail 的
            dt-ming(card/ 目录只读消费,无法摊其上),以覆盖条代替;窄屏贴底抽屉
            形态不渲染把手 = 禁用拖动(断点单源 useIsNarrow/IS_NARROW_QUERY)。
            #708:z-2 恒在钉住牌名带(z-1)之上,牌名钉住后把手热区不受遮。 */}
        {!isNarrow && (
          <DialogDragHandle
            aria-hidden="true"
            className="absolute inset-x-0 top-0 z-[2] h-[52px]"
            testid={TESTIDS.modalDragHandle}
          />
        )}
        {/* 体部内滚(#708):滚动归 scroll-area 视口;牌名行 sticky 钉住机制在
            hand-rack.css,面板内衬/底色不动 */}
        <ScrollArea className="jinnang-detail-scroll">
          <JinnangCardDetail cardId={cardId} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/** 窗态状态类 →(钮层,hand-rack.css 消费;牌面层类单源 jinnang-card.css 的
 *  .sel/.off 交互态,这里只做归属:可出=usable 上浮,选中=sel,灰置/已出=off。 */
function junshiBtnClass(s: RackCardJunshi): string {
  if (s.played) return "played";
  if (!s.available) return "off";
  return s.selected ? "sel" : "usable";
}
function junshiFaceClass(s: RackCardJunshi): string {
  if (s.played) return ""; // 已出计牌本体常色(进行时不是废牌),金描边上浮由钮层 .played 承担
  if (!s.available) return "off";
  return s.selected ? "sel" : "";
}

/** 同名第几张(0 起):React key 去重用(同名牌各有独立 key,进/出窗态不重挂;
 *  评审去重前三处各写一份 slice/filter,归此一处)。id 由调用方给(常态/目标段=手牌
 *  项本身,卡牌段=选项 id,数重复时以手牌前缀为准)。 */
function nthSame(hand: string[], i: number, id: string): number {
  return hand.slice(0, i).filter((x) => x === id).length;
}

/** 窗态牌面微旋(#234 P2-E TablePile 质感,±1.5°):出牌阶段/反应窗内的牌面按
 *  「牌 id+#序」确定性取角(重渲不翻滚),经 --tilt 注入牌面(jinnang-card.css
 *  的 rotate:var(--tilt),与交互态 transform 正交;reduced-motion 由 CSS 兜层归零)。
 *  常态架不微旋——质感只归「出手瞬间」的窗态。 */
function tiltVars(key: string): CSSProperties {
  return { ["--tilt" as string]: `${rackTilt(key)}deg` };
}

/** 单张手牌:真 <button> 包住牌面(键盘可达;不用裸 role——红线:交互语义不自写)。
 *  常态:点击与长按(useLongPress 单源,500ms)同效开详情,长按触发后置 fired
 *  抑制随后的合成 click,同一动作绝不弹两次。
 *  窗态(junshi 槽在场):点牌=选中(音效 jinnangSelect),再点同牌/右键/长按取消;
 *  手势接线走 useTapOrLongPress 复合手势单源(评审去重:与 JunshiSkillCard/Tip 同形
 *  收拢),长按只服务「取消选中」(未选中不武装)。灰置牌可看不可出(#715,#676 定案):
 *  弃原生 disabled(浏览器禁用契约吞全部 pointer→不可查看),改 aria-disabled+自门控
 *  ——点/长按开详情(现役详情通路),选中/出牌命令通路仍只对 available 开(门控在
 *  语义层,不在指针层);屏读语义不降级(aria-disabled 仍宣告禁用)。目标段(played
 *  字段在场)整架退出交互(#256),原生禁用保持。两态共用同一组件与 key:进/出窗态
 *  不重挂、不重播发牌音/入场级联。
 *  反应窗槽(reaction 在场,#281):点牌=选中/再点取消(确认在横幅落印钮),长按开
 *  详情弹层(#751 A1);呼吸金边归 .reactive 类(reaction-banner.css);非反应牌仍走
 *  常态详情。
 *  index:发牌入场级联的错峰序(--i)。 */
function RackCard({
  cardId,
  index,
  junshi,
  reaction,
  onOpen,
}: {
  cardId: string;
  index: number;
  junshi: RackCardJunshi | null;
  reaction?: { selected: boolean; onSelect: () => void } | null;
  onOpen: (id: string) => void;
}) {
  const press = useLongPress();
  // 窗态复合手势(hooks 规则:配置随分支,调用不随分支);常态分支用原语直连。
  // #715 自门控:非 available 的点/长按=开详情(可看),不触选中/取消通路(不可出)
  // ——门控在语义层,不在指针层;长按吞补发 click 由 props.onClick 内置(同动作不弹两次)。
  const junshiTap = useTapOrLongPress(
    junshi
      ? {
          onTap: () => {
            if (!junshi.available) {
              onOpen(cardId);
              return;
            }
            if (junshi.selected) junshi.onDeselect?.();
            else junshi.onSelect?.();
          },
          onLongPress: !junshi.available
            ? () => onOpen(cardId)
            : junshi.selected
              ? () => junshi.onDeselect?.()
              : null,
          onContextMenu: junshi.selected ? () => junshi.onDeselect?.() : undefined,
        }
      : {},
  );
  // 反应窗槽手势(#751 A1,#744 判词):点牌=选中/再点取消(既有语义不变,选中态
  // 维持既有上浮表达),长按=开既有卡面详情弹层——15s 竞速窗内读不全笺脚的解法
  // 是补通路不是新造交互:手势收 useTapOrLongPress 既有单源,详情走 JinnangDetailSheet
  // 既有弹层(#530 × 出口/#708 夹高内滚),零新组件零新语义。
  const reactTap = useTapOrLongPress(
    reaction
      ? {
          onTap: () => reaction.onSelect(),
          onLongPress: () => onOpen(cardId),
        }
      : {},
  );

  // 发牌音(#239 T4):新牌挂载 = 入手,牌落漆木架一声轻叩(jinnangDraw,文件通路
  // woodblock-hit)。挂载即播惯例同 ScrollShell 的 scrollOpen;音画与 rack-card-in
  // 入场动画同帧起步。dev StrictMode 双挂载会双响,生产单响——同先例接受。
  // 窗态切换不重挂(key/组件类型稳定),不重播。
  useEffect(() => {
    getAudio().play("jinnangDraw");
  }, []);

  if (junshi) {
    const s = junshi;
    return (
      <button
        type="button"
        {...junshiTap.props}
        data-testid={TESTIDS.jinnangCard(cardId)}
        aria-label={cardId}
        aria-pressed={s.available && !s.played ? s.selected : undefined}
        /* #715:卡牌段灰置弃原生 disabled(禁用契约吞全部 pointer→不可查看),改
            aria-disabled+自门控(手势层:点/长按开详情,不进选中通路)——出牌命令
            通路仍只对 available 开(点选/数字键/Enter 确认与 GameScreen 确认过滤
            既有口径,不放宽);屏读语义不降级(aria-disabled 仍宣告禁用)。
            目标段(played 在场)整架退出交互(#256),原生禁用保持。 */
        disabled={s.played != null}
        aria-disabled={!s.available && s.played == null ? true : undefined}
        className={junshiBtnClass(s)}
        style={{ ["--i" as string]: index }}
      >
        <JinnangCardFace
          cardId={cardId}
          className={junshiFaceClass(s)}
          style={tiltVars(`${cardId}#${index}`)}
        >
          {!s.available && s.reason && <span className="reason">{s.reason}</span>}
        </JinnangCardFace>
      </button>
    );
  }

  if (reaction) {
    // 反应窗槽(#281):点牌=选中/再点取消(音效随 GameScreen 侧 onSelect);长按开
    // 详情弹层(#751 A1,reactTap 单源);呼吸金边/选中实金在 .reactive/.sel
    //(reaction-banner.css)。
    return (
      <button
        type="button"
        {...reactTap.props}
        data-testid={TESTIDS.jinnangCard(cardId)}
        aria-label={cardId}
        aria-pressed={reaction.selected}
        className={"reactive" + (reaction.selected ? " sel" : "")}
        style={{ ["--i" as string]: index }}
      >
        <JinnangCardFace cardId={cardId} style={tiltVars(`${cardId}#${index}`)} />
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid={TESTIDS.jinnangCard(cardId)}
      aria-label={cardId}
      onPointerDown={(e) => press.start(e, () => onOpen(cardId))}
      onPointerMove={(e) => press.move(e)}
      onPointerUp={press.cancel}
      onPointerCancel={press.cancel}
      onContextMenu={(e) => e.preventDefault()} // 长按不出系统菜单,右键无动作
      onClick={() => {
        if (press.fired.current) {
          press.fired.current = false; // 长按刚开过详情,这次的 click 吃掉
          return;
        }
        onOpen(cardId);
      }}
      style={{ ["--i" as string]: index }}
      className="block cursor-pointer border-0 bg-transparent p-0 outline-offset-2"
    >
      <JinnangCardFace cardId={cardId} />
    </button>
  );
}

/** 出牌阶段态名将技卡(#188 档 3;#360 起换 HeroCardFace 紧凑档,与招贤/府库同卡面):
 *  手势与 RackCard 窗态分支同款(useTapOrLongPress 单源,长按/右键只服务「取消选中」);
 *  无发牌音(技不是新入手的牌)。卡面双输入(#786):heroId+实授技都由调用侧从本地
 *  玩家槽位反查(heroSlotBySkillId,技→将定位走槽;choices 载荷只承担可用性/原因/
 *  aria-label)。testid 沿 jinnang-card-* 族(option.id = skill:<id>)。 */
function JunshiSkillCard({
  option,
  heroId,
  skillIds,
  index,
  selected,
  onSelect,
  onDeselect,
  onInspect,
}: {
  option: ChoiceOption;
  /** 技→槽反查出的属主将 + 该槽实授技(#786 双输入,卡面/全览同源;技 id 收窄与
   *  反查都在调用侧完成,本件不再吃裸 skillId)。 */
  heroId: string;
  skillIds: string[];
  index: number;
  selected: boolean;
  onSelect: () => void;
  onDeselect: () => void;
  /** 点技名 chip 开技能全览(#605):参数=被点技 id(全览目标由调用侧用本卡槽位装配)。 */
  onInspect: (chipSkillId: string) => void;
}) {
  const tap = useTapOrLongPress({
    onTap: () => {
      if (selected) onDeselect();
      else onSelect();
    },
    onLongPress: selected ? onDeselect : null,
    onContextMenu: selected ? onDeselect : undefined,
  });
  // 点技名 chip=开全览(不选中),点卡面其余处=选中/取消:skillIdFromClick 判定分流。
  // tap.props.onClick 在此被覆写,长按吞补发 click 按 hook 钦定口径手读 fired(fired
  // 读后即清);长按/右键取消选中的语义不受影响(pointer 族原样生效)。
  const onCardClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (tap.fired.current) {
      tap.fired.current = false;
      return;
    }
    const chipSkillId = skillIdFromClick(e);
    if (chipSkillId != null) {
      onInspect(chipSkillId);
      return;
    }
    if (selected) onDeselect();
    else onSelect();
  };
  return (
    <button
      type="button"
      {...tap.props}
      onClick={onCardClick}
      data-testid={TESTIDS.jinnangCard(option.id)}
      aria-label={option.label}
      aria-pressed={option.available ? selected : undefined}
      disabled={!option.available}
      className={selected ? "sel" : option.available ? "usable" : "off"}
      style={{ ["--i" as string]: index }}
    >
      <HeroCardFace
        heroId={heroId}
        skillIds={skillIds}
        size="compact"
        className={option.available ? (selected ? "sel" : "") : "off"}
        style={tiltVars(`${option.id}#${index}`)}
      >
        {!option.available && option.reason && <span className="reason">{option.reason}</span>}
      </HeroCardFace>
    </button>
  );
}

/** 反应窗态载荷(#281,P1-D 牌架即反应窗;GameScreen 派生,缺省=常态架)。
 *  banner=已组装的结算事件横幅(ReactionBanner 件,本件只负责定位在架上缘——
 *  「横幅从手牌架上缘长出」);reactiveIds=此刻可打的反应锦囊(呼吸金边,点牌=选中,
 *  确认在横幅落印钮);selectedId/onSelect=选中可逆(再点同牌取消)。与出牌阶段态
 *  (AwaitingJinnang)互斥,不并存。 */
export interface RackReaction {
  banner: ReactNode;
  reactiveIds: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export interface HandRackProps {
  /** 本地视角玩家(对局屏挂载期恒在座)。 */
  player: SnapshotPlayer;
  /** 出牌阶段态(#256);缺省 = 常态架(点牌开详情)。 */
  junshi?: JunshiWindow;
  /** 反应窗态(#281);缺省 = 常态架。与 junshi 互斥(AwaitingReaction ≠ AwaitingJinnang)。 */
  reaction?: RackReaction;
  /** 未选牌点按「出牌」的计数(#751 B1,GameScreen 持账本):变更一次=架上可用牌
   *  金圈脉冲一次(自门控 #715 同款状态语言)。 */
  nudgePulse?: number;
}

/** 牌面宽 = 15em(jinnang-card.css 基座,与 JINNANG_FACE_SIZE_EM 互为镜像的只读常量)。 */
const CARD_WIDTH_EM = 15;

/** 架体可用几何(content box 宽 + 牌面像素宽 + em 基),ResizeObserver 实时跟随窗口/降档。 */
interface RackBox {
  avail: number;
  cardWidth: number;
  /** 容器 em 基像素(= computed font-size):呼吸档 gap「3em」的折算依据(#751 C1)。 */
  em: number;
}

/** 叠加压缩的三个 inline 变量(#254):步距 = 每张露出的窥条宽;hover 挥出的邻牌
 *  让位量按 noname getSpreadOffset 语义折算(右邻让满幅、左邻让 2 成)。 */
interface StackVars {
  step: number;
  spreadLeft: number;
  spreadRight: number;
}

/** 屏幕下缘手牌架(#238 一期 T3;#700 全浮层骨架改形:透明浮置、chrome 退役):
 *  手牌横排(空态斜放牌背占位)——漆木条底/架首竖排章随仪表条一并退役(原型
 *  席位侧列原型.html ①handzone:透明居中浮置,签面驻左端归 HandZone),藏品双入口
 *  (RackEntry)由右下三圆钮接替(PileButtons,#361 明细入口平移);出牌阶段态(#256)
 *  下架即出牌面,反应窗态(#281)横幅挂架上缘+反应牌呼吸金边。
 *  em 基仍在架体(font-size/降档断点在 hand-rack.css),叠加压缩测量口径不变。 */
export function HandRack({ player, junshi, reaction, nudgePulse = 0 }: HandRackProps) {
  const [detailId, setDetailId] = useState<string | null>(null);
  // 技能全览弹框开合态(#605):null=收;点技卡技名 chip 开,Esc/点外/X 关。
  const [glossary, setGlossary] = useState<SkillGlossaryTarget | null>(null);
  // 触屏临时全展(#751 C2,#744 判词):.many 态下架尾计数章点按=临时全展 2.5s
  // 回落,再点/点外即收——hover 挥出是桌面通路,触屏没有 hover;手势=点按,零新语义。
  const [spreadAll, setSpreadAll] = useState(false);
  const spreadTimer = useRef(0);
  const handRowRef = useRef<HTMLDivElement | null>(null);
  const badgeRef = useRef<HTMLButtonElement | null>(null);
  // 禁用「出牌」点按反馈(#751 B1,#744 判词):动作条自门控发来的未选牌点按计数,
  // 变更一次=架上可用牌金圈脉冲一次(seat-selglow 同族状态语言,不加文字)。
  const [usablePulse, setUsablePulse] = useState(false);
  const pulseTimer = useRef(0);
  const rackRef = useRef<HTMLElement | null>(null);
  const [box, setBox] = useState<RackBox | null>(null);
  const mounted = player != null;

  // 窗态两段:pendingJinnang/pendingSkill 在场 = 目标段(架退出交互,选目标在席位格)。
  const targeting =
    junshi != null && (junshi.pendingCardId != null || junshi.pendingSkillId != null);

  // 出牌窗聚光(#764):卡牌段有选中牌(放大 1.6× 的 .sel 态)即全屏 radial 压暗
  // (骰子 overlay 同族语言,z 序压盘面、让位放大牌与动作条),取消选中/出牌/进
  // 目标段即撤。开关态走 fxStore.spotlight(渲染在 FxLayer 的 body portal,本件
  // 只挂摘);effect 卸载兜摘,防架体带着选中态下屏时聚光滞留。
  const spotlightOn = junshi != null && !targeting && junshi.selectedId != null;
  useEffect(() => {
    useFxStore.getState().setSpotlight(spotlightOn);
    return () => useFxStore.getState().setSpotlight(false);
  }, [spotlightOn]);

  // 金圈脉冲一拍(#751 B1):nudgePulse 计数变更即亮 700ms(动画 --dur-med 级)后熄,
  // 类摘除再挂可重播;点按连发时重置计时,不叠影。
  const lastNudge = useRef(nudgePulse);
  useEffect(() => {
    if (nudgePulse === lastNudge.current) return;
    lastNudge.current = nudgePulse;
    window.clearTimeout(pulseTimer.current);
    setUsablePulse(true);
    pulseTimer.current = window.setTimeout(() => setUsablePulse(false), 700);
  }, [nudgePulse]);
  useEffect(() => () => window.clearTimeout(pulseTimer.current), []);

  // 临时全展的自动回落与点外收回(#751 C2):2.5s 计时器 + spreadAll 期间 document
  // pointerdown 落在手牌行/计数章外即收(点外=检视结束,同 hover 移出口径)。
  useEffect(() => {
    if (!spreadAll) return;
    const onDocDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && (handRowRef.current?.contains(t) || badgeRef.current?.contains(t)))
        return;
      window.clearTimeout(spreadTimer.current);
      setSpreadAll(false);
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, [spreadAll]);
  useEffect(() => () => window.clearTimeout(spreadTimer.current), []);

  // 窗态选中(音效在此收口:选中是动作,取消是撤销不出声——一期口径)。
  const select = (id: string | null) => {
    if (id != null) getAudio().play("jinnangSelect");
    junshi?.onSelect(id);
  };

  // 数字键 1..n 选中第 n 个可用选项(useDigitKeyPick 单源,G-19;灰置跳过计数)+ Enter
  // 确认(本件自挂,仅卡牌段;目标段数字键直发座位命令,归 GameScreen 接线)。快捷键读
  // ref 不进依赖:options 每快照新引用,监听器只挂一次;窗态退场(kbOn 变 false)解绑。
  const kbOn = junshi != null && !targeting;
  useDigitKeyPick(
    kbOn,
    junshi != null && !targeting ? junshi.options.filter((o) => o.available) : [],
    (hit) => select(hit.id),
  );
  const enterKb = useRef({ junshi, targeting });
  enterKb.current = { junshi, targeting };
  useEffect(() => {
    if (!kbOn) return;
    const onKey = (e: KeyboardEvent) => {
      const k = enterKb.current;
      if (!k.junshi || k.targeting) return;
      if (e.key === "Enter") {
        const j = k.junshi;
        const hasSel =
          j.selectedId != null && j.options.some((o) => o.id === j.selectedId && o.available);
        if (hasSel) {
          // 压掉焦点钮的原生激活:有选中时回车只有一个语义(出牌);
          // 无选中时放行原生点击,焦点在牌上回车仍可选中(键盘可达)。
          e.preventDefault();
          j.onConfirm();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kbOn]);

  // 可用宽测量:架体 content box(去 em 起架 padding)即手牌行的可用宽;em 基随
  // layout.css 槽位档(7.6px)/短横屏降档(6.4px)走,卡面像素宽从 computed font-size
  // 折算,测量与渲染永远同一口径。useLayoutEffect 同步首测(首帧就叠,不闪全展),
  // RO 管后续窗口缩放/降档。
  useLayoutEffect(() => {
    if (!mounted) return;
    const el = rackRef.current;
    if (!el) return;
    const read = () => {
      const cs = getComputedStyle(el);
      setBox({
        avail: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        cardWidth: CARD_WIDTH_EM * parseFloat(cs.fontSize),
        em: parseFloat(cs.fontSize),
      });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);

  const hand = player.jinnangHand;
  // 渲染张数:卡牌段=options(手牌 + 技卡混排);常态/目标段=手牌。叠加压缩按渲染
  // 张数算,窗态下照常工作(#254 口径)。
  const cardOptions = junshi != null && !targeting ? junshi.options : [];
  const renderCount = junshi != null ? (targeting ? hand.length : cardOptions.length) : hand.length;
  // 叠加压缩(#254,手牌无上限 #250):拍板公式(#751 C1 修,#744 判词)
  // spacing = min(卡宽+3em,(可用宽−卡宽)/(n−1))——原式 min(卡宽,…) 在 n=4 时
  // step 恰落卡宽 → gap 收拢为 0,4-7 张「贴死带」;上限抬一档呼吸位后,n=4-6 自然
  // 落「卡宽+≤19px gap」档(与 ≤3 张的 3em 同语),可用宽吃紧时才贴死/真叠。
  // spread=Math.max(0,…) 兜住 step>卡宽 的负值,hover 挥出不受影响。
  const stack: StackVars | null =
    box != null && renderCount > 3
      ? (() => {
          const step = Math.min(
            box.cardWidth + 3 * box.em,
            (box.avail - box.cardWidth) / (renderCount - 1),
          );
          const spread = Math.max(0, box.cardWidth - step); // hover 挥出要邻牌让出的总幅
          return { step, spreadLeft: spread * 0.2, spreadRight: spread };
        })()
      : null;
  // 触屏临时全展态(#751 C2):步距抬到「卡宽 + 余量摊派 gap(≤3em)」——每张全宽
  // 无重叠一字排开(可用宽不足摊满 3em 时先收 gap 再贴排;8+ 张短窗的溢出属临时
  // 检视态,2.5s 自动回落);让位变量归零(无叠可挥)。
  const stackNow: StackVars | null =
    stack != null && spreadAll && box != null
      ? (() => {
          const gapEach = Math.max(
            0,
            Math.min(3 * box.em, (box.avail - box.cardWidth * renderCount) / (renderCount - 1)),
          );
          return { step: box.cardWidth + gapEach, spreadLeft: 0, spreadRight: 0 };
        })()
      : stack;
  const handStyle: CSSProperties | undefined = stackNow
    ? {
        ["--jn-step" as string]: `${Math.round(stackNow.step)}px`,
        ["--jn-spread-left" as string]: `${Math.round(stackNow.spreadLeft)}px`,
        ["--jn-spread-right" as string]: `${Math.round(stackNow.spreadRight)}px`,
      }
    : undefined;

  // 手牌行内容(常态/目标段按手牌、卡牌段按 options;手牌 key 规则三态一致,进/出
  // 窗态不重挂已存在的牌)。
  const handItems = (() => {
    if (junshi != null && targeting) {
      // 目标段:整架退出交互——pendingCardId 即已出计牌(金描边上浮),其余灰置;
      // 牌钮恒 disabled,不传 onSelect/onDeselect(交互语义已随窗态退场)。
      // 印条只留已出计牌(#751 B3,#744 判词):§4.6 判据——撤掉文字,off 置灰已可辨,
      // N 张各印一条同文案是噪音;「为什么不能动」由目标段窗态本身表达。
      return hand.map((id, i) => {
        const played = junshi.pendingCardId === id;
        return (
          <RackCard
            key={`${id}-${nthSame(hand, i, id)}`}
            cardId={id}
            index={i}
            junshi={{
              available: false,
              selected: false,
              played,
              reason: played ? "已出牌 · 待择目标" : undefined,
            }}
            onOpen={setDetailId}
          />
        );
      });
    }
    if (junshi != null) {
      // 卡牌段:choices 原序(手牌序在前、技卡殿后);手牌 key 与常态一致。
      // 技卡先槽位反查属主(#786:技→将定位走本地玩家槽位),卡面/全览吃同一槽实授技。
      return cardOptions.map((o, i) => {
        if (o.skillId != null) {
          const slot = heroSlotBySkillId(player.heroes, o.skillId);
          return (
            <JunshiSkillCard
              key={o.id}
              option={o}
              heroId={slot.heroId}
              skillIds={slot.skillIds}
              index={i}
              selected={junshi.selectedId === o.id && o.available}
              onSelect={() => select(o.id)}
              onDeselect={() => select(null)}
              onInspect={(chipSkillId) =>
                setGlossary({ heroId: slot.heroId, skillIds: slot.skillIds, skillId: chipSkillId })
              }
            />
          );
        }
        return (
          <RackCard
            key={`${o.id}-${nthSame(hand, i, o.id)}`}
            cardId={o.id}
            index={i}
            junshi={{
              available: o.available,
              selected: junshi.selectedId === o.id && o.available,
              reason: o.reason,
              onSelect: () => select(o.id),
              onDeselect: () => select(null),
            }}
            onOpen={setDetailId}
          />
        );
      });
    }
    // 常态:手牌全展/叠加,点牌开详情;反应窗槽(#281)在场时,可打的反应锦囊改点选
    //(呼吸金边,确认在横幅落印钮),其余牌仍开详情。
    return hand.map((id, i) => {
      const reactive = reaction != null && reaction.reactiveIds.includes(id);
      return (
        <RackCard
          key={`${id}-${nthSame(hand, i, id)}`}
          cardId={id}
          index={i}
          junshi={null}
          reaction={
            reactive
              ? {
                  selected: reaction!.selectedId === id,
                  onSelect: () => reaction!.onSelect(id),
                }
              : null
          }
          onOpen={setDetailId}
        />
      );
    });
  })();

  return (
    <section
      ref={rackRef}
      data-testid={TESTIDS.jinnangRack}
      aria-label="锦囊手牌"
      className={"hand-rack" + (junshi != null ? " junshi" : "")}
    >
      {/* 反应窗横幅(#281):从手牌架上缘长出(P1-D「牌架即反应窗」);定位归架体
          (reaction-banner.css),挂载/卸载即窗开/窗收,横幅自带入场与倒计时。 */}
      {reaction?.banner}
      {renderCount > 0 ? (
        /* 手牌行:testid 沿用 jinnang-hand(契约零漂移;三态同一容器)。无上限(#250):
            ≤3 张全展,≥4 张叠加压缩(.many,样式在 hand-rack.css)。usablePulse=
            未选牌点按「出牌」的架上金圈脉冲一拍(#751 B1)。 */
        <div
          ref={handRowRef}
          data-testid={TESTIDS.jinnangHand}
          className={
            (stack ? "hand-rack-hand many" : "hand-rack-hand") + (usablePulse ? " nudge" : "")
          }
          style={handStyle}
        >
          {handItems}
        </div>
      ) : (
        /* 空态:斜放一张漆木牌背占位(暗牌语义,器物空态不写文案;窗态下不可能到这
            ——hasUsableJinnang 才进 AwaitingJinnang 相位,架上必有选项) */
        <JinnangCardBack aria-hidden="true" className="hand-rack-back" />
      )}
      {/* 架尾计数章(#751 C2):.many 压缩态常驻,点按=临时全展(触屏无 hover 的
          全显通路;pointer:coarse 档才显示,桌面 hover 通路保留);章上数字=信息
          (§4.6 例外),全展中金边点亮 = 状态表达。 */}
      {stack != null && (
        <button
          ref={badgeRef}
          type="button"
          data-testid={TESTIDS.jinnangSpreadBadge}
          aria-label={`手牌 ${renderCount} 张,点按临时全展`}
          aria-pressed={spreadAll}
          onClick={() => {
            setSpreadAll((v) => {
              window.clearTimeout(spreadTimer.current);
              if (!v) spreadTimer.current = window.setTimeout(() => setSpreadAll(false), 2500);
              return !v;
            });
          }}
          className="rack-spread-badge"
        >
          {renderCount}
        </button>
      )}
      {detailId !== null && (
        <JinnangDetailSheet cardId={detailId} onClose={() => setDetailId(null)} />
      )}
      {/* 技能全览弹框(#605):点技卡技名 chip 开,只读,关闭即清 */}
      <SkillGlossaryDialog target={glossary} onClose={() => setGlossary(null)} />
    </section>
  );
}
