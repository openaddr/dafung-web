// 原型 #1399：现有手册珍宝签内比较三种结构，?prototype=treasure-wall&variant=A|B|C。
// A 整册卡墙 / B 左录右鉴 / C 图文行册。只读真实目录，正式构建不启用。
import { useState } from "react";
import { Button } from "@base-ui/react/button";
import type { TreasureDef } from "@core/treasures";
import { guidePriceOf } from "@core/treasures";
import { formatMoney } from "@core/money";
import { TreasureCardFace } from "@app/components/card/JinnangCardFace";
import { treasureImagePath } from "@app/components/card/jinnang-face-data";
import { PrototypeSwitcher } from "@app/components/prototype/PrototypeSwitcher";
import { ScrollArea } from "@app/components/ui/scroll-area";
import { MANUAL_TID } from "./testids";
import "./treasure-wall-prototype.css";

type Variant = "A" | "B" | "C";
const VARIANTS: ReadonlyArray<{ key: Variant; label: string }> = [
  { key: "A", label: "整册卡墙" },
  { key: "B", label: "左录右鉴" },
  { key: "C", label: "图文行册" },
];

export function isTreasureWallPrototype(): boolean {
  return (
    import.meta.env.DEV && new URLSearchParams(location.search).get("prototype") === "treasure-wall"
  );
}

function initialVariant(): Variant {
  const value = new URLSearchParams(location.search).get("variant");
  if (value === null) return "A";
  if (value !== "A" && value !== "B" && value !== "C") throw new Error(`未知珍宝原型：${value}`);
  return value;
}

function ObjectImage({ treasure }: { treasure: TreasureDef }) {
  const image = treasureImagePath(treasure.id);
  return image ? (
    <img src={image} alt={`${treasure.name}画心`} />
  ) : (
    <div className="twp-art-empty" aria-label="此珍宝暂无画心">
      <span>宝</span>
    </div>
  );
}

export function TreasureWallPrototype({
  rows,
  onInspect,
}: {
  rows: readonly TreasureDef[];
  onInspect: (id: string) => void;
}) {
  if (rows.length === 0) throw new Error("珍宝原型需要非空目录");
  const [variant, setVariant] = useState<Variant>(initialVariant);
  const [selectedId, setSelectedId] = useState(rows[0]!.id);
  const selected = rows.find((row) => row.id === selectedId);
  if (!selected) throw new Error("珍宝原型选中项不在目录");
  const chooseVariant = (next: Variant) => {
    const url = new URL(location.href);
    url.searchParams.set("variant", next);
    history.replaceState(null, "", url);
    setVariant(next);
  };
  return (
    <div className="treasure-wall-prototype" data-prototype-variant={variant}>
      {variant === "A" && (
        <div className="twp-wall">
          {rows.map((treasure) => {
            const image = treasureImagePath(treasure.id);
            return (
              <Button
                key={treasure.id}
                data-testid={MANUAL_TID.card(treasure.id)}
                className="twp-card-button"
                title={`${treasure.name} · 品级 ${treasure.level} · ${formatMoney(guidePriceOf(treasure.level))}`}
                onClick={() => onInspect(treasure.id)}
              >
                <TreasureCardFace
                  name={treasure.name}
                  level={treasure.level}
                  desc={treasure.desc}
                  art={image ? <img src={image} alt="" /> : undefined}
                  style={{ fontSize: "7.2px" }}
                />
              </Button>
            );
          })}
        </div>
      )}
      {variant === "B" && (
        <div className="twp-cabinet">
          <ScrollArea className="twp-index">
            {rows.map((treasure) => (
              <Button
                key={treasure.id}
                data-testid={MANUAL_TID.card(treasure.id)}
                className={"twp-index-row" + (selectedId === treasure.id ? " chosen" : "")}
                aria-pressed={selectedId === treasure.id}
                onClick={() => setSelectedId(treasure.id)}
              >
                <span>{treasure.name}</span>
                <small>{treasure.level}</small>
              </Button>
            ))}
          </ScrollArea>
          <div className="twp-reading" data-prototype-selection={selected.id}>
            <Button
              className="twp-reading-art"
              onClick={() => onInspect(selected.id)}
              aria-label={`展开${selected.name}详情`}
            >
              <ObjectImage treasure={selected} />
            </Button>
            <div className="twp-reading-text">
              <span className="twp-grade">品级 {selected.level}</span>
              <h3>{selected.name}</h3>
              <p>{selected.desc}</p>
              <div className="twp-reading-price">
                <span>指导价</span>
                <strong>{formatMoney(guidePriceOf(selected.level))}</strong>
              </div>
              <Button className="twp-inspect" onClick={() => onInspect(selected.id)}>
                展开画心
              </Button>
            </div>
          </div>
        </div>
      )}
      {variant === "C" && (
        <div className="twp-ledger">
          {rows.map((treasure) => (
            <Button
              key={treasure.id}
              data-testid={MANUAL_TID.card(treasure.id)}
              className="twp-ledger-row"
              onClick={() => onInspect(treasure.id)}
            >
              <div className="twp-ledger-art">
                <ObjectImage treasure={treasure} />
              </div>
              <div className="twp-ledger-copy">
                <h3>{treasure.name}</h3>
                <p>{treasure.desc}</p>
              </div>
              <div className="twp-ledger-value">
                <span>品级 {treasure.level}</span>
                <strong>{formatMoney(guidePriceOf(treasure.level))}</strong>
              </div>
            </Button>
          ))}
        </div>
      )}
      <PrototypeSwitcher
        variants={VARIANTS}
        current={variant}
        onChange={chooseVariant}
        state={`${rows.length} 项 · ${variant === "B" ? selected.name : "点珍宝看详情"}`}
        hostTestId={MANUAL_TID.modal}
      />
    </div>
  );
}
