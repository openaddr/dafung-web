// 组件收口:交易选宝沿用 PileShell→ui/dialog;先预选并显示报价，再提交交涉命令。
// 坐地起价与公道买卖共用装裱卡网格,点选=预选,点成交提交 treasureId。
// 交易条件与结算预览、成交钮同处固定 footer。
import { useState, type ReactNode } from "react";
import { Button } from "@base-ui/react/button";
import { PileShell, PileZone, treasureFace } from "./PileModal";
import type { SnapshotTreasure } from "@app/store/gameStore";
import "./pile-modal.css";
import "./treasure-pick.css";

/** 交涉 testid 族(单源 scroll/testids.ts)。 */
interface TreasurePickTestids {
  /** 弹层容器(DialogContent)。 */
  container: string;
  /** 珍宝卡格(点选=预选)。 */
  item: (treasureId: string) => string;
  /** 成交钮。 */
  confirm: string;
  /** 底部返回钮(回模式选择步);不传则不渲染。 */
  back?: string;
}

interface TreasurePickModalProps {
  /** 题名(「公道买卖 · 选珍宝」等)。 */
  title: string;
  /** 题名朱印小章单字。 */
  seal: string;
  /** 副题行(语境一句)。 */
  sub: string;
  /** 固定操作区的报价和城池结果。 */
  context?: ReactNode;
  treasures: SnapshotTreasure[];
  /** 价签(随选中态):交涉未选=「指导价 N」/坐地双行「指导价+要价」小节,选中=「成交 ·
   *  至 N 两」。返回 ReactNode(字符串或双行小节)。 */
  tagOf: (t: SnapshotTreasure, selected: boolean) => ReactNode;
  /** 底部结算预览句(选中才显示):「卖出 X · 入账 N 两」。 */
  summaryOf: (t: SnapshotTreasure) => string;
  /** 成交钮文案。 */
  confirmLabel: string;
  testids: TreasurePickTestids;
  /** 按选中的珍宝提交。 */
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
  confirmLabel,
  testids,
  onConfirm,
  onClose,
}: TreasurePickModalProps) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = treasures.find((t) => t.id === pickedId);

  return (
    <PileShell
      title={title}
      seal={seal}
      sub={sub}
      testid={testids.container}
      className="treasure-pick"
      onClose={onClose}
      /* 底部操作行走 PileShell footer 槽(#708 矮屏规范):钉在壳内下缘,卡格再多
          内滚多深,返回/结算/成交行恒在场可达 */
      footer={
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
          {context != null && <div className="treasure-pick-foot-context">{context}</div>}
          {/* aria-live:预选/结算预览随点选播报(点选语言的状态反馈,不加文字标牌) */}
          <span className="treasure-pick-sum" aria-live="polite">
            {picked !== undefined && summaryOf(picked)}
          </span>
          <Button
            type="button"
            data-testid={testids.confirm}
            disabled={picked === undefined}
            onClick={() => onConfirm(picked!.id)}
            className="treasure-pick-btn treasure-pick-ok"
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <PileZone>待选 · {treasures.length} 件</PileZone>
      <div className="pile-grid">
        {treasures.map((t) => {
          const sel = t.id === pickedId;
          return (
            <button
              type="button"
              key={t.id}
              data-testid={testids.item(t.id)}
              aria-pressed={sel}
              onClick={() => setPickedId(t.id)}
              className={"pile-cell treasure-pick-cell" + (sel ? " treasure-pick-sel" : "")}
            >
              {treasureFace(t)}
              <span className="pile-price">{tagOf(t, sel)}</span>
            </button>
          );
        })}
      </div>
    </PileShell>
  );
}
