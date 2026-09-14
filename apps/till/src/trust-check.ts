// A click-through-only trust detector (spec §3.3, nice-to-have). The browser's own certificate
// interstitial fires before any of our JS on an untrusted origin, so the plain-HTTP landing page
// (Task 3) is the load-bearing surface; this only helps a user who has already clicked past that
// warning. We detect that state because, over HTTPS, a same-origin service-worker registration throws a
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

/** What {@link isTrustBroken} reads; each field defaults to the real browser value. */
export interface TrustCheckOptions {
  /** Defaults to `navigator`. */
  nav?: NavigatorLike;
  /** How long the probe may take before the answer is "not broken". Defaults to 1500 ms. */
  timeoutMs?: number;
  /** Defaults to `location.protocol`; only `"https:"` is probed. */
  protocol?: string;
}

/**
 * Resolves true only when we can positively tell the origin's certificate is not trusted for a
 * click-through user. A page not served over HTTPS, an absent or unreadable `serviceWorker` (can't
 * tell) and any non-SecurityError failure — a 404 on the probe script, a network error — are treated
 * as "not broken": we never block the till on an ambiguous signal, and in a browser this never throws.
 *
 * The probe is BOUNDED (C4): a `serviceWorker.register(...)` that never settles must not hang till
 * boot forever. The registration races a `timeoutMs` timer (default 1500 ms); on timeout we resolve
 * "not broken" — we cannot decide, so the till boots. The till must ALWAYS boot.
 */
export async function isTrustBroken({
  nav = navigator,
  timeoutMs = 1500,
  protocol = location.protocol,
}: TrustCheckOptions = {}): Promise<boolean> {
  // Only HTTPS has a certificate to distrust. Over http: the probe proves nothing: in Chromium a
  // server that answers the missing script with an HTML page (the Vite dev server) gets a
  // SecurityError too.
  if (protocol !== "https:") return false;
  let sw: NavigatorLike["serviceWorker"];
  try {
    sw = nav.serviceWorker;
  } catch {
    return false;
  }
  if (!sw) return false;
  // We ship no `/sw-probe.js`, so the box's server 404s it, which Chromium reports as a TypeError
  // (→ "not broken"). A SecurityError is therefore only a candidate signal while the server answers
  // 404: in Chromium an answer with a non-JavaScript MIME type (text/html from the Vite dev server)
  // also produces one. The async IIFE turns even a SYNCHRONOUS throw from `register` into a rejection
  // this catch handles, so the probe itself never throws.
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
