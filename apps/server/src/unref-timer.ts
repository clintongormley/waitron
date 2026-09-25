export interface Timer {
  cancel: () => void;
}

/**
 * A `setTimeout` that never holds the process open, returning a `cancel` handle. The `typeof unref`
 * guard covers a timer that returns a plain number, such as a fake clock.
 */
export function unrefTimer(ms: number, fn: () => void): Timer {
  const t = setTimeout(fn, ms);
  if (typeof t.unref === "function") t.unref();
  return { cancel: () => clearTimeout(t) };
}
