import { renderedParent } from "@waitron/ui";

export interface VisibleArea {
  readonly height: number;
  readonly offsetTop: number;
  readonly scale: number;
}

export interface KeyboardInsets {
  top: number;
  bottom: number;
}

const NONE: KeyboardInsets = { top: 0, bottom: 0 };

/** How much of a full-height page lies above and below the visible area while a device's own
 * keyboard covers it, in whole CSS pixels. A pinch zoom also shrinks the visible area, so a zoom
 * 1% or more away from 1 counts as no keyboard. */
export function keyboardInsets(layoutHeight: number, visible: VisibleArea): KeyboardInsets {
  if (Math.abs(visible.scale - 1) > 0.01) return NONE;
  if (Math.round(visible.height) >= Math.round(layoutHeight)) return NONE;
  return {
    top: Math.round(visible.offsetTop),
    bottom: Math.max(0, Math.round(layoutHeight - visible.offsetTop - visible.height)),
  };
}

export interface KeyboardWindow {
  readonly visualViewport?: (EventTarget & VisibleArea) | null | undefined;
  readonly innerHeight: number;
}

function setLength(root: HTMLElement, name: string, value: number): void {
  if (value > 0) root.style.setProperty(name, `${value}px`);
  else root.style.removeProperty(name);
}

/** Keeps `--wt-keyboard-inset` and `--wt-keyboard-top` on `root` in step with the keyboard, for a
 * browser that leaves the page full height under it. */
export function watchKeyboardInsets(win: KeyboardWindow, root: HTMLElement): () => void {
  const viewport = win.visualViewport;
  if (!viewport) return () => {};
  let current = NONE;
  let frame: number | undefined;
  let opening = false;
  const update = (): void => {
    const insets = keyboardInsets(win.innerHeight, viewport);
    if (insets.top === current.top && insets.bottom === current.bottom) return;
    const resized = insets.top + insets.bottom !== current.top + current.bottom;
    const wasDown = current.top + current.bottom === 0;
    current = insets;
    setLength(root, "--wt-keyboard-inset", insets.bottom);
    setLength(root, "--wt-keyboard-top", insets.top);
    // A pan keeps the band's height, and scrolling then would undo the person's pan.
    if (!resized) return;
    if (frame === undefined) opening = wasDown;
    else cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const field = focusedTextControl(root.ownerDocument);
      if (field === undefined) return;
      // A window that shrinks to the new band can leave the field being typed in hidden below its
      // scrolled body.
      if (inOpenSurface(field)) field.scrollIntoView({ block: "nearest" });
      // A page field goes to the top of the band as the keyboard opens, so what lies beneath it
      // shows too; later, that would undo the person's scrolling.
      else if (opening && current.top + current.bottom > 0)
        field.scrollIntoView({ block: "start" });
    });
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
  };
}

/** Whether `node` is drawn inside an open modal dialog or popover. */
function inOpenSurface(node: Node): boolean {
  for (let at: Node | null = node; at; at = renderedParent(at))
    if (at instanceof Element && at.matches(":popover-open, dialog:modal")) return true;
  return false;
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "tel", "url", "password", "number"]);

function focusedTextControl(doc: Document): HTMLElement | undefined {
  let active = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (active instanceof HTMLTextAreaElement) return active;
  if (active instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(active.type)) return active;
  return undefined;
}
