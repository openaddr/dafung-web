// 组件收口:地图和重试条目用 Base UI Button，横滑沿用原生滚动。
import { Button } from "@base-ui/react/button";
import { useLayoutEffect, useRef } from "react";
import type { MapSource } from "@dafung/core/engine/map-source";
import { formatMoney } from "@dafung/core/engine/money";
import { InkBreathe, SealEmpty } from "@app/screens/shared/ArtifactEmpty";
import { useMapCatalog } from "@app/screens/setup/useMapCatalog";
import { HOME_TID } from "./testids";

interface MapStripProps {
  mapSource: MapSource;
  selectedMapId: string;
  onSelect: (mapId: string) => void;
}

export function MapStrip({ mapSource, selectedMapId, onSelect }: MapStripProps) {
  const { entries, error, reload } = useMapCatalog(mapSource);
  const stripRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // 恢复选中、点到半露签或条带尺寸改变时仅滚动地图条，首页保持原位。
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const card = selectedRef.current;
    if (!strip || !card) return;

    const reveal = () => {
      const start = card.offsetLeft;
      if (
        start < strip.scrollLeft ||
        start + card.offsetWidth > strip.scrollLeft + strip.clientWidth
      ) {
        strip.scrollLeft = start;
      }
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [entries, selectedMapId]);

  if (error) {
    return (
      <div data-testid={HOME_TID.mapStrip} className="home-map-status">
        <p className="home-map-name text-sm text-danger">加载失败:{error}</p>
        <Button
          onClick={reload}
          className="note-btn min-h-(--touch-target) rounded-[3px] px-3 font-brush"
        >
          重试
        </Button>
      </div>
    );
  }
  if (!entries) {
    return (
      <div data-testid={HOME_TID.mapStrip} className="home-map-status">
        <InkBreathe title="载入地图清单" />
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div data-testid={HOME_TID.mapStrip} className="home-map-status">
        <SealEmpty char="空" note="尚无图志" title="暂无可用地图" />
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="选择地图"
      data-testid={HOME_TID.mapStrip}
      data-many={entries.length > 2}
      ref={stripRef}
      className="home-map-strip"
    >
      {entries.map((entry) => {
        const selected = entry.id === selectedMapId;
        return (
          <Button
            key={entry.id}
            ref={selected ? selectedRef : undefined}
            data-testid={HOME_TID.mapStripItem(entry.id)}
            aria-pressed={selected}
            onClick={() => onSelect(entry.id)}
            className="home-map-card"
          >
            <span className="home-map-name">{entry.name}</span>
            <span className="home-map-details">
              <span>{entry.tileCount} 城 ·</span>{" "}
              <span>目标 {formatMoney(entry.targetNetWorth)}</span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}
