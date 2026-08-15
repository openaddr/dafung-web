# React 全量重写渲染层方案

## 总原则

- **同仓新分支** `react-rewrite`(不开新仓:保留 git 历史、core 单测与联机服务器不动)
- **零改动区**:`src/core/**`(2400 行,零 DOM)、`scripts/server.ts`、`room.ts`、联机协议(`GameCommand`/snapshot)、`test/` 单测、`public/` 资源
- **全量重写区**:`src/render/**`(~4900 行)、`src/main.ts`、`e2e/`(17 spec 约 1300 行)、`src/render/style.css`(1339 行,迁 Tailwind)
- 双模式控制器思想保留:单机(引擎权威)与联机(snapshot 驱动)仍是两个控制器,但 UI 壳统一 React

## 技术栈

- React 18 + TypeScript + Vite(不换构建体系,Tauri 无感)
- zustand:游戏状态 store
- Tailwind CSS v4:主题色 token 从 `theme.ts` 单源生成(脚本产出 tailwind theme 配置),根治双源配色
- Three.js/cannon-es 骰子、Web Audio 音效:**逻辑保留类封装,以 React 组件 + ref 挂载**(Three.js/Web Audio 本质是命令式 API,"React 化"指组件生命周期接管其创建/销毁/触发,不是改写其内部)

## 新目录结构

```
src/
  core/              # 原样不动
  app/               # 新 React 层
    main.tsx         # React 挂载入口(替换 src/main.ts)
    store/
      gameStore.ts   # zustand:snapshot 作 state、syncFromEngine()、viewSeat、UI 态
      netStore.ts    # WS 连接/房间状态
    controllers/
      local.ts       # 单机编排(原 state.ts 的动画编排/AI 调度,去 DOM 化,改发 store 更新)
      online.ts      # 联机编排(原 network-client.ts,WS → engine.restore → store.sync)
    screens/
      Setup/ MapSelect/ Lobby/ Game/ Editor/ Victory/
    components/
      board/         # JSX 声明式 SVG 棋盘(宣纸滤镜/山川/道路/城池 props 驱动)
      dice/          # DiceOverlay 组件(封装 ThreeDice 类)
      audio/         # AudioProvider(封装 AudioPlayer)
      ui/            # 按钮/卷轴弹层/侧栏/战报等通用组件
    fx/              # 令牌行军、浮动金额、回合横幅等编排(命令式,由 store 驱动触发)
  styles → Tailwind(theme token 由脚本从 core/theme.ts 生成)
```

## 实施阶段(每阶段有验证门,可用子 agent 并行)

1. **脚手架**:建分支,装 react/zustand/tailwind,React 入口跑通空壳页;写 theme→Tailwind token 生成脚本(单源配色)
2. **store + 控制器骨架**:gameStore(snapshot/syncFromEngine/viewSeat/interactive),local/online 控制器去 DOM 化接入
3. **棋盘 JSX 化**:board/ 组件(滤镜、山川、道路、40 城、旗子棋子、panZoom),props 驱动 + memo 增量
4. **Game 屏**:侧栏四区(手牌/状态栏/他人/战报)、data-testid 体系建立
5. **动画与骰子**:fx/ 编排(行军/浮字/横幅/印章),DiceOverlay、AudioProvider 接入
6. **单机全流程可玩**:设置屏 → 开局 → 掷骰 → 决策 → 胜利(验证门:手动全流程 + window.__dafung 调试钩子重建)
7. **联机**:Lobby 屏 + online 控制器 + snapshot 重 hydrate(验证门:双端同步手测)
8. **地图编辑器**:Editor 屏(拖拽画布保留命令式,面板 React 化)
9. **样式收尾**:style.css 全量迁 Tailwind 完成后删除;内联样式清理
10. **e2e 重写**:新选择器体系下重写 17 spec(断言逻辑复用,选择器全部换 data-testid);vitest 保留,action-parser 随新 UI 层重设计后同步
11. **文档**:更新 CLUDE.md(技术栈条款、架构红线不变)、RULES.md、CONTEXT.md

## 风险与对策

- **SVG 滤镜/复杂图形 JSX 重做易走样**:board.ts 作视觉对照基准,边迁边截图比对(screenshots/ 已 gitignore,可作临时对照)
- **动画编排(controller 里最难拆的 451 行)**:保持命令式封装、由 store 触发,不强行"状态驱动化",降低引入时序 bug 的风险
- **迁移期无 e2e 安全网**:阶段 6/7 各设手动验证门;window.__dafung 钩子提前重建供调试
- TODO 里两条已知问题(骰子结尾 snap、联机多端动画一致性)在迁移中一并按新架构设计,但不阻塞主线

## 交付物

分支 `react-rewrite`,功能对齐当前 master(单机 + 联机 + 编辑器),core 与联机协议零改动,样式 Tailwind 化、配色 theme.ts 单源,e2e 全新通过。