// 单机模式配置页(信息架构重构):承接原 SetupScreen 的对局配置部分——
// 诸侯数/目标身价/AI 难度/国号字盘/座位表 + 起兵。模式入口已上移到首页
// (HomeScreen),此页只关心「怎么开这一局」,顶部回显当前选中地图名
// (选图在首页完成,记忆仍走 localStorage)。规则与旧实现保持一致:
// - 单机模式:2–8 诸侯,仅首行为真人,其余全部电脑(bot 国号由引擎在 Guohao 阶段分配)
// - 真人国号必须为单个汉字(isSingleCjk 校验)
// - 目标身价:速战 15000 / 标准 30000 / 鏖战 60000;起始银两固定 10000(经济 v2)
import { useState } from "react";
import type { SeatConfig } from "@core/game";
import { GUOHAO_POOL, playerColor, rgba } from "@core/theme";
import { formatMoney } from "@core/money";
import { isSingleCjk } from "@core/constants";
import type { MapSource } from "@core/map-source";
import { getMapSource } from "@app/map-sources";
import { MapSelectPanel } from "./MapSelectPanel";
import { TID } from "./testids";
import { useMapName } from "./useMapName";

/** 起兵配置:GameEngine 开局所需全部参数(对照旧 main.ts 的 new App({...}) 入参)。
 *  接线方(main 线)用它 loadMapById(mapSource, mapId) 后 new LocalController(map, config)。
 *  seed 可选:?seed= 复现参数由接线方解析后注入,配置页不感知 URL。 */
export interface SetupConfig {
  seats: SeatConfig[];
  targetNetWorth: number;
  startingCash: number;
  difficulty: "Simple" | "Normal";
  /** 选中的地图 id(延迟加载:起兵时才 loadMapById,与旧行为一致)。 */
  mapId: string;
  /** 骰子种子(可选,注入 EngineConfig)。 */
  seed?: number;
}

export interface SoloSetupScreenProps {
  /** P0-1:App 侧 handleStart 为 async(loadMapById+开局);允许返回 Promise,
   *  配置页 await 其完成以驱动 busy 态,同步回调也兼容。 */
  onStart: (config: SetupConfig) => void | Promise<void>;
  /** 返回首页。 */
  onBack: () => void;
  /** 当前选中的地图 id(首页选图后传入,localStorage 记忆同一份;必传,无兜底)。 */
  mapId: string;
  /** 地图源(默认进程级复合源;测试可注入内存实现)。 */
  mapSource?: MapSource;
  /** S-3:配置页内嵌换图回调 —— 确认换图后回传新 mapId(接线方持久化
   *  localStorage 并更新自己的 initialMapId state;与 HomeScreen.onMapChange 同契约)。 */
  onMapChange?: (mapId: string) => void;
}

/** 目标身价档位(旧实现固定三档)。 */
const TARGET_OPTIONS = [15000, 30000, 60000] as const;
const TARGET_LABEL: Record<number, string> = { 15000: "速战", 30000: "标准", 60000: "鏖战" };
/** 起始银两:经济 v2 硬编码 10000(与引擎默认/地图 startingCash 一致)。 */
const STARTING_CASH = 10000;
/** 国号预设持久化 key(起兵成功后写入;下次进入默认带入;联机加入也读同一份)。 */
export const GUOHAO_PREF_KEY = "dafung.guohao";

export function SoloSetupScreen({
  onStart,
  onBack,
  mapId,
  mapSource = getMapSource(),
  onMapChange,
}: SoloSetupScreenProps) {
  const [seatCount, setSeatCount] = useState(4);
  const [target, setTarget] = useState(30000);
  const [difficulty, setDifficulty] = useState<"Simple" | "Normal">("Normal");
  // 单机模式仅首行可编:真人国号默认读上次起兵用的国号(localStorage 无记录则「魏」);bot 国号引擎分配
  const [guohao, setGuohao] = useState(() => localStorage.getItem(GUOHAO_PREF_KEY) ?? "魏");
  // S-8:hint 只承载错误提示(装饰文案上移副标题);null = 无错不渲染
  const [hint, setHint] = useState<string | null>(null);
  // S-3:配置页内嵌换图 —— 本地镜像当前 mapId(prop 不随换图变,显示走本地态)
  const [currentMap, setCurrentMap] = useState(mapId);
  const [showMapSelect, setShowMapSelect] = useState(false);
  // S8:国号内联校验 —— onChange 即算,非法时输入框红边 + 框下红字;
  // 默认值「魏」合法,首屏不误报;提交时的 hint 只作兜底,正常路径不再触发
  const guohaoInvalid = !isSingleCjk(guohao.trim());
  // 与首页共用同一份地图名解析逻辑(清单失败回退 id 显示)
  const mapName = useMapName(mapSource, currentMap);

  // P0-1:起兵 busy 态 —— await onStart(App 侧 loadMapById 异步)期间禁点防连击
  const [busy, setBusy] = useState(false);

  const start = async () => {
    // 校验规则与旧实现一致:真人国号必须单个汉字;bot 国号留给引擎分配。
    // S8:内联校验已即时提示,此处 hint 仅作兜底(正常路径不触发)
    const g = guohao.trim();
    if (!isSingleCjk(g)) {
      setHint("你的国号需为单个汉字。");
      return;
    }
    setHint(null);
    const seats: SeatConfig[] = [{ name: "诸侯1", isBot: false, guohao: g }];
    for (let i = 1; i < seatCount; i++) {
      seats.push({ name: `诸侯${i + 1}`, isBot: true });
    }
    setBusy(true);
    try {
      await onStart({
        seats,
        targetNetWorth: target,
        startingCash: STARTING_CASH,
        difficulty,
        mapId: currentMap,
      });
      // 起兵成功:记住本次国号,下次进入默认带入
      localStorage.setItem(GUOHAO_PREF_KEY, g);
    } finally {
      // 开局成功即切屏,此复位只服务于失败留在本页的情况
      setBusy(false);
    }
  };

  // M-3 按钮触达 ≥40px:py-1.5 → py-2(返回/起兵共用基类,只改尺寸)
  const btnBase =
    "rounded border px-4 py-2 font-deco text-ink cursor-pointer transition-colors";

  return (
    <div data-testid={TID.screen} className="min-h-full flex flex-col items-center justify-center bg-bg p-6">
      <h1 className="font-brush text-4xl text-ink tracking-widest">单机模式</h1>

      <div className="w-[min(560px,92vw)] rounded-lg border border-gold/60 bg-panel p-5 shadow-xl mt-4">
        {/* 顶部回显当前地图;S-3:内嵌「更换」按钮就地唤起选图面板,不必回首页 */}
        <div className="font-deco text-sm text-ink-dim mb-1 flex items-center gap-2">
          <span>当前地图:</span>
          <span data-testid={TID.currentMapName} className="text-ink">{mapName}</span>
          <button
            type="button"
            onClick={() => setShowMapSelect(true)}
            className="rounded border border-gold/60 bg-panel-hi px-2.5 min-h-[32px] font-deco text-xs text-ink cursor-pointer transition-colors hover:bg-panel"
          >
            更换
          </button>
        </div>
        {/* S-8:原页脚装饰文案上移为卡片副标题(页脚只留错误提示) */}
        <p className="font-deco text-xs text-ink-dim mb-4 border-b border-dashed border-ink/25 pb-3">
          立国号、定诸侯,起兵逐鹿天下。
        </p>

        <h3 className="font-brush text-lg text-ink tracking-[0.3em] mb-3">开局布阵</h3>

        {/* 诸侯数 / 目标身价 / AI 难度:受限选择(单机 = 1 真人 + 其余电脑) */}
        <div className="grid grid-cols-3 gap-3 font-deco text-sm text-ink mb-4">
          <label className="flex flex-col gap-1">
            诸侯数
            <select
              data-testid={TID.seatCount}
              value={seatCount}
              onChange={(e) => setSeatCount(Number(e.target.value))}
              className="min-h-[40px] rounded border border-ink/30 bg-bg px-2 py-2"
            >
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{n} 诸侯</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            目标身价
            <select
              data-testid={TID.target}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              className="min-h-[40px] rounded border border-ink/30 bg-bg px-2 py-2"
            >
              {TARGET_OPTIONS.map((t) => (
                <option key={t} value={t}>{TARGET_LABEL[t]} {formatMoney(t)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            AI 难度
            <select
              data-testid={TID.difficulty}
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as "Simple" | "Normal")}
              className="min-h-[40px] rounded border border-ink/30 bg-bg px-2 py-2"
            >
              <option value="Normal">智将(EV)</option>
              <option value="Simple">庸才(随机)</option>
            </select>
          </label>
        </div>

        {/* 座位表:首行真人(国号可编),其余 bot(国号引擎分配,显示「机」) */}
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-[32px_1fr_56px] font-deco text-xs text-ink-dim border-b-2 border-ink/30 pb-1">
            <span />
            <span>国号</span>
            <span>类型</span>
          </div>
          {Array.from({ length: seatCount }, (_, i) => {
            const isBot = i >= 1;
            const color = rgba(playerColor(i));
            return (
              <div key={i} data-testid={TID.seatRow(i)} className="grid grid-cols-[32px_1fr_56px] items-center gap-2 py-1">
                <span
                  className="w-[26px] h-[26px] rounded-full flex items-center justify-center font-deco text-base text-white"
                  style={{ background: color }}
                >
                  {i + 1}
                </span>
                {isBot ? (
                  // bot 行不可编:显示占位「电脑」,国号在对局 Guohao 阶段由引擎分配
                  // (S-7:title 补语义,触屏 hover 不可见也不误导——「电脑」自明)
                  <span
                    data-testid={TID.seatGuohaoInput(i)}
                    title="开局由引擎分配国号"
                    className="font-deco text-ink-dim px-2 py-1 border border-transparent"
                  >
                    电脑
                  </span>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    <input
                      data-testid={TID.seatGuohaoInput(i)}
                      type="text"
                      maxLength={1}
                      value={guohao}
                      placeholder="?"
                      onChange={(e) => setGuohao(e.target.value)}
                      // S8:非法国号即时红边(border-danger),校验随 onChange 每次渲染重算
                      className={
                        "w-16 min-h-[40px] rounded border bg-bg px-2 py-2 font-deco text-center " +
                        (guohaoInvalid ? "border-danger text-danger" : "border-ink/30 text-ink")
                      }
                    />
                    {guohaoInvalid ? (
                      // S8:框下即时 xs 红字(替代提交后 hint 里才出现文案)
                      <span data-testid="setup-guohao-error" className="text-xs text-danger">
                        国号需为单个汉字
                      </span>
                    ) : (
                      // #28 UI:国号预设的可感知说明 —— 告知起兵后会记住并默认带入(含联机)
                      <span className="text-xs text-ink-dim">
                        起兵后记住此国号,下次默认带入,联机加入时也自动使用
                      </span>
                    )}
                  </div>
                )}
                <span data-testid={TID.seatType(i)} className="font-deco text-sm text-ink-dim">
                  {isBot ? "电脑" : "你"}
                </span>
              </div>
            );
          })}
        </div>

        {/* 字盘快选国号(仅作用于真人行;对照旧 GUOHAO_POOL 前 26 字) */}
        <div className="font-deco text-xs text-ink-dim mt-3 mb-1">字盘快选国号:</div>
        <div data-testid={TID.guohaoPool} className="flex flex-wrap gap-1.5">
          {GUOHAO_POOL.slice(0, 26).map((ch) => (
            <button
              key={ch}
              data-testid={TID.guohaoChar(ch)}
              onClick={() => setGuohao(ch)}
              className={
                // W5:触屏点击目标 28px→36px(w-9 h-9),字号微调到 text-base 仍保字盘密度
                "w-9 h-9 rounded border font-deco text-base cursor-pointer transition-colors " +
                (guohao === ch
                  ? "border-gold bg-gold/25 text-ink"
                  : "border-ink/25 bg-bg/60 text-ink-dim hover:border-gold/60 hover:text-ink")
              }
            >
              {ch}
            </button>
          ))}
        </div>

        {/* 操作区:返回首页 / 起兵 */}
        <div className="flex items-center gap-2.5 mt-4">
          <button
            data-testid="solo-setup-back"
            onClick={onBack}
            className={btnBase + " border-ink/30 bg-panel-hi hover:bg-bg-deep"}
          >
            返回
          </button>
          <button
            data-testid={TID.startGame}
            onClick={() => void start()}
            // S-2:国号非法即禁点(title 说明原因);P0-1:busy 期防连点
            disabled={guohaoInvalid || busy}
            title={guohaoInvalid ? "国号需为单个汉字" : undefined}
            className={
              btnBase +
              " border-gold bg-gold/80 hover:bg-gold font-bold py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
            }
          >
            {busy ? "调兵遣将中…" : "起兵"}
          </button>
        </div>

        {/* S-8:页脚只在出错时出现(e2e 无 setup-hint 常驻断言,testid 保留于错误态) */}
        {hint != null && (
          <div data-testid={TID.hint} className="font-deco text-xs text-danger mt-3">{hint}</div>
        )}
      </div>

      {/* S-3:内嵌选图二级屏(复用首页同款面板;确认后本地回显 + onMapChange 通知接线方) */}
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
    </div>
  );
}
