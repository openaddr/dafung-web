// 组件收口:已收口——手册大弹层,ui/dialog 自组壳+ADR-0031 拖动把手,挂载不夺焦;体部内滚同 #708 规范,顶带 ≥44px 见 ADR-0049;详情叠层零新壳(锦囊/珍宝复用 game 侧 PileShell、名将复用 SkillGlossaryDialog),四签切换语义全在真 button[role=tab] 上(细则 docs/design/组件收口.md)
// 手册大弹层(#1070,spec #1069 T1;形态决议 ADR-0049):首页「手册」入口点开的
// 四类玩法内容总览,大弹层而非全屏屏——对局内将来复用同一组件,顶边恒让出 ≥44px 顶带
// (回合胶囊带,游戏内挂载前条件;首页虽无胶囊也照此几何)。几何写死(规格口径):
//   顶带 44px + 底距 20px → 壳高 ≤ 100dvh − 64px(844×390 上 ≤326px),
//   纵向锚 = 让位区 [44px, 100dvh−20px] 的中点(translate-y(-50%) 居中于该区),
//   高顶满时顶边恰 44px、底边距视口底 20px。
// 壳 = ui/dialog 底件自组(T1 交付形制保留;本件已归位 screens/manual 层,#1069
// 收口时 T2/T3 的详情叠层归 PileShell 复用),形制照 PileShell:题名行兼拖动把手(#674)、挂载不夺焦
// 内容区 ui/scroll-area
// 内滚(#708 同规范:头部/签行钉住,体部内滚)。
// 四签 tab 行:名将/技能/锦囊/珍宝,选中态=金描边+上浮(DESIGN §4.6 状态视觉
// 通道,无文字标牌);位移/描边过渡走 --dur/--ease token,无自造常驻动画。
// props={open,onClose} 纯受控,不绑屏不绑路由(游戏内直接复用);签选态存本地 state。
// 内容=各签目录(珍宝采用图文行册,其余沿既有陈列);壳样式走 tailwind utilities + token
// arbitrary values,壳皮由底件 paper-skin 承担。
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { ScrollArea } from "@app/components/ui/scroll-area";
import { DialogDragHandle } from "@app/hooks/use-dialog-drag";
import { RoundClose } from "@app/screens/shared/RoundClose";
import { MANUAL_TID } from "./testids";
import ManualHeroesTab from "./ManualHeroesTab";
import ManualSkillsTab from "./ManualSkillsTab";
import ManualJinnangTab from "./ManualJinnangTab";
import ManualTreasuresTab from "./ManualTreasuresTab";

interface ManualModalProps {
  /** 开合(纯受控)。 */
  open: boolean;
  onClose: () => void;
}

/** 签键(签序=目录序,spec #1069 决议④)。 */
type ManualTabKey = "heroes" | "skills" | "jinnang" | "treasures";

const TABS: ReadonlyArray<{
  key: ManualTabKey;
  label: string;
  tid: string;
}> = [
  { key: "heroes", label: "名将", tid: MANUAL_TID.tabHeroes },
  { key: "skills", label: "技能", tid: MANUAL_TID.tabSkills },
  { key: "jinnang", label: "锦囊", tid: MANUAL_TID.tabJinnang },
  { key: "treasures", label: "珍宝", tid: MANUAL_TID.tabTreasures },
];

/** 每签独立占位，签间留出空白。选中签上浮 2px 并显示金边。 */
const TAB_CLS =
  "min-h-(--touch-target) min-w-(--touch-target) flex-none rounded-[3px] border px-2.5 py-1 font-brush text-[15px] sm:px-3.5 " +
  "tracking-[0.2em] transition-[border-color,color,background-color,transform,box-shadow] " +
  "duration-[var(--dur-fast)] ease-[var(--ease-out)]";

/** 手册大弹层(#1069 决议③/⑥:入口钮与题名同名「手册」)。 */
export function ManualModal({ open, onClose }: ManualModalProps) {
  const [tab, setTab] = useState<ManualTabKey>("heroes");
  if (!open) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        data-testid={MANUAL_TID.modal}
        aria-label="手册"
        /* 挂载不夺焦(PileShell 同款):只读浮层,焦点留在入口笺钮上 */
        initialFocus={false}
        className="top-[calc((100dvh_+_24px)/2)] h-[min(max-content,calc(100dvh-64px))] max-h-[calc(100dvh-64px)] w-[min(940px,94vw)] px-5 py-4"
      >
        <div data-testid={MANUAL_TID.screen} className="flex min-h-0 flex-1 flex-col">
          {/* 题名行兼拖动把手(#674):行内 X 钮自带豁免(起点命中按钮不启动拖) */}
          <DialogDragHandle
            className="flex min-h-(--touch-dialog-control) flex-none items-center gap-4 border-b border-gold/30 pr-12 pb-2.5"
            testid={MANUAL_TID.dragHandle}
          >
            {/* 可达名:题名即 DialogTitle(视觉/读屏同一节点);朱印单字「册」随题名右落 */}
            <DialogTitle className="text-[24px] leading-none tracking-[0.1em]">
              手册
              <span
                aria-hidden="true"
                className="ml-1.5 inline-grid h-[21px] w-[21px] rotate-[2.5deg] place-items-center rounded-[3px] align-[3px] bg-[color-mix(in_srgb,var(--color-danger)_62%,var(--color-bg-deep))] text-[13px] text-paper"
              >
                册
              </span>
            </DialogTitle>
            <RoundClose testid={MANUAL_TID.close} />
          </DialogDragHandle>
          {/* 四签行(钉住不随滚):选中态=金描边+上浮,无文字标牌(§4.6) */}
          <div
            role="tablist"
            aria-label="手册分类"
            className="mt-3 flex flex-none flex-wrap items-center justify-center gap-2"
          >
            {TABS.map((t) => {
              const selected = t.key === tab;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={t.tid}
                  onClick={() => setTab(t.key)}
                  className={
                    TAB_CLS +
                    (selected
                      ? " -translate-y-0.5 border-gold-bright bg-panel-hi/60 text-paper shadow-[0_3px_10px_rgba(0,0,0,0.35)]"
                      : " border-transparent text-paper-dim ")
                  }
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <ScrollArea data-testid={MANUAL_TID.body} className="mt-3 min-h-0 flex-1">
            {tab === "heroes" && <ManualHeroesTab />}
            {tab === "skills" && <ManualSkillsTab />}
            {tab === "jinnang" && <ManualJinnangTab />}
            {tab === "treasures" && <ManualTreasuresTab />}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
