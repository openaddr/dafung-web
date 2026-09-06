# audit.md — 视觉审计汇总(Wave-2)

> 方法:基线审计(2026-09-06,主线,14 张基线截图,tmp/ui-shots/audit-before/)
> 四维走查后已随 PR #139 修复大项;本文件是 Wave-2 的**逐屏复审**汇总:
> 各审计包回传四维问题清单,主线裁决后进入 BRIEF.md §4 台账的工作包。
> 状态标记:☐ 未决 / ☑ 已修(注 commit)/ ✕ 裁决不做(注理由)。

## 基线问题(2026-09-06,已收敛)

四维清单全文见 DESIGN.md §2(V1-V6 视觉 / H1-H4 层级 / M1-M3 动效 / C1-C3 一致性)。
主项全部随 #139 修复;遗留进入本轮复审。

## Wave-2 复审(2026-09-07,分包并行)

(各包回传后由主线汇总填入)

### 包 A1 对局内·棋盘与演出(a1,截图 tmp/ui-shots/w2-a1/)
- ☐ [层级] 开局镜头跟随吃掉 FIT 边距,最左列(长安)出画 — usePanZoom/boardCamera — **✕ 裁决不做**:镜头跟随是 R3-C4 既有交互特性,改「开局回总览」属行为变更,回报用户另立单
- ☐ [层级] 诸侯行右缘硬裁丢数据(你行最重)— OthersPanel — 并入包 D
- ☑ [视觉] 主驿道 opacity .38 发灰 — board.css — 并入包 D(提档/加芯线)
- ✕ [动效] 终点金环与支路记号交叠、行军环总览不可辨 — 低危观察项,不做
- ☐ [层级] 己方掷骰演出窗「未轮到你」与「魏的回合」口径打架 — HandPanel — 并入包 D
- ☐ [层级] 「运筹中」双份反馈(回合 chip 微标 + WaitingBar)— GameScreen — 并入包 D(撤微标)

### 包 A2 对局内·HUD/侧栏/卷轴/终局(a2,截图 tmp/ui-shots/w2-a2/)
- ☐ [层级] 回合主笺 meta 恒截断 — StatusBar — 并入包 D(允许两行/压缩)
- ✕ [一致性] 现金大数手书体 vs tabular 规约 — **裁决豁免**:主数是「手书点缀」,tabular 指表格/列表列
- ✕ [一致性] 手牌区无笺头 — **裁决豁免**:身份头(国号大印)即本区笺头变体
- ✕ [层级] 「快▾」速度档常驻 — **裁决不做**:改显隐涉 autopilot-speed e2e 契约,风险>收益
- ☐ [层级] 招贤候选卡无行动指引、序号过淡 — DecisionScrolls — 并入包 D
- ☐ [一致性] 破产卷轴金额符号不一(+ 缺)、单位双制(200 分 vs 2两)、进度条无数值伴随 — BankruptcyScroll — 并入包 D
- ☐ [层级] **胜利屏未覆盖侧栏**(absolute→fixed)— VictoryScreen — 并入包 D(最重)
- 观察项:× 圆钮权重弱、购入价/变卖价口径注 — 不做

### 包 A3 首页 + 单机配置 + 选图弹层(a3,截图 tmp/ui-shots/w2-a3/)
- ☑ [一致性] 首页墨钮 rounded-lg 8px 超档 — HomeScreen — 并入包 E(落 5px)
- ☑ [一致性] 首页 ▾ 裸排 — HomeScreen — 并入包 E(Sym expand)
- ☑ [层级/字体] 当前地图行权重弱且 font-deco — HomeScreen — 并入包 E(小签材质+wenkai)
- ✕ [视觉] 横带裱边金线被画心吞 — 低危,不做
- ☑ **[面板种] MapSelectPanel 必须回炉**(金线框+shadow-2xl 纯黑影+满屏 deco 新文案+无笺头+手搓取消钮+大圆角)— **包 A(主包)**
- ☑ [字体] 配置页机遇区 deco 新文案 + details 原生 marker + CTA 沉底 — SoloSetupScreen — **并入包 A**(同在 setup 域,文件不冲突? SoloSetupScreen 归 A 扩)

### 包 A4 联机大厅 + 地图编辑器(a4,截图 tmp/ui-shots/w2-a4/)
- ☐ [错误态] 建房失败裸「HTTP 404」无中文话术 — lobby-api — 并入包 C(先查 e2e 是否钉文本)
- ☑ [一致性] 建房/加入分隔金线 → 发丝墨线;分段头 note-head 化;标点全角统一;空座位浅印 — LobbyScreen — 并入包 C
- ☑ [对比度] 「在线」text-success 3.2:1 — **主线已改**:theme.ts success #059669→#0b7a52(≈4.8:1),gen:theme 已再生成
- ☑ [层级] 编辑器价值表 grid-cols-3 换行孤行 → cols-4;「(未选中城池)」死代码空态删;「已保存」加 font-medium;「返回」按钮 wenkai(回字混排);另存标签全角冒号 — EditorScreen — 并入包 B

### 包 A5 共享组件与全局(a5)
- ☑ [符号·高危] TreasureVisitorScroll「←」「→」裸排于 brush 按钮 — 并入包 D(Sym back + 改「至」)
- ☑ [字体] 「返回首页/返回」按钮 font-deco 含「回」(已剔出 XiaoWei)现即混排 — Lobby/Editor — 并入包 C/B;动态文案容器(HintBar/ConnectionBanner/ConfirmDialog children)迁 wenkai — 并入包 E
- ☑ [动效·红线3] 侧栏抽屉 duration-200/300 字面量 — GameScreen — 并入包 D(--dur-med)
- ☑ [投影] MapSelectPanel shadow-2xl 纯黑影 — 并入包 A
- ☑ [符号] HomeScreen ▾ — 并入包 E
- ✕ [符号] ◆ 裸排 — **裁决不做**:四字体均缺 25C6,现回落系统字形非 tofu;Sym 登记缺口记档
- ✕ [视觉] 棋盘中心亮端发灰 — 低危观察项;✕ Tile deco 城名 — 已知边界(镜像修复消除)
- 正面:金底按钮清零(3 处皆选中态豁免)、ConfirmDialog 品质达标、纹理/晕影双屏协调
