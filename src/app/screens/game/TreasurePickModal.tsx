// 交易选宝弹层(#362,spec #357 T5):城主交涉「公道买卖/坐地起价」选定后的选宝
// 界面与破产变卖自救共用同一选择模式(视觉基准 proto/treasure/backpack.html 节三
// 交易弹段)——PileShell 壳 + 装裱卡网格,点选=金描边上浮,价签随选中转「成交 · 至
// N 两」(变卖恒「至 N 两」);底部成交/变卖钮二段式防误触:第一段=预选态点亮
// 「确认成交」,第二段=确认提交。选牌(可反悔)与成交(提交)分两段,替代旧
// 「点牌名即成交」。
// 协议零改:treasureId 原样进 resolveTreasureOwner / sellTreasureBankruptcy;拾取器
// 是本地 UI 态,不是 ADR-0013 选项集(交涉三选仍在卷轴,两者不混)。
// 卡格=真 <button> 包牌面(HandRack RackCard 同口径,交互语义不裸写 role)。
import { useState, type ReactNode } from "react";
import { PileShell } from "./PileModal";
import { TreasureCardFace } from "@app/components/card/JinnangCardFace";
import type { SnapshotTreasure } from "@app/store/gameStore";
import "./pile-modal.css";
import "./treasure-pick.css";

/** 各流程的 testid 族(交涉=treasure*、破产=bankruptcy*;单源 scroll/testids.ts)。 */
export interface TreasurePickTestids {
  /** 弹层容器(DialogContent)。 */
  container: string;
  /** 珍宝卡格(点选=预选)。 */
  item: (treasureId: string) => string;
  /** 成交/变卖钮(二段式)。 */
  confirm: string;
  /** 底部返回钮(交涉=回模式选择步);不传=不渲染(变卖用右上 X/Esc 关层)。 */
  back?: string;
}

export interface TreasurePickModalProps {
  /** 题名(交涉=「公道买卖 · 选珍宝」随口径;破产=「变卖自救 · 变卖珍宝」)。 */
  title: string;
  /** 题名朱印小章单字(交/变)。 */
  seal: string;
  /** 副题行(语境一句)。 */
  sub: string;
  /** 语境区(题名下、网格上):交涉=报价口径句;破产=已凑/债务进度条。 */
  context?: ReactNode;
  treasures: SnapshotTreasure[];
  /** 价签文案(随选中态):未选=指导价/至 N 两,交涉选中=「成交 · 至 N 两」。 */
  tagOf: (t: SnapshotTreasure, selected: boolean) => string;
  /** 底部结算预览句(选中才显示):「卖出 X · 入账 N 两 · 长安 +1 级」。 */
  summaryOf: (t: SnapshotTreasure) => string;
  /** 无预选时结算位的指引句。 */
  hint: string;
  /** 成交/变卖钮基名(武装态加「确认」前缀)。 */
  confirmLabel: string;
  testids: TreasurePickTestids;
  /** 二段确认的提交(treasureId 原样,协议零改)。 */
  onConfirm: (treasureId: string) => void;
  onClose: () => void;
}

export function TreasurePickModal({
  title,
  seal,
  sub,
  context,
  treasures,
  tagOf,
  summaryOf,
  hint,
  confirmLabel,
  testids,
  onConfirm,
  onClose,
}: TreasurePickModalProps) {
  // 预选(可反悔)+ 二段武装:点卡=预选(金描边上浮,换卡即解除武装——确认态只属于
  // 被确认的那一件);成交钮第一段只点亮确认态,第二段才提交。
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const picked = treasures.find((t) => t.id === pickedId);

  return (
    <PileShell
      title={title}
      seal={seal}
      sub={sub}
      testid={testids.container}
      className="treasure-pick"
      onClose={onClose}
    >
      {context}
      <div className="pile-zone">
        <span className="pile-zdot" aria-hidden="true" />
        待选 · {treasures.length} 件
        <small>(点选=金描边上浮,价签转成交;底部两段确认)</small>
      </div>
      <div className="pile-grid">
        {treasures.map((t) => {
          const sel = t.id === pickedId;
          return (
            <button
              type="button"
              key={t.id}
              data-testid={testids.item(t.id)}
              aria-pressed={sel}
              onClick={() => {
                setArmed(false);
                setPickedId(t.id);
              }}
              className={"pile-cell treasure-pick-cell" + (sel ? " treasure-pick-sel" : "")}
            >
              <TreasureCardFace
                name={t.name}
                level={t.level}
                desc={t.desc}
                className="pile-cell-card"
                title={`${t.name} · 品级 ${t.level}${t.desc ? ` · ${t.desc}` : ""}`}
              />
              <span className="pile-price">{tagOf(t, sel)}</span>
            </button>
          );
        })}
      </div>
      <div className="treasure-pick-foot">
        {testids.back !== undefined && (
          <button
            type="button"
            data-testid={testids.back}
            onClick={onClose}
            className="treasure-pick-btn"
          >
            返回
          </button>
        )}
        {/* aria-live:预选/结算预览随点选播报(点选语言的状态反馈,不加文字标牌) */}
        <span className="treasure-pick-sum" aria-live="polite">
          {picked !== undefined ? summaryOf(picked) : hint}
        </span>
        <button
          type="button"
          data-testid={testids.confirm}
          disabled={picked === undefined}
          title={armed ? undefined : "再点一次确认"}
          onClick={() => {
            // disabled 保证选中非空(浏览器禁用契约,RackCard 灰置同口径),不写运行时再守
            if (!armed) {
              setArmed(true);
              return;
            }
            onConfirm(picked!.id);
          }}
          className={
            "treasure-pick-btn treasure-pick-ok" + (armed ? " treasure-pick-armed" : "")
          }
        >
          {armed ? `确认${confirmLabel}` : confirmLabel}
        </button>
      </div>
    </PileShell>
  );
}
