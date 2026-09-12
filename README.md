# 群雄逐鹿 · 三国大富翁

一款**古风水墨**画风的多人三国大富翁:掷骰行军、购地经营、拼点探宝,率先攒够身价者称帝。

## 即开即玩

**→ [https://dafung.openaddr.cn](https://dafung.openaddr.cn)**

浏览器打开就能玩,无需安装;和朋友联机也是同一个地址——一人建房,把房间码发给朋友入座即可,见[联机对战](./docs/how-to/联机对战.md)。另有安卓安装包(APK),属实验性打包、未经实测,建议直接用浏览器玩。

## 玩法速览

- 2–8 人一局:单机是你对阵电脑,联机则各带一台设备、真人同桌。
- 每回合掷骰行军:买城进驻、免费扩军经营;落宝物城拼点探宝,踏进别人的城便有一场珍宝交涉。
- 锦囊是全游戏唯一的暗牌:暗攥在手、他人不见,出牌的时机就是你的底牌。
- **身价 = 仅现金**(珍宝、城池都不计入),率先达到目标身价,或让对手尽数破产,即称帝获胜。
- 规则与数值全集见[规则手册](./docs/reference/rules/README.md)。

## 五分钟上手

不用先啃规则,跟着[新手第一局](./docs/tutorials/新手第一局.md)走完一局,你就会了。

## 文档地图

| 想做什么 | 去哪 |
|---|---|
| 教我玩一局 | [新手第一局](./docs/tutorials/新手第一局.md) |
| 联机 / 自制地图 / 扩将 / 自建服务器 / 开发测试 | how-to 对应页:[联机对战](./docs/how-to/联机对战.md) · [自制地图](./docs/how-to/自制地图.md) · [扩将指南](./docs/how-to/扩将指南.md) · [部署服务器](./docs/how-to/部署服务器.md) · [开发与测试](./docs/how-to/开发与测试.md) |
| 查规则 / 数值 | [规则手册](./docs/reference/rules/README.md)(十页导览) |
| 懂设计(哲学 / 时机框架 / 联机架构 / 锦囊设计) | [设计哲学](./docs/explanation/设计哲学.md) · [时机框架](./docs/explanation/时机框架.md) · [联机架构](./docs/explanation/联机架构.md) · [锦囊设计](./docs/explanation/锦囊设计.md) |
| 查术语 | [CONTEXT.md](./CONTEXT.md) |

## 为开发者

```bash
bun install && bun run dev   # 本地开发服务器 http://localhost:5173
```

测试与 AI 自动化接口见[开发与测试](./docs/how-to/开发与测试.md);架构与红线见 [AGENTS.md](./AGENTS.md);设计决策存档见 [docs/adr/](./docs/adr/)。
