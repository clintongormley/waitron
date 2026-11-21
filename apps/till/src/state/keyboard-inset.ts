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

/** How much of a full-height page a device's own keyboard hides, in whole CSS pixels. A pinch zoom
 * also shrinks the visible area, so any zoom counts as no keyboard. */
export function keyboardInsets(layoutHeight: number, visible: VisibleArea): KeyboardInsets {
  if (Math.abs(visible.scale - 1) > 0.01) return NONE;
  const bottom = Math.round(layoutHeight - visible.offsetTop - visible.height);
  if (bottom <= 0) return NONE;
  return { top: Math.round(visible.offsetTop), bottom };
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
  const update = (): void => {
    const insets = keyboardInsets(win.innerHeight, viewport);
    setLength(root, "--wt-keyboard-inset", insets.bottom);
    setLength(root, "--wt-keyboard-top", insets.top);
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
  };
}
