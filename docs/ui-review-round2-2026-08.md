# UI 评审第二轮(2026-08-26,四路子 agent 并行评审汇总)

> 范围:入口三屏 / 游戏内 HUD / 棋盘与战斗演出 / 美术资源侦察(互联网)。
> 上轮 76 项(ui-improvements.md)已全部避开不重复。本文件为唯一施工清单,完成勾选。
> **施工跟踪已归一化至 GitHub Issues**(spec=#12,条目见各括号号);本文档降级为证据明细存档,完成以 issue 关闭为准。
> 四项汇总:P0 硬伤 6 · P1 体验 14 · P2 打磨 13 · 美术资源 11(另附)。

## P0 · 硬伤(必修)

- [ ] **E1(#13) 三屏竖向溢出截断**(横屏 APK 必现):Home/Lobby/SoloSetup 根节点 `justify-center`+`overflow:hidden`,8 座位/8 诸侯时底部按钮消失不可达。→ 根节点改 `flex-col overflow-y-auto` + 内层 `m-auto`(flexbox 居中+滚动的标准解)。证据:app.css:14-19、HomeScreen.tsx:69、SoloSetupScreen.tsx:117、LobbyScreen.tsx:179/292
- [ ] **E2(#14) 卷轴拖拽复位回归**(G-18 因 effect 依赖 children 引用失效):快照每变/hint 每次闪烁都把拖开的卷轴拉回中心。→ deps 改 title+显式 `scrollKey` prop,`drag.current.active` 时跳过复位。证据:ScrollShell.tsx:107-110
- [ ] **E3(#15) 卷轴拖拽无边界**:决策卷轴可被拖出屏幕成死局。→ onPointerMove 写回前 clamp(标题栏恒留 ≥60px 在视口)。证据:ScrollShell.tsx:94-102(与 E2 同文件,一个工作包)
- [ ] **E4(#16) 胜利屏胜因硬编码**:DecisionScrollLayer.tsx:63 写死 `winReason="NetWorth"`,「群雄尽灭」局必显示「富甲天下」。→ 改透传 `snapshot.winReason`。顺手:终榜一行(身价降序+破产标注)+窄屏标题 clamp
- [ ] **E5(#17) 编辑器单击即搬城**:finishDrag 无拖动阈值,点选查看属性 → 城心被改到点击点+undo 栈塞满。→ 位移 >6px 或 pos 变化才 apply。证据:EditorScreen.tsx:286-301
- [ ] **E6(#18) 8 人局诸侯列表被裁**:OthersPanel `shrink-0` 无内滚,1366×768 下末位诸侯与折叠钮不可达。→ `min-h-0`+列表 `overflow-y-auto`,TreasuryPanel `min-h-24` 保底。证据:OthersPanel.tsx:10
- [ ] **E7(#19) 联机国号零展示+静默改前缀**:seatMeta 不含 guohao,重名加前缀只有进局才发现。→ ①服务端 seatMeta 补 guohao;②大厅座位行渲染单字方章;③重复时 xs 行预告「开局将改为『东魏』」。证据:room.ts:95-127、LobbyScreen.tsx:321-357

## P1 · 体验显著提升

- [ ] **X1(#20) 驻跸必停无解释**:骰六走三停在半路,玩家只能猜。→ orchestrator 追加盖「驻」章 + textFloat「驻跸补给」(引擎 pushFloaterText 已有先例,零引擎改动)
- [ ] **X2(#21) 巡幸 +2 委任零反馈**:warrants chip 数字静默跳变。→ 复用 game-cash-float 浮标(金色 +2)
- [ ] **X3(#22) 同格双浮字叠印**:交涉 −300/+300 精确重叠。→ FxLayer 同锚点按序 y−idx*36 错位
- [ ] **X4(#23) 选都三候选仪式感**:金圈静态无脉冲无序号,旁观者看不出三城,确认后镜头不聚焦。→ 候选呼吸动画+壹贰叁小印+轮到本地 flyTo 质心+候选集全座位可见(旁观静态 0.15)
- [ ] **X5(#24) 骰子结果无确认、退场硬切**:落定即 display:none,软渲 fallback 仅黑屏。→ 落定叠大字签面(96px 弹入)+退场 0.25s 渐隐+bot hold 250→400ms+fallback 文字签面
- [ ] **X6(#25) 横屏手机不吃抽屉**:useIsNarrow 仅按宽 767px,844×390 判宽屏侧栏挤掉棋盘。→ 判定扩 `(pointer:coarse) and (max-height:500px)`
- [ ] **X7(#26) 等待反馈重复+静态**:bot 回合同屏两处「运筹中」;联机长等待仅省略号。→ 删底部角标(testid 迁 WaitingBar),>8s 追加「已候 N 秒」或轮换安抚句
- [ ] **X8(#27) 珍宝交涉锁死非决策方**:visitor 卷轴无 onClose,城主犹豫多久访客被困多久。→ visitor 分支补 onClose,关闭后 WaitingBar 接管
- [ ] **X9(#28) 招贤三选一信息差**:desc 与按钮分离且无画像。→ 竖排三选项卡(画像位+名/title+desc 两行 clamp+快捷键角标)
- [ ] **X10(#29) 四处原生 select 破功**:诸侯数/目标/难度/建房。→ 分段选择器(目标/难度)+stepper(诸侯数 2-8),e2e 同步
- [ ] **X11(#30) InputScroll Enter 撞 IME**:未判 isComposing,中文选字回车即确认;空名可过。→ 判 isComposing+空值禁确定
- [ ] **X12(#31) 卷轴无视口高度保护+触屏拖拽打架**:壳体无 max-h(破产卷轴横屏溢出),标题栏无 touch-action。→ `max-h-[min(86dvh)]` flex-col+内滚+`touch-action:none`(与 E2/E3 同为 ScrollShell 工作包)
- [ ] **X13(#32) OthersPanel 不标「你」**:8 相似色找自己靠记忆。→ 传 viewSeat,自己行复用金框「你」印
- [ ] **X14(#33) 大厅无 Enter 提交**:房间码输入回车无效。→ form onSubmit 包裹

## P2 · 打磨

- [ ] **S1(#34) 三屏入场编排**:卡片瞬现,复用现成 scroll-anim-unroll(0.35s)
- [ ] **S2(#35) focus-visible 全局墨圈**:非首页 Tab 导航回落浏览器蓝圈。→ app.css 一条 `:where(...):focus-visible` 规则
- [ ] **S3(#36) ConnectionBanner 无 safe-top**:刘海横屏贴顶切字。→ 内层 `paddingTop: calc(var(--safe-top) + 6px)`
- [ ] **S4(#37) MapSelectPanel 无焦点陷阱**:与 ConfirmDialog 双标。→ 抽 useDialogFocus hook 两处接入+关闭还焦
- [ ] **S5(#38) 符号表登记 ▾**:ui-symbols.md 增「展开/下拉」用途行
- [ ] **S6(#39) 行军逐段 linear 顿挫**:每段 linear+10ms 停顿机械感。→ `.bv-token-marching` 改 cubic-bezier(0.45,0,0.55,1),segSlackMs 10→0
- [ ] **S7(#40) 有主城仍渲染购入价**(纯噪声):owner 存在不渲染价格行
- [ ] **S8(#41) setupHint 与 HintBar 同位重叠**:setupHint 改 `top-[calc(var(--safe-top)+48px)]`(选都期 WaitingBar 恒空,同槽复用)
- [ ] **S9(#42) 珍宝行 div 无键盘语义**:改 button 全宽 text-left
- [ ] **S10(#43) 只读详情卷轴关闭口径分裂**:CardDetail 恢复 ×(44px 热区已有),hideClose 只留决策卷轴;ui-symbols.md 注明
- [ ] **S11(#44) 委任状无变化反馈**:抽 useDeltaFloat 复用现金浮标(与 X2 合并施工)
- [ ] **S12(#45) 观战态无锚**:空态内联「观」印身份行+展示被跟随者资产(快照已有)
- [ ] **S13(#46) 编辑器工具栏触达<40px+硬编码色**:min-h-10+from-paper-hi to-paper-lo(S3 遗留收尾)
- [ ] **S14(#47) 内滚区原生滚动条**:集中定义 6px 金 thumb 细滚动条

## 美术资源(侦察已验证可访问,接入走 fetch-asset.ts + CREDITS.md 纪律)

- [ ] **A1(#48) 宣纸实拍纹理**(P0,CC0):Wikimedia Xuan Paper 1920px→webp ~250KB,全屏 multiply/soft-light 低透明叠加——对现有手绘风增强最大的单项
- [ ] **A2(#49) game-icons 图标包**(P0,CC BY 3.0):铜钱/卷轴/珍宝 SVG 1-5KB/枚,fill 改墨色统一,填图标空缺
- [x] **A3(#50) 武将立绘扩容**(P0,学习用途):patchwiki 管线已代码化+司马懿入库,操作见 docs/hero-expansion.md
- [ ] **A4(#51) 霞鹜文楷**(P1,OFL):正文/规则说明可读楷体,webfont 分片自托管 ~1-2MB
- [ ] **A5(#52) CC0 音效**(P1):Freesound 印章盖下 759526/卷轴纸张(已验证 CC0 过滤搜索法),替换/补充合成音
- [ ] **A6(#53) 千里江山图局部**(P1,PD):标题屏/胜利屏青绿山水带
- [ ] **A7(#54) 龙藏/志莽行书 + Pixabay 古筝**(P2):手写点缀与真实乐器感,锦上添花

## 施工波次(文件所有权互斥 → 可并行)

- **Wave A · P0 死磕包**(并行 3 agent):
  - A-1:ScrollShell 三合一(E2 复位/E3 边界/X12 max-h+touch-action)——scroll/ 目录
  - A-2:入口三屏溢出(E1)+ 大厅 Enter(X14)+ 国号展示(E7,含 server seatMeta)——home/lobby/setup + room.ts
  - A-3:胜利屏胜因(E4)+ 编辑器搬城(E5)+ 诸侯列表内滚(E6)——DecisionScrollLayer/Editor/OthersPanel
- **Wave B · 反馈链**(并行,依赖 A-1):X1 驻跸章/X2+S11 委任浮标/X3 浮字错位/X5 骰子确认/X4 选都仪式/X6 横屏抽屉/X7 等待去重/X8 访客解锁
- **Wave C · 表单与可访问性**:X9 招贤卡/X10 分段器+stepper/X11 IME/S2/S4/S5/S9/S10/S13/S14
- **Wave D · 打磨**:S1/S3/S6/S7/S8/S12
- **Wave E · 美术接入**:A1→A2→A3(可先行,不依赖代码波);A4-A7 随后
- 每波质量门:tsc / bun test / build / 全量 e2e;截图验收入 screenshots/(不入库)

## 完成记录

(格式:条目号 + commit + 一句话)
