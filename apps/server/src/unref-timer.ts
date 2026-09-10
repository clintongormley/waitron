export interface Timer {
  cancel: () => void;
}

/**
 * A `setTimeout` that never holds the process open, returning a `cancel` handle. Shared by the
 * shutdown deadline (`run-server.ts`) and the connection-close grace (`close-listener.ts`) so the
 * "background timers must be unref'd" invariant lives in one place. The `typeof unref` guard covers
 * a non-Node timer (a fake clock in a test host that returns a plain number).
 */
export function unrefTimer(ms: number, fn: () => void): Timer {
  const t = setTimeout(fn, ms);
  if (typeof t.unref === "function") t.unref();
  return { cancel: () => clearTimeout(t) };
}
