/** How far the pointer travels from the press before it is a drag, so a press alone does nothing. */
export const DRAG_THRESHOLD_PX = 5;

/** Best effort: `setPointerCapture` throws for a pointer that is not active, as a test's synthetic
 * one is. */
export function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* no active pointer */
  }
}

export function releasePointer(el: Element, pointerId: number): void {
  try {
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  } catch {
    /* nothing captured */
  }
}
