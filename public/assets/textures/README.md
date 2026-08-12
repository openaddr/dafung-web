# 古风水墨纹理素材 (`public/assets/textures/`)

为「群雄逐鹿」三国大富翁棋盘准备的纹理/装饰素材。当前棋盘为纯 SVG 程序绘制
(`src/render/board.ts` 的 `feTurbulence` 滤镜 + `drawMountainsAndRivers` + CSS 渐变宣纸底),
本目录提供可叠加替换的高质量纹理。

---

## ⚠️ 重要:本批素材为原创生成(非 Wikimedia 下载)

原始任务要求从 Wikimedia Commons 下载 public domain / CC0 素材。经多轮中英文检索
(`commons.wikimedia.org` search API + `imageinfo` API),结论如下,无法满足"下载现成素材":

| 类别 | Wikimedia 调研结论 |
|---|---|
| 宣纸/水墨纹理 SVG | **几乎不存在**合适的矢量纹理,搜索全是无关内容或博物馆藏品照片(JPG) |
| 水墨山水真品 | 有大量 PD 真迹(范宽《溪山行旅》、夏圭《溪山清远》、倪瓒《容膝斋》等),但**全是 JPG 大图**,而本流程无 `bash`/`curl`,`web_fetch` 无法下载二进制(会把图片当文本损坏) |
| 祥云/回纹 SVG | 中英文均未命中可用矢量纹样("祥云"全是云南祥云县照片;"meander" 命中的是河流地质图) |
| 古地图罗盘 SVG | 找到 `Simple compass rose.svg`,但授权是 **CC BY 3.0**(需署名,非 PD/CC0);且 `upload.wikimedia.org` 对自动化请求返回 **429 限流** |

**因此采用风险最低、完全可逆的兜底方案:程序化自生成全部 4 类 SVG 纹理。**
自创即**公有领域 / CC0**(无任何版权与署名负担),严格满足"PD/CC0"要求;且与
`board.ts` 的程序绘制风格统一,体积小、可平铺。**仅新增文件,不改动任何现有代码**,可随时删除替换。

---

## 文件清单

| 文件 | 用途 | 大小 | 授权 | 作者 |
|---|---|---|---|---|
| `rice-paper-texture.svg` | 宣纸纹理(可无缝平铺) | ~2.3 KB | CC0 / 公有领域 | 原创生成 |
| `ink-mountains.svg` | 水墨远山(背景远景层) | ~1.9 KB | CC0 / 公有领域 | 原创生成 |
| `chinese-fret-border.svg` | 回纹/祥云边框纹样(可水平平铺) | ~1.9 KB | CC0 / 公有领域 | 原创生成 |
| `compass-rose.svg` | 古风八方位罗盘 | ~3.1 KB | CC0 / 公有领域 | 原创生成 |

> 全部 < 100 KB(实际均 < 4 KB)。配色严格对齐 `src/render/style.css` 与 `src/core/theme.ts`。

### 配色对照(双源同步,改一处记得同步另一处)

| 变量 | hex | 用于 |
|---|---|---|
| `--bg` 宣纸底 | `#e8dcc0` | 宣纸纹理底、罗盘盘面 |
| `--bg-deep` | `#d9c9a3` | 纹理渍痕、罗盘外缘 |
| `--panel` | `#f2e8cf` | 罗盘高光中心 |
| `--ink` 墨 | `#2b2317` | 水墨远山、罗盘北针/中心 |
| `--ink-dim` | `#6b5d40` | 罗盘次向针/刻度 |
| `--gold` | `#c8a13a` | 回纹/祥云/罗盘金枢 |

---

## 用法示例

### 1. 宣纸纹理替代 CSS 渐变底(`src/render/style.css` body)

```css
body {
  background-color: var(--bg);
  background-image: url("/assets/textures/rice-paper-texture.svg");
  background-size: 512px 512px;   /* 原始尺寸平铺 */
  background-repeat: repeat;
}
```

### 2. 水墨远山叠加到棋盘背景(`src/render/board.ts` 的 `drawMountainsAndRivers` 替代/增强)

```ts
// 在背景层最底(色块 rect 之后、城池层之前):
defs.appendChild(svg("image", {
  href: "/assets/textures/ink-mountains.svg",
  x: VB_X, y: VB_H * 0.62, width: VB_W, height: VB_H * 0.38,
  opacity: "0.9", preserveAspectRatio: "none",
}));
```

### 3. 回纹边框(侧栏/标题栏描金)

```css
.title-banner {
  border-image: url("/assets/textures/chinese-fret-border.svg") 30 round;
}
```

### 4. 罗盘(棋盘角落装饰)

```html
<img src="/assets/textures/compass-rose.svg" width="120" style="position:absolute;right:16px;top:16px;opacity:.85"/>
```

---

## 后续:若要替换为 Wikimedia 真实素材

下面是调研中确认存在的候选,**需用 `curl` 手动下载**(本流程因无 shell + 429 限流未自动下载)。
注意授权并非全部 PD/CC0,使用前请按各自协议处理署名:

| 候选 | 文件 | 授权 | 下载(去掉 utm 参数) |
|---|---|---|---|
| 古地图罗盘 | `File:Simple compass rose.svg` | **CC BY 3.0**(需署名:作者 Brosen / Howcheng) | `curl -o compass.svg "https://upload.wikimedia.org/wikipedia/commons/8/8d/Simple_compass_rose.svg"` |
| 水墨山水(PD 真迹,JPG) | `File:Fan Kuan-Sitting Alone by a Stream.jpg`(北宋范宽) | **公有领域**(作者逝世 >100 年) | 需先经 `imageinfo` 取 `url` 再 `curl`,文件较大(数 MB),建议压缩到 100KB |
| 水墨山水(PD 真迹) | `File:溪山清远图.jpg`(南宋夏圭) | 公有领域 | 同上 |
| 水墨山水(PD 真迹) | `File:Ni Zan. The Rongxi Studio...jpg`(元倪瓒) | 公有领域 | 同上 |

> 拓展来源(非 Wikimedia,但多为 CC0/CC BY):[OpenGameArt.org](https://opengameart.org) 搜 "paper texture" / "chinese"。
