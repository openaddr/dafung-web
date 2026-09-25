// 底部常驻手牌架(#238 一期 T3,方案 §4 P1-C):锦囊手牌从侧栏纸签迁到屏幕下缘
// 漆木架——横排大牌面(手牌无上限,#250 删满手作废;>3 张叠加压缩 + hover 挥出
// 全显,#254)、空手牌斜放一张牌背占位(器物空态,无文案)、他人回合同样
// 可见(常驻不收拢:反应窗二期落地前,架先站住「牌始终在线」的位置)。
//
// 视觉基线:tmp/prototype-jinnang-ui.html 其四(.rack / .jia-zhang / .slash),
// 样式在 hand-rack.css;牌面器物件(JinnangCardFace/Back,card/ 目录只读消费)。
//
// 交互(已决事项 5:点牌=抽屉,长按同效):点击/长按(按住 500ms)单张牌 → 详情
// 弹层,壳走 ui/dialog 底件(Base UI:焦点陷阱/Esc/点外关闭全部白拿,不自写交互
// 语义);桌面=底部居中面板、窄屏(useIsNarrow)=贴底抽屉(上圆角+抓手上条),
// 一个组件两种皮。挂载不夺焦 = Dialog.Popup initialFocus={false}(底件文档口径:
// false=Do not move focus,等同 DialogFocusScope 的 onMountAutoFocus preventDefault
// 惯用法——首焦点不得落在弹层,Enter 误触风险归零)。
//
// 观战(localPlayer==null)不渲染整个架:观战无手牌可看(快照投影本就不含他人牌面)。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  JinnangCardBack,
  JinnangCardDetail,
  JinnangCardFace,
} from "@app/components/card/JinnangCardFace";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { useLongPress } from "@app/hooks/use-long-press";
import { useIsNarrow } from "@app/hooks/use-media-query";
import { getAudio } from "@app/fx/audio";
import { jinnangCardOf } from "@core/jinnang";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { TESTIDS } from "./testids";
import "./hand-rack.css";

/** 长按判定窗与位移容差口径已收口 use-long-press.ts(单源)。 */

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

/** 单张手牌:真 <button> 包住牌面(键盘可达:Enter/Space 即详情,焦点圈免费;
 *  不用裸 role——红线:交互语义不自写)。点击与长按(useLongPress 单源,500ms)
 *  同效开详情,长按触发后置 fired 抑制随后的合成 click,同一动作绝不弹两次。
 *  index:发牌入场级联的错峰序(--i,hand-rack.css rack-card-in 消费)。 */
function RackCard({ cardId, index, onOpen }: { cardId: string; index: number; onOpen: (id: string) => void }) {
  const press = useLongPress();

  // 发牌音(#239 T4):新牌挂载 = 入手,牌落漆木架一声轻叩(jinnangDraw,文件通路
  // woodblock-hit)。挂载即播惯例同 ScrollShell 的 scrollOpen;音画与 rack-card-in
  // 入场动画同帧起步。dev StrictMode 双挂载会双响,生产单响——同先例接受。
  useEffect(() => {
    getAudio().play("jinnangDraw");
  }, []);

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

export interface HandRackProps {
  /** 本地视角玩家(null = 观战/未入座,整个架不渲染)。 */
  player: SnapshotPlayer | null;
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

/** 屏幕下缘常驻漆木手牌架:架首竖排「锦囊手牌」章 + 手牌横排(空态斜放牌背)。 */
export function HandRack({ player }: HandRackProps) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const rackRef = useRef<HTMLElement | null>(null);
  const [box, setBox] = useState<RackBox | null>(null);
  const mounted = player != null;

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
  // 叠加压缩(#254,手牌无上限 #250):拍板公式 spacing = min(卡宽,(可用宽−卡宽)/(n−1))
  // ——无「超过 N 张才叠」的阈值常量(那等于把已删的旧上限从窗户新塞回来);n≤3 时
  // (可用宽−卡宽)/(n−1) 远大于卡宽,公式自然落在全展档,但与一期形态(gap 3em)的
  // 归属不同,故 ≤3 仍走旧 flex gap,≥4 才挂 .many 消费下方变量。
  const stack: StackVars | null =
    box != null && hand.length > 3
      ? (() => {
          const step = Math.min(box.cardWidth, (box.avail - box.cardWidth) / (hand.length - 1));
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
  return (
    <section
      ref={rackRef}
      data-testid={TESTIDS.jinnangRack}
      aria-label="锦囊手牌"
      className="hand-rack"
    >
      {/* 架首章:竖排漆金描边(纯装饰,架的可达名由 aria-label 承担) */}
      <span aria-hidden="true" className="hand-rack-zhang">
        <span>锦</span>
        <span>囊</span>
        <span>手</span>
        <span>牌</span>
      </span>
      {hand.length > 0 ? (
        /* 手牌行:testid 沿用 jinnang-hand,只在有牌时存在(与原侧栏容器同语义,
            空手牌清空的 e2e 断言零漂移);无上限(#250):≤3 张全展,≥4 张叠加压缩
            (.many,样式在 hand-rack.css)。 */
        <div
          data-testid={TESTIDS.jinnangHand}
          className={stack ? "hand-rack-hand many" : "hand-rack-hand"}
          style={handStyle}
        >
          {hand.map((id, i) => {
            /* key = id + 同名序数:前位异名牌被消耗时后位 key 不变(不重播发牌音/
                入场动画;index 键会全体移位重挂载,评审 Standards 轴发现)。同名两张
                只剩其一时会换一次键、重播一拍——快照无实例 id,引擎数据下这已最稳。
                testid 契约仍是 jinnang-card-${id}(重复牌的定位歧义属既有口径)。 */
            const nth = hand.slice(0, i).filter((x) => x === id).length;
            return <RackCard key={`${id}-${nth}`} cardId={id} index={i} onOpen={setDetailId} />;
          })}
        </div>
      ) : (
        /* 空态:斜放一张漆木牌背占位(暗牌语义,器物空态不写文案) */
        <JinnangCardBack aria-hidden="true" className="hand-rack-back" />
      )}
      {detailId !== null && (
        <JinnangDetailSheet cardId={detailId} onClose={() => setDetailId(null)} />
      )}
    </section>
  );
}
