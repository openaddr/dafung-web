# hero-taishici — 名将扩展·太史慈(官方示例包)

ADR-0022 扩展系统骨架的验收样例:三能力各一最小实现,随引擎注册面走通全链路
(装包 → 双端加载 → 对局可玩 → UI 生效)。

| 能力          | 落点                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------- |
| 技能/效果注册 | 被动技「义从」(HeroRecruited 时机)+ 自定义效果 `joinGift`;主动技「破阵」复用 warDrum 结算案 |
| 动画 handler  | 吃 `skillFired`/`heroSkillActivated` 事件批,播「义」字印 + 文案浮字                         |
| 渲染 hook     | 名将专属将旗(`assets/flag.svg`,招贤/军师幕/府库卡面挂旗)                                    |
| 交互 handler  | 定制问询「信义盲选」(`taishici-blind-pick`):从暗牌盲选的脱敏选项集;客户端声明牌背呈现       |

## 布局

```
manifest.json   包清单(id/name/version/entry/client)
index.js        权威侧入口(编译产物;裁决语义,服务端与单机本地引擎同装)
client.js       客户端入口(编译产物;纯表现,浏览器动态 import)
assets/         静态资源(将旗;站点根相对 URL)
src/            TS 源(类型对齐 src/core/extension-contract.ts 与 src/app/extensions/registry.ts)
```

## 从源码再生成编译产物

```bash
cd extensions/hero-taishici
../../node_modules/.bin/esbuild src/index.ts  --format=esm --target=es2022 --charset=utf8 --outfile=index.js
../../node_modules/.bin/esbuild src/client.ts --format=esm --target=es2022 --charset=utf8 --outfile=client.js
```

写扩展包的完整说明见 `docs/how-to/扩将指南.md` 的「运行时扩展包」一节。
