// 极小 DOM helper,避免模板字符串拼 HTML(XSS 安全 + 类型友好)。
export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = String(v);
    else if (k === "style") node.setAttribute("style", String(v));
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (SVGElement | string | null | undefined)[] = [],
): SVGElementTagNameMap[K] {
  const NS = "http://www.w3.org/2000/svg";
  const node = document.createElementNS(NS, tag) as SVGElementTagNameMap[K];
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) as unknown as SVGElement : c);
  }
  return node;
}

/** 清空元素子节点。 */
export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
