// 顶中知会横幅槽(#732,spec #731 知会/响应分流铁律的知会侧):回合横幅、都城停
// 条带、等待条共用顶中一条带——槽可排队、同槽互斥(排队与互斥的结构单源 = fxStore
// 知会槽泵,展示态经 notice 单字段吐出,同一时刻至多一条);瞬态横幅(回合/都城停)
// 优先于等待条:展示期等待条让位,播完(时长到,槽空)自动回归。
// #762 两段式亮相+常驻回合胶囊:回合横幅前段大字亮相、后段收编(fx.css 两段动画)
// 为槽内的常驻回合胶囊(.turn-capsule,fxStore.turnCapsule 单源,横幅消散不带走);
// 等待条与胶囊同槽融合(bare 变体落胶囊右侧,免重名派生)。槽渲染分层:胶囊(flex
// 常驻件)在下、知会带件(absolute)在上——收编即「横幅缩位淡出露出胶囊」。
// 分流铁律的另一半不在本槽:响应件(ReactionBanner,限时应答带选项)留手牌架上缘、
// 决策类全屏弹层(BannerShell 族)另论——两者零改动,不经过本槽。
// 落点 top+8 safe-aware(与顶栏行同排,layout.css 同款 safe 口径);容器不吃事件
// (知会件纯播报零点击),等待条药丸/胶囊自带 pointer-events-none。
import { playerSealText, rgba } from "@core/theme";
import { useFxStore } from "@app/fx/fxStore";
import { TESTIDS } from "./testids";
import { WaitingBar, type WaitingBarProps } from "./WaitingBar";
import "./notice-banner.css";

export function NoticeBanner(props: WaitingBarProps) {
  const notice = useFxStore((s) => s.notice);
  const capsule = useFxStore((s) => s.turnCapsule);
  return (
    <div className="notice-slot" data-testid={TESTIDS.noticeBanner}>
      {capsule != null && (
        // 常驻回合胶囊(#762):key=id 保证每次回合宣告(全幅或合并)都重挂重播
        // 入场过渡;--pc-seal 印字亮档单源 core/theme playerSealText(同 SeatRail 注入式)。
        <div
          key={capsule.id}
          className="turn-capsule pointer-events-none"
          data-testid={TESTIDS.turnCapsule}
          style={{
            ["--player-color" as string]: capsule.color,
            ["--pc-seal" as string]: rgba(playerSealText(capsule.colorIndex)),
          }}
        >
          <span className="tc-seal">{capsule.guohao.charAt(0)}</span>
          <span className="tc-name">{capsule.guohao}</span>
          <span className="tc-round">第{capsule.round}轮</span>
          {/* 等待附加信息与胶囊主体融合(#762):瞬态知会展示期让位(notice 非空不渲染);
              免重名=等待对象是当前回合方时(胶囊主体已指名)。 */}
          {notice == null && <WaitingBar {...props} variant="bare" hideOwnerName />}
        </div>
      )}
      {notice == null && capsule == null && (
        // 槽空且胶囊未立(选都期/开局前):常驻级知会(等待条)独立药丸回归;
        // 派生逻辑口径不变(#732 只迁渲染宿主)
        <WaitingBar {...props} />
      )}
      {notice?.kind === "turn" && (
        // 回合旌旗横幅(#762 两段式亮相):key=id 保证同一玩家连续两回合也能重启动画;
        // 前段大字亮相+后段收编,终态让位给 z 序之下的常驻胶囊(fx.css 两段动画)
        <div
          key={notice.id}
          className="fx-turn-banner"
          style={{ ["--player-color" as string]: notice.color }}
        >
          【{notice.guohao}】之回合
        </div>
      )}
      {notice?.kind === "halt" && (
        // 都城停条带(#732 降格):原全屏漆金宣告改条带级横幅,与回合横幅同形同槽;
        // 号角音保留(sink 侧),震屏/编排时长按条带级校准(timings.ts)。#762 不两段化
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
