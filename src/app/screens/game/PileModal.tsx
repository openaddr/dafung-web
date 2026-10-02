// 藏品弹层(#361,spec #357 T4):牌架双入口点开的两独立弹层——点「珍宝」开珍宝
// 弹层(装裱卡大格网格陈列全件,带指导价与品级角标)、点「名将」开名将弹层
// (HeroCardFace 详情档网格,麾下全部);标题随入口、右上 X,无互切页签、无
// 「府库」品名(视觉基准 proto/treasure/r5.html 节二/节三)。
//
// 壳走 ui/dialog 底件(Base UI:焦点陷阱/Esc/点外关闭全部白拿,不自写交互语义,
// 同 JinnangDetailSheet 先例);挂载不夺焦 = initialFocus={false},焦点留在入口
// 小件上,Esc 直关即可;可见题名即 DialogTitle(可达名=视觉题名同一节点)。
// 画心双通道:本层走缺省回退(远山肌理;快照珍宝无画心数据),art 通道保留在
// TreasureCardFace props 上;无「曾持有」区——UI 只显示当前状态(DESIGN §4.6)。
// 空陈列照常可开:计数角标如实报 0、网格自然为空(业务空态,非兜底)。
// 样式在 pile-modal.css(经 Portal 渲染在 body,.game-layout 罩不到——pile-* 前缀
// 防串扰,war-* 同先例)。
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { HeroCardFace } from "@app/components/card/HeroCardFace";
import { TreasureCardFace } from "@app/components/card/JinnangCardFace";
import { formatMoney } from "@core/money";
import { guidePriceOf } from "@core/treasures";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { TESTIDS } from "./testids";
import "./pile-modal.css";

/** 弹层种类(与牌架入口一一对应;标题随入口,HandRack 持有开合态)。 */
export type PileModalKind = "treasures" | "heroes";

const KIND_META = {
  treasures: {
    title: "珍宝",
    seal: "宝",
    sub: "珍宝收藏册 · 装裱陈列+品级角标",
    testid: TESTIDS.treasureModal,
  },
  heroes: {
    title: "名将",
    seal: "将",
    sub: "麾下名将 · 武将卡群",
    testid: TESTIDS.heroModal,
  },
} as const;

/** 弹层壳参数:题名/朱印小章/副题/容器 testid 显式传入——藏品弹层(KIND_META 给
 *  默认值)与交易选宝弹层(TreasurePickModal,标题随交涉口径/变卖自救语境)共用
 *  同一壳,不复制第二套壳皮。 */
export interface PileShellProps {
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
  onClose: () => void;
  children: ReactNode;
}

/** 弹层壳(fuku 漆金内环形制,r5 节二/节三同款):题名(朱印小章)+副题 + 右上 X,
 *  内容(children)= 陈列网格。题名即 DialogTitle(可达名单源)。 */
export function PileShell({
  title,
  seal,
  sub,
  testid,
  ariaLabel = title,
  className,
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
        <div className="pile-head">
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
          <button
            type="button"
            data-testid={TESTIDS.modalClose}
            aria-label="关闭"
            onClick={onClose}
            className="pile-close"
          >
            ×
          </button>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** 珍宝弹层内容:已持有全件的装裱卡大格网格(陈列档 7.6px 基=114×152),
 *  每格 = TreasureCardFace(品级角标+题签+鉴藏印)+ 指导价名牌;画心走缺省回退
 *  (远山肌理),art 通道保留;指导价同时进 title 浮签(名称/品级/风味文一行看全)。 */
function TreasureGrid({ player }: { player: SnapshotPlayer }) {
  return (
    <>
      <div className="pile-zone">
        <span className="pile-zdot" aria-hidden="true" />
        已持有 · {player.treasures.length} 件
        <small>(右上角标=品级,底色随品级;名牌=指导价)</small>
      </div>
      <div className="pile-grid">
        {player.treasures.map((t) => (
          <div className="pile-cell" key={t.id}>
            <TreasureCardFace
              name={t.name}
              level={t.level}
              desc={t.desc}
              className="pile-cell-card"
              title={`${t.name} · 品级 ${t.level} · 指导价 ${formatMoney(guidePriceOf(t.level))}${t.desc ? ` · ${t.desc}` : ""}`}
            />
            <span className="pile-price">指导价 {formatMoney(guidePriceOf(t.level))}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** 名将弹层内容:麾下全部名将的 HeroCardFace 详情档网格(技能全文档,13px 基);
 *  画像缺失(image="")或加载失败由卡面显「像」占位(组件内既有语义)。 */
function HeroGrid({ player }: { player: SnapshotPlayer }) {
  return (
    <>
      <div className="pile-zone">
        <span className="pile-zdot" aria-hidden="true" />
        麾下名将 · {player.heroes.length} 席
        <small>(HeroCardFace 详情档)</small>
      </div>
      <div className="pile-hero-grid">
        {player.heroes.map((h) => (
          <HeroCardFace key={h.id} heroId={h.id} size="detail" />
        ))}
      </div>
    </>
  );
}

/** 藏品弹层(#361):kind 决定陈列内容与题名(player = 本地视角玩家,数据单源快照)。 */
export function PileModal({
  kind,
  player,
  onClose,
}: {
  kind: PileModalKind;
  player: SnapshotPlayer;
  onClose: () => void;
}) {
  return (
    <PileShell
      title={KIND_META[kind].title}
      seal={KIND_META[kind].seal}
      sub={`${player.guohao} · ${KIND_META[kind].sub}`}
      testid={KIND_META[kind].testid}
      ariaLabel={`${KIND_META[kind].title} · ${player.guohao}`}
      onClose={onClose}
    >
      {kind === "treasures" ? <TreasureGrid player={player} /> : <HeroGrid player={player} />}
    </PileShell>
  );
}
