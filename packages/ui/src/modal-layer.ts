import { renderedParent } from "./tabbable.js";

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

/** Whether an open modal window that `node` is not drawn inside makes it inert. */
export function underModal(node: Node): boolean {
  let top: Element | undefined;
  let topOrder = -Infinity;
  for (const [modal, order] of openModals) if (order > topOrder) [top, topOrder] = [modal, order];
  if (top === undefined) return false;
  for (let at: Node | null = node; at; at = renderedParent(at)) if (at === top) return false;
  return true;
}

/** Open popovers and modal dialogs in `root` and in every open shadow root inside it. */
export function* openSurfaces(root: Document | ShadowRoot): Generator<HTMLElement> {
  yield* root.querySelectorAll<HTMLElement>(":popover-open, dialog:modal");
  for (const each of root.querySelectorAll("*"))
    if (each.shadowRoot) yield* openSurfaces(each.shadowRoot);
}

/** Whether `dialog` is the one an open tracked window draws in its own shadow root. */
function drawnByOpenModal(dialog: HTMLDialogElement): boolean {
  const root = dialog.getRootNode();
  for (const modal of openModals.keys()) if (modal.shadowRoot === root) return true;
  return false;
}

/** Whether an open popover or modal dialog that `node` is not drawn inside is in front of it,
 * manual popovers included: they are menus drawn in front. The dialogs of tracked windows are left
 * out, since `underModal` knows which of those is latest and an earlier one is not in front. */
export function surfaceOutside(node: Node): boolean {
  outer: for (const surface of openSurfaces(document)) {
    if (surface instanceof HTMLDialogElement && drawnByOpenModal(surface)) continue;
    for (let at: Node | null = node; at; at = renderedParent(at))
      if (at === surface) continue outer;
    return true;
  }
  return false;
}
