// 组件收口:交易选宝沿用 PileShell→ui/dialog;二段式点选提交交涉命令。
// 坐地起价与公道买卖共用装裱卡网格,点选=预选,两段确认后提交 treasureId。
// 语境在矮横屏合入 footer,高档置于体部顶;任一档仅一份。
import { useState, type ReactNode } from "react";
import { useIsShortLandscape } from "@app/hooks/use-media-query";
import { PileShell, PileZone } from "./PileModal";
import { TreasureCardFace } from "@app/components/card/JinnangCardFace";
import { treasureImagePath } from "@app/components/card/jinnang-face-data";
import type { SnapshotTreasure } from "@app/store/gameStore";
import "./pile-modal.css";
import "./treasure-pick.css";

/** 交涉 testid 族(单源 scroll/testids.ts)。 */
interface TreasurePickTestids {
  /** 弹层容器(DialogContent)。 */
  container: string;
  /** 珍宝卡格(点选=预选)。 */
  item: (treasureId: string) => string;
  /** 成交钮(二段式)。 */
  confirm: string;
  /** 底部返回钮(回模式选择步);不传则不渲染。 */
  back?: string;
}

/** 矮横屏档判定走 useIsShortLandscape 单源(hooks/use-media-query.ts,断点串
 *  SHORT_LANDSCAPE_QUERY;#833 语境区分档换位用。JS 渲染分档而非 CSS 双副本的
 *  理由见文件头注)。 */

interface TreasurePickModalProps {
  /** 题名(「公道买卖 · 选珍宝」等)。 */
  title: string;
  /** 题名朱印小章单字。 */
  seal: string;
  /** 副题行(语境一句)。 */
  sub: string;
  /** 语境区(题名下、网格上):报价口径句。 */
  context?: ReactNode;
  treasures: SnapshotTreasure[];
  /** 价签(随选中态):交涉未选=「指导价 N」/坐地双行「指导价+要价」小节,选中=「成交 ·
   *  至 N 两」。返回 ReactNode(字符串或双行小节)。 */
  tagOf: (t: SnapshotTreasure, selected: boolean) => ReactNode;
  /** 底部结算预览句(选中才显示):「卖出 X · 入账 N 两 · 长安 +1 级」。 */
  summaryOf: (t: SnapshotTreasure) => string;
  /** 无预选时结算位的指引句。 */
  hint: string;
  /** 成交钮基名(武装态加「确认」前缀)。 */
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
  const shortStage = useIsShortLandscape();

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
          {/* ①矮横屏档语境行并入 footer(#833):交涉口径句并入钮行、语境整行垫在
              钮行上(footer 恒钉壳内下缘,点选/武装过程恒在);高档不渲染(体部顶副本
              在场) */}
          {shortStage && context != null && (
            <div className="treasure-pick-foot-context">{context}</div>
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
            className={"treasure-pick-btn treasure-pick-ok" + (armed ? " treasure-pick-armed" : "")}
          >
            {armed ? `确认${confirmLabel}` : confirmLabel}
          </button>
        </div>
      }
    >
      {/* 语境区分档在场(#833):高档在体部顶;矮档不渲染(footer 副本接管),体部首帧让位给整排卡+价签 */}
      {!shortStage && context}
      <PileZone>待选 · {treasures.length} 件</PileZone>
      <div className="pile-grid">
        {treasures.map((t) => {
          const sel = t.id === pickedId;
          const image = treasureImagePath(t.id);
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
                art={image != null ? <img src={image} alt="" /> : undefined}
                className="pile-cell-card"
                title={`${t.name} · 品级 ${t.level}${t.desc ? ` · ${t.desc}` : ""}`}
              />
              <span className="pile-price">{tagOf(t, sel)}</span>
            </button>
          );
        })}
      </div>
    </PileShell>
  );
}
