// 组件收口:BannerShell 沿用焦点/拖动语义;预选用 Base UI Toggle,数量与翻页用 Button。
// 预选只在本组件保存;最终将按加选顺序排列的逐件明细交权威一次出售并清偿。
import { useState } from "react";
import { Button } from "@base-ui/react/button";
import { Toggle } from "@base-ui/react/toggle";
import type { GameCommand } from "@dafung/core/engine/authority";
import type { BankruptcyAsset } from "@dafung/core/engine/bankruptcy";
import { guidePriceOf } from "@dafung/core/engine/treasures";
import { formatMoney } from "@dafung/core/engine/money";
import type { SnapshotTreasure } from "@app/store/gameStore";
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
  cash: number;
  debtAmount: number;
  treasures: SnapshotTreasure[];
  /** 调用方排除都城,变卖价与引擎共用 sellValueOf。 */
  sellableProperties: { propId: string; name: string; sellPrice: number; level: number }[];
  onCommand: (cmd: GameCommand) => void;
}

interface SaleGroupFields {
  key: string;
  ids: string[];
  name: string;
  price: number;
  level: number;
}

type SaleGroup = SaleGroupFields &
  ({ kind: "treasure"; treasure: SnapshotTreasure } | { kind: "property" });

type SelectedAsset = BankruptcyAsset & { group: string; price: number };
const PAGE_SIZE = 6;

export function BankruptcyScroll({
  guohao,
  cash,
  debtAmount,
  treasures,
  sellableProperties,
  onCommand,
}: BankruptcyScrollProps) {
  const [selected, setSelected] = useState<SelectedAsset[]>([]);
  const [page, setPage] = useState(0);
  const [confirmingBankruptcy, setConfirmingBankruptcy] = useState(false);
  const treasureGroups = new Map<string, SaleGroup & { kind: "treasure" }>();
  for (const t of treasures) {
    // 普通珍宝=目录 id + 牌堆序号;同技多册技能书共用 id,不能用 Set 去重实物。
    const id = treasureArtId(t.id);
    const existing = treasureGroups.get(id);
    if (existing) existing.ids.push(t.id);
    else {
      treasureGroups.set(id, {
        key: `treasure:${id}`,
        kind: "treasure",
        ids: [t.id],
        name: t.name,
        price: guidePriceOf(t.level),
        level: t.level,
        treasure: t,
      });
    }
  }
  const groups: SaleGroup[] = [
    ...treasureGroups.values(),
    ...sellableProperties.map((p) => ({
      key: `property:${p.propId}`,
      kind: "property" as const,
      ids: [p.propId],
      name: p.name,
      price: p.sellPrice,
      level: p.level,
    })),
  ];
  const owe = Math.max(0, debtAmount - cash);
  const selectedValue = selected.reduce((sum, asset) => sum + asset.price, 0);
  const enough = selectedValue >= owe;
  const totalValue = groups.reduce((sum, group) => sum + group.price * group.ids.length, 0);
  const pageCount = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const groupId = (group: SaleGroup) => group.key.slice(group.kind.length + 1);
  const add = (group: SaleGroup, quantity: number) => {
    setSelected([
      ...selected,
      {
        kind: group.kind,
        id: group.ids[quantity],
        group: group.key,
        price: group.price,
      },
    ]);
    getAudio().play("jinnangSelect");
  };
  const decrease = (group: SaleGroup) => {
    // 只撤回本组最后加选的一件,保留其他组与剩余实物的顺序。
    const index = selected.map((asset) => asset.group).lastIndexOf(group.key);
    setSelected(selected.filter((_, i) => i !== index));
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
                现钱 {formatMoney(cash)} · 债务 {formatMoney(debtAmount)}
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
                disabled={!enough}
                testid={T.bankruptcyConfirm}
                onClick={() =>
                  onCommand({
                    type: "confirmBankruptcySettle",
                    assets: selected.map(({ kind, id }) => ({ kind, id })),
                  })
                }
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
              const quantity = selected.filter((asset) => asset.group === group.key).length;
              const id = groupId(group);
              const duplicate = group.ids.length > 1;
              const art =
                group.kind === "treasure" ? (
                  <TreasureArt treasure={group.treasure} className="bankruptcy-art" />
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
            onCommand({ type: "declareBankruptcy" });
          }}
        >
          认破产后立即出局。现金、城池与珍宝按债主关系清算,名将回招贤池,不换银也不折书。
        </ConfirmDialog>
      )}
    </>
  );
}
