import { composedParent } from "./tabbable.js";

/** The open modal windows, each with its place in the order they were opened (later is higher), and
 * who wants to hear when that changes. A modal makes everything outside it inert, so only what is
 * inside the latest one can be pressed. */
const openModals = new Map<Element, number>();
const listeners = new Set<() => void>();

export function modalOpened(modal: Element, order: number): void {
  openModals.set(modal, order);
  for (const listener of [...listeners]) listener();
}

export function modalClosed(modal: Element): void {
  if (!openModals.delete(modal)) return;
  for (const listener of [...listeners]) listener();
}

export function modalOpen(): boolean {
  return openModals.size > 0;
}

/** Calls `listener` whenever a modal window opens or closes; returns what stops that. */
export function onModalChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The parent `node` is drawn in: its slot when it is slotted, its host when it is a shadow root. */
function flatParent(node: Node): Node | null {
  if (node instanceof Element && node.assignedSlot) return node.assignedSlot;
  return node instanceof ShadowRoot ? node.host : node.parentNode;
}

/** Whether an open modal window that `node` is not drawn inside makes it inert. */
export function underModal(node: Node): boolean {
  let top: Element | undefined;
  let topOrder = -Infinity;
  for (const [modal, order] of openModals) if (order > topOrder) [top, topOrder] = [modal, order];
  if (top === undefined) return false;
  for (let at: Node | null = node; at; at = flatParent(at)) if (at === top) return false;
  return true;
}

export function inInertTree(node: Node): boolean {
  for (let at: Node | null = node; at; at = flatParent(at))
    if ((at as Partial<HTMLElement>).inert) return true;
  return false;
}

/** Whether `node` is `ancestor` or sits inside it, across shadow-root boundaries. */
export function composedContains(ancestor: Node, node: Node | null): boolean {
  for (let at = node; at; at = composedParent(at)) if (at === ancestor) return true;
  return false;
}

/** Open popovers and modal dialogs in `root` and in every open shadow root inside it. */
export function* openSurfaces(root: Document | ShadowRoot): Generator<HTMLElement> {
  yield* root.querySelectorAll<HTMLElement>(":popover-open, dialog:modal");
  for (const each of root.querySelectorAll("*"))
    if (each.shadowRoot) yield* openSurfaces(each.shadowRoot);
}

/** Whether an open popover or modal dialog that does not hold `node` is drawn in front of it. */
export function surfaceOutside(node: Node): boolean {
  for (const surface of openSurfaces(document)) if (!composedContains(surface, node)) return true;
  return false;
}
