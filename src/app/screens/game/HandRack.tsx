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
// 军师窗态(#256,军师幕弹窗退役):轮到玩家且 hasUsableJinnang 时,架就地进窗态
// ——不弹窗,提示不弹窗。GameScreen 从快照(turnPhase=AwaitingJinnang + choices)
// 派生 junshi 载荷传入,本件只呈现与发手势:
//   卡牌段:可出牌金边上浮(.usable);不可用灰置+原因印条(.off+.reason,原因文案
//   单源 choices,不另写);点牌=选中放大 1.6×(放大态即详情态,.sel 金描边,样式
//   单源 jinnang-card.css,笺脚放开 4 行);点它牌换选、再点同牌/右键/长按取消;
//   数字键 1..n 选中(灰置跳过计数)、Enter 确认(G-19 口径与一期手感一致)。
//   令笺(技)变体混排架中(一期形制,#188 档 3,JunshiSkillCard)。
//   目标段(pendingJinnang/pendingSkill 在场):整架退出交互——已出计牌金描边上浮
//   印「已出牌 · 待择目标」(原型目标态口径),其余牌灰置印「目标段不可换牌」;
//   选目标在席位卡(SeatRail targets),本架不再接手势。
// 叠加压缩(#254)窗态下照常工作(状态 transform 与挥出同落 button 层,顺序收口在
// hand-rack.css 的窗态块)。
//
// 观战(localPlayer==null)不渲染整个架:观战无手牌可看(快照投影本就不含他人牌面)。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  JinnangCardBack,
  JinnangCardDetail,
  JinnangCardFace,
} from "@app/components/card/JinnangCardFace";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { JinnangLingjian } from "./scroll/JinnangLingjian";
import { useLongPress } from "@app/hooks/use-long-press";
import { useIsNarrow } from "@app/hooks/use-media-query";
import { getAudio } from "@app/fx/audio";
import { jinnangCardOf } from "@core/jinnang";
import type { ChoiceOption } from "@core/choices";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { TESTIDS } from "./testids";
import "./hand-rack.css";

/** 长按判定窗与位移容差口径已收口 use-long-press.ts(单源)。 */

/** 军师窗态载荷(#256;GameScreen 派生,null=常态架)。 */
export interface JunshiWindow {
  /** 卡牌段选项(锦囊+令笺,choices 原序,含灰置;目标段传空数组)。 */
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

/** 窗态下单张手牌的呈现/交互槽(null=常态牌:点/长按开详情)。 */
interface RackCardJunshi {
  available: boolean;
  selected: boolean;
  /** 目标段:此牌即已出待择目标的计牌(金描边上浮,非交互,印「已出牌 · 待择目标」)。 */
  played?: boolean;
  /** 原因印条(灰置时展示;文案单源 choices;目标段用原型口径「目标段不可换牌」)。 */
  reason?: string;
  onSelect: () => void;
  onDeselect: () => void;
}

/** 详情弹层壳:内容 = JinnangCardDetail 五段面板,壳(定位/遮罩/出口)归本件。
 *  modal=true(默认):焦点陷阱+锁滚+Esc/点遮罩关闭全由底件承担。 */
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
        // 底件默认屏幕居中(fixed top-1/2 left-1/2 -translate-x/y-1/2),两形态都改
        // 贴底:冲突组(top/translate-y 等)由 cn(twMerge)按后者覆盖。
        className={
          isNarrow
            ? // 窄屏:贴底全宽抽屉(上圆角 + 抓手上条,原型 .xiang-sheet 制式;
                // max-h 86dvh + 内滚 = 方案「看不全」三层保证之②)
              "jinnang-detail-sheet inset-x-0 bottom-0 top-auto translate-x-0 translate-y-0 w-full max-w-full max-h-[86dvh] overflow-y-auto rounded-b-none rounded-t-[14px] px-5 pt-3 pb-[calc(var(--safe-bottom)+16px)]"
            : // 桌面:底部居中面板(同口径 86dvh 内滚;下缘让出安全区)
              "jinnang-detail-sheet bottom-[calc(var(--safe-bottom)+16px)] top-auto translate-y-0 w-max max-w-[92vw] max-h-[86dvh] overflow-y-auto"
        }
      >
        {/* 可达名:牌名即标题(sr-only,视觉由 JinnangCardDetail 的 dt-ming 承担) */}
        <DialogTitle className="sr-only">{def.id}</DialogTitle>
        {isNarrow && <div aria-hidden="true" className="jinnang-detail-grab" />}
        <JinnangCardDetail cardId={cardId} />
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

/** 单张手牌:真 <button> 包住牌面(键盘可达;不用裸 role——红线:交互语义不自写)。
 *  常态:点击与长按(useLongPress 单源,500ms)同效开详情,长按触发后置 fired
 *  抑制随后的合成 click,同一动作绝不弹两次。
 *  窗态(junshi 槽在场):点牌=选中(音效 jinnangSelect),再点同牌/右键/长按取消;
 *  灰置牌 disabled(浏览器禁用契约,不可选中)。两态共用同一组件与 key:进/出窗态
 *  不重挂、不重播发牌音/入场级联。index:发牌入场级联的错峰序(--i)。 */
function RackCard({
  cardId,
  index,
  junshi,
  onOpen,
}: {
  cardId: string;
  index: number;
  junshi: RackCardJunshi | null;
  onOpen: (id: string) => void;
}) {
  const press = useLongPress();

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
        data-testid={TESTIDS.jinnangCard(cardId)}
        aria-label={cardId}
        aria-pressed={s.available && !s.played ? s.selected : undefined}
        disabled={!s.available || s.played}
        className={junshiBtnClass(s)}
        style={{ ["--i" as string]: index }}
        onPointerDown={(e) => {
          press.cancel();
          if (s.selected) press.start(e, s.onDeselect); // 长按只服务「取消选中」
        }}
        onPointerMove={(e) => press.move(e)}
        onPointerUp={press.cancel}
        onPointerCancel={press.cancel}
        onPointerLeave={press.cancel}
        onContextMenu={(e) => {
          e.preventDefault(); // 右键=取消选中,不弹浏览器菜单
          if (s.selected) s.onDeselect();
        }}
        onClick={() => {
          if (press.fired.current) {
            press.fired.current = false; // 长按已取消选中,吞掉补发 click
            return;
          }
          if (s.selected) s.onDeselect();
          else s.onSelect();
        }}
      >
        <JinnangCardFace cardId={cardId} className={junshiFaceClass(s)}>
          {!s.available && s.reason && <span className="reason">{s.reason}</span>}
        </JinnangCardFace>
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

/** 窗态令笺钮(#188 档 3 技变体混排架中):手势与 RackCard 窗态分支同款;无发牌音
 *  (技不是新入手的牌)。文案随 choices 载荷(skillHero/label/skillText),UI 不回查
 *  名将目录(一期口径)。testid 沿 jinnang-card-* 族(option.id = skill:<id>)。 */
function JunshiSkillCard({
  option,
  index,
  selected,
  onSelect,
  onDeselect,
}: {
  option: ChoiceOption;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onDeselect: () => void;
}) {
  const press = useLongPress();
  const hero = option.skillHero ?? "";
  const name = option.label.slice(hero.length + 1); // 剥「属主·」前缀(一期口径)
  return (
    <button
      type="button"
      data-testid={TESTIDS.jinnangCard(option.id)}
      aria-label={option.label}
      aria-pressed={option.available ? selected : undefined}
      disabled={!option.available}
      className={selected ? "sel" : option.available ? "usable" : "off"}
      style={{ ["--i" as string]: index }}
      onPointerDown={(e) => {
        press.cancel();
        if (selected) press.start(e, onDeselect);
      }}
      onPointerMove={(e) => press.move(e)}
      onPointerUp={press.cancel}
      onPointerCancel={press.cancel}
      onPointerLeave={press.cancel}
      onContextMenu={(e) => {
        e.preventDefault();
        if (selected) onDeselect();
      }}
      onClick={() => {
        if (press.fired.current) {
          press.fired.current = false;
          return;
        }
        if (selected) onDeselect();
        else onSelect();
      }}
    >
      <JinnangLingjian
        hero={hero}
        name={name}
        text={option.skillText ?? ""}
        className={option.available ? (selected ? "sel" : "") : "off"}
      >
        {!option.available && option.reason && <span className="reason">{option.reason}</span>}
      </JinnangLingjian>
    </button>
  );
}

export interface HandRackProps {
  /** 本地视角玩家(null = 观战/未入座,整个架不渲染)。 */
  player: SnapshotPlayer | null;
  /** 军师窗态(#256);缺省 = 常态架(点牌开详情)。 */
  junshi?: JunshiWindow;
}

/** 牌面宽 = 15em(jinnang-card.css 基座,与 JINNANG_FACE_SIZE_EM 互为镜像的只读常量)。 */
const CARD_WIDTH_EM = 15;

/** 架体可用几何(content box 宽 + 牌面像素宽),ResizeObserver 实时跟随窗口/降档。 */
interface RackBox {
  avail: number;
  cardWidth: number;
}

/** 叠加压缩的三个 inline 变量(#254):步距 = 每张露出的窥条宽;hover 挥出的邻牌
 *  让位量按 noname getSpreadOffset 语义折算(右邻让满幅、左邻让 2 成)。 */
interface StackVars {
  step: number;
  spreadLeft: number;
  spreadRight: number;
}

/** 屏幕下缘常驻漆木手牌架:架首竖排「锦囊手牌」章 + 手牌横排(空态斜放牌背);
 *  军师窗态(#256)下架即出牌面(见文件头)。 */
export function HandRack({ player, junshi }: HandRackProps) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const rackRef = useRef<HTMLElement | null>(null);
  const [box, setBox] = useState<RackBox | null>(null);
  const mounted = player != null;

  // 窗态两段:pendingJinnang/pendingSkill 在场 = 目标段(架退出交互,选目标在席位卡)。
  const targeting = junshi != null && (junshi.pendingCardId != null || junshi.pendingSkillId != null);

  // 窗态选中(音效在此收口:选中是动作,取消是撤销不出声——一期口径)。
  const select = (id: string | null) => {
    if (id != null) getAudio().play("jinnangSelect");
    junshi?.onSelect(id);
  };

  // 数字键 1..n 选中第 n 个可用选项(灰置跳过计数)+ Enter 确认(G-19;仅卡牌段。
  // 目标段数字键直发座位命令,归 GameScreen 接线)。快捷键读 ref 不进依赖:options
  // 每快照新引用,监听器只挂一次;窗态退场(mountedOn 变 false)解绑。
  const kb = useRef({ junshi, targeting, select });
  kb.current = { junshi, targeting, select };
  const kbOn = junshi != null && !targeting;
  useEffect(() => {
    if (!kbOn) return;
    const onKey = (e: KeyboardEvent) => {
      const k = kb.current;
      if (!k.junshi || k.targeting) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1) {
        const avail = k.junshi.options.filter((o) => o.available);
        const hit = avail[n - 1];
        if (hit != null) k.select(hit.id);
      } else if (e.key === "Enter") {
        const j = k.junshi;
        const hasSel = j.selectedId != null && j.options.some((o) => o.id === j.selectedId && o.available);
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
      });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);

  if (!player) return null; // 观战不渲染(不是兜底:观战无手牌是业务事实)

  const hand = player.jinnangHand;
  // 渲染张数:卡牌段=options(手牌 + 令笺混排);常态/目标段=手牌。叠加压缩按渲染
  // 张数算,窗态下照常工作(#254 口径)。
  const cardOptions = junshi != null && !targeting ? junshi.options : [];
  const renderCount = junshi != null ? (targeting ? hand.length : cardOptions.length) : hand.length;
  // 叠加压缩(#254,手牌无上限 #250):拍板公式 spacing = min(卡宽,(可用宽−卡宽)/(n−1))
  // ——无「超过 N 张才叠」的阈值常量;n≤3 时公式自然落在全展档,但与一期形态(gap 3em)
  // 的归属不同,故 ≤3 仍走旧 flex gap,≥4 才挂 .many 消费下方变量。
  const stack: StackVars | null =
    box != null && renderCount > 3
      ? (() => {
          const step = Math.min(box.cardWidth, (box.avail - box.cardWidth) / (renderCount - 1));
          const spread = Math.max(0, box.cardWidth - step); // hover 挥出要邻牌让出的总幅
          return { step, spreadLeft: spread * 0.2, spreadRight: spread };
        })()
      : null;
  const handStyle: CSSProperties | undefined = stack
    ? {
        ["--jn-step" as string]: `${Math.round(stack.step)}px`,
        ["--jn-spread-left" as string]: `${Math.round(stack.spreadLeft)}px`,
        ["--jn-spread-right" as string]: `${Math.round(stack.spreadRight)}px`,
      }
    : undefined;

  // 手牌行内容(常态/目标段按手牌、卡牌段按 options;手牌 key 规则三态一致,进/出
  // 窗态不重挂已存在的牌)。
  const handItems = (() => {
    if (junshi != null && targeting) {
      // 目标段:整架退出交互——pendingCardId 即已出计牌(金描边上浮),其余灰置。
      return hand.map((id, i) => {
        const nth = hand.slice(0, i).filter((x) => x === id).length;
        const played = junshi.pendingCardId === id;
        return (
          <RackCard
            key={`${id}-${nth}`}
            cardId={id}
            index={i}
            junshi={{
              available: false,
              selected: false,
              played,
              reason: played ? "已出牌 · 待择目标" : "目标段不可换牌",
              onSelect: () => {},
              onDeselect: () => {},
            }}
            onOpen={setDetailId}
          />
        );
      });
    }
    if (junshi != null) {
      // 卡牌段:choices 原序(手牌序在前、令笺殿后);手牌 key 与常态一致。
      return cardOptions.map((o, i) => {
        if (o.skillId != null) {
          return (
            <JunshiSkillCard
              key={o.id}
              option={o}
              index={i}
              selected={junshi.selectedId === o.id && o.available}
              onSelect={() => select(o.id)}
              onDeselect={() => select(null)}
            />
          );
        }
        const nth = hand.slice(0, i).filter((x) => x === o.id).length;
        return (
          <RackCard
            key={`${o.id}-${nth}`}
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
    // 常态:手牌全展/叠加,点牌开详情。
    return hand.map((id, i) => {
      const nth = hand.slice(0, i).filter((x) => x === id).length;
      return <RackCard key={`${id}-${nth}`} cardId={id} index={i} junshi={null} onOpen={setDetailId} />;
    });
  })();

  return (
    <section
      ref={rackRef}
      data-testid={TESTIDS.jinnangRack}
      aria-label="锦囊手牌"
      className={"hand-rack" + (junshi != null ? " junshi" : "")}
    >
      {/* 架首章:竖排漆金描边(纯装饰,架的可达名由 aria-label 承担) */}
      <span aria-hidden="true" className="hand-rack-zhang">
        <span>锦</span>
        <span>囊</span>
        <span>手</span>
        <span>牌</span>
      </span>
      {renderCount > 0 ? (
        /* 手牌行:testid 沿用 jinnang-hand(契约零漂移;三态同一容器)。无上限(#250):
            ≤3 张全展,≥4 张叠加压缩(.many,样式在 hand-rack.css)。 */
        <div
          data-testid={TESTIDS.jinnangHand}
          className={stack ? "hand-rack-hand many" : "hand-rack-hand"}
          style={handStyle}
        >
          {handItems}
        </div>
      ) : (
        /* 空态:斜放一张漆木牌背占位(暗牌语义,器物空态不写文案;窗态下不可能到这
            ——hasUsableJinnang 才进 AwaitingJinnang 相位,架上必有选项) */
        <JinnangCardBack aria-hidden="true" className="hand-rack-back" />
      )}
      {detailId !== null && (
        <JinnangDetailSheet cardId={detailId} onClose={() => setDetailId(null)} />
      )}
    </section>
  );
}
