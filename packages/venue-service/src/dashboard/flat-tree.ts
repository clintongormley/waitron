/** The element `at` is drawn inside: its slot, else its parent, else its shadow root's host. */
export function flatParent(at: Element): Element | null {
  const parent = at.parentNode;
  return at.assignedSlot ?? at.parentElement ?? (parent instanceof ShadowRoot ? parent.host : null);
}

/** Where every scroll that can move `at` is heard in the capture phase. A scroll does not bubble
 *  or leave its shadow root, so: the window, and the shadow root of every box `at` is drawn
 *  inside, slots included. */
export function scrollTargets(at: Element): EventTarget[] {
  const targets = new Set<EventTarget>([window]);
  for (let box: Element | null = at; box !== null; box = flatParent(box)) {
    const root = box.getRootNode();
    if (root instanceof ShadowRoot) targets.add(root);
  }
  return [...targets];
}

const SCROLLS = new Set(["auto", "scroll"]);

/** The top edge of the area `at` scrolls in: the window's top, or lower where a box `at` is drawn
 *  inside scrolls up and down and starts lower. */
export function visibleTop(at: Element): number {
  let top = 0;
  // The window's top already stands for the root element's own scrolling.
  for (
    let box = flatParent(at);
    box !== null && box !== document.documentElement;
    box = flatParent(box)
  ) {
    if (!SCROLLS.has(getComputedStyle(box).overflowY)) continue;
    top = Math.max(top, box.getBoundingClientRect().top + box.clientTop);
  }
  return top;
}
