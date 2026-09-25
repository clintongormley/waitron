// Only helps a user who clicked past the browser's certificate warning. That a service-worker
// registration throws a SecurityError in that state is a belief, never checked on a device.

export interface NavigatorLike {
  serviceWorker?: { register(scriptURL: string): Promise<unknown> };
}

function isSecurityError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name: unknown }).name === "SecurityError"
  );
}

export interface TrustCheckOptions {
  nav?: NavigatorLike;
  /** How long the probe may take before the answer is "not broken". */
  timeoutMs?: number;
  protocol?: string;
}

/**
 * Every ambiguous answer, a timeout included, is "not broken": the till must always boot.
 */
export async function isTrustBroken({
  nav = navigator,
  timeoutMs = 1500,
  protocol = location.protocol,
}: TrustCheckOptions = {}): Promise<boolean> {
  // Over plain HTTP, Chromium also throws a SecurityError when the missing script is answered with HTML.
  if (protocol !== "https:") return false;
  let sw: NavigatorLike["serviceWorker"];
  try {
    sw = nav.serviceWorker;
  } catch {
    return false;
  }
  if (!sw) return false;
  // No `/sw-probe.js` is shipped. The signal holds only while the server answers it 404: a non-JavaScript
  // answer also yields a SecurityError. The async wrapper turns a synchronous throw into a rejection.
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
