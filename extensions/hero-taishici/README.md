# hero-taishici — 名将扩展·太史慈(官方示例包)

ADR-0022 扩展系统骨架的验收样例:**最小模板形制 = `manifest.json` + `index.js` 两个文件**
(外加 `src/` TS 源供作者维护),权威侧三路贡献(skills/effects/heroes)各一最小实现,
随引擎注册面走通全链路(装包 → 装载 → 对局可玩)。能力全集对照
`src/core/extension-contract.ts`;客户端半边(动画/渲染/呈现 hook)已退役(#1064),
交互问询线(「信义盲选」)已退役(#1065,choices 通路为唯一问询通路)。

| 路贡献  | 落点                                                                                  |
| ------- | ------------------------------------------------------------------------------------- |
| skills  | 被动技「义从」(HeroRecruited 时机)+ 主动技「破阵」复用 warDrum 结算案(两技形制)       |
| effects | 自定义效果 `joinGift`(来投之礼 +100 两)                                               |
| heroes  | 名将「太史慈」入池(skillPool 按序引用上述两技),招贤/机遇送将/快照回链全走 HEROES 单表 |

## 从源码再生成编译产物

```bash
cd extensions/hero-taishici
../../node_modules/.bin/esbuild src/index.ts --format=esm --target=es2022 --charset=utf8 --outfile=index.js
```

写扩展包的完整说明见 `docs/how-to/扩将指南.md` 的「运行时扩展包」一节。
