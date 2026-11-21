import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { useEffect, useId, useRef, useState } from "react";
import type { SeatConfig } from "@core/authority";
import type { EncounterSwitch } from "@core/encounters";
import type { MapSource } from "@core/map-source";
import { isSingleCjk } from "@core/constants";
import { formatMoney } from "@core/money";
import { playerColor, playerSealText, rgba } from "@core/theme";
import { Switch } from "@app/components/ui/switch";
import { getMapSource } from "@app/map-sources";
import { SegmentedSelect } from "@app/screens/shared/SegmentedSelect";
import { Stepper } from "@app/screens/shared/Stepper";
import { Sym } from "@app/screens/shared/Sym";
import { cn } from "@app/utils/cn";
import {
  BUILTIN_ENCOUNTER_DEFAULTS,
  fetchEncounterDefaults,
  toEncounterConfig,
} from "./encounterConfig";
import { GuohaoPicker } from "./GuohaoPicker";
import { MapSelectPanel } from "./MapSelectPanel";
import {
  DEFAULT_GUOHAO,
  DEFAULT_SEAT_COUNT,
  DEFAULT_TARGET_NET_WORTH,
  defaultSetupSeats,
} from "./setup-defaults";
import { TID } from "./testids";
import { useMapName } from "./useMapName";
import "./setup.css";

export interface SetupConfig {
  seats: SeatConfig[];
  targetNetWorth: number;
  mapId: string;
  /** 骰子种子由接线方解析后注入。 */
  seed?: number;
  encounter: EncounterSwitch;
}

interface SoloSetupScreenProps {
  onStart: (config: SetupConfig) => Promise<boolean>;
  onBack: () => void;
  mapId: string;
  mapSource?: MapSource;
  /** 确认换图后回传地图 id，由接线方记忆。 */
  onMapChange?: (mapId: string) => void;
}

const TARGET_OPTIONS = [
  { value: 15000, label: "速战" },
  { value: 30000, label: "标准" },
  { value: 60000, label: "鏖战" },
] as const;

/** 单机起兵后记录的国号，也是联机预设。 */
export const GUOHAO_PREF_KEY = "dafung.guohao";

export function SoloSetupScreen({
  onStart,
  onBack,
  mapId,
  mapSource = getMapSource(),
  onMapChange,
}: SoloSetupScreenProps) {
  const [seatCount, setSeatCount] = useState(DEFAULT_SEAT_COUNT);
  const [target, setTarget] = useState(DEFAULT_TARGET_NET_WORTH);
  const [guohao, setGuohao] = useState(
    () => localStorage.getItem(GUOHAO_PREF_KEY) ?? DEFAULT_GUOHAO,
  );
  const [currentMap, setCurrentMap] = useState(mapId);
  const [showMapSelect, setShowMapSelect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [encounter, setEncounter] = useState(BUILTIN_ENCOUNTER_DEFAULTS);
  const [encounterDefault, setEncounterDefault] = useState(BUILTIN_ENCOUNTER_DEFAULTS);
  const guohaoInputId = useId();
  // 打开字盘时收起输入法，让系统返回键交给字盘。
  const guohaoInputRef = useRef<HTMLInputElement>(null);
  const guohaoHelpId = useId();
  const mapName = useMapName(mapSource, currentMap);
  const trimmedGuohao = guohao.trim();
  const guohaoInvalid = !isSingleCjk(trimmedGuohao);
  const seats = defaultSetupSeats(trimmedGuohao, seatCount);

  useEffect(() => {
    let alive = true;
    fetchEncounterDefaults().then((enabled) => {
      if (alive) {
        setEncounter(enabled);
        setEncounterDefault(enabled);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      const started = await onStart({
        seats,
        targetNetWorth: target,
        mapId: currentMap,
        encounter: toEncounterConfig(encounter),
      });
      if (started) localStorage.setItem(GUOHAO_PREF_KEY, trimmedGuohao);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main data-testid={TID.screen} className="su-root bg-bg font-wenkai text-paper">
      <div className="su-wrap">
        <header className="su-header">
          <Button
            data-testid={TID.backTop}
            aria-label="返回首页"
            onClick={onBack}
            className="note-btn flex size-(--touch-target) items-center justify-center rounded-[3px]"
          >
            <Sym name="back" size={16} />
          </Button>
          <h1 className="su-title font-title">单机模式</h1>
        </header>

        <div className="su-card note-card scroll-anim-unroll">
          <div className="su-content">
            <section className="su-column su-config" aria-label="对局配置">
              <h2 className="su-section-title">对局配置</h2>

              <div className="su-config-row">
                <span className="text-paper-dim">地图</span>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span data-testid={TID.currentMapName} className="min-w-0 wrap-anywhere">
                    {mapName}
                  </span>
                  <Button
                    aria-label="更换地图"
                    onClick={() => setShowMapSelect(true)}
                    className="su-secondary note-btn font-brush"
                  >
                    更换
                  </Button>
                </div>
              </div>

              <div className="su-config-row">
                <span className="text-paper-dim">诸侯数</span>
                <Stepper
                  testid={TID.seatCount}
                  ariaLabel="诸侯数"
                  value={seatCount}
                  min={2}
                  max={8}
                  onChange={setSeatCount}
                />
              </div>

              <div className="su-config-row su-target">
                <span className="text-paper-dim">目标身价</span>
                <SegmentedSelect
                  testid={TID.target}
                  ariaLabel="目标身价"
                  value={target}
                  onChange={setTarget}
                  options={TARGET_OPTIONS.map(({ value, label }) => ({
                    value,
                    label: (
                      <span className="su-target-label">
                        <span>{label}</span>
                        <span className="font-wenkai text-xs tabular-nums">
                          {formatMoney(value)}
                        </span>
                      </span>
                    ),
                  }))}
                />
              </div>

              <details data-testid={TID.encounterToggle} className="su-encounter group">
                <summary
                  data-testid={TID.encounterSummary}
                  className="su-config-row su-encounter-summary"
                >
                  <span className="font-brush">机遇</span>
                  <span className="flex items-center justify-between gap-2 text-paper-dim">
                    <span>{encounter ? "开启" : "关闭"}</span>
                    <Sym
                      name="expand"
                      size={12}
                      className="transition-transform duration-[var(--dur-fast)] group-open:rotate-180"
                    />
                  </span>
                </summary>
                <div className="su-encounter-body">
                  <label data-testid={TID.encounterRow} className="su-encounter-option">
                    <span className="font-brush">机遇必出</span>
                    <Switch
                      data-testid={TID.encounterEnabled}
                      size="sm"
                      checked={encounter}
                      onCheckedChange={setEncounter}
                    />
                  </label>
                  <p className="su-encounter-help text-paper-dim">
                    开启后每次落格先触发一条机遇，运势概率随声望变化。
                    {encounterDefault ? "默认开启" : "默认关闭"}，此处调整仅对本局生效。
                  </p>
                </div>
              </details>
            </section>

            <section className="su-column" aria-label="国号与座次">
              <div className="su-identity">
                <label htmlFor={guohaoInputId} className="text-paper-dim">
                  国号
                </label>
                <Input
                  ref={guohaoInputRef}
                  id={guohaoInputId}
                  data-testid={TID.seatGuohaoInput(0)}
                  type="text"
                  maxLength={1}
                  value={guohao}
                  onInput={(event) => setGuohao(event.currentTarget.value)}
                  aria-invalid={guohaoInvalid}
                  aria-describedby={guohaoHelpId}
                  className="su-guohao-input font-brush"
                />
                <GuohaoPicker
                  value={trimmedGuohao}
                  onChoose={setGuohao}
                  onOpen={() => guohaoInputRef.current?.blur()}
                />
              </div>
              <p id={guohaoHelpId} className="su-guohao-help" aria-live="polite">
                {guohaoInvalid ? (
                  <span data-testid={TID.guohaoError} className="text-danger">
                    国号需为单个汉字
                  </span>
                ) : (
                  "起兵后记住国号，联机同用"
                )}
              </p>

              <h2 className="su-section-title su-seat-heading">座次</h2>
              <ol className="su-seat-grid">
                {seats.map((seat, index) => (
                  <li
                    key={seat.name}
                    data-testid={TID.seatRow(index)}
                    data-human={seat.isBot ? undefined : ""}
                    className="su-seat-card"
                    style={{
                      ["--pc" as string]: rgba(playerColor(index)),
                      ["--pc-seal" as string]: rgba(playerSealText(index)),
                    }}
                  >
                    <span className="su-seat-pseal font-title">{index + 1}</span>
                    {seat.isBot ? (
                      <span data-testid={TID.seatGuohaoInput(index)} className="text-paper-dim">
                        待分配
                      </span>
                    ) : (
                      <span className="su-seat-guohao font-brush">{seat.guohao}</span>
                    )}
                    <span data-testid={TID.seatType(index)} className="su-seat-type">
                      {seat.isBot ? "电脑" : "真人"}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <footer className="su-actions">
            <Button
              data-testid={TID.startGame}
              onClick={() => void start()}
              disabled={guohaoInvalid || busy}
              className={cn("ink-btn su-start font-brush", busy && "su-busy")}
            >
              {busy ? "调兵遣将中…" : "起兵"}
            </Button>
          </footer>
        </div>
      </div>

      {showMapSelect && (
        <MapSelectPanel
          mapSource={mapSource}
          currentMapId={currentMap}
          onConfirm={(id) => {
            setCurrentMap(id);
            setShowMapSelect(false);
            onMapChange?.(id);
          }}
          onCancel={() => setShowMapSelect(false)}
        />
      )}
    </main>
  );
}
