// 顶中知会横幅槽(#732,spec #731 知会/响应分流铁律的知会侧):回合横幅、都城停
// 条带、等待条共用顶中一条带——槽可排队、同槽互斥(排队与互斥的结构单源 = fxStore
// 知会槽泵,展示态经 notice 单字段吐出,同一时刻至多一条);瞬态横幅(回合/都城停)
// 优先于等待条:展示期等待条让位,播完(时长到,槽空)自动回归。
// 分流铁律的另一半不在本槽:响应件(ReactionBanner,限时应答带选项)留手牌架上缘、
// 决策类全屏弹层(BannerShell 族)另论——两者零改动,不经过本槽。
// 落点 top+8 safe-aware(与顶栏行同排,layout.css 同款 safe 口径);容器不吃事件
// (知会件纯播报零点击),等待条药丸自带 pointer-events-none。
import { useFxStore } from "@app/fx/fxStore";
import { TESTIDS } from "./testids";
import { WaitingBar, type WaitingBarProps } from "./WaitingBar";
import "./notice-banner.css";

export function NoticeBanner(props: WaitingBarProps) {
  const notice = useFxStore((s) => s.notice);
  return (
    <div className="notice-slot" data-testid={TESTIDS.noticeBanner}>
      {notice == null ? (
        // 槽空:常驻级知会(等待条)回归;派生逻辑口径不变(#732 只迁渲染宿主)
        <WaitingBar {...props} />
      ) : notice.kind === "turn" ? (
        // 回合旌旗横幅(漆金横幅带原样迁槽):key=id 保证同一玩家连续两回合也能重启动画
        <div
          key={notice.id}
          className="fx-turn-banner"
          style={{ ["--player-color" as string]: notice.color }}
        >
          【{notice.guohao}】之回合
        </div>
      ) : (
        // 都城停条带(#732 降格):原全屏漆金宣告改条带级横幅,与回合横幅同形同槽;
        // 号角音保留(sink 侧),震屏/编排时长按条带级校准(timings.ts)
        <div
          key={notice.id}
          className="fx-halt-banner"
          style={{ ["--player-color" as string]: notice.color }}
        >
          <span className="fx-halt-title">驻跸</span>
          <span className="fx-halt-sub">
            【{notice.guohao}】入「{notice.cityName}」·补给入帐
          </span>
        </div>
      )}
    </div>
  );
}
