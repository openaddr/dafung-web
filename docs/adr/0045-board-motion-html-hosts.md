# ADR-0045: 动态板出 SVG 入 HTML 宿主 + 手势合成器化——第三波渲染性能治本

状态:已采纳(2026-11-01,用户报「还是有点卡卡的,尽可能提高性能,实在不行上引擎」即席拍板;ADR-0039/0040 同一治本路线的第三波)

## 背景

前两波(ADR-0039 氛围层 / ADR-0040 双板拆分)合入并发版后,用户实机(v2026.11.x,卓易通)仍报「卡卡的感觉」。四阶段量化探针(844×390 DPR3 + CPU 4x 降速,真机口径)把残余瓶颈钉死:

- **活动窗(行军/特效/流光)**:动态板 `#board-tokens` 里活着的东西(棋子 transform 过渡、行军金环 0.9s infinite、浮字/印章/流光 CSS 动画)每帧令**整张视口级 SVG** 失效重绘——窗内 28~~45 次 layout/s,fps 掉到 28~~43;窗间显隐 A/B(display:none)layout→≈0、fps 回 41~51,代价全部记在这张 SVG 头上。Blink 铁律:SVG 子元素拿不到合成器层,动画再少也是整幅重栅(设备 DPR3 ≈2.8MP/帧)。
- **手势(滚轮缩放/拖拽/捏合)**:usePanZoom 每帧 setAttribute 双板 viewBox → 双幅全重栅,fps 60→33。
- 真静止干净(60fps、layout 0),前两波成果稳固;选都金圈脉冲实测无帧代价,不动。

用户问「是不是 SVG 太多」——不是数量问题:主线程 JS 只占 1%,静止期同样的 SVG 满帧率;病根是**动的东西住在 SVG 里**,一个都嫌多。「上引擎」不需要:动画本就是 CSS,治本=搬到浏览器合成器能接管的宿主(合成器就是引擎);three.js 已否决(卓易通 WebGL 疑软渲染),Canvas2D 只作复测不合格时的备胎,不在本波。

## 决策

### 一、动态板整体出 SVG → board 锚定 HTML 宿主(逐件 mini-svg 保形)

- **BoardHost(boardHost.tsx)**:世界坐标(逻辑单位=px)直铺的 HTML 宿主,矩阵同步自持(viewBox MutationObserver/RO/fonts.ready,每事件拍一次「读盒+写容器」)——即 ADR-0039 氛围层同步的共享化(`useBoardMatrixSync` 钩子,ambientMatrix.ts 退役)。氛围层与棋子/特效/流光四个宿主同一套换算,单源不复制。
- **棋子层(TokenLayer,HTML 版)**:每棋子一个合成器提升的包装 div(`will-change:transform` + transform 过渡,尺寸=美术盒 TOKEN_ART_BOX 121×142、负 margin 回锚)+ 内嵌 mini-svg(旗面/双环**原绘原类**,viewBox 同盒)。行军接管机制零改动:useMarch 仍查 `#bv-tokens [data-token-player]` 写 style.transform——宿主从 `<g>` 换 div,选择器契约保号;HTML transform 过渡由合成器插值,主线程只在段边界参与。
- **特效层(BoardFxLayer,HTML 版)+ 驿道流光**:每件特效/每条流光独立 mini-svg(`.bv-fx-svg`:0 尺寸 overflow visible,世界坐标原绘原类)——美术/CSS keyframes/DOM 契约(`data-fx-jinnang-line` 等)逐字不动,失效范围收敛到各件自身小盒。墨渍渐变 defs 走单例 mini-svg(同文档跨 svg url 引用,氛围层 capital-glow 同法先例)。
- **顶板 SVG(`#board-tokens`)就此退役**,双板双写回单板:`usePanZoom` 收掉 tokensSvgRef 第三参;层序(DOM 序)棋子 → fx → 流光 → 氛围,与旧绘制序一致。

### 二、手势合成器化:手势期栈 transform,提交拍写回 viewBox

- 全部棋盘层包进**手势栈 `.bv-stack`**(公共 transform 宿主,`transform-origin:0 0`)。手势进行中(滚轮连发/拖拽/捏合/±钮),取景增量写成栈的 CSS transform(严格复刻 meet 映射的 translate+scale,k=s2/s1、t 按恒等式解出)——合成器插值,棋盘栅格缓存零重绘;**静默 140ms 或指针收尾才「提交拍」**:一次性写回 `#board` viewBox 并清栈 transform,棋盘重栅一次回清晰。
- 提交拍同时是宿主矩阵的唯一 resync 拍(各宿主的 viewBox MutationObserver 同拍跟随),手势期宿主随栈 transform 整体跟随,不脱锚。
- 手势期 gBCR 是含 transform 的视觉盒:锚点/拖拽映射一律经 gestureRef 系数(tx/ty/k)折算回布局盒再走既有数学,精确不引第二套近似。

## 承认的取舍

- **手势进行中画面变糊**:栈 transform 拉伸旧栅格,松手/静默提交后回脆——手势是短瞬交互,清晰度让位流畅度;静止期(绝大多数时间)零影响。
- **逐帧失效从「一张大 SVG」变「N 个小 svg」**:行军金环旋转/浮字上升仍触发各自 mini-svg 的对象布局,Layout 事件计数不降(量级从视口级塌缩到盒级);桌面 trace 总和受限采样噪声未见显著差——真收益在栅格体积(~~100×)与合成器接管位移,桌面探针只能测到主线程闲化(taskMs 3~~5ms/5s)与手势帧率翻倍。
- **取景真源短暂双态**(手势期:viewBox=fit 旧值+栈 transform=新取景):提交拍即归一;取景敏感消费点(pxPerUnit/getScreenCTM)在 140ms 窗口内读到旧值/含 transform 值,飞行类特效起飞拍一次性换算,实测无感。
- **包装 div 携带真实美术盒**(非 0×0 锚):氛围层对位 spec 量的就是它,盒=旗面+双环缩放并集+2 安全边,单值 TOKEN_ART_BOX。

## 验收

- 视觉 parity:master 同种子同拍点 A/B 截图(静止态+行军态)逐像素一致;对位守卫 e2e(react-ambient-align,量包装盒)原样通过;
- 手势(4x,frozen board):滚轮缩放 rAF fps 34→50、拖拽 33→58,layout 事件 28~~30→3~~14/窗;活动窗主线程 taskMs 塌到 3~5ms/5s,藏宿主窗 fps 上限 44.7→53.9;
- 全量 e2e + bun test + 门禁全绿(见 PR);真机终审按既定口径交用户复测(与前两波同协议)。

## 后果

- 正面:SVG 内逐帧动画清零——棋盘上每帧失效的东西全部住在合成器可见的宿主里;真机「活动期卡顿+棋盘格闪」的最后结构性源头(整幅视口重栅)拔除;
- 代价:棋盘心智模型从「两板」变「一 SVG + 三 HTML 宿主 + 手势栈」(词汇收口:手势栈/动态宿主/mini-svg,见 GLOSSARY);Canvas2D 备胎搁置不用;
- 后续:若真机活动窗仍有可感顿挫,残余候选=行军金环旋转改合成器通路(HTML 环)或降为两帧摆动——证据驱动,不预设。
