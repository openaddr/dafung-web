// 组件收口:模式、地图、手册、试听与诊断入口沿用 Base UI Button。
import { Button } from "@base-ui/react/button";
import { useEffect, useState } from "react";
import type { MapSource } from "@dafung/core/engine/map-source";
import { getMapSource } from "@app/map-sources";
import { startWarmup } from "@app/warmup";
import { useIsShortLandscape } from "@app/hooks/use-media-query";
import { ManualModal } from "@app/screens/manual/ManualModal";
import { MapSelectPanel } from "@app/screens/setup/MapSelectPanel";
import { TID } from "@app/screens/setup/testids";
import { useMapName } from "@app/screens/setup/useMapName";
import { GameDiagnosticDialog } from "@app/screens/shared/GameDiagnosticDialog";
import { Sym } from "@app/screens/shared/Sym";
import { SoundMenu } from "@app/screens/sound/SoundBoard";
import { HOME_TID } from "./testids";
import { MapStrip } from "./MapStrip";
import { VERSION } from "../../../version";
import "./home.css";

interface HomeScreenProps {
  onSolo: () => void;
  onOnline: () => void;
  /** 初始选中的地图 id 来自 App 解析的清单首项或 localStorage 记忆。 */
  initialMapId: string;
  /** 接线方将选中地图持久化至 localStorage。 */
  onMapChange?: (mapId: string) => void;
  mapSource?: MapSource;
}

export function HomeScreen({
  onSolo,
  onOnline,
  initialMapId,
  onMapChange,
  mapSource = getMapSource(),
}: HomeScreenProps) {
  const [selectedMapId, setSelectedMapId] = useState(initialMapId);
  const [showMapSelect, setShowMapSelect] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const isShortLandscape = useIsShortLandscape();
  const mapName = useMapName(mapSource, selectedMapId);

  useEffect(() => {
    startWarmup();
  }, []);

  const pickMap = (mapId: string) => {
    setSelectedMapId(mapId);
    onMapChange?.(mapId);
  };
  const secondary = [
    { tid: HOME_TID.online, label: "联机模式", onClick: onOnline },
    { tid: HOME_TID.manual, label: "手册", onClick: () => setManualOpen(true) },
  ];

  return (
    <div data-testid={HOME_TID.screen} className="home-screen">
      <div className="home-layout">
        <div className="home-cover">
          <div className="home-artwork" aria-hidden="true">
            <div className="home-factions">
              <span>魏</span>
              <span>蜀</span>
              <span>吴</span>
            </div>
          </div>
          <h1 className="home-title-in home-title font-title">群雄逐鹿</h1>
        </div>

        <div className="home-menu">
          <div className="home-btn-in" style={{ animationDelay: "300ms" }}>
            <Button
              data-testid={HOME_TID.solo}
              onClick={onSolo}
              className="home-menu-btn home-btn-brush home-primary ink-btn"
            >
              单机模式
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {secondary.map(({ tid, label, onClick }, index) => (
              <div
                key={tid}
                className="home-btn-in"
                style={{ animationDelay: `${380 + index * 80}ms` }}
              >
                <Button
                  data-testid={tid}
                  onClick={onClick}
                  className="home-menu-btn home-btn-brush note-btn"
                >
                  {label}
                </Button>
              </div>
            ))}
          </div>

          {isShortLandscape ? (
            <MapStrip mapSource={mapSource} selectedMapId={selectedMapId} onSelect={pickMap} />
          ) : (
            <Button
              data-testid={HOME_TID.selectMap}
              onClick={() => setShowMapSelect(true)}
              className="home-map-trigger note-btn"
            >
              <span className="font-brush">选择地图</span>
              <span data-testid={TID.currentMapName} className="home-map-name">
                {mapName}
              </span>
              <Sym name="expand" size={11} className="shrink-0 text-paper-dim" />
            </Button>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              data-testid={HOME_TID.soundAudition}
              aria-haspopup="dialog"
              onClick={() => setSoundOpen(true)}
              className="home-tool"
            >
              <Sym name="sound" />
              音效试听
            </Button>
            <Button
              data-testid={HOME_TID.diagExport}
              onClick={() => setDiagOpen(true)}
              className="home-tool"
            >
              对局诊断
            </Button>
          </div>
        </div>
      </div>

      <div className="home-version">v{VERSION}</div>
      {soundOpen && <SoundMenu onClose={() => setSoundOpen(false)} />}
      {diagOpen && <GameDiagnosticDialog onClose={() => setDiagOpen(false)} />}
      {!isShortLandscape && showMapSelect && (
        <MapSelectPanel
          mapSource={mapSource}
          currentMapId={selectedMapId}
          onConfirm={(mapId) => {
            setShowMapSelect(false);
            pickMap(mapId);
          }}
          onCancel={() => setShowMapSelect(false)}
        />
      )}
      <ManualModal open={manualOpen} onClose={() => setManualOpen(false)} />
    </div>
  );
}
