// 底部常驻手牌架(#238 一期 T3,方案 §4 P1-C):锦囊手牌从侧栏纸签迁到屏幕下缘
// 漆木架——横排大牌面(规则上限 JINNANG_HAND_LIMIT=3 张全展,无重叠算法;未来
// >3 张的压缩只在此留位)、空手牌斜放一张牌背占位(器物空态,无文案)、他人回合同样
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
import { useEffect, useRef, useState } from "react";
import {
  JinnangCardBack,
  JinnangCardDetail,
  JinnangCardFace,
} from "@app/components/card/JinnangCardFace";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { useIsNarrow } from "@app/hooks/use-media-query";
import { getAudio } from "@app/fx/audio";
import { jinnangCardOf } from "@core/jinnang";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { TESTIDS } from "./testids";
import "./hand-rack.css";

/** 长按判定窗(已决事项 5:长按与点击同效)。 */
const LONG_PRESS_MS = 500;
/** 长按位移容差:按下后超出即视作拖动/滚屏,取消长按(标准 pointer 手势口径)。 */
const LONG_PRESS_SLOP_PX = 10;

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
            ? // 窄屏:贴底全宽抽屉(上圆角 + 抓手上条,原型 .xiang-sheet 制式)
              "jinnang-detail-sheet inset-x-0 bottom-0 top-auto translate-x-0 translate-y-0 w-full max-w-full max-h-[70dvh] overflow-y-auto rounded-b-none rounded-t-[14px] px-5 pt-3 pb-[calc(var(--safe-bottom)+16px)]"
            : // 桌面:底部居中面板(下缘让出安全区)
              "jinnang-detail-sheet bottom-[calc(var(--safe-bottom)+16px)] top-auto translate-y-0 w-max max-w-[92vw]"
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
 *  不用裸 role——红线:交互语义不自写)。点击与长按(pointer 500ms)同效开详情,
 *  长按触发后置 fired 抑制随后的合成 click,同一动作绝不弹两次。
 *  index:发牌入场级联的错峰序(--i,hand-rack.css rack-card-in 消费)。 */
function RackCard({ cardId, index, onOpen }: { cardId: string; index: number; onOpen: (id: string) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const fired = useRef(false);

  // 发牌音(#239 T4):新牌挂载 = 入手,牌落漆木架一声轻叩(jinnangDraw,文件通路
  // woodblock-hit)。挂载即播惯例同 ScrollShell 的 scrollOpen;音画与 rack-card-in
  // 入场动画同帧起步。dev StrictMode 双挂载会双响,生产单响——同先例接受。
  useEffect(() => {
    getAudio().play("jinnangDraw");
  }, []);

  const cancelTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!e.isPrimary) return; // 多指第二指不起长按
    fired.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true; // 抑制抬指后的合成 click
      onOpen(cardId);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (timer.current === null) return;
    if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > LONG_PRESS_SLOP_PX) {
      cancelTimer(); // 拖动/滚屏,不是长按
    }
  };
  const onClick = () => {
    if (fired.current) {
      fired.current = false; // 长按刚开过详情,这次的 click 吃掉
      return;
    }
    onOpen(cardId);
  };

  return (
    <button
      type="button"
      data-testid={TESTIDS.jinnangCard(cardId)}
      aria-label={cardId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelTimer}
      onPointerCancel={cancelTimer}
      onContextMenu={(e) => e.preventDefault()} // 长按不出系统菜单,右键无动作
      onClick={onClick}
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

/** 屏幕下缘常驻漆木手牌架:架首竖排「锦囊手牌」章 + 手牌横排(空态斜放牌背)。 */
export function HandRack({ player }: HandRackProps) {
  const [detailId, setDetailId] = useState<string | null>(null);
  if (!player) return null; // 观战不渲染(不是兜底:观战无手牌是业务事实)

  const hand = player.jinnangHand;
  return (
    <section
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
            空手牌清空的 e2e 断言零漂移);上限 3 张全展,无重叠算法(压缩留位未实现)。 */
        <div data-testid={TESTIDS.jinnangHand} className="hand-rack-hand">
          {hand.map((id, i) => (
            /* key 带序号:同名两张(牌库各 2 副本)同手时 id 独身会撞 key;
                testid 契约仍是 jinnang-card-${id}(原值,重复牌的定位歧义属既有口径)。 */
            <RackCard key={`${id}-${i}`} cardId={id} index={i} onOpen={setDetailId} />
          ))}
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
