# 破产自救分页静态样张

用于核对 [#1401](https://github.com/openaddr/dafung-web/issues/1401) 已确认方案在移动横屏中的资产密度、数量器与底部清偿区。仅为静态展示，不接真实状态变更，不并入主线。

从本分支仓库根运行：

```bash
bunx vite --host 127.0.0.1 --port 4187 --strictPort
```

打开 <http://127.0.0.1:4187/src/app/screens/game/scroll/BankruptcyStaticPrototype.html>，视口设为 844×390。初始展示尚欠款；给 `body` 加上 `ready` 类展示足额状态。所有资产、页数与选择均为示意，翻页与加减没有绑定行为。

布局与金额状态以相邻 HTML 为源；价格取当前规则中的相应珍宝档位及中原地图城池变卖价，配色、字体直接消费项目现有样式。是否采用本布局仍待维护者查看样张，不把网页几何观察当作 APK 交互验收。
