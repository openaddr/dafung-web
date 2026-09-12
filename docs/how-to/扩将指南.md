# 扩将指南:新增武将(立绘 + 数据行)

从三国杀 wiki(patchwiki 图床)扩一名武将入库,共两步:找页面 id → 跑一条命令。图片落库后,
在 `src/core/heroes.ts` 补一条 `HeroDef` 数据行即完成"新武将可玩"。

## 管线用法(两步)

### 第 1 步:在 wiki 上找到武将「经典形象」的 File 页 id(curid)

1. 打开武将 wiki 页(如 `https://wiki.biligame.com/sgs/司马懿`),点其立绘进入 **「文件:XXX-经典形象.png」**
   的 File 页(File 页 = `ns=6` 的「文件:」命名空间页,注意不是武将主页面)。
2. File 页 URL 里的 `curid=N` 就是页面 id;没有 curid 时用 `index.php?title=文件:XXX-经典形象.png` 形式也可以。

### 第 2 步:跑 fetch-asset 管线

```bash
# 推荐用 curid(避开终端中文编码坑):
bun scripts/fetch-asset.ts --id hero:<py>:sgs --wiki "https://wiki.biligame.com/sgs/index.php?curid=2199"

# 或 File 页标题路径 / patchwiki 直链(缩略图链接会自动还原成原图):
bun scripts/fetch-asset.ts --id hero:simayi:sgs --wiki "https://wiki.biligame.com/sgs/文件:司马懿-经典形象.png"
bun scripts/fetch-asset.ts --id hero:simayi:sgs --wiki "https://patchwiki.biligame.com/images/sgs/0/0a/<hash>.png"
```

`--id` 命名规范:`hero:<py>:sgs`,其中 `<py>` 是武将名全拼(小写,如 `zhouyu`/`caopi`/`zhangxingcai`/`simayi`)。
落盘文件自动命名 `hero-<py>-sgs.png`,默认进 `--category heroes`。

管线自动完成(wiki 模式走 MediaWiki `imageinfo` API 解析原图直链,非 HTML 正则刮取):

- 抓 File 页 → 提取原图 URL(`patchwiki.biligame.com/images/...`)+ 上传者 + 尺寸口径
- 下载(429 退避重试),按 PNG 签名读 IHDR 尺寸,**与 API 口径不符直接抛错**(防取错图)
- 登记 `public/assets/manifest.json`(`source`=wiki File 页,`license`=学习用途标注,**`review_required: true`**)
- 追加 `public/assets/CREDITS.md`(同 id 重跑会替换旧行,不会重复)

**授权口径**:三国杀官方武将原画(游卡桌游)版权归官方,本项目**仅限学习与朋友间娱乐,不商用**;
自动化管线无法推断自由授权,一律标 `review_required: true`——APK 公开发布前必须人工复核
(见 `public/assets/CREDITS.md` 授权纪律)。

## 现有立绘清单(4 张,均为十周年·经典形象,574×761 口径)

| id | 武将 | curid 来源 | 文件 |
|---|---|---|---|
| `hero:zhouyu:sgs` | 周瑜 | [curid=11615](https://wiki.biligame.com/sgs/index.php?curid=11615) | `assets/heroes/hero-zhouyu-sgs.png` |
| `hero:caopi:sgs` | 曹丕 | [curid=9064](https://wiki.biligame.com/sgs/index.php?curid=9064) | `assets/heroes/hero-caopi-sgs.png` |
| `hero:zhangxingcai:sgs` | 张星彩 | [curid=9705](https://wiki.biligame.com/sgs/index.php?curid=9705) | `assets/heroes/hero-zhangxingcai-sgs.png` |
| `hero:simayi:sgs` | 司马懿 | [curid=2199](https://wiki.biligame.com/sgs/index.php?curid=2199) | `assets/heroes/hero-simayi-sgs.png` |

## 与 heroes.ts 的衔接(图片落地后加数据行)

`public/assets/` 里的立绘不会自动生效——在 `src/core/heroes.ts` 的 `HEROES` 数组追加一条 `HeroDef`,
`image` 指向落盘路径(`/assets/heroes/hero-<py>-sgs.png`),CardDetail 详情画像位
(`src/app/screens/game/CardDetailScroll.tsx`)会自动读取 `HeroDef.image` 展示:

```ts
{
  id: "simayi",
  image: "/assets/heroes/hero-simayi-sgs.png",
  name: "司马懿",
  title: "<称号>",
  desc: "<一句话技能描述>",
  skills: [{ id: "simayi-xxx", when: "<GameMoment>", effect: "<EffectId>", params: {...}, scope: "self" }],
},
```

技能即数据:`when` 挂 `src/core/timing.ts` 的 GameMoment,`effect` 查 `src/core/effects.ts`
注册表;只有引入**新时机/新效果**才需要动那两个文件,`heroes.ts` 永远是纯数据。

## 注意事项

- **传 File 页,别传武将主页面**:主页面(ns=0)没有 imageinfo,管线直接抛错。
- 直链模式拿不到 wiki 上传者(manifest author 退化为「三国杀官方武将原画(游卡桌游)」),入库优先用 File 页 URL。
- 非 PNG 原图、非 patchwiki/wiki.biligame.com 域名,管线直接抛错(不兜底)。
- Windows 终端传中文 URL 可能因编码失真 404(GBK/UTF-8 坑),**优先用 curid 形式**。
