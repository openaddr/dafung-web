# BRIEF.md — 视觉重做 Wave-2 分包简报 & 实施台账

> 本文件是子代理的唯一上下文入口:你从零开始,读我(主线)落盘的这一份 + 指定的
> docs/design/DESIGN.md,即可开工。它同时是实施台账:每屏状态随手更新
> (待办 / 进行 / 绿 = 四项门槛齐 + 评审放行)。
> 基线:视觉重做主体已合入 master(5214f4f,PR #139)。Wave-2 = 编排化收口:
> 逐屏审计 → 按包回炉 → 评审放行 → 全量绿。

## 0. 红线(违反任何一条 = 该包失败)

1. `src/core` 权威引擎**零改动**(theme.ts 仅配色/动效 token 单源,属 gen:theme 管线,非引擎裁决逻辑);UI 永不裁决,一切状态来自快照/命令/表现事件。
2. **data-testid 契约不变**(各屏 testids.ts 是唯一来源),e2e 选择器零漂移。
3. 一切动画时长经 `src/app/fx/timings.ts` 的 scaler / CSS `--dur-*`/`--ease-*` token 表达;秒级常量只活在 timings.ts 注释钉死的那几处。
4. 每屏合入门槛 = **typecheck 零错 + bun test 全绿 + 该屏 e2e 绿 + 评审放行**,四项齐。
5. 工作树中未提交改动只许避开;`tokens.css`/`app.css`/`theme.ts` 等全局样式**只归主线改**——分包需要动全局 → 停手回报,不自己动手。
6. 无障碍底线:键盘可达、焦点可见、prefers-reduced-motion 尊重、对比度达标(小字 4.5:1)、移动端可用。

## 1. 方向宣言(一句话版,全文见 DESIGN.md)

**「一纸墨戏,方寸庙堂」**——棋盘是水墨长卷(山水为底、城池为子、旌旗为魂),HUD 是案头笺纸(手札/签筒/印匣),决策是展开的卷轴(读诏的仪式),一切确认以落印为终。
换皮测试结论:纸-墨-印的语言若换到唐/宋仍成立,但**三国特异性由内容器物承担**——国号方印(魏蜀吴…)、城池匾牌、委任状/都/起/胜的功能印系、名士画像、IE 校验过的三大地图城名;印章系统与游戏机制(委任状=资源、国号=身份)互证,不是贴纸。
反对:AI 默认三件套(奶油底+衬线+赤陶 / 纯黑底+荧光 / 报纸细线栅格)、后台换皮感、无意义装饰。

## 2. 设计系统速查(细节见 DESIGN.md §4 与源文件)

- **色板语义**:`墨=行动`(lacquer 墨钮 ink-btn)· `朱=权险`(danger/印章/cinnabar-btn)· `金=势`(gold,轮次/选中/珍宝贵重,不再作按钮底)· `笺=次级`(note-btn/note-card)。
- **控件种(app.css,只读)**:`ink-btn`(漆底金字主行动)、`note-btn`(笺纸底发丝墨边)、`cinnabar-btn`(朱砂确认)、`note-card`(有边有衬里的纸)、`note-head`(单字朱印+标签+发丝线,标签字体落 wenkai——XiaoWei 有空芯字形!)、`note-select`(原生 select 皮肤)。
- **字体**:`font-brush`(马善政,标题/城名/印文)、`font-wenkai`(文楷,正文+新文案安全位)、`font-deco`(小薇,**只存量维护,新文案禁用**——镜像有空芯字形)、`font-hand`(龙藏,手书点缀)。数字挂 `tabular-nums`。符号(←↶↷◎♪×▶▾)一律 `Sym` 组件(src/app/screens/shared/Sym.tsx),不裸排字符。
- **动效 token**:`--dur-instant/fast/med/slow/reveal/fx/banner/ambient` + `--ease-out/in/out-back/sine`(唯一源 core/theme.ts Motion,gen:theme 产出)。一次性演出只走表现事件管线(ADR-0010/0015);CSS 只承担常驻呼吸与状态样式。
- **投影**:`var(--ink-shadow-sm/lg)`(墨褐,不用纯黑)。**圆角**:面板 8px/主控件 5px/小控件 3px/印章 2px。

## 3. 范本屏指针(质量基线 = 对局内)

对局屏是已过四项门槛的参照物。分包前先看这几处「对的样子」:
- `src/app/screens/game/scroll/ScrollShell.tsx` —— 挂轴双杆、题名朱印、墨钮/笺钮按钮种。
- `src/app/screens/game/HandPanel.tsx` + `StatusBar.tsx` —— 笺头制式、方印国号、墨钮 CTA、朱印「你」。
- `src/app/screens/home/HomeScreen.tsx` —— 签名件(千里江山装裱横带 + 落款印)。
- `docs/design/DESIGN.md` §7 —— 前后对比图(tmp/ui-shots/audit-before|after)。

## 4. 各屏验收标准(Wave-2 逐屏)

通用(每屏都要过):新文案不出现 font-deco;无裸排符号字符;按钮/面板用控件种;金不再作按钮底(选中/轮次/珍宝档位除外);testid 与交互零变化;typecheck+单测+本屏 e2e 绿。

| # | 屏 | 验收要点 | 状态 | 包 |
|---|---|---|---|---|
| 1 | 对局内·棋盘/演出 | 山水带/江河/城卡/宣告动效(ADR-0015)无回退 | 绿(基线) | — |
| 2 | 对局内·HUD/侧栏/手牌 | 笺头四区、方印、墨钮行军;残留 grep 清零 | 绿(基线) | — |
| 3 | 对局内·卷轴/终局 | 挂轴/题印/两态破产/价值表 | 绿(基线) | — |
| 4 | 首页 | 山水横带+落款印+签条入口;MapSelectPanel 弹层协调 | 绿(待评审) | A+E |
| 5 | 单机配置 | 手札卡+钤印字盘 | 绿(基线) | — |
| 6 | 联机大厅 | 座次笺/房码签条/控件种 | 绿(基线) | — |
| 7 | 地图编辑器 | 工具钮/表单/侧栏全入控件种;InputScroll 协调 | 绿(待评审) | B |
| 8 | 共享组件/全局 | MapSelectPanel(已回炉)、HintBar/ConnectionBanner/ConfirmDialog 字族迁 wenkai、theme.success 加深(主线) | 绿(待评审) | A+E+主线 |
| 9 | 落格结算动效 | **✕ 裁决不做**:活跃格虚线环已承担「落格」定位,新增表现事件类型(双提取器)成本>收益;挂起待用户另立单 | 裁决归档 | 主线 |

## 5. 子代理工作守则

- **文件互斥**:一包一文件集(见派单指令),不碰包外文件;全局样式冲突 → 停手回报。
- **验证**:typecheck(`bun run typecheck`)/单测(`bun test`)随时;e2e 单 spec 跑法:
  `E2E_STATIC_PORT=4<包号>1 E2E_GAME_PORT=3<包号>1 E2E_ROOMS_DIR=./tmp/e2e-rooms-<包号> E2E_WORKERS=1 npx playwright test e2e/<相关>.spec.ts`
  (runner 是 Node,勿 `--bun`;先 `bun run build`)。收口全量由主线跑。
- **截图**:参考 tmp/quick-shot.mjs(playwright + swiftshader;测试钩子 `window.__dafung` 可构造局面,用法见 tmp/audit-shots.mjs);图存 `tmp/ui-shots/w2-<包>/`。
- **台账**:开工把本文件你的包状态改「进行」;四项门槛齐 + 评审放行后改「绿」并注 commit。
- **层叠陷阱记档(包A 实证)**:app.css 控件种是非分层规则,天然压过 @layer utilities——`note-card` 后再写 `shadow-*` 工具类会被静默吃掉,覆盖投影需 Tailwind v4 尾缀 `!`(如 `shadow-[var(--ink-shadow-lg)]!`)或由 app.css 增设变体。
- 汇报格式:改动文件清单 / 验证结果(逐项)/ 截图路径 / 未决问题。
