# 纹理素材 (`public/assets/textures/`)

「群雄逐鹿」棋盘与界面用的宣纸/古画纹理。授权与来源的机器可读清单见
`../manifest.json`(`id → {path, source, license, author, fetched_at}`)与 `../CREDITS.md`,
均由 `scripts/fetch-asset.ts` 入库登记;本目录不再收程序自生成的 SVG(2026-08-30 #100
已退役删除 ink-mountains / rice-paper-texture / chinese-fret-border / compass-rose 四个零引用旧文件)。

## 文件清单

| 文件                     | 用途                                       | 授权                                       | 引用处                          |
| ------------------------ | ------------------------------------------ | ------------------------------------------ | ------------------------------- |
| `texture-lanting.webp`   | 兰亭背景(noname 内置,#507 批量入库)      | noname(源头三国杀官方原画,不商用)        | 暂无(S8/S6 接位接线中)         |
| `texture-zhulin.webp`    | 竹林背景(noname 内置,#507 批量入库)       | noname(源头三国杀官方原画,不商用)        | 暂无(S8/S6 接位接线中)         |

> 历史:①`xuan-paper.jpg`(Wikimedia 宣纸实拍,CC0)曾作全局纸纹平铺,2026-09 视觉重做
> 时移除——那是带挂轴/展签内容的展厅照片,平铺读作「失焦展厅」;纸纹改为 app.css 内
> 的程序化 feTurbulence 噪点(代码属 UI 层,不入本目录)。
> ②`qianli-jiangshan.webp`(王希孟《千里江山图》横带,曾用于胜利屏背景/首页横带)与
> `xishan-qingyuan.webp`(夏圭《溪山清远图》中段横带,曾用于棋盘上/下缘远景)于
> 2026-10-14 随玄墨鎏金视觉方向退役(#516)——浅色古画横带与深色基调冲突,由上表
> 深色素材接位;文件已下架,manifest/CREDITS 条目留档标 `retired`。

## 用法速记

- 宣纸底:`src/app/styles/app.css` 的 `#app::after`(feTurbulence data-URI,双层噪点 × multiply)。
- 纹理接线:SVG `<image href="/assets/textures/…" preserveAspectRatio="xMidYMid slice">`;
  新增/更换纹理一律走 `scripts/fetch-asset.ts` 管线下载并登记 manifest + CREDITS,退役时
  删文件并在 manifest/CREDITS 标 `retired` 留档。
