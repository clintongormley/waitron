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
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // once per hour

export interface ServerTrustOptions {
  serverUrl: string | undefined;
  stateDir: string;
  fetch?: typeof fetch;
  caEndpointFetch?: typeof fetch;
  now?: () => number;
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

  /** Fetch /ca.crt, throttled to once per hour. Returns true when the CA bytes changed. */
  const refresh = async (): Promise<boolean> => {
    if (now() - lastFetchAt < REFRESH_INTERVAL_MS) return false;
    lastFetchAt = now();
    let pem: string;
    try {
      const res = await caFetch(caUrl);
      if (!res.ok) return false;
      pem = await res.text();
    } catch {
      return false;
    }
    if (pem === caPem || pem.trim() === "") return false;
    const changed = caPem !== undefined;
    caPem = pem;
    rebuild();
    await mkdir(opts.stateDir, { recursive: true });
    const tmp = `${caPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, pem, { mode: 0o644 });
    await rename(tmp, caPath);
    log(changed ? "server CA changed" : "server CA pinned", { caUrl });
    return true;
  };

  // One best-effort refresh at boot (covers a first run with no persisted CA).
  await refresh();

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
