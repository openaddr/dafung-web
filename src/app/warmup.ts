// 资产预热:主页挂载后 idle 期把全部字体与游戏图片拉取+解码进内存,消除
// 「某视觉组件第一次出现」的加载税(首开弹框顿/首掷骰顿/首现立绘顿——字体按
// unicode-range 子集首现才拉+解码+swap 闪换,图片首现才解码,弱 WebView 上
// 每次都是肉眼一顿)。拍板 2026-11-01(拷问五问全过):
//   ①全量无白名单:字体(现 4 族 261 子集约 11MB,族面随 fonts.css 自动跟随,
//     无需登记)+ 图片 15 张 2.5MB,APK 本地读零压力;
//     白名单要维护、漏登记即复发首现卡;
//   ②idle 分片:主页立刻可交互,族与族之间让出 idle,用户看主页的几秒里拉完,
//     进对局时全热;一次预热管本次启动会话(进程死即归零,每次启动重征一遍小税,
//     这是平台天花板——运行态的解码产物/JIT/字形缓存不落盘)。#1273 起第一波 =
//     对局屏 React.lazy chunk 预取(起兵→进对局首切现拉现 eval 会是可感顿点);
//   ③失败零兜底:预热只是提前触发浏览器原生按需加载——任何一波失败,整链就地停
//     并 console 留痕,对局内首现走原生路径照常工作,不写第二条容错链;
//   ④JS 首执行税不归它管:单包代码常驻内存、函数首次执行才编译,加载救不了
//     (chunk 级下载+模块求值归它管见 ②;组件隐藏热身收益小侵入大,拍板不做)。
// 图片清单吃各单源:武将/珍宝 = core 两张数据表的 image 字段;纹理三张无共同
// 单源(CSS url 两处 + StaticLayers 常量一处),在此誊录,增删纹理两处同查。
// manifest.json 是授权台账非资产清单(含已退役路径,盘上不存在),预热不吃它。

import { HEROES } from "@core/heroes";
import { TREASURES } from "@core/treasures";

/** 纹理贴图 url 誊录(单源:home.css 平复帖 / victory.css 竹林 /
 *  StaticLayers.tsx 贡县山水横带常量;改纹理两处同查)。 */
const TEXTURE_URLS = [
  "/assets/textures/texture-pingfutie.webp",
  "/assets/textures/texture-zhulin.webp",
  "/assets/textures/texture-gongxian-shanshui.webp",
];

/** 游戏图片 url 全集(core 两表 image 字段 + 纹理誊录)。 */
function imageUrlSet(): string[] {
  return [
    ...HEROES.map((hero) => hero.image),
    ...TREASURES.flatMap((t) => (t.image == null ? [] : [t.image])),
    ...TEXTURE_URLS,
  ];
}

/** 下一拍浏览器空闲(idle 链节拍器;timeout 上限防高负载下饿死整链)。 */
function nextIdle(): Promise<void> {
  return new Promise((resolve) => requestIdleCallback(() => resolve(), { timeout: 2000 }));
}

/** 下两帧动画(#1273):rIC 在首帧绘制定成前也可能判「空闲」并插队——预热链第一波
 *  (对局屏 chunk 求值,~百 ms 同步段)若抢在首帧前跑,FCP 就被推迟一截(实测
 *  132→684-1084ms)。先等两帧(帧已提交+上屏)再开预热链,首渲不与 chunk 求值竞速。 */
function nextPaintedFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

/** 字体族分波 load(fonts.css 全部 @font-face 子集面;同族并取、族间让 idle——
 *  弱 WebView 上解码一波是一顿,分波摊平,主页交互不受损)。 */
async function warmupFonts(): Promise<void> {
  const byFamily = new Map<string, FontFace[]>();
  for (const face of document.fonts) {
    const faces = byFamily.get(face.family);
    if (faces == null) byFamily.set(face.family, [face]);
    else faces.push(face);
  }
  for (const faces of byFamily.values()) {
    await Promise.all(faces.map((face) => face.load()));
    await nextIdle();
  }
}

/** 图片全量 fetch+decode 进位图缓存(decode 含网络加载与解码两步)。 */
async function warmupImages(): Promise<void> {
  await Promise.all(
    imageUrlSet().map(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
    }),
  );
}

/** 对局屏 chunk 预取(#1273):GameScreen 已 React.lazy(App.tsx),首包不再含对局
 *  屏——起兵→进对局首切若现拉现 eval,弱 WebView 上是可感顿点。排预热链第一波,
 *  玩家看主页的头几秒里就把这个 chunk 拉好评好(懒加载记录:import() 即模块求值,
 *  组件级 JIT 仍按首次调用付,与头注 ④ 不冲突)。与 e2e 无涉:自动化通道整个
 *  warmup 直返,对局屏 chunk 切屏时按需拉取(web-first 断言自等挂载)。 */
function warmupGameScreenChunk(): Promise<unknown> {
  return import("@app/screens/game/GameScreen");
}

let started = false;

/** 主页挂载即调:排 idle 分片预热链,fire-and-forget;启动后重复调用忽略
 *  (StrictMode 双挂载 / 路由回主页均幂等,加载已热资产是原生级 no-op)。
 *  自动化通道跳过(navigator.webdriver):预热为人眼首现平滑服务,自动化不感知
 *  首现税,每例新 context 重拉 ~300 资产纯属全量墙钟税(#730 配速 env 关同族的
 *  通道豁免)。 */
export function startWarmup(): void {
  if (navigator.webdriver) return;
  if (started) return;
  started = true;
  void (async () => {
    await nextPaintedFrame();
    await nextIdle();
    await warmupGameScreenChunk();
    await warmupFonts();
    await warmupImages();
  })().catch((err: unknown) => {
    // 文件头 ③:失败 = 原生按需路径接管,只响亮留痕,不重试不写兜底链
    console.warn("[warmup] 资产预热中断(对局内首现走原生按需加载):", err);
  });
}
