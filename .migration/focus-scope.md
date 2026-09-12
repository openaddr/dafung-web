# focus-scope

2026-09-12,engine(自研等价物,Base UI 无独立 FocusScope——#158 证实 mui/base-ui#1374 open、内部 FloatingFocusManager 未导出)。结论:全仓最后一个 Radix 依赖移除,零第三方等价物缺失。

## Changed

- `src/app/screens/shared/DialogFocusScope.tsx`:重写——@radix-ui/react-focus-scope 薄壳 → 自研焦点陷阱(document 级 Tab 圈定回绕 + focusin 漂出拉回 + 容器 focusout 掉焦补拍 + 卸载还焦;asChild ref 组合保住 Shell 拖拽 bodyRef)。外部 API 不变(asChild/children),消费方零改动。
- `src/app/screens/game/scroll/ScrollShell.tsx`:三处注释里的 radix 表述刷新(纯注释,零代码变化)。
- `package.json`/`bun.lock`:−@radix-ui/react-focus-scope。
- `AGENTS.md`:红线 #6 附表措辞——「radix focus-scope 单点」→「shared/DialogFocusScope 自研原语,radix 依赖已清零」。

Leftover scan:`grep -rn "from \"@radix-ui\|from \"radix-ui" src/` = **0**;package.json 无任何 radix 条目(残留字符串均为「已移除」史注)。

## Left alone

- cmdk/vaul/sonner 等非 radix 库:项目未使用,无涉及。
- `.migration/`:本报告目录,skill 产物。

## Behavior changes

- **掉焦拉回补强**(非回归,是补盲):radix 对「blur()/非焦点元素点击掉焦到 body」同样不拉回(Chromium 不派发 body focusin);自研版加了容器 focusout 守卫补拍,行为强于原实现。其余口径(挂载不夺焦/Tab 回绕/漂出拉回/关闭还焦)与 radix 行为逐项对齐。
- asChild ref 组合为自实现:子元素 ref 不被覆盖(Shell 拖拽 bodyRef 实测不受影响——拖拽 clamp e2e 全绿)。

## Verify by hand

1. 对局中点城开详情卷轴:连按 Tab,焦点应恒在卷轴内;点遮罩/掉焦后 Tab 应重新进卷轴;
2. Esc 关卷轴:焦点回到打开前持有者(如掷骰钮);
3. 胜利屏:Tab 在「重开/导出」两钮间回绕;重开后焦点不丢;
4. 卷轴标题栏拖拽:拖动仍正常(证明壳体 ref 未被覆盖)。

**Radix wrappers remaining: 0**
