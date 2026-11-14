---
name: dogfood
description: 按用户明确请求进行单次网页探索 QA，查找功能、体验或视觉问题并提供可复现证据；不建立浏览器回归，APK 视觉与设备交互由用户验收。
---

<!--
Derived from ZCode (.agents/skills/dogfood/SKILL.md), itself derived from
vercel-labs/agent-browser (skills/dogfood/SKILL.md), Copyright 2025 Vercel Inc.,
Licensed under Apache-2.0. Modified for dafung-web: browser-use tooling,
game-specific checklist and evidence conventions.
-->

# 狗粮 QA(dogfood)

仅在用户明确请求网页走查、页面观察、截图对比或浏览器复现时执行,服务于本次问题。发版或实现页面本身不触发走查;验证边界见 [ADR-0065](../../../docs/adr/0065-test-economics-browser-retirement.md)。

## 准备

1. 按请求确定流程与观察面,默认移动横屏 844×390。视觉和真实手势、系统返回、键盘、后台恢复、原生保存仍由用户在 APK 中验收。
2. 启动、截图与探针按[开发与测试](../../../docs/how-to/开发与测试.md)选用现役工装和会话可用浏览器能力。网页从玩家操作开始探索;调试桥仅在证据存疑时佐证,不作为探索入口。
3. 截图、录屏和临时草稿放本次 tmp/ 目录;结论在回复中交付。过程材料按[文档规约](../../../docs/how-to/文档规约.md)处置,不要求长期报告归档或固定问题数量。

## 按请求走查

- **首页与现役入口**:单机、联机、当前视口的选图入口及手册,检查可达性与内容完整性。
- **单机流程**:按任务范围观察选都、购地/扩军、珍宝、锦囊手牌架、抉择卷轴、过都城、清算和终局。需要复现同局时固定 seed,不为凑流程重复跑整局。
- **异常操作**:按请求检查托管、设置、快速连点或刷新恢复,记录实际行为与控制台报错。
- **联机**:涉及联机时用独立客户端观察同房状态、操作与重连;单次网页结果只说明所见场景。

## 取证与交付

发现问题就记录操作、前后状态和复现条件。交互或时序问题保留相关步骤与截图,必要时录屏;静态问题用能定位问题的截图。数量、位置或尺寸判断可用相关 testid 或已授权调试桥读数佐证,选择器沿用各屏 testids.ts 单源。无法复现的现象明确标注条件和不确定性。

回复列出有证据的问题、影响、复现步骤及证据位置,说明已观察范围和 APK 待人工确认项。用户要求立票或修复后,按[工单约定](../../../docs/agents/issue-tracker.md)继续;本次操作与脚本不固化为测试或开发门槛。
