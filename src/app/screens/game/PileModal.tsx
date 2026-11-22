// 组件收口:已收口——PileShell 共用壳(藏品/选宝/窥探/学技),底件 ui/dialog,挂载不夺焦;#708 矮屏规范=夹高视口−64px+头部钉住+体部内滚+footer 钉底(细则 docs/design/组件收口.md)
// 藏品弹层(#361,spec #357 T4):牌架双入口点开的两独立弹层——点「珍宝」开珍宝
// 弹层(装裱卡大格网格陈列全件,带指导价与品级角标)、点「名将」开名将弹层
// (共用 HeroInspectionModal 人物卷,画像签切将);标题随入口、右上 X,无互切页签、无
// 「府库」品名(视觉基准 proto/treasure/r5.html 节二/节三)。
//
// 壳走 ui/dialog 底件(Base UI:焦点陷阱/Esc/点外关闭全部白拿,不自写交互语义,
// 同 JinnangDetailSheet 先例);挂载不夺焦 = initialFocus={false},焦点留在入口
// 小件上,Esc 直关即可;可见题名即 DialogTitle(可达名=视觉题名同一节点)。
// 快照珍宝行经 TreasureArt 取目录画心或带真实技名的技能书装订册;
// 无「曾持有」区——UI 只显示当前状态(DESIGN §4.6)。
// 空陈列照常可开:计数角标如实报 0;空网格接 #768 器物空态制式(斜放朱印+短注,
// 单源 screens/shared/ArtifactEmpty,#851 接入)。
// 样式在 pile-modal.css(经 Portal 渲染在 body,.game-layout 罩不到——pile-* 前缀
// 防串扰,war-* 同先例)。
// 矮屏规范(#708,五族一处收口):壳最大高=视口高−64px(上下安全边);头部钉住,
// 体部=ui/scroll-area 内滚(首帧可见滚动提示),底部操作行经 footer 槽钉住不随滚;
// 矮横屏档行高自适应(卡基/列宽缩档)断头防治,细则全在 pile-modal.css 规范块。
import { memo, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { RoundClose } from "@app/screens/shared/RoundClose";
import { ScrollArea } from "@app/components/ui/scroll-area";
import { DialogDragHandle } from "@app/hooks/use-dialog-drag";
import { TreasureCardFace } from "@app/components/card/JinnangCardFace";
import { TreasureArt } from "@app/components/card/TreasureArt";
import { SealEmpty } from "@app/screens/shared/ArtifactEmpty";
import { formatMoney } from "@core/money";
import { guidePriceOf, isSkillBook } from "@core/treasures";
import { skillBookLearners } from "@core/roster";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { TESTIDS } from "./testids";
import { HeroInspectionModal } from "./HeroInspectionModal";
import "./pile-modal.css";

/** 弹层种类(与牌架入口一一对应;标题随入口,HandRack 持有开合态)。 */
export type PileModalKind = "treasures" | "heroes";

const KIND_META = {
  treasures: {
    title: "珍宝",
    seal: "宝",
    sub: "珍宝收藏册",
    testid: TESTIDS.treasureModal,
  },
  heroes: {
    title: "名将",
    seal: "将",
    sub: "麾下名将",
    testid: TESTIDS.heroModal,
  },
} as const;

/** 弹层壳参数:题名/朱印小章/副题/容器 testid 显式传入——藏品弹层(KIND_META 给
 *  默认值)与交易选宝弹层(TreasurePickModal,标题随交涉口径/变卖自救语境)共用
 *  同一壳,不复制第二套壳皮。 */
interface PileShellProps {
  title: string;
  /** 题名右落的朱印小章单字(宝/将/交/变)。 */
  seal: string;
  /** 副题行(国号语境/口径一句)。 */
  sub: string;
  /** 容器 data-testid(各弹层单源 testids)。 */
  testid: string;
  /** 可达名(缺省=题名;藏品弹层传「题名 · 国号」保持既有口径)。 */
  ariaLabel?: string;
  /** 附加类(treasure-pick 选宝态样式挂点);基壳类恒带。 */
  className?: string;
  /** 钉底操作行(#708 矮屏规范,可选):恒钉在壳内下缘,不随体部滚动——交易选宝
   *  的成交/变卖行由此传入;只读弹层不传即无操作行。 */
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/** 弹层壳(fuku 漆金内环形制,r5 节二/节三同款):题名(朱印小章)+副题 + 右上 X,
 *  内容(children)= 陈列网格。题名即 DialogTitle(可达名单源)。
 *  矮屏规范(#708):头部钉住 + 体部 pile-body 内滚(ui/scroll-area)+ footer 钉底;
 *  壳自身不滚(夹高细则在 pile-modal.css 规范块)。
 */
export function PileShell({
  title,
  seal,
  sub,
  testid,
  ariaLabel = title,
  className,
  footer,
  onClose,
  children,
}: PileShellProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid={testid}
        aria-label={ariaLabel}
        /* 挂载不夺焦(JinnangDetailSheet 同款):只读浮层,焦点留在触发入口上,
            Esc/点遮罩/X 三路关闭全由底件与壳承担 */
        initialFocus={false}
        className={className ? `pile-modal ${className}` : "pile-modal"}
      >
        {/* 题名行兼拖动把手(#674):把手原语由 DialogContent 下发,行内 X 钮自带
            豁免(起点命中按钮不启动拖)——五个藏品弹层共用本壳,自动获得同一手势 */}
        <DialogDragHandle className="pile-head" testid={TESTIDS.modalDragHandle}>
          <div>
            {/* 可达名:题名即 DialogTitle(视觉/读屏同一节点,不另写 sr-only) */}
            <DialogTitle className="pile-title">
              {title}
              <span className="pile-seal" aria-hidden="true">
                {seal}
              </span>
            </DialogTitle>
            <div className="pile-sub">{sub}</div>
          </div>
          <RoundClose testid={TESTIDS.modalClose} />
        </DialogDragHandle>
        {/* 体部内滚(#708):头部/footer 之外的全部内容;首帧可见滚动提示由
            ui/scroll-area 底件承担(keepMounted+溢出门控常显) */}
        <ScrollArea className="pile-body" data-testid={TESTIDS.modalScrollBody}>
          {children}
        </ScrollArea>
        {footer != null && (
          <div className="pile-foot" data-testid={TESTIDS.modalFooter}>
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 藏品弹层计数条(R2 残余收口):pile-zone 三行 markup 的单源小件,七处消费
 *  (PileModal 珍宝/名将、SeatAttrModals 名将/珍宝、CityLedgerModal、
 *  SkillBookLearnModal、TreasurePickModal)。 */
export function PileZone({ children }: { children: ReactNode }) {
  return (
    <div className="pile-zone">
      <span className="pile-zdot" aria-hidden="true" />
      {children}
    </div>
  );
}

/** 藏品与选宝共用装裱卡。指导价和可点态由各自的操作场景决定。 */
export function treasureFace(t: SnapshotPlayer["treasures"][number]) {
  return (
    <TreasureCardFace
      name={t.name}
      level={t.level}
      desc={t.desc}
      art={<TreasureArt treasure={t} />}
      className="pile-cell-card"
    />
  );
}

/** 珍宝价签名牌(与 treasureFace 配对,见上)。 */
export function treasurePrice(t: SnapshotPlayer["treasures"][number]) {
  return <span className="pile-price">指导价 {formatMoney(guidePriceOf(t.level))}</span>;
}

/** 珍宝弹层内容:已持有全件的装裱卡大格网格(陈列档 7.6px 基=114×152),
 *  每格显示装裱卡与指导价，技能书还显示研读入口或当前不可学原因。 */
function TreasureGrid({ player }: { player: SnapshotPlayer }) {
  return (
    <>
      {player.treasures.length === 0 ? (
        <div className="flex justify-center py-6">
          <SealEmpty char="宝" note="库中尚空" title="暂无珍宝" />
        </div>
      ) : (
        <div className="pile-grid">
          {player.treasures.map((t, i) => (
            <div className="pile-cell" key={`${t.id}:${i}`}>
              {treasureFace(t)}
              {treasurePrice(t)}
              {isSkillBook(t) && (
                <span className="pile-book-reason">
                  {skillBookLearners(player, t.skillId).length > 0
                    ? "出牌阶段可在手牌区研读"
                    : "麾下无人可习此技（可交易变卖）"}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Props 形状单点(值等比较器与组件共用,防两处漂移)。 */
interface PileModalProps {
  kind: PileModalKind;
  player: SnapshotPlayer;
  /** 遣散可点窗口(#1147):己方回合(GameScreen 计算=本地决策+Playing+自己回合);
   *  缺省=false——遣散钮恒禁用态。 */
  dismissReady?: boolean;
  /** 遣散命令通路(#1147,dismissHero;缺省=无通路,遣散钮恒禁用态)。 */
  onDismiss?: (heroId: string) => void;
  onClose: () => void;
}

/** 值等(#1140 渲染税):kind+player(值等复用引用)+dismissReady(值等,#1147 遣散钮随己方回合翻面);onClose/
 *  onDismiss 不入比较(setState/命令驱动,行为恒定)。藏品层是全仓最大壳(94vw),
 *  演出期开着掂量时内容没变的拍在此 bail out。 */
function pileModalEqual(a: PileModalProps, b: PileModalProps): boolean {
  return a.kind === b.kind && a.player === b.player && a.dismissReady === b.dismissReady;
}

export const PileModal = memo(function PileModal({
  kind,
  player,
  dismissReady = false,
  onDismiss,
  onClose,
}: PileModalProps) {
  if (kind === "heroes") {
    return (
      <HeroInspectionModal
        player={player}
        testid={TESTIDS.heroModal}
        dismissReady={dismissReady}
        onDismiss={onDismiss}
        onClose={onClose}
      />
    );
  }
  return (
    <PileShell
      title={KIND_META[kind].title}
      seal={KIND_META[kind].seal}
      sub={`${player.guohao} · ${player.treasures.length} 件`}
      testid={KIND_META[kind].testid}
      ariaLabel={`${KIND_META[kind].title} · ${player.guohao}`}
      onClose={onClose}
    >
      <TreasureGrid player={player} />
    </PileShell>
  );
}, pileModalEqual);
