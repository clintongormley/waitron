import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { Agent } from "undici";

/** TLS verification failures undici surfaces on `error.cause.code` — the cases a reimaged box (new
 * self-signed CA) produces. A non-verify failure (refused, DNS, timeout) is NOT in this set, so it is
 * rethrown untouched for the loop to fold into "unreachable". */
const VERIFY_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_SIGNATURE_FAILURE",
]);

const CA_FILE = "server-ca.crt";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // once per hour, once a CA is pinned (rotation)
const INITIAL_RETRY_INTERVAL_MS = 10_000; // 10s, until the first CA is obtained
const DEFAULT_CA_FETCH_TIMEOUT_MS = 5_000;

export interface ServerTrustOptions {
  serverUrl: string | undefined;
  stateDir: string;
  fetch?: typeof fetch;
  caEndpointFetch?: typeof fetch;
  now?: () => number;
  caFetchTimeoutMs?: number;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

function isVerifyError(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } })?.cause;
  return typeof cause?.code === "string" && VERIFY_ERROR_CODES.has(cause.code);
}

/** `http://<host>/ca.crt` — the plain-HTTP landing route (port 80), for an https server URL only. */
function caUrlFor(serverUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  return `http://${parsed.hostname}/ca.crt`;
}

export async function createServerTrustingFetch(opts: ServerTrustOptions): Promise<typeof fetch> {
  const baseFetch = opts.fetch ?? fetch;
  const caFetch = opts.caEndpointFetch ?? fetch;
  const now = opts.now ?? Date.now;
  const caFetchTimeoutMs = opts.caFetchTimeoutMs ?? DEFAULT_CA_FETCH_TIMEOUT_MS;
  const log = opts.log ?? ((): void => {});
  const caPath = join(opts.stateDir, CA_FILE);
  const caUrl = opts.serverUrl === undefined ? undefined : caUrlFor(opts.serverUrl);

  // A plain-http or unconfigured agent needs no CA work: hand back the base fetch untouched.
  if (caUrl === undefined) return baseFetch;

  let caPem: string | undefined;
  let dispatcher: Agent | undefined;
  let lastFetchAt = -Infinity;

  const rebuild = (): void => {
    dispatcher?.close().catch(() => {});
    dispatcher =
      caPem === undefined
        ? undefined
        : new Agent({ connect: { ca: [...rootCertificates, caPem] } });
  };

  // Persisted CA first, so a restart trusts before the landing listener is even reachable.
  try {
    caPem = await readFile(caPath, "utf8");
    rebuild();
  } catch {
    /* none yet */
  }

  /** Fetch /ca.crt, throttled. Returns true when the CA bytes changed. Until the first CA is
   * obtained the throttle is short (a failed first-boot fetch must not disable printing for an
   * hour); once a CA is pinned the hourly interval covers rotation. Best-effort: a persistence
   * failure never rejects — in-memory trust is already updated. */
  const refresh = async (): Promise<boolean> => {
    const interval = caPem === undefined ? INITIAL_RETRY_INTERVAL_MS : REFRESH_INTERVAL_MS;
    if (now() - lastFetchAt < interval) return false;
    lastFetchAt = now();
    let pem: string;
    try {
      const res = await caFetch(caUrl, { signal: AbortSignal.timeout(caFetchTimeoutMs) });
      if (!res.ok) return false;
      pem = await res.text();
    } catch {
      return false;
    }
    if (pem === caPem || pem.trim() === "") return false;
    const changed = caPem !== undefined;
    caPem = pem;
    rebuild();
    try {
      await mkdir(opts.stateDir, { recursive: true });
      const tmp = `${caPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
      await writeFile(tmp, pem, { mode: 0o644 });
      await rename(tmp, caPath);
    } catch (error) {
      // Best-effort cache: in-memory trust is already updated; only the on-disk copy failed.
      log("server CA persist failed", { caUrl, error: String(error) });
    }
    log(changed ? "server CA changed" : "server CA pinned", { caUrl });
    return true;
  };

  // Boot: a usable cached CA already serves trust, so refresh in the background rather than blocking
  // the agent loop and the 9110 setup page on a slow /ca.crt. With no cached CA, try once but bound
  // the wait so a hung landing endpoint cannot stall boot.
  if (caPem !== undefined) {
    void refresh();
  } else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      refresh(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, caFetchTimeoutMs);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
  }

  const trusting = (async (input, init) => {
    const withDispatcher = (): RequestInit =>
      dispatcher === undefined ? (init ?? {}) : ({ ...init, dispatcher } as RequestInit);
    try {
      return await baseFetch(input as RequestInfo | URL, withDispatcher());
    } catch (error) {
      // A cert-verification failure MIGHT be a rotated CA: refetch (throttled) and retry once.
      if (isVerifyError(error) && (await refresh())) {
        return baseFetch(input as RequestInfo | URL, withDispatcher());
      }
      throw error;
    }
  }) as typeof fetch;

  return trusting;
}
