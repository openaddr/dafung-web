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

- [ ] **W1 战报 emoji → 单字印章图标**
  证据:WarlogPanel.tsx:13-26(12 种 emoji)
  改法:换「单字小方章」(掷/置/伐/宝/贤/税/破/胜…),朱砂或黛青描边小章,旋转 -4°;
  图标表集中定义(icon 表:事件类型→字+色)
  验收:战报区零 emoji;截图对比风格统一;简报/详情两 tab 同步

- [ ] **W2 大厅"活感" + 房间码复制**
  证据:LobbyScreen.tsx:199-289(等待静止);房间码无复制
  改法:①座位点亮动画(scale+fade in);②等待文案轮换(「虚位以待…」→「坐等群雄…」3s);
  ③房间码点击复制 + navigator.clipboard + 「已复制」提示;④开局 disabled 原因(F1 联动)
  验收:建房后肉眼可见动态;点房间码 → 剪贴板含码

- [ ] **W3 手牌区字号阶梯 + 活跃强调**
  证据:HandPanel.tsx:162(primary text-base 混 xs 行);OthersPanel.tsx:18-23(bg-gold/25 太轻)
  改法:①手牌区字号定三档:现金数值 text-lg brush / 标签 text-xs / 卡片 text-xs 统一,
  primary 动作单独一行;②诸侯列表活跃玩家加左侧金色竖条 + 微光;③回合横幅即逝后,
  StatusBar 活跃卡加呼吸描边
  验收:手牌区字号 ≤3 种;活跃玩家一眼可辨(斜眼测试)

- [ ] **W4 破产卷轴分组滚动 + 交涉逃生口**
  证据:BankruptcyScroll.tsx:42-73(平铺无约束);TreasureVisitorScroll 两步流无逃生
  改法:破产列表分「珍宝/城池/名士」三组,组标题 + max-h 内滚;珍宝交涉 owner 视角
  第二步可返回(F已有 back)且模式步可「暂不交易」取消到等待(需引擎允许 skip——已有 skip 命令,接 UI)
  验收:资产 20+ 时不溢出;交涉可全程返回

- [ ] **W5 点击目标 44px(触屏基线)**
  证据:复位/静音按钮 py-0.5(约24px)、字盘 w-7 h-7(28px)、warlog tab、托管小按钮
  改法:全部提到 ≥40px 触达区(padding 扩大,视觉尺寸可不变——用伪元素/负 margin 保密度)
  验收:移动端可点;视觉密度不明显下降

## P2 · 打磨与系统性债

- [ ] **S1 首页仪式感**:入场淡入 stagger(四按钮依次)+ 笔触下划线 hover;active 按压态
- [ ] **S2 编辑器原生弹窗替换**:window.prompt/alert(LobbyScreen 与 EditorScreen)→ 卷轴式 ConfirmDialog/输入卷轴
- [ ] **S3 硬编码色收编**:61 处非 token 色值(重灾区:fx.css 全部、卷轴渐变 #f7ecd0/#ecdcb4×3、
  Editor 危险色全套 #b23a2e、LobbyScreen emerald、VictoryScreen 烟花/遮罩、棋盘 SVG rgba)
  → 扩 tokens(--paper-hi/--paper-lo/--success 等)后逐一替换;fx.css 是否并入 @theme 讨论
- [ ] **S4 胜利屏烟花自适应**:粒子坐标 200-600px magic number → vw/vh 百分比;色板入 token
- [ ] **S5 侧栏响应式**:GameScreen w-72 shrink-0 → md: 断点折叠(棋盘优先,侧栏抽屉或底部);
  Editor w-[380px] 同
- [ ] **S6 符号表统一**:↶↷←▶⌖♪♫◆⇄ 混用 → 定义古风符号表(文档化后统一替换)
- [ ] **S7 仅颜色传达信息 ×3**:大厅在线点(加文字)、棋盘归属(玩家色+首字徽记已有 ✓ 核对)、
  破产线(已有文字标?核对 OthersPanel)
- [ ] **S8 SoloSetup 校验内联**:国号非法 → 输入框红边 + 即时提示(替代常驻灰字)
- [ ] **S9 单机「未开局」兜底页**:GameScreen.tsx:74-77 一行灰字 → 引导回首页按钮

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
