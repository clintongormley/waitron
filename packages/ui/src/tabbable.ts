export function composedParent(node: Node): Node | null {
  return node instanceof ShadowRoot ? node.host : node.parentNode;
}

function inTabOrder(element: HTMLElement): boolean {
  if (element.hasAttribute("tabindex")) return element.tabIndex >= 0;
  // A link reports a tabIndex of 0 even with no address, when it takes no focus.
  if (element instanceof HTMLAnchorElement) return element.hasAttribute("href");
  return element.tabIndex >= 0 || element.isContentEditable;
}

/** The parent `node` is drawn in: its slot when it is slotted, its host when it is a shadow root. */
export function renderedParent(node: Node): Node | null {
  return node instanceof Element && node.assignedSlot ? node.assignedSlot : composedParent(node);
}

/** Whether `node`, or anything it is drawn inside, is inert. */
export function inInertTree(node: Node): boolean {
  for (let at: Node | null = node; at; at = renderedParent(at))
    if (at instanceof HTMLElement && at.inert) return true;
  return false;
}

/** Whether the Tab key can stop on `node`. Hidden inputs, and anything inside a `hidden` element,
 * are drawn nowhere, so the visibility check covers them. */
export function isTabbable(node: Node): node is HTMLElement {
  return (
    node instanceof HTMLElement &&
    inTabOrder(node) &&
    !node.matches(":disabled") &&
    node.checkVisibility({ visibilityProperty: true }) &&
    !inInertTree(node)
  );
}

/** The elements inside `root`, and inside the open shadow roots within it, that the Tab key can
 * stop on, in tree order and a host's shadow root first, leaving out `skip` and everything inside
 * it. */
export function* tabbables(root: Node, skip: Set<Node> = new Set()): Generator<HTMLElement> {
  const shadow = root instanceof Element ? root.shadowRoot : null;
  if (shadow && !skip.has(shadow)) yield* tabbables(shadow, skip);
  for (const child of root.childNodes) {
    if (skip.has(child)) continue;
    if (isTabbable(child)) yield child;
    yield* tabbables(child, skip);
  }
}

/** Whether any of `elements`, or anything inside them, can take a Tab stop. */
export function holdsTabbable(elements: Iterable<Element>): boolean {
  for (const element of elements)
    if (isTabbable(element) || !tabbables(element).next().done) return true;
  return false;
}
