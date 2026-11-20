// #1409 画心比选，手册与藏品界面采用同一份固定数据。
const { records, theme } = globalThis.treasureSample;
const catalog = records.filter((item) => item.kind !== "book");
const sampleIds = [
  "hat",
  "hubing",
  "seal",
  "suanchou",
  "qingmei",
  "skillbook-jixing",
  "skillbook-yingzi",
];
const sampleItems = sampleIds.map((id) => records.find((item) => item.id === id));
const heldItems = [0, 1, 2, 5, 6, 3, 4].map((index) => sampleItems[index]);
const newArt = {
  hat: "art/hat.webp",
  hubing: "art/hubing.webp",
  seal: "art/seal-photo.webp",
  suanchou: "art/suanchou.webp",
  qingmei: "art/qingmei.webp",
};
const notes = {
  current: "现状 · 草帽、胡饼和古物原图；缺画心项在手册显示空态，局内以远山肌理陈列。",
  a: "A · 把原兽钮印照片的实物轮廓置于暖暗绢底；补画和技能书采用同底同光。",
  b: "B · 同一实物照片保留原背景和投影，收紧取景、压低饱和度；补画和技能书与 A 相同。",
};
const mountain =
  '<svg viewBox="0 0 100 26" aria-hidden="true"><path d="M4 22 Q18 8 32 18 Q40 12 50 18 M52 20 Q64 10 76 18 Q84 14 96 20 M8 24 q20 3 42 0 q22 -3 42 0" /></svg>';
const bookReason = "出牌阶段可研读";
const repoPublic = "../../../../../public";

function escapeText(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function artPath(item, variant) {
  if (variant !== "current") {
    if (item.kind === "book") return "art/book.webp";
    if (item.id in newArt) return newArt[item.id];
  }
  return item.image ? repoPublic + item.image : null;
}

function picture(item, variant, large = false) {
  const art = artPath(item, variant);
  if (!art) return "";
  const setting = item.id === "seal" && variant === "a" ? " cloth" : "";
  const title =
    item.kind === "book" && variant !== "current"
      ? '<span class="picture-name" aria-hidden="true">' +
        [...item.skillName].map(escapeText).join("<br />") +
        "</span>"
      : "";
  const alt = large ? escapeText(item.name) + "画心" : "";
  return (
    '<span class="picture' +
    setting +
    '"><img src="' +
    art +
    '" alt="' +
    alt +
    '" />' +
    title +
    "</span>"
  );
}

function manualArt(item, variant, large = false) {
  const placeholder =
    item.kind === "book"
      ? '<span class="manual-treasure-art-empty mountain">' + mountain + "</span>"
      : '<span class="manual-treasure-art-empty"><span aria-hidden="true">宝</span><span>暂无画心</span></span>';
  return (
    '<span class="manual-treasure-art' +
    (large ? " manual-treasure-art-detail" : "") +
    '">' +
    (picture(item, variant, large) || placeholder) +
    "</span>"
  );
}

function manualRow(item, variant) {
  return (
    '<button type="button" class="manual-treasure-row" data-detail="' +
    item.id +
    '">' +
    manualArt(item, variant) +
    '<span class="manual-treasure-copy"><span class="manual-treasure-name">' +
    escapeText(item.name) +
    '</span><span class="manual-treasure-desc">' +
    escapeText(item.desc) +
    "</span></span>" +
    '<span class="manual-treasure-value"><span class="manual-treasure-grade">品级 ' +
    item.level +
    '</span><span class="manual-treasure-price" aria-label="指导价 ' +
    item.price +
    '">' +
    item.price +
    "</span></span></button>"
  );
}

function pileCell(item, variant) {
  const art = picture(item, variant);
  const tone = item.level < 4 ? "tong" : item.level < 7 ? "yin" : "gold";
  const face =
    '<span class="jinnang-card mount pile-cell-card tone-' +
    tone +
    '">' +
    '<span class="ling" aria-hidden="true"></span><span class="bj a" aria-hidden="true"></span>' +
    '<span class="bj b" aria-hidden="true"></span><span class="bj c" aria-hidden="true"></span><span class="bj d" aria-hidden="true"></span>' +
    '<span class="huaxin">' +
    (art ? '<span class="art">' + art + "</span>" : '<span class="shan">' + mountain + "</span>") +
    '<span class="ba">' +
    escapeText(item.desc) +
    "</span></span>" +
    '<span class="lv-badge"><i>' +
    item.level +
    "</i></span>" +
    '<span class="qian"><span class="ling-zi">珍</span><span class="qian-ming' +
    (item.name.length > 3 ? " long" : "") +
    '">' +
    escapeText(item.name) +
    "</span></span>" +
    '<span class="jian-yin" aria-hidden="true"><span class="seal">宝</span></span></span>';
  const price = '<span class="pile-price">指导价 ' + item.price + "</span>";
  const reason = item.kind === "book" ? '<span class="pile-reason">' + bookReason + "</span>" : "";
  return (
    '<button type="button" class="pile-cell" aria-label="查看样张：' +
    escapeText(item.name) +
    '" data-detail="' +
    item.id +
    '">' +
    face +
    price +
    reason +
    "</button>"
  );
}

function detailBody(item, variant, surface) {
  const subtitle = surface === "manual" ? "手册 · 珍宝" : "珍宝收藏册 · 画心预览";
  const skill =
    item.kind === "book"
      ? "<p>" + escapeText(item.skillDesc) + "</p><p>" + bookReason + "</p>"
      : "";
  return (
    '<header class="screen-head"><div><h2 id="detail-title">' +
    escapeText(item.name) +
    ' <i aria-hidden="true">宝</i></h2><div class="sub">' +
    subtitle +
    "</div></div>" +
    '<button class="close" type="button" data-action="close-detail" aria-label="关闭详情">×</button></header>' +
    '<div class="screen-body"><div class="detail-body">' +
    manualArt(item, variant, true) +
    '<div class="detail-copy"><div><span class="grade">品级 ' +
    item.level +
    '</span><span class="detail-price">指导价 ' +
    item.price +
    "</span></div><p>" +
    escapeText(item.desc) +
    "</p>" +
    skill +
    "</div></div></div>"
  );
}

if (typeof document !== "undefined") {
  for (const [token, value] of Object.entries(theme)) {
    document.documentElement.style.setProperty(token, value);
  }
  const query = new URLSearchParams(location.search);
  const initialVariant = location.hash.slice(1) || query.get("variant");
  let variant = Object.hasOwn(notes, initialVariant) ? initialVariant : "b";
  const initialScene = query.get("scene");
  let surface = initialScene === "board" || initialScene === "home" ? initialScene : "manual";
  let activeItem = null;
  let returnFocusTo = null;

  const manual = document.getElementById("manual");
  const manualBody = document.getElementById("manual-body");
  const manualRows = document.getElementById("manual-rows");
  const inventory = document.getElementById("inventory");
  const inventoryBody = document.getElementById("inventory-body");
  const inventoryGrid = document.getElementById("inventory-grid");
  const detail = document.getElementById("detail");
  const stageShade = document.getElementById("stage-shade");
  const detailShade = document.getElementById("detail-shade");
  const rounds = document.querySelector(".rounds");
  const stage = document.querySelector(".stage");
  const homeManual = document.querySelector(".home-manual");

  function updateLayers() {
    stage.dataset.context = surface === "board" || surface === "inventory" ? "board" : "home";
    stageShade.hidden = surface === "board" || surface === "home";
    rounds.hidden = stage.dataset.context === "home";
    rounds.inert = surface !== "board";
    homeManual.hidden = stage.dataset.context === "board";
    homeManual.inert = surface !== "home";
    manual.hidden = surface !== "manual";
    inventory.hidden = surface !== "inventory";
    manual.inert = activeItem != null;
    inventory.inert = activeItem != null;
    detailShade.hidden = activeItem == null;
    detail.hidden = activeItem == null;
    detail.innerHTML = activeItem ? detailBody(activeItem, variant, surface) : "";
    document.querySelectorAll(".choices [data-action]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.action === surface));
    });
  }

  function drawArt() {
    const manualScroll = manualBody.scrollTop;
    const inventoryScroll = inventoryBody.scrollTop;
    manualRows.innerHTML = catalog.map((item) => manualRow(item, variant)).join("");
    inventoryGrid.innerHTML = heldItems.map((item) => pileCell(item, variant)).join("");
    manualBody.scrollTop = manualScroll;
    inventoryBody.scrollTop = inventoryScroll;
    document.getElementById("variant-note").textContent = notes[variant];
    document.querySelectorAll("[data-variant]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.variant === variant));
    });
    updateLayers();
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const action = button.dataset.action;
    if (button.dataset.variant) {
      variant = button.dataset.variant;
      history.replaceState(null, "", "#" + variant);
      drawArt();
    } else if (action === "close-detail") {
      activeItem = null;
      updateLayers();
      const rows = surface === "manual" ? manualRows : inventoryGrid;
      rows.querySelector('[data-detail="' + returnFocusTo + '"]').focus({ preventScroll: true });
    } else if (action) {
      surface = action;
      activeItem = null;
      updateLayers();
    } else if (button.dataset.find) {
      surface = "manual";
      activeItem = null;
      updateLayers();
      const target = manualRows.querySelector('[data-detail="' + button.dataset.find + '"]');
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    } else if (button.dataset.detail) {
      returnFocusTo = button.dataset.detail;
      activeItem = records.find((item) => item.id === returnFocusTo);
      updateLayers();
      detail.focus({ preventScroll: true });
    }
  });

  drawArt();
}
