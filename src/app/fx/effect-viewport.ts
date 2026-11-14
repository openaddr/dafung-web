/** 动态宿主内的世界坐标绘制盒(ADR-0045):一个逻辑单位仍是一个宿主px。 */
export interface EffectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 画笔/动画与包络共用的形状参数;CSS由消费点注入变量,不再另藏一份峰值。 */
export const POINT_MOTION = {
  float: {
    startScale: 0.6,
    peakScale: 1.15,
    peakY: -10,
    endY: -60,
    stroke: 1,
    miterLimit: 4,
  },
  tag: { startY: 8, revealY: -6, holdY: -14, endY: -36, peakScale: 1 },
  coin: {
    radius: 11,
    haloStroke: 6,
    coreStroke: 1.5,
    fontSize: 13,
    baseline: 4,
    spin: 540,
  },
  pulse: {
    radius: 26,
    stroke: 3,
    shadowBlur: 5,
    startScale: 0.35,
    peakScale: 1.5,
  },
  ink: { radius: 34, startScale: 0.2, peakScale: 1.3 },
  // 落章弧由棋盘/拼点/招贤共用,CSS参数单源见fx.css;挂载测量拍读取最大尺度。
  seal: { side: 58, corner: 9, stroke: 3, fontSize: 32, baseline: 11 },
} as const;

/** 线状画笔与局部包络共用;不改端点、虚线节奏或生产行军轨迹。 */
export const LINE_PAINT = {
  own: { halfLength: 46, y: -39, stroke: 8, dash: 30, gap: 138, dashEnd: -92 },
  jinnang: {
    stroke: 10,
    haloStroke: 16,
    anchorRadius: 5,
    featherStroke: 5,
    feather: [
      { x: -9, y: -7 },
      { x: 5, y: 0 },
      { x: -9, y: 7 },
    ],
  },
  flow: { stroke: 5, haloStroke: 11 },
  // SVG默认miter连接的最大伸出;折线/箭羽绘制端也显式消费同值。
  miterLimit: 4,
} as const;

export const JINNANG_FEATHER_D = LINE_PAINT.jinnang.feather
  .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`)
  .join(" ");

/** 全部烤定点的整段包络;虚线扫掠始终落在同一条路径内,不按当前帧缩盒。 */
export function pathEffectBox(
  points: readonly { x: number; y: number }[],
  padding: number,
): EffectBox {
  let x = points[0].x;
  let y = points[0].y;
  let right = x;
  let bottom = y;
  for (const point of points) {
    x = Math.min(x, point.x);
    y = Math.min(y, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return expandEffectBox({ x, y, width: right - x, height: bottom - y }, padding);
}

/** 光晕端点、起点圆锚与按真实旋向展开的箭羽并集。 */
export function jinnangEffectBox(line: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}): EffectBox {
  const shape = LINE_PAINT.jinnang;
  const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const feather = shape.feather.map((p) => ({
    x: line.x2 + p.x * cos - p.y * sin,
    y: line.y2 + p.x * sin + p.y * cos,
  }));
  return unionEffectBoxes(
    pathEffectBox(
      [
        { x: line.x1, y: line.y1 },
        { x: line.x2, y: line.y2 },
      ],
      Math.max(shape.haloStroke / 2, shape.anchorRadius),
    ),
    pathEffectBox(feather, (shape.featherStroke / 2) * LINE_PAINT.miterLimit),
  );
}

export function expandEffectBox(box: EffectBox, padding: number): EffectBox {
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
}

export function unionEffectBoxes(first: EffectBox, ...rest: EffectBox[]): EffectBox {
  const boxes = [first, ...rest];
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}

/** 围绕fill-box中心缩放,再包含整段上/下移;描边外扩在调用前完成。 */
export function translatedScaleBox(
  box: EffectBox,
  maxScale: number,
  minY: number,
  maxY: number,
): EffectBox {
  return {
    x: box.x - (box.width * (maxScale - 1)) / 2,
    y: box.y - (box.height * (maxScale - 1)) / 2 + minY,
    width: box.width * maxScale,
    height: box.height * maxScale + maxY - minY,
  };
}

/** 任意旋转的外接圆保守界,含整个落章缩放弧,不读动画当前帧。 */
export function rotatingScaleBox(box: EffectBox, maxScale: number): EffectBox {
  const radius = (Math.hypot(box.width, box.height) * maxScale) / 2;
  return {
    x: box.x + box.width / 2 - radius,
    y: box.y + box.height / 2 - radius,
    width: radius * 2,
    height: radius * 2,
  };
}

/** React/命令式共用同一组属性,内容继续画在世界坐标,不用再换算一遍。 */
export function effectViewport(box: EffectBox) {
  return {
    width: box.width,
    height: box.height,
    viewBox: `${box.x} ${box.y} ${box.width} ${box.height}`,
    style: { left: box.x, top: box.y, width: box.width, height: box.height },
  };
}

/** 命令式驿道流光与React载体复用的布置口。 */
export function placeEffectViewport(svg: SVGSVGElement, box: EffectBox): void {
  const viewport = effectViewport(box);
  svg.setAttribute("width", String(viewport.width));
  svg.setAttribute("height", String(viewport.height));
  svg.setAttribute("viewBox", viewport.viewBox);
  for (const [key, value] of Object.entries(viewport.style)) {
    svg.style.setProperty(key, `${value}px`);
  }
}
