# 纹理素材 (`public/assets/textures/`)

「群雄逐鹿」棋盘与界面用的宣纸/古画纹理。授权与来源的机器可读清单见
`../manifest.json`(`id → {path, source, license, author, fetched_at}`)与 `../CREDITS.md`,
均由 `scripts/fetch-asset.ts` 入库登记;本目录不再收程序自生成的 SVG(2026-08-30 #100
已退役删除 ink-mountains / rice-paper-texture / chinese-fret-border / compass-rose 四个零引用旧文件)。

## 文件清单

| 文件 | 用途 | 授权 | 引用处 |
|---|---|---|---|
| `xuan-paper.jpg` | 宣纸实拍纹理(CSS 平铺底) | CC0 | `src/app/styles/app.css` |
| `qianli-jiangshan.webp` | 王希孟《千里江山图》横带(胜利屏背景) | Public domain | `src/app/screens/game/scroll/victory.css` |
| `xishan-qingyuan.webp` | 夏圭《溪山清远图》中段横带(棋盘上/下缘远景) | Public domain | `src/app/components/board/StaticLayers.tsx` |

## 用法速记

- 宣纸底:CSS `background: url("/assets/textures/xuan-paper.jpg") center / 960px auto repeat;`
- 古画横带:SVG `<image href="/assets/textures/…" preserveAspectRatio="xMidYMid slice">`;
  新增/更换纹理一律走 `scripts/fetch-asset.ts` 管线下载并登记 manifest + CREDITS。
