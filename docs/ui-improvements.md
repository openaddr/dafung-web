# UI/UX 优化清单(2026-08-16 专业评审,持久化)

> 来源:双 agent 摸底(视觉体系 + 交互反馈)的设计评审。每条含**证据位置/改法/验收标准**,
> 供任何会话照单施工。完成一条勾一条并在末尾注 commit。
> 分级:P0=反馈断层(功能性)/P1=体验显著提升/P2=打磨与系统性债。

## P0 · 反馈断层(玩家会"懵"的时刻)

- [x] **F1 disabled 按钮零解释**(HandPanel 部分 2026-08-16:reasonForDisabled 集中推导,title+旁注;买地/扩军内嵌文案收敛为 title。Lobby 部分 2026-08-16:开局未选图 title「需先选择地图」+ 下方 xs 原因行;建房/加入/选图 busy 灰 title「处理中…」,加入空码「请输入房间码」)
  证据:HandPanel.tsx:95-226(行军/内嵌决策)、LobbyScreen.tsx:268 附近(开局未选图)
  改法:每个 disabled 按钮给 title + 底部 xs 原因行(如「银两不足」「未轮到你」「未选地图」);
  买地/扩军已有文案内嵌原因(HandPanel.tsx:199/215)推广到全部
  验收:任意时刻按钮灰 → 悬停或旁注可知道原因;e2e 不回归

- [x] **F2 断线不可见**(最严重)(2026-08-16:netStore.connection 三值透出(idle/open/closed/gaveUp,
  online.ts onStatus 全量写入);shared/ConnectionBanner 挂 game 棋盘区顶部 z-20 + lobby 卡片上方,
  testid=connection-banner;closed→「连接中断,重连中…」animate-pulse,gaveUp→「已断线,请刷新页面」,
  重连成功自动消失。顺带修复 reconnecting-socket 默认 timer 方法简写致浏览器 Illegal invocation、
  重连静默失效的存量 bug。注:Chromium setOffline 不断 WS,手测验收用杀服务器进程方式)
  证据:netStore.connected 无任何 UI 消费(grep src/screens 零命中)
  改法:对局屏与大厅屏顶部加常驻「连接中断·重连中(第 N 次)」横幅(bg-danger/90 白字,
  重连成功淡出);重连耗尽换「已断线,请刷新」
  验收:联机 e2e 用 page.context().setOffline(true) 断网 → 横幅出现;恢复 → 消失

- [x] **F3 pending 无 loading**(2026-08-16:online.ts 经 netStore.pending 透传;行军按钮「行军中…」+disabled,内嵌决策同款 label+…。大厅按钮 busy 未动)
  证据:online.ts:100-102(pending=true 锁按钮,无指示)
  改法:行军按钮/内嵌决策加「行军中…」态(文字变体或小 spinner);大厅按钮 busy 同理
  验收:联机发命令 → 按钮文案变化;快照到达 → 恢复

- [x] **F4 hint 三套口径**(game 1.5s 自清 / lobby 1.8s / App+solo-setup 永不过期)
  (2026-08-16:过期下沉 gameStore/netStore 的 pushHint(msg, level?: "error"|"info")——store 持
  1.8s 定时器、重复 push 先清旧;四处渲染点统一 shared/HintBar.tsx(error=红底白字 chip,
  info=原面板/灰字行);GameScreen/LobbyScreen 的本地过期 useEffect 删除)
  证据:GameScreen.tsx:56-60、LobbyScreen.tsx:82-84、App.tsx:239-246(无 timer)
  改法:过期逻辑下沉 store(单一 timeout 常量 1.8s),App 层挂统一清理;错误类 hint 用
  更醒目样式(红底白字 chip)而非灰字,且可点击关闭
  验收:solo-setup 屏起兵失败 → 1.8s 后消失;三屏口径一致

- [x] **F5 cursor 撒谎**(2026-08-16:CardDetailScroll 珍宝/名士详情卷轴,点卡弹出,testid=card-detail-scroll)
  证据:HandPanel.tsx:56-77(cursor-pointer + hover 但 onClick=undefined)
  改法:接珍宝/名士详情卷轴(TODO 阶段5b 遗留挂点);接不上则去掉 cursor/hover
  验收:点击卡片有响应(详情卷轴)或无误导光标

## P1 · 体验显著提升

- [x] **W1 战报 emoji → 单字印章图标**(2026-08-16:WarlogPanel 12 类 emoji → 单字小方章
  20×20/border 1.5px/圆角 2/字 11px/rotate -4°,字表 掷置扩/税济通宝/禁卖胜/纪天,
  朱砂(danger token)·黛青(#3f6a6b)·墨(ink-dim)三色集中定义;简报/详情同源;
  scroll.css 加 warlog-stamp-in 盖入 0.3s,只动画最新一条防 300 条批量重放)
  证据:WarlogPanel.tsx:13-26(12 种 emoji)
  改法:换「单字小方章」(掷/置/伐/宝/贤/税/破/胜…),朱砂或黛青描边小章,旋转 -4°;
  图标表集中定义(icon 表:事件类型→字+色)
  验收:战报区零 emoji;截图对比风格统一;简报/详情两 tab 同步

- [x] **W2 大厅"活感" + 房间码复制**(2026-08-16:①座位行 key 含状态签名 → 入座/上下线
  remount 触发 scale+fade 点亮(lobby.css keyframes lobby-seat-in);②等待文案 3s 轮换——
  非 host「等待房主开局/主公尚在谋划/稍安勿躁」、host 未满座「虚位以待/坐等群雄/广发英雄帖」,
  setInterval 有 cleanup,视角切换重置下标;③房间码改 button 可点,navigator.clipboard 复制 +
  「已复制」1s 小态 + xs「点击复制」提示,复制失败走 pushHint info)
  证据:LobbyScreen.tsx:199-289(等待静止);房间码无复制
  改法:①座位点亮动画(scale+fade in);②等待文案轮换(「虚位以待…」→「坐等群雄…」3s);
  ③房间码点击复制 + navigator.clipboard + 「已复制」提示;④开局 disabled 原因(F1 联动)
  验收:建房后肉眼可见动态;点房间码 → 剪贴板含码

- [x] **W3 手牌区字号阶梯 + 活跃强调**(2026-08-16:①现金 text-lg brush / 标签 text-xs /
  卡片 text-xs 三档;行军行与 ActionInline 分行,ActionInline 内 primary(驻跸/走大路/购地/
  扩军)单独一行不与 xs 次级混排;②OthersPanel 活跃行左侧 3px 金竖条(非活跃透明占位防
  横跳)+ bg-gold/25 + 国号 font-bold;③StatusBar 活跃卡 active-card-breath 呼吸描边,
  2.4s 低透明度金圈(panels.css),subtle 不抢棋盘戏)
  证据:HandPanel.tsx:162(primary text-base 混 xs 行);OthersPanel.tsx:18-23(bg-gold/25 太轻)
  改法:①手牌区字号定三档:现金数值 text-lg brush / 标签 text-xs / 卡片 text-xs 统一,
  primary 动作单独一行;②诸侯列表活跃玩家加左侧金色竖条 + 微光;③回合横幅即逝后,
  StatusBar 活跃卡加呼吸描边
  验收:手牌区字号 ≤3 种;活跃玩家一眼可辨(斜眼测试)

- [x] **W4 破产卷轴分组滚动 + 交涉逃生口**(2026-08-16:BankruptcyScroll 分珍宝/城池/名士
  三组,各组 max-h-56 内滚、空组显示「无」,「结算」钉底加分隔线不随滚,无资产时文案提示认破产;
  TreasureVisitorScroll 模式步「暂不交易」发 resolveTreasureOwner skip——引擎已支持(core/game.ts:893),
  UI 侧核对 action 形状 `{type:"skip"}` 后接线,第二步「← 返回」原有)
  证据:BankruptcyScroll.tsx:42-73(平铺无约束);TreasureVisitorScroll 两步流无逃生
  改法:破产列表分「珍宝/城池/名士」三组,组标题 + max-h 内滚;珍宝交涉 owner 视角
  第二步可返回(F已有 back)且模式步可「暂不交易」取消到等待(需引擎允许 skip——已有 skip 命令,接 UI)
  验收:资产 20+ 时不溢出;交涉可全程返回

- [x] **W5 点击目标 44px(触屏基线)**(warlog tab 部分 2026-08-16:简报/详情按钮 py-2.5,
  点击区 ≥40px 高,视觉字号不变;其余部分同日完成:GameScreen 复位/静音 min-h/w-10 + py-2、
  HandPanel 托管按钮 py-2 + min-h-10、SoloSetup 字盘 w-7 h-7→w-9 h-9(36px,字号 text-base 保密度))
  证据:复位/静音按钮 py-0.5(约24px)、字盘 w-7 h-7(28px)、warlog tab、托管小按钮
  改法:全部提到 ≥40px 触达区(padding 扩大,视觉尺寸可不变——用伪元素/负 margin 保密度)
  验收:移动端可点;视觉密度不明显下降

## P2 · 打磨与系统性债

- [x] **S1 首页仪式感**(2026-08-16:home/home.css——四按钮入场 stagger(80ms/个,
  translateY 8px→0+fade,挂包裹层防动画 fill 锁 transform 压掉 :active);hover 笔触下划线
  2px 金边 scaleX 0→1(伪元素,键盘 focus-visible 同效);active scale .97。testid/布局不变)
- [ ] **S2 编辑器原生弹窗替换**:window.prompt/alert(LobbyScreen 与 EditorScreen)→ 卷轴式 ConfirmDialog/输入卷轴
- [x] **S3 硬编码色收编**(2026-08-16,Scroll/卷轴/fx/lobby/victory 部分;Editor 危险色全套归
  EditorScreen 并行施工,遗留):theme.ts 新增 paper-hi/paper-lo/seal-qing/success 四 token
  (gen:theme 带出),卷轴体渐变 #f7ecd0/#ecdcb4 → from-paper-hi to-paper-lo(ScrollShell/
  ConfirmDialog),WarlogPanel 印章黛青 #3f6a6b → seal-qing,LobbyScreen 在线点 emerald →
  success,fx.css 全部主题色 hex → var(--color-*)(黑色阴影 rgba 字面量保留,投影非色板)。
  遗留:棋盘 SVG Tile/StaticLayers 的 rgba 渲染层字面量(另一体系,量大)、卷轴阴影
  rgba(60,40,10,.4)、胜利屏烟花亮蓝/纯白与遮罩暗金(表现专用色,集中常量见 S4)
- [x] **S4 胜利屏烟花自适应**(2026-08-16):粒子圆心 200-600px/150-400px magic number →
  容器百分比(水平 15%-85%、垂直 12%-60%);烟花六色中金/朱砂/青绿/赭橙改引
  var(--color-*),亮蓝 #2980b9 与纯白 #fff 为烟花表现专用色不入 theme 语义色板(组件常量
  +注释);遮罩暗金渐变与信息文字 rgba 收敛为组件常量 OVERLAY_BG/INFO_TEXT
- [x] **S5 侧栏响应式**(game 部分 2026-08-16:md 断点以下棋盘优先,侧栏
  `w-[min(288px,45vw)]` 可压(棋盘保 ≥55vw),md+ 恢复 w-72;四区 flex-col 自适应。
  遗留:抽屉式折叠成本高未做;Editor w-[380px] 部分(EditorScreen 非本批文件)未动)
- [x] **S6 符号表统一**(2026-08-16:docs/ui-symbols.md 定「古风符号表」(每用途 1 符号);
  独占文件内替换 GameScreen 静音 ♪/♫→♪/♪̶、复位 ⌖→◎;全项目盘点其余文件均已
  符合符号表,遗留清单见 ui-symbols.md(无需替换项))
- [x] **S7 仅颜色传达信息 ×3**(lobby 部分 2026-08-16:座位在线点旁加「在线/离线」xs 文字
  标签(成功色/ink-dim,testid lobby-seat-online-N),不只靠颜色;game 部分 2026-08-16 核对:
  OthersPanel 破产行 line-through+opacity-40 已有非颜色线索 ✓,胜者原仅 text-gold → 补
  「胜」单字标记(与「智」同款后缀);棋盘归属有国号徽记+文字,非仅颜色)
- [ ] **S8 SoloSetup 校验内联**:国号非法 → 输入框红边 + 即时提示(替代常驻灰字)
- [x] **S9 单机「未开局」兜底页**(2026-08-16:GameScreen 一行灰字 → 居中卡片「尚未开局/
  对局数据不存在或已丢失」+「回到首页」按钮 setScreen("setup"),testid=not-started-back)

## 摸底事实速查(施工时引用)

- 字体族:brush(标题/数值)/body(正文)/deco(脚注),tokens.css:24-26
- 玩家色注入:`--player-color` + `bg-(--player-color)` 任意值类
- 反馈时长表:浮字 1.3s/铜钱 1.4s/横幅 1.8s/印章 0.85s/流光 0.5s;bot 步 750ms;骰子 500-1500ms
- hint:testid "hint";三屏渲染点 GameScreen:124/App:239/solo-setup:214
- e2e 命名:testids.ts 集中定义(kebab-case),quickStart 走 home-solo

## 完成记录

(格式:条目号 + commit + 一句话效果)

- F2/F4 + F1-Lobby(react-rewrite,2026-08-16,待 commit):断线横幅三值透出 + 浏览器端
  重连静默失效修复;hint 过期下沉 store 统一 1.8s、渲染统一 HintBar;大厅开局未选图
  title + xs 原因行。手测:?online=1 建房 → taskkill 服务器 → 横幅「连接中断,重连中…」
  出现 → 重启服务器 → 横幅自动消失。

- W1/W4/W5-warlog(react-rewrite,2026-08-16,待 commit):战报 emoji 全部换单字印章
  (朱砂/黛青/墨三色,新条目盖入动画);破产卷轴三组内滚 + 结算钉底;珍宝交涉模式步
  可「暂不交易」skip;warlog tab 触达区 ≥40px。tsc/bun test/build/e2e(scrolls+solo)全绿。

- W2/W3/W5-其余(react-rewrite,2026-08-16,待 commit):大厅座位点亮动画 + 等待文案 3s
  轮换 + 房间码点击复制;手牌三档字号 + primary 独立行 + 活跃竖条/呼吸描边;复位/静音/
  托管/字盘触达区提升。tsc/bun test/build/e2e(online+setup)全绿。

- S3(Scroll/fx/lobby/victory)+ S4 + S7-lobby(react-rewrite,2026-08-16,待 commit):新增
  paper-hi/paper-lo/seal-qing/success 四 token;范围内硬编码色 hex/语义色 19 处 → 3 处
  (fx.css 11→0、卷轴渐变 4→0、WarlogPanel 2→0、Lobby emerald 1→0、Victory 烟花 6→2
  表现专用常量);烟花圆心改容器百分比自适应;tsc 因并行 SoloSetup WIP 暂报 1 错(非本
  批文件),bun test 167 绿、build 过、scrolls+online e2e 6/6 绿、gen:theme 幂等。

- S1 + S5-game + S6 + S7-核对 + S9(react-rewrite,2026-08-16,待 commit):首页四按钮入场
  stagger(80ms/个)/笔触下划线 hover/按压态(home.css);game 侧栏窄屏
  w-[min(288px,45vw)] 棋盘优先(抽屉遗留);静音 ♪/♪̶、复位 ◎ 按符号表替换,符号表落
  docs/ui-symbols.md(盘点:其余文件已一致);OthersPanel 胜者补「胜」字标记(破产行原有
  line-through+opacity 非颜色线索 ✓);未开局灰字 → 卡片+回到首页(not-started-back)。
