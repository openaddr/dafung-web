import { CITY_ART_BOX, TILE_SCALE, cityOpacity, type CityScene } from "./city-scene";
import type { ViewBox, fitBoardViewport } from "./board-viewport";

const SVG_NS = "http://www.w3.org/2000/svg";
const sceneImages = new Map<string, Promise<string>>();

async function inlineImage(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("棋盘素材 " + url + " 加载失败（" + response.status + "）");
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function pictureDocument(box: ViewBox, width: number, height: number) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", [box.x, box.y, box.w, box.h].join(" "));
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");
  return svg;
}

export function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("棋盘绘制需要 Canvas 2D");
  return context;
}

async function rasterize(svg: SVGSVGElement, width: number, height: number) {
  const xml = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvasContext(canvas).drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function rasterizeTerrain(
  source: SVGGElement,
  viewport: ReturnType<typeof fitBoardViewport>,
  width: number,
  height: number,
) {
  const { scale, x, y } = viewport;
  const box = {
    x: -x / scale,
    y: -y / scale,
    w: viewport.width / scale,
    h: viewport.height / scale,
  };
  const svg = pictureDocument(box, width, height);
  const terrain = source.cloneNode(true) as SVGGElement;
  terrain.removeAttribute("display");
  // SVG 图片上下文只读内嵌素材。重取景时复用同一山水带。
  await Promise.all(
    Array.from(terrain.querySelectorAll("image"), async (image) => {
      const href = image.getAttribute("href");
      if (!href) throw new Error("棋盘远山缺少素材路径");
      let data = sceneImages.get(href);
      if (!data) {
        data = inlineImage(href);
        sceneImages.set(href, data);
      }
      image.setAttribute("href", await data);
    }),
  );
  svg.append(terrain);
  return rasterize(svg, width, height);
}

function glyphMatrix(glyph: SVGTextElement, city: SVGGElement): DOMMatrix {
  let matrix = new DOMMatrix();
  for (let node: Element = glyph; node !== city; node = node.parentElement!) {
    if (!node.hasAttribute("transform")) continue;
    const list = (node as SVGGraphicsElement).transform.baseVal;
    let local = new DOMMatrix();
    for (let i = 0; i < list.numberOfItems; i++) local = local.multiply(list.getItem(i).matrix);
    matrix = local.multiply(matrix);
  }
  return matrix;
}

function readGlyphs(source: SVGGElement) {
  const styles = getComputedStyle(document.documentElement);
  return Array.from(source.querySelectorAll("text"), (node) => {
    const family = node.getAttribute("font-family")?.match(/^var\((--[^)]+)\)$/)?.[1];
    const size = node.getAttribute("font-size");
    const fill = node.getAttribute("fill");
    if (!family || !size || !fill || node.getAttribute("text-anchor") !== "middle")
      throw new Error("城池字形需要字号、色值、字族和居中锚点");
    const fontFamily = styles.getPropertyValue(family).trim();
    if (!fontFamily) throw new Error("城池缺少字族 " + family);
    return {
      matrix: glyphMatrix(node, source),
      text: node.textContent,
      x: Number(node.getAttribute("x")),
      y: Number(node.getAttribute("y")),
      font: size + "px " + fontFamily,
      fill,
      stroke: node.getAttribute("stroke"),
      lineWidth: Number(node.getAttribute("stroke-width")),
    };
  });
}

export async function rasterizeCity(source: SVGGElement, defs: SVGDefsElement, scale: number) {
  const box = CITY_ART_BOX;
  const width = Math.ceil(box.w * scale);
  const height = Math.ceil(box.h * scale);
  const svg = pictureDocument(box, width, height);
  const city = source.cloneNode(true) as SVGGElement;
  city.removeAttribute("transform");
  city.querySelectorAll("text").forEach((node) => node.remove());
  svg.append(defs.cloneNode(true), city);
  // 字形由主文档的字体绘制，复用现役字体和 Unicode 子集。
  const glyphs = readGlyphs(source);
  const [bitmap] = await Promise.all([
    rasterize(svg, width, height),
    Promise.all(glyphs.map(({ font, text }) => document.fonts.load(font, text))),
  ]);
  const context = canvasContext(bitmap);
  context.setTransform(
    width / box.w,
    0,
    0,
    height / box.h,
    (-box.x * width) / box.w,
    (-box.y * height) / box.h,
  );
  context.textAlign = "center";
  for (const glyph of glyphs) {
    context.save();
    const { a, b, c, d, e, f } = glyph.matrix;
    context.transform(a, b, c, d, e, f);
    context.font = glyph.font;
    if (glyph.stroke !== null) {
      context.strokeStyle = glyph.stroke;
      context.lineWidth = glyph.lineWidth;
      context.strokeText(glyph.text, glyph.x, glyph.y);
    }
    context.fillStyle = glyph.fill;
    context.fillText(glyph.text, glyph.x, glyph.y);
    context.restore();
  }
  return bitmap;
}

export function paintBoard(
  canvas: HTMLCanvasElement,
  viewport: ReturnType<typeof fitBoardViewport>,
  terrain: CanvasImageSource,
  width: number,
  height: number,
  cities: readonly CityScene[],
  sprites: readonly CanvasImageSource[],
) {
  const context = canvasContext(canvas);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.drawImage(terrain, 0, 0, width, height);

  const xRatio = width / viewport.width;
  const yRatio = height / viewport.height;
  context.setTransform(
    viewport.scale * xRatio,
    0,
    0,
    viewport.scale * yRatio,
    viewport.x * xRatio,
    viewport.y * yRatio,
  );
  const box = CITY_ART_BOX;
  const focused = cities.some(({ state }) => state.isSelectable);
  for (const [index, city] of cities.entries()) {
    context.globalAlpha = cityOpacity(city, focused);
    context.filter = city.state.isTaken ? "grayscale(1)" : "none";
    context.drawImage(
      sprites[index],
      city.tile.position.x + box.x * TILE_SCALE,
      city.tile.position.y + box.y * TILE_SCALE,
      box.w * TILE_SCALE,
      box.h * TILE_SCALE,
    );
  }
  context.globalAlpha = 1;
  context.filter = "none";
}
