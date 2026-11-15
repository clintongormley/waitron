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
