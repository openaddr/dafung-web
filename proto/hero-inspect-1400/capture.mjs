// 一手样张与小范围演练；不添加测试套件、不调用引擎写口。先按 README 构建 prototype 档。
import { openShotSession } from "../../scripts/shot.mjs";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TESTIDS } from "../../src/app/screens/game/testids.ts";
import { HOME_TID } from "../../src/app/screens/home/testids.ts";

const s = await openShotSession({ port: 5314, zeroEncounter: true });
const errors = [];
s.page.on("pageerror", (e) => errors.push(String(e)));
const toolsOnly = process.argv.includes("--tools-only");
const report = toolsOnly
  ? JSON.parse(readFileSync("proto/hero-inspect-1400/evidence.json", "utf8"))
  : { viewport: "844×390", dpr: 2, frames: [], interactions: [] };
const root = "tmp/ui-shots/hero-inspect-1400";
const archive = "proto/hero-inspect-1400";

async function open(variant, scene = "trio", present = true) {
  await s.page.goto(
    `http://localhost:5314/?heroPrototype=1&variant=${variant}&scene=${scene}&present=${present ? 1 : 0}`,
  );
  await s.page.getByTestId(HOME_TID.screen).waitFor();
  await s.page.evaluate(async () => {
    await window.__dafung.seedSolo({ seed: 49, seats: 2 });
    window.__dafung.clockPause();
  });
  await s.page.getByTestId(TESTIDS.pileHeroes).click();
  await s.page.getByTestId(TESTIDS.heroModal).waitFor();
  await s.page.evaluate(() => document.fonts.ready);
  await s.page
    .locator(".hip-portrait img")
    .evaluateAll((imgs) => Promise.all(imgs.map((img) => img.decode())));
}
async function capture(name) {
  // 让既有弹窗入场结束；截图不注入改变产品布局的 CSS。
  await s.page.getByTestId(TESTIDS.heroModal).evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished));
  });
  await s.shot(`${root}/${name}.png`);
  if (["A", "B", "C", "B-tools", "C-empty"].includes(name))
    copyFileSync(`${root}/${name}.png`, `${archive}/${name}.png`);
  const geometry = await s.page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const modal = document.querySelector(".hero-inspect-prototype");
    return {
      modal: box(modal),
      content: box(document.querySelector(".hip-variant,.hip-empty")),
      rootWidth: document.documentElement.scrollWidth,
      descriptions: [...document.querySelectorAll(".hip-skill p")].map((p) => ({
        text: p.textContent,
        font: getComputedStyle(p).fontSize,
        ...box(p),
      })),
      buttons: [...modal.querySelectorAll(".hip-dismiss,.hip-seal,.hip-roster-item")].map((b) => ({
        name: b.getAttribute("aria-label"),
        disabled: b.disabled,
        ...box(b),
      })),
      brokenImages: [...modal.querySelectorAll("img")].filter(
        (i) => !i.complete || i.naturalWidth === 0,
      ).length,
    };
  });
  if (geometry.rootWidth !== 844 || geometry.brokenImages !== 0)
    throw new Error(`布局/图片失败 ${name}`);
  if (
    name === "B-tools" &&
    geometry.buttons.some((b) => b.y + b.h > geometry.content.y + geometry.content.h + 1)
  )
    throw new Error("评样工具档裁掉名册或遣散钮");
  report.frames = report.frames.filter((f) => f.name !== name);
  report.frames.push({ name, ...geometry });
}
function check(ok, message) {
  if (!ok) throw new Error(message);
  report.interactions.push(message);
}
try {
  for (const v of toolsOnly ? [] : ["A", "B", "C"]) {
    await open(v);
    await capture(v);
    await open(v, "single");
    await capture(`${v}-single`);
    await open(v, "long");
    await capture(`${v}-long`);
    if (v !== "C") {
      const reading = s.page.locator('.hip-reading > [data-slot="scroll-area-viewport"]');
      await reading.hover();
      await s.page.mouse.wheel(0, 500);
      await s.page.waitForFunction(
        () =>
          document.querySelector('.hip-reading > [data-slot="scroll-area-viewport"]').scrollTop > 0,
      );
      check(true, `${v} 长技能通过真实滚轮可读到下部`);
      await s.page.getByRole("button", { name: "查看司马懿", exact: true }).click();
      check(
        (await s.page.getByText("岁俸", { exact: true }).count()) > 0,
        `${v} 切换名将读取对应技能`,
      );
    }
    await open(v, "empty");
    await capture(`${v}-empty`);
    await open(v, "readonly");
    await capture(`${v}-readonly`);
    check((await s.page.locator(".hip-dismiss").count()) === 0, `${v} 他人无遣散入口`);
    await open(v, "offturn");
    check((await s.page.locator(".hip-dismiss:enabled").count()) === 0, `${v} 非己回合不可遣散`);
  }
  await open("B", "trio", false);
  await capture("B-tools");
  await s.page.getByRole("button", { name: "下一方案", exact: true }).click();
  check(new URL(s.page.url()).searchParams.get("variant") === "C", "箭头更新可分享的方案 URL");
  await s.page.keyboard.press("ArrowLeft");
  check(new URL(s.page.url()).searchParams.get("variant") === "B", "键盘左右可切换方案");
  await s.page.getByTestId(TESTIDS.heroDismiss("caopi")).click();
  check(
    (await s.page.getByRole("button", { name: "确认遣散曹丕", exact: true }).count()) === 1,
    "首次遣散只进入确认",
  );
  await capture("B-dismiss-confirm");
  await s.page.getByTestId(TESTIDS.heroDismiss("caopi")).click();
  check(
    (await s.page.getByText("已演练遣散曹丕，对局未改", { exact: true }).count()) === 1,
    "第二次遣散只改原型内存",
  );
  await open("B", "book-single", false);
  await s.page.getByRole("button", { name: "演练学技 · 1", exact: true }).click();
  check(
    (await s.page.getByTestId(TESTIDS.bookLearnModal).count()) === 0,
    "一人可学直接演练，不开选人层",
  );
  check(await s.page.getByText("技能书已用", { exact: true }).isDisabled(), "学技后技能书消耗");
  await capture("B-book-single-learned");
  await open("B", "book-multi", false);
  await s.page.getByRole("button", { name: "演练学技 · 2", exact: true }).click();
  await s.page.getByTestId(TESTIDS.bookLearnModal).waitFor();
  await s.shot(`${root}/B-book-pick.png`);
  copyFileSync(`${root}/B-book-pick.png`, `${archive}/B-book-pick.png`);
  await s.page.getByTestId(TESTIDS.bookLearnItem("dengai")).click();
  check(
    (await s.page.getByText("已演练邓艾习得岁俸，对局未改", { exact: true }).count()) === 1,
    "多人可学复用选人层，落到所选名将",
  );
  const realRoster = await s.page.evaluate(() => window.__dafung.snapshot().players[0].heroes);
  check(realRoster.length === 0, "学习与遣散未修改真实对局名将");
  await open("C", "long");
  const scroll = s.page.locator('.hip-c > [data-slot="scroll-area-viewport"]');
  await scroll.hover();
  await s.page.mouse.wheel(0, 1800);
  await s.page.waitForFunction(() => {
    const el = document.querySelector('.hip-c > [data-slot="scroll-area-viewport"]');
    return el.scrollTop >= el.scrollHeight - el.clientHeight - 1;
  });
  await capture("C-long-last");
  check(await scroll.evaluate((el) => el.scrollTop > 0), "行册可滚到末将");
  await s.page.getByTestId(TESTIDS.heroModal).getByTestId(TESTIDS.modalClose).click();
  await s.page.getByTestId(TESTIDS.heroModal).waitFor({ state: "detached" });
  await s.page.getByTestId(TESTIDS.pileHeroes).click();
  await s.page.getByTestId(TESTIDS.heroModal).waitFor();
  check((await s.page.locator(".hip-row").count()) === 3, "关闭再开原型，布景可读");
  // 专用模式也要求无 heroPrototype 参数的普通入口不受影响。
  await s.page.goto("http://localhost:5314/?variant=C");
  await s.page.getByTestId(HOME_TID.screen).waitFor();
  await s.page.evaluate(async () => {
    await window.__dafung.seedSolo({ seed: 49, seats: 2 });
    window.__dafung.clockPause();
  });
  await s.page.getByTestId(TESTIDS.pileHeroes).click();
  await s.page.getByTestId(TESTIDS.heroModal).waitFor();
  check((await s.page.locator(".hero-inspect-prototype").count()) === 0, "普通名将入口不进入原型");
  await s.page.getByTestId(TESTIDS.heroModal).getByTestId(TESTIDS.modalClose).click();
  await s.page.getByTestId(TESTIDS.heroModal).waitFor({ state: "detached" });
  for (const heroId of ["caopi", "simayi", "dengai"])
    await s.plant({ kind: "armHero", seat: 0, heroId });
  await s.page.getByTestId(TESTIDS.pileHeroes).click();
  await s.page.getByTestId(TESTIDS.heroModal).waitFor();
  await s.page.evaluate(() => document.fonts.ready);
  await s.page.getByTestId(TESTIDS.heroModal).evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished));
  });
  await s.shot(`${archive}/before.png`);
  report.baseline = await s.page.locator(".pile-hero-grid .hface").evaluateAll((cards) =>
    cards.map((el) => ({
      w: el.getBoundingClientRect().width,
      h: el.getBoundingClientRect().height,
      bodyFont: getComputedStyle(el.querySelector(".sdesc")).fontSize,
    })),
  );
  check(errors.length === 0, "无页面异常");
  mkdirSync(archive, { recursive: true });
  writeFileSync(`${archive}/evidence.json`, JSON.stringify({ ...report, errors }, null, 2));
  console.log(
    JSON.stringify({ frames: report.frames.length, checks: report.interactions.length, errors }),
  );
} finally {
  await s.close();
}
