// Offline mockup. No live game commands or network calls.
const repo = "../../../../public";
const asset = (path) => repo + path;
const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const homeNames = { current: "现状 · 书法短横带", a: "A · 沙盘横幅", b: "B · 左画右操作" };
const cardNames = { current: "现状 · 照片与墨线", a: "A · 统一设色", b: "B · 保留实物照片" };
const scenes = {
  hand: "局内手牌",
  treasure: "手册珍宝",
  encounter: "手册机遇",
  decision: "局内机遇",
};
const testMaps = [
  { id: "test1", name: "关中诸城与西北驿道", tileCount: 28, target: "30,000 两" },
  { id: "test2", name: "荆襄九郡群雄会盟", tileCount: 36, target: "50,000 两" },
  { id: "test3", name: "江东水陆两道与沿江诸郡古战场", tileCount: 48, target: "80,000 两" },
  { id: "test4", name: "南中山道", tileCount: 18, target: "20,000 两" },
];

function button(label, action, primary = false) {
  return '<button type="button" class="game-btn' + (primary ? ' primary' : '') +
    '" data-action="' + action + '">' + esc(label) + '</button>';
}
function mapStrip(maps, selected) {
  return '<div class="map-strip' + (maps.length > 3 ? ' many' : '') +
    '" role="group" aria-label="选择地图">' + maps.map((m) =>
      '<button type="button" aria-pressed="' + (m.id === selected) + '" data-map="' + m.id +
      '"><span title="' + esc(m.name) + '">' + esc(m.name) + '</span><small>' +
      m.tileCount + ' 城 · 目标 ' + esc(m.target) + '</small></button>'
    ).join("") + '</div>';
}
function art(kind, variant) {
  const painted = { seal: 0, fire: 1, boat: 2 };
  if (variant !== "current" && (variant !== "b" || kind !== "seal")) {
    return '<img class="painting" src="art/paint-' + painted[kind] + '.webp" alt="">';
  }
  if (kind === "seal") return '<img src="' + asset(data.seal.image) + '" alt="">';
  return data[kind].ink;
}
function face(kind, variant, size = "", e = data[kind]) {
  return '<div class="face ' + kind + ' ' + size + '"><div class="face-title">' +
    esc(e.id) + '<span>' + (kind === "fire" ? '攻' : '中') + '</span></div><div class="picture">' +
    art(kind, variant) + '</div><p>' + esc(e.text) + '</p></div>';
}
function handbookTabs(which) {
  return '<div class="manual-tabs" aria-label="手册分类">' +
    ["名将", "技能", "珍宝", "锦囊", "机遇"].map((label) => {
      const pane = { "珍宝": "treasure", "机遇": "encounter" }[label];
      const active = label === which;
      const action = pane ? ' data-action="scene-' + pane + '"' : ' disabled';
      return '<button type="button" aria-pressed="' + active + '"' + action + '>' + label + '</button>';
    }).join("") + '</div>';
}
function treasureRows(variant) {
  return data.rows.map((t) => {
    const seal = t.id === "seal";
    const element = seal ? 'button' : 'div';
    const action = seal ? ' type="button" data-action="detail"' : '';
    return '<' + element + ' class="treasure-row"' + action + '><span class="picture">' +
      (seal ? art("seal", variant) : '<img src="' + asset(t.image) + '" alt="">') +
      '</span><span class="item-text"><strong>' + esc(t.name) + '</strong><small>' + esc(t.desc) +
      '</small></span><span class="treasure-value"><small>品级 ' + t.level +
      '</small><span>' + esc(t.price) + '</span></span></' + element + '>';
  }).join("");
}
function manualBody(scene, variant) {
  const treasure = scene === "treasure";
  return '<section class="manual-window"><header><span aria-hidden="true">册</span><h2>手册</h2></header>' +
    handbookTabs(treasure ? "珍宝" : "机遇") +
    (treasure ? '<div class="treasure-rows">' + treasureRows(variant) + '</div>' :
      '<h3 class="tier">中性</h3><div class="manual-deck"><button type="button" data-action="detail" aria-label="查看携民渡江">' +
      face("boat", variant) + '</button>' + data.neighbors.map(e => face("boat", "current", "", e)).join("") + '</div>') + '</section>';
}
function closeButton() {
  return '<button type="button" class="close-sheet" aria-label="关闭" data-action="close">×</button>';
}
function detailBody(scene, variant) {
  if (scene === "treasure") {
    return '<section class="detail treasure-detail">' + closeButton() +
      '<h2>' + esc(data.seal.name) + '</h2><div class="detail-columns"><div class="picture">' +
      art("seal", variant) + '</div><div><small>品级 ' + data.seal.level + '</small>　<span class="price">指导价 ' +
      esc(data.seal.price) + '</span><p>' + esc(data.seal.desc) + '</p></div></div></section>';
  }
  const fire = scene === "hand";
  const kind = fire ? "fire" : "boat";
  const e = data[kind];
  return '<section class="detail ' + (fire ? 'bottom-sheet' : '') + '">' + closeButton() +
    '<h2>' + esc(e.id) + '</h2><div class="detail-columns"><div class="picture ' + kind + '">' +
    art(kind, variant) + '</div><div><small>' + esc(fire ? e.tags.join(" · ") : e.tier) +
    '</small><p>' + esc(e.text) + '</p></div></div></section>';
}
function choiceBody(variant) {
  return '<section class="encounter-window"><h2>机遇 · ' + esc(data.boat.id) + '</h2>' +
    '<div class="encounter-story' + (variant !== "current" ? ' has-art' : '') + '">' +
    (variant !== "current" ? '<div class="picture">' + art("boat", variant) + '</div>' : '') +
    '<p>' + esc(data.boat.text) + '</p></div><div class="encounter-options">' +
    data.boat.choices.map((o, i) => button(o.text, "resolve-" + i, i === 0)).join("") +
    '</div></section>';
}

function homeFrame(variant, maps, chosen, launched = "", size = "normal") {
  const actions = '<div class="home-actions">' + button("单机模式", "solo", true) +
    '<div class="secondary">' + button("联机模式", "online") + button("手册", "manual") +
    '</div></div>';
  const extra = '<div class="home-extra">' + button("对局诊断", "diagnostic") + '</div>';
  const title = '<h1>群雄逐鹿</h1>';
  const strip = mapStrip(maps, chosen);
  const backdrop = variant === "current" ?
    title + '<div class="calligraphy" aria-hidden="true"><b>逐鹿</b></div>' :
    '<div class="cover">' + title + (variant === "b" ?
      '<div class="factions" aria-hidden="true"><b>魏</b><b>蜀</b><b>吴</b></div>' : '') + '</div>';
  const map = maps.find((m) => m.id === chosen);
  const report = { solo: "单机配置", online: "联机大厅", manual: "手册", diagnostic: "对局诊断" }[launched];
  const modal = launched ? '<div class="shade"></div><section class="detail launch">' + closeButton() +
    '<h2>' + report + '</h2><p>' + (launched === "solo" || launched === "online" ?
      '已选地图　' + esc(map.name) : '已点开' + report) +
    '</p><p>示意跳转</p></section>' : '';
  const menus = actions + strip + extra;
  return '<div class="screen home ' + variant + ' ' + size + '"><section class="home-layout">' +
    (variant === "b" ? backdrop + '<div class="home-menu">' + menus + '</div>' : backdrop + menus) +
    '</section><div class="version">v' + data.version + '</div>' + modal + '</div>';
}
function cardFrame(variant, scene, detail = false, selected = false, resolved = -1) {
  const manual = scene === "treasure" || scene === "encounter";
  const board = scene === "hand" ? "hand.webp" : "board.webp";
  let body = "";
  if (scene === "hand") {
    body = '<button class="hand-card' + (selected ? " selected" : "") +
      '" type="button" aria-label="选中火烧连营" data-action="select">' + face("fire", variant, "small") +
      '</button>' + (selected ? '<div class="turn-strip"><div>火烧连营</div><div>' +
        button("不出", "skip") + button("选目标", "target", true) +
        '</div></div>' : '');
  } else if (scene === "decision") {
    body = resolved === -1 ? '<div class="shade"></div>' + choiceBody(variant) :
      '<div class="decision-result" role="status">' + esc(data.boat.choices[resolved].text) +
      '　' + button("再看一次", "reset") + '</div>';
  } else {
    body = '<div class="shade"></div>' + manualBody(scene, variant);
  }
  return '<div class="screen board" style="background-image:url(art/' + board + ')">' + (manual ? homeFrame("current", data.mapList, data.mapList[0].id) : "") + body +
    (detail ? '<div class="shade detail-shade"></div>' + detailBody(scene, variant) : '') + '</div>';
}
