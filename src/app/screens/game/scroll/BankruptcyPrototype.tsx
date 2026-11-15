// THROWAWAY #1401: 三种变卖自救信息层级；现役对局路径 ?prototype=bankruptcy&variant=A/B/C。
// 仅内存演示；共享事实/叶子组件，三版各自决定布局。候选尚未由用户拍板。
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@base-ui/react/button";
import { formatMoney } from "@core/money";
import { guidePriceOf } from "@core/treasures";
import { TreasurePickModal } from "../TreasurePickModal";
import { SCROLL_TESTIDS as T } from "./testids";
import { BannerShell } from "./BannerShell";
import type { BankruptcyScrollProps } from "./BankruptcyScroll";
import "./bankruptcy-prototype.css";

const variants = ["A", "B", "C"] as const;
const names = { A: "缺口主位", B: "债务与资产并排", C: "变卖动作主位" };
const scenarios = ["正常缺口", "较大缺口", "部分为空", "一笔变卖后", "已凑足"];
type Variant = (typeof variants)[number];
type AssetState = Pick<
  BankruptcyScrollProps,
  "cash" | "debtAmount" | "treasures" | "sellableProperties" | "heroes"
>;
type Model = AssetState & {
  owe: number;
  feedback: string;
  sellProperty: (id: string) => void;
  sellHero: (id: string) => void;
  openTreasure: () => void;
};
function stateAt(props: BankruptcyScrollProps, scenario: number): AssetState {
  return {
    ...props,
    cash: scenario === 3 ? 1100 : scenario === 4 ? 1300 : 500,
    debtAmount: scenario === 1 ? 6000 : 1300,
    treasures:
      scenario === 2
        ? []
        : scenario === 3 || scenario === 4
          ? props.treasures.filter((t) => t.id !== "qingnang")
          : props.treasures,
    heroes: scenario === 2 ? [] : scenario === 4 ? props.heroes.slice(1) : props.heroes,
  };
}
function feedbackAt(scenario: number) {
  return scenario === 3
    ? "已变卖青囊书残卷，入账 600 两"
    : scenario === 4
      ? "已遣散周瑜，入账 200 两；已够清偿"
      : "选择资产变卖，入账后再确认结算";
}

function Action({
  children,
  onClick,
  disabled = false,
  primary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Button
      className={`prototype-action ${primary ? "ink-btn" : "note-btn"}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function Assets({ m, category }: { m: Model; category: "treasures" | "properties" | "heroes" }) {
  if (category === "treasures")
    return m.treasures.length ? (
      <Action onClick={m.openTreasure} disabled={m.owe === 0}>
        变卖珍宝 · {m.treasures.length} 件
      </Action>
    ) : (
      <span className="prototype-empty">暂无可变卖珍宝</span>
    );
  if (category === "properties")
    return m.sellableProperties.length ? (
      <>
        {m.sellableProperties.map((p) => (
          <Action key={p.propId} onClick={() => m.sellProperty(p.propId)} disabled={m.owe === 0}>
            <span>
              卖城 · {p.name}
              <em>+{formatMoney(p.sellPrice)}</em>
            </span>
            <small>
              购入 {formatMoney(p.purchasePrice)} · Lv.{p.level}
              {p.sellPrice < p.purchasePrice ? " 变卖折价" : ""}
            </small>
          </Action>
        ))}
      </>
    ) : (
      <span className="prototype-empty">暂无可变卖城池</span>
    );
  return m.heroes.length ? (
    <>
      {m.heroes.map((h) => (
        <Action key={h.id} onClick={() => m.sellHero(h.id)} disabled={m.owe === 0}>
          遣 · {h.name}
          <em>+{formatMoney(200)}</em>
        </Action>
      ))}
    </>
  ) : (
    <span className="prototype-empty">暂无可遣散名将</span>
  );
}

function Footer({ m, compact = false }: { m: Model; compact?: boolean }) {
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => setConfirmed(false), [m.cash, m.debtAmount]);
  return (
    <div className={`prototype-footer ${compact ? "prototype-footer-compact" : ""}`}>
      {compact && (
        <div className="prototype-foot-gap">
          <span>{m.owe ? "尚欠" : "已凑足"}</span>
          <strong>{formatMoney(m.owe || m.cash)}</strong>
        </div>
      )}
      <div className="prototype-footer-status" aria-live="polite">
        {confirmed
          ? m.owe
            ? "原型结果：认破产，结束本局"
            : "原型结果：债务清偿，保留剩余资产"
          : m.owe
            ? "凑足即可清偿；现在结算将认破产"
            : `结算将清偿 ${formatMoney(m.debtAmount)}`}
      </div>
      <Action primary={m.owe === 0} onClick={() => setConfirmed(true)}>
        {m.owe ? "结算 · 认破产" : "结算 · 清偿债务"}
      </Action>
    </div>
  );
}

export function VariantA({ m }: { m: Model }) {
  return (
    <BannerShell title="魏 · 变卖自救" footer={<Footer m={m} />}>
      <div className="prototype-gap">
        <div>
          <span>{m.owe ? "还差" : "已凑足"}</span>
          <strong>{formatMoney(m.owe || m.cash)}</strong>
        </div>
        <p>
          现钱 {formatMoney(m.cash)}
          <br />
          债务 {formatMoney(m.debtAmount)}
        </p>
      </div>
      <p className="prototype-feedback" aria-live="polite">
        {m.feedback}
      </p>
      <div className="prototype-a-assets">
        <section>
          <h3>城池</h3>
          <div className="prototype-stack">
            <Assets m={m} category="properties" />
          </div>
        </section>
        <section>
          <h3>珍宝 · 指导价</h3>
          <Assets m={m} category="treasures" />
        </section>
        <section>
          <h3>名将 · 每名 200 两</h3>
          <div className="prototype-wrap">
            <Assets m={m} category="heroes" />
          </div>
        </section>
      </div>
    </BannerShell>
  );
}

export function VariantB({ m }: { m: Model }) {
  return (
    <BannerShell title="魏 · 变卖自救" footer={<Footer m={m} />}>
      <div className="prototype-ledger-layout">
        <aside>
          <h3>债务账</h3>
          <dl>
            <dt>债务</dt>
            <dd>{formatMoney(m.debtAmount)}</dd>
            <dt>现钱</dt>
            <dd>{formatMoney(m.cash)}</dd>
            <dt className="prototype-owe">尚欠</dt>
            <dd className="prototype-owe">{formatMoney(m.owe)}</dd>
          </dl>
          <p className="prototype-feedback" aria-live="polite">
            {m.feedback}
          </p>
        </aside>
        <div className="prototype-ledger-assets">
          <section>
            <h3>
              珍宝 <small>按指导价</small>
            </h3>
            <Assets m={m} category="treasures" />
          </section>
          <section>
            <h3>
              城池 <small>按当前等级变卖价</small>
            </h3>
            <div className="prototype-stack">
              <Assets m={m} category="properties" />
            </div>
          </section>
          <section>
            <h3>
              名将 <small>每名 200 两</small>
            </h3>
            <div className="prototype-wrap">
              <Assets m={m} category="heroes" />
            </div>
          </section>
        </div>
      </div>
    </BannerShell>
  );
}

export function VariantC({ m }: { m: Model }) {
  return (
    <BannerShell title="魏 · 变卖自救" footer={<Footer m={m} compact />}>
      <div className="prototype-action-layout">
        <section>
          <div>
            <h3>变卖珍宝</h3>
            <p>按指导价入账</p>
          </div>
          <Assets m={m} category="treasures" />
        </section>
        <section>
          <div>
            <h3>卖城</h3>
            <p>按当前等级变卖价</p>
          </div>
          <div className="prototype-wrap">
            <Assets m={m} category="properties" />
          </div>
        </section>
        <section>
          <div>
            <h3>遣散名将</h3>
            <p>每名 200 两</p>
          </div>
          <div className="prototype-wrap">
            <Assets m={m} category="heroes" />
          </div>
        </section>
      </div>
      <p className="prototype-feedback" aria-live="polite">
        {m.feedback}
      </p>
      <p className="prototype-quiet">
        现钱 {formatMoney(m.cash)} / 债务 {formatMoney(m.debtAmount)}
      </p>
    </BannerShell>
  );
}

export function BankruptcyPrototype(props: BankruptcyScrollProps) {
  const initial = new URLSearchParams(location.search).get("variant");
  if (initial !== "A" && initial !== "B" && initial !== "C")
    throw new Error("原型需指定 variant=A/B/C");
  const [variant, setVariant] = useState<Variant>(initial);
  const scenarioParam = new URLSearchParams(location.search).get("scenario");
  const initialScenario = scenarioParam === null ? 0 : Number(scenarioParam);
  if (
    !Number.isInteger(initialScenario) ||
    initialScenario < 0 ||
    initialScenario >= scenarios.length
  )
    throw new Error("scenario 需为 0–4");
  const [scenario, setScenario] = useState(initialScenario);
  const [state, setState] = useState<AssetState>(() => stateAt(props, initialScenario));
  const [feedback, setFeedback] = useState(() => feedbackAt(initialScenario));
  const [pickOpen, setPickOpen] = useState(false);
  const owe = Math.max(0, state.debtAmount - state.cash);
  const cycle = (direction: number) => {
    const next =
      variants[(variants.indexOf(variant) + direction + variants.length) % variants.length];
    setVariant(next);
    const url = new URL(location.href);
    url.searchParams.set("variant", next);
    history.replaceState(null, "", url);
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName))
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        cycle(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [variant]);
  function changeScenario() {
    const next = (scenario + 1) % scenarios.length;
    setScenario(next);
    setPickOpen(false);
    setState(stateAt(props, next));
    setFeedback(feedbackAt(next));
    const url = new URL(location.href);
    url.searchParams.set("scenario", String(next));
    history.replaceState(null, "", url);
  }
  const m: Model = {
    ...state,
    owe,
    feedback,
    openTreasure: () => setPickOpen(true),
    sellProperty(id) {
      const asset = state.sellableProperties.find((p) => p.propId === id)!;
      setState({
        ...state,
        cash: state.cash + asset.sellPrice,
        sellableProperties: state.sellableProperties.filter((p) => p.propId !== id),
      });
      setFeedback(`已卖出${asset.name}，入账 ${formatMoney(asset.sellPrice)}`);
    },
    sellHero(id) {
      const asset = state.heroes.find((h) => h.id === id)!;
      setState({
        ...state,
        cash: state.cash + 200,
        heroes: state.heroes.filter((h) => h.id !== id),
      });
      setFeedback(`已遣散${asset.name}，入账 200 两`);
    },
  };
  return (
    <div className={`bankruptcy-prototype prototype-${variant}`} data-settled={owe === 0}>
      {variant === "A" && <VariantA m={m} />}
      {variant === "B" && <VariantB m={m} />}
      {variant === "C" && <VariantC m={m} />}
      {pickOpen && (
        <TreasurePickModal
          title="变卖自救 · 变卖珍宝"
          seal="变"
          sub="魏 · 按指导价变卖入账"
          treasures={state.treasures}
          context={
            <p>
              现钱 {formatMoney(state.cash)} / 债务 {formatMoney(state.debtAmount)} · 尚欠{" "}
              {formatMoney(owe)}
            </p>
          }
          tagOf={(t) => `至 ${formatMoney(guidePriceOf(t.level))}`}
          summaryOf={(t) => `变卖 ${t.name} · 入账 ${formatMoney(guidePriceOf(t.level))}`}
          hint="点选要变卖的珍宝"
          confirmLabel="变卖"
          testids={{
            container: T.bankruptcyTreasurePick,
            item: T.bankruptcySellTreasure,
            confirm: T.bankruptcySellTreasureConfirm,
          }}
          onConfirm={(id) => {
            const asset = state.treasures.find((t) => t.id === id)!;
            const price = guidePriceOf(asset.level);
            setState({
              ...state,
              cash: state.cash + price,
              treasures: state.treasures.filter((t) => t.id !== id),
            });
            setFeedback(`已变卖${asset.name}，入账 ${formatMoney(price)}`);
            setPickOpen(false);
          }}
          onClose={() => setPickOpen(false)}
        />
      )}
      <nav className="prototype-switcher" aria-label="原型方案与场景">
        <Button onClick={() => cycle(-1)} aria-label="上一方案">
          ‹
        </Button>
        <span>
          原型 {variant} · {names[variant]}
        </span>
        <Button onClick={() => cycle(1)} aria-label="下一方案">
          ›
        </Button>
        <Button onClick={changeScenario}>{scenarios[scenario]} · 切换</Button>
      </nav>
    </div>
  );
}
