// A click-through-only trust detector (spec §3.3, nice-to-have). The browser's own certificate
// interstitial fires before any of our JS on an untrusted origin, so the plain-HTTP landing page
// (Task 3) is the load-bearing surface; this only helps a user who has already clicked past that
// warning. We detect that state because a same-origin service-worker registration throws a
// SecurityError in an untrusted secure context.
//
// The SecurityError signal is a belief, unverified on-device: register any positive result cautiously
// and never block the till on an ambiguous one.

/** The slice of `navigator` this probe reads — the injectable seam so a test can pass a stub. */
export interface NavigatorLike {
  serviceWorker?: { register(scriptURL: string): Promise<unknown> };
}

/** True only when the rejection carries `name === "SecurityError"`. Duck-types the check on `name`
 * rather than requiring `err instanceof Error`, so any thrown value shaped that way is recognised
 * without assuming the rejection is an `Error` instance. */
function isSecurityError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name: unknown }).name === "SecurityError"
  );
}

/**
 * Resolves true only when we can positively tell the origin's certificate is not trusted for a
 * click-through user. Absent `serviceWorker` (can't tell) and any non-SecurityError failure — a 404
 * on the probe script, a network error — are treated as "not broken": we never block the till on an
 * ambiguous signal, and this never throws.
 *
 * The probe is BOUNDED (C4): a `serviceWorker.register(...)` that never settles must not hang till
 * boot forever. The registration races a `timeoutMs` timer (default 1500 ms); on timeout we resolve
 * "not broken" — we cannot decide, so the till boots. The till must ALWAYS boot.
 */
export async function isTrustBroken(
  nav: NavigatorLike = navigator,
  timeoutMs = 1500,
): Promise<boolean> {
  const sw = nav.serviceWorker;
  if (!sw) return false;
  // We ship no `/sw-probe.js`, so a trusted origin 404s here (→ "not broken"); only an untrusted
  // secure context short-circuits with a SecurityError before the fetch is attempted. The async IIFE
  // turns even a SYNCHRONOUS throw from `register` into a rejection this catch handles, so the probe
  // itself never throws.
  const probe = (async (): Promise<boolean> => {
    try {
      await sw.register("/sw-probe.js");
      return false;
    } catch (err) {
      return isSecurityError(err);
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([probe, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
