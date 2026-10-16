import { page } from "vitest/browser";

// The browser announces a scroll or a resize a frame late, so one left pending reaches the next
// test, where it closes a day box open on a date out of view.
const announced = (type: "scroll" | "resize") =>
  new Promise((resolve) => addEventListener(type, resolve, { once: true }));

export async function resizeViewport(width: number, height: number): Promise<void> {
  if (innerWidth === width && innerHeight === height) return;
  const resized = announced("resize");
  await page.viewport(width, height);
  await resized;
}

/** Takes the test's content away with `empty`, then waits for the window's scroll back to its
 *  top. Scrolling first would close a box still open on that content, and its close would be
 *  announced in the next test. */
export async function emptyPageAtTop(empty: () => void): Promise<void> {
  const scrolled = scrollX !== 0 || scrollY !== 0 ? announced("scroll") : undefined;
  empty();
  scrollTo(0, 0);
  await scrolled;
}
