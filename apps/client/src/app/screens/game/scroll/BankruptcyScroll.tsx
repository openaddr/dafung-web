// 组件收口:BannerShell 沿用焦点/拖动语义;预选用 Base UI Toggle,数量与翻页用 Button。
// 草选和最终提交由座位交互处理，卷轴负责分页与确认框。
import { useState } from "react";
import { Button } from "@base-ui/react/button";
import { Toggle } from "@base-ui/react/toggle";
import type { BankruptcyAsset } from "@dafung/core/engine/bankruptcy";
import { formatMoney } from "@dafung/core/engine/money";
import type {
  BankruptcyInteractionView,
  SeatIntent,
  SeatIntentResult,
} from "@dafung/core/protocol/seat-interaction";
import type { BankruptcySaleOption } from "@dafung/core/room/bankruptcy-decisions";
import { TreasureArt } from "@app/components/card/TreasureArt";
import { treasureArtId } from "@app/components/card/treasure-art";
import { getAudio } from "@app/fx/audio";
import { cn } from "@app/utils/cn";
import { Sym } from "@app/screens/shared/Sym";
import { SealEmpty } from "@app/screens/shared/ArtifactEmpty";
import { BannerShell, BannerButton } from "./BannerShell";
import { ConfirmDialog } from "./ConfirmDialog";
import { SCROLL_TESTIDS as T } from "./testids";

interface BankruptcyScrollProps {
  guohao: string;
  view: BankruptcyInteractionView;
  onIntent: (intent: SeatIntent) => SeatIntentResult | undefined;
}

type SaleGroup = BankruptcySaleOption & { key: string; groupId: string; ids: string[] };
const PAGE_SIZE = 6;

function groupSales(assets: readonly BankruptcySaleOption[]): SaleGroup[] {
  const groups = new Map<string, SaleGroup>();
  for (const option of assets) {
    // 同款珍宝共用一个数量器，草选仍逐件引用权威选项的 id。
    const groupId = option.kind === "treasure" ? treasureArtId(option.id) : option.id;
    const key = `${option.kind}:${groupId}`;
    const ids = Array.from({ length: option.maxQuantity }, () => option.id);
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, { ...option, key, groupId, ids });
    else existing.ids.push(...ids);
  }
  return [...groups.values()];
}

export function BankruptcyScroll({
  guohao,
  view: {
    decision: { cash, debt, assets },
    selected,
    selectedValue,
    canConfirm,
  },
  onIntent,
}: BankruptcyScrollProps) {
  const [page, setPage] = useState(0);
  const [confirmingBankruptcy, setConfirmingBankruptcy] = useState(false);
  const groups = groupSales(assets);
  const owe = Math.max(0, debt.amount - cash);
  const enough = selectedValue >= owe;
  const totalValue = assets.reduce((sum, option) => sum + option.price * option.maxQuantity, 0);
  const pageCount = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const belongsToGroup = (asset: BankruptcyAsset, group: SaleGroup) =>
    asset.kind === group.kind && group.ids.includes(asset.id);
  const add = (group: SaleGroup, quantity: number) => {
    const result = onIntent({
      type: "addBankruptcyAsset",
      asset: { kind: group.kind, id: group.ids[quantity] },
    });
    if (result?.status === "draft") getAudio().play("jinnangSelect");
  };
  const decrease = (group: SaleGroup) => {
    // 只撤回本组最后加选的一件，保留其他组与剩余实物的顺序。
    const asset = [...selected].reverse().find((candidate) => belongsToGroup(candidate, group));
    if (asset === undefined) throw new Error(`变卖草选缺少 ${group.key}`);
    onIntent({ type: "removeBankruptcyAsset", asset });
  };
  return (
    <>
      <BannerShell
        title={`${guohao}·变卖自救`}
        testid={T.bankruptcyScroll}
        wide
        bodyKey={page}
        className="bankruptcy-shell"
        summary={
          <div className="bankruptcy-catalog-head">
            <div data-testid={T.bankruptcyDebt} className="bankruptcy-account">
              <span>
                现钱 {formatMoney(cash)} · 债务 {formatMoney(debt.amount)}
              </span>
              {groups.length > 0 && totalValue < owe && (
                <small>全部变卖仍差 {formatMoney(owe - totalValue)}</small>
              )}
            </div>
            <div className="bankruptcy-pages">
              <Button
                aria-label="上一页"
                data-testid={T.bankruptcyPrevious}
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                <Sym name="back" size={16} />
              </Button>
              <span data-testid={T.bankruptcyPage}>
                {page + 1} / {pageCount}
              </span>
              <Button
                aria-label="下一页"
                data-testid={T.bankruptcyNext}
                disabled={page + 1 === pageCount}
                onClick={() => setPage(page + 1)}
              >
                <Sym name="back" size={16} />
              </Button>
            </div>
          </div>
        }
        footer={
          <div className="bankruptcy-footer">
            <div
              className="bankruptcy-totals"
              data-testid={T.bankruptcyProgress}
              aria-live="polite"
            >
              <div>
                <span>已选</span>
                <strong>{formatMoney(selectedValue)}</strong>
              </div>
              <div data-enough={enough || undefined}>
                <span>{enough ? "超出" : "还差"}</span>
                <strong>{formatMoney(Math.abs(owe - selectedValue))}</strong>
              </div>
            </div>
            <div className="bankruptcy-actions">
              <BannerButton
                testid={T.bankruptcyDeclare}
                onClick={() => setConfirmingBankruptcy(true)}
              >
                认破产
              </BannerButton>
              <BannerButton
                primary
                disabled={!canConfirm}
                testid={T.bankruptcyConfirm}
                onClick={() => onIntent({ type: "confirm" })}
              >
                出售并清偿
              </BannerButton>
            </div>
          </div>
        }
      >
        {groups.length === 0 ? (
          <div className="bankruptcy-empty">
            <SealEmpty char="无" note="没有可变卖珍宝或非都城城池" title="没有可变卖资产" />
            <p>名将不能变卖,认破产需再次确认。</p>
          </div>
        ) : (
          <div className="bankruptcy-grid">
            {groups.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((group) => {
              const quantity = selected.filter((asset) => belongsToGroup(asset, group)).length;
              const id = group.groupId;
              const duplicate = group.ids.length > 1;
              const art =
                group.kind === "treasure" ? (
                  <TreasureArt
                    treasure={{ id: group.id, ...group.treasure }}
                    className="bankruptcy-art"
                  />
                ) : (
                  <svg
                    className="bankruptcy-art"
                    viewBox="0 0 40 48"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M3 21 20 8l17 13H3Zm4 0v22h26V21M3 43h34M16 43V29h8v14M11 26v5m18-5v5M12 15V8h16v7" />
                  </svg>
                );
              const contents = (
                <>
                  {art}
                  <span className="bankruptcy-asset-copy">
                    <span className="bankruptcy-asset-name">{group.name}</span>
                    <span className="bankruptcy-asset-price">
                      {formatMoney(group.price)}
                      {duplicate && <small>/件</small>}
                    </span>
                    {group.kind === "property" && <small>Lv.{group.level}</small>}
                  </span>
                </>
              );
              return duplicate ? (
                <div
                  key={group.key}
                  data-testid={T.bankruptcyAsset(group.kind, id)}
                  data-selected={quantity > 0 || undefined}
                  className="bankruptcy-asset bankruptcy-duplicate"
                >
                  {contents}
                  <span className="bankruptcy-stock">共{group.ids.length}件</span>
                  <div className="bankruptcy-stepper" aria-label={`${group.name}数量`}>
                    <Button
                      aria-label={`减少${group.name}`}
                      data-testid={T.bankruptcyDecrease(id)}
                      disabled={quantity === 0}
                      onClick={() => decrease(group)}
                    >
                      −
                    </Button>
                    <output data-testid={T.bankruptcyQuantity(id)}>{quantity}</output>
                    <Button
                      aria-label={`增加${group.name}`}
                      data-testid={T.bankruptcyIncrease(id)}
                      disabled={enough || quantity === group.ids.length}
                      onClick={() => add(group, quantity)}
                    >
                      +
                    </Button>
                  </div>
                </div>
              ) : (
                <Toggle
                  key={group.key}
                  data-testid={T.bankruptcyAsset(group.kind, id)}
                  pressed={quantity > 0}
                  disabled={enough && quantity === 0}
                  onPressedChange={(pressed) => (pressed ? add(group, 0) : decrease(group))}
                  className={cn("bankruptcy-asset", quantity > 0 && "bankruptcy-selected")}
                >
                  {contents}
                </Toggle>
              );
            })}
          </div>
        )}
      </BannerShell>
      {confirmingBankruptcy && (
        <ConfirmDialog
          danger
          title="确认认破产?"
          confirmLabel="确认认破产"
          cancelLabel="返回清算"
          onCancel={() => setConfirmingBankruptcy(false)}
          onConfirm={() => {
            setConfirmingBankruptcy(false);
            onIntent({ type: "declareBankruptcy" });
          }}
        >
          认破产后立即出局。现金、城池与珍宝按债主关系清算,名将回招贤池,不换银也不折书。
        </ConfirmDialog>
      )}
    </>
  );
}
