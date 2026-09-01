// 折叠侧栏(spec #107 C5 收口):桌面侧栏收起的 w-12 竖条与窄屏抽屉收起时挂在棋盘
// 右缘的浮动小条,原是 GameScreen 里两份几乎逐字的 JSX(「托」印 / 竖排回合·现金 /
// 行军热钮),收成本组件的两种形态。「轮到我」金框与行军热钮共用 myTurnToRoll 单一
// 口径(此前桌面分支曾绕过变量内联同一表达式,已删)。
import { formatMoney } from "@core/money";
import { TESTIDS } from "./testids";

/** panel = 桌面折叠窄条(渲染 aside 收起分支的内容,自身不带容器);
 *  float = 窄屏浮动小条(自带 absolute 容器与 sidebar-collapsed testid)。 */
export type CollapsedRailVariant = "panel" | "float";

export interface CollapsedRailProps {
  variant: CollapsedRailVariant;
  /** 「轮到我」(本地人类可操作且非托管的行军相位):整条金框 + 行军热钮显隐。 */
  myTurnToRoll: boolean;
  /** G-8:托管中「托」印常驻,收起态仍可见(展开侧栏可收回)。 */
  autopilotOn: boolean;
  /** 活跃方国号(竖排摘要;panel 形态带「之回合」后缀)。 */
  activeGuohao: string;
  /** 本地视角玩家现金(null = 未入座/观战,不渲染现金摘要)。 */
  cash: number | null;
  /** P0-3:联机 pending(命令已发未回)时热钮禁用防连点。 */
  pending: boolean;
  onToggle: () => void;
  /** P0-3:行军热钮,与 HandPanel 主按钮同发 rollAndMove(dispatchCommand 唯一入口)。 */
  onRoll: () => void;
}

// 两形态只差布局槽位类(容器/按钮尺寸/字号),文案与语义逐字一致。
const PANEL = {
  toggle:
    "flex h-12 w-12 shrink-0 items-center justify-center border-b border-gold/40 bg-panel-hi font-brush text-ink-dim hover:text-ink",
  seal: "shrink-0 rounded border border-gold bg-gold/20 px-1 py-1 font-brush text-sm text-gold",
  guohao: "font-brush text-xl text-ink",
  roll:
    "min-h-0 min-w-12 flex-1 rounded border border-gold bg-gold/80 px-1 font-brush text-ink hover:bg-gold disabled:opacity-40",
};
const FLOAT = {
  toggle:
    "flex min-h-10 min-w-10 items-center justify-center rounded font-brush text-ink-dim hover:text-ink",
  seal: "rounded border border-gold bg-gold/20 px-1 py-1 font-brush text-sm text-gold",
  guohao: "font-brush text-lg text-ink",
  roll:
    "min-h-10 min-w-10 rounded border border-gold bg-gold/80 px-1 font-brush text-ink hover:bg-gold disabled:opacity-40",
};

export function CollapsedRail({
  variant,
  myTurnToRoll,
  autopilotOn,
  activeGuohao,
  cash,
  pending,
  onToggle,
  onRoll,
}: CollapsedRailProps) {
  const panel = variant === "panel";
  const s = panel ? PANEL : FLOAT;
  // 共享内容件(两形态逐字同源):托印 / 竖排回合 / 现金 / 行军热钮
  const content = (
    <>
      {/* G-8:托管中「托」印,收起态仍可见(点开侧栏可收回) */}
      {autopilotOn && (
        <span
          title="托管中,展开侧栏可收回"
          className={s.seal}
          style={{ writingMode: "vertical-rl" }}
        >
          托
        </span>
      )}
      <span
        title={`当前回合:${activeGuohao}`}
        className={s.guohao}
        style={{ writingMode: "vertical-rl" }}
      >
        {panel ? `${activeGuohao}之回合` : activeGuohao}
      </span>
      {cash !== null && (
        <span
          title={`我的现金 ${formatMoney(cash)}`}
          className="font-brush text-sm text-money"
          style={{ writingMode: "vertical-rl" }}
        >
          {/* G-2:与各面板同口径 formatMoney,不再手工换算丢精度 */}
          {formatMoney(cash)}
        </span>
      )}
      {myTurnToRoll && (
        <button
          type="button"
          title="行军"
          disabled={pending}
          onClick={onRoll}
          className={s.roll}
          style={{ writingMode: "vertical-rl" }}
        >
          {pending ? "行军中…" : "行军"}
        </button>
      )}
    </>
  );
  const toggle = (
    <button
      type="button"
      data-testid={TESTIDS.sidebarToggle}
      title="展开侧栏"
      onClick={onToggle}
      className={s.toggle}
    >
      «
    </button>
  );
  if (panel) {
    return (
      <>
        {toggle}
        {/* P0-3 折叠窄条「轮到我」:轮到本地人类且非托管时整条金色微底 + 内描边,
            一眼可辨不错过回合;底部挂竖排「行军」热钮(与主按钮同发 rollAndMove)。 */}
        <div
          className={
            "flex min-h-0 flex-1 flex-col items-center gap-4 overflow-hidden py-4 " +
            (myTurnToRoll ? "bg-gold/10 ring-1 ring-gold/60 ring-inset" : "")
          }
        >
          {content}
        </div>
      </>
    );
  }
  return (
    /* P0-7 窄屏浮动小条(侧栏抽屉收起时):把手 + 「轮到我」金框 + 行军热钮 + 「托」印。
        波1 加在桌面折叠窄条上的信息在此平移到棋盘右缘,窄屏收起时行军入口不丢。 */
    <div
      data-testid={TESTIDS.sidebarCollapsed}
      className={
        "absolute top-1/2 right-0 z-10 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l border border-r-0 border-gold/60 bg-panel/95 px-1 py-2 shadow-md " +
        (myTurnToRoll ? "bg-gold/10 ring-1 ring-gold/60" : "")
      }
    >
      {toggle}
      {content}
    </div>
  );
}
