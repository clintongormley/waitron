import { routableServers, type SignedMembershipDocument } from "@waitron/membership";

export interface AllowedOriginsDeps {
  advertisedOrigin: string;
  readMembership: () => Promise<SignedMembershipDocument | null>;
  devMode: boolean;
  vitePorts?: { till?: string; dashboard?: string; setup?: string };
  now: () => number;
  ttlMs?: number;
}

const DEV_ORIGINS = [5190, 5191, 5192, 5290, 5291, 5292].map((port) => `http://localhost:${port}`);

/** A contactUrl's origin, or null when it does not parse — a malformed address allows nothing. */
function originOf(url: string): string | null {
  return URL.parse(url)?.origin ?? null;
}

/** The credentialed-CORS origin set from a held document: the origin of every ROUTABLE node's
 * contactUrl. `routableServers` drops `evicted` nodes (an ejected node has left the venue and must
 * keep no cross-origin access — the sibling `/api/till` `servers` set) and empty contactUrls. */
async function loadOrigins(
  read: () => Promise<SignedMembershipDocument | null>,
): Promise<Set<string>> {
  const held = await read();
  const origins = new Set<string>();
  for (const server of routableServers(held)) {
    const o = originOf(server.url);
    if (o !== null) origins.add(o);
  }
  return origins;
}

/**
 * Which browser origins may call this node's API with credentials (#257): this
 * node's own advertised origin and the origin of every routable `contactUrl` in the held membership
 * document — the venue's own serving servers, nothing else. The document is re-read at most once per
 * `ttlMs` (default 30 s): a preflight or a cross-origin request must not cost a DB read each.
 */
export function createOriginAllowlist(
  deps: AllowedOriginsDeps,
): (origin: string) => Promise<boolean> {
  const ttl = deps.ttlMs ?? 30_000;
  const devOrigins = deps.vitePorts
    ? [
        deps.vitePorts.till || "5190",
        deps.vitePorts.dashboard || "5191",
        deps.vitePorts.setup || "5192",
      ].map((port) => `http://localhost:${port}`)
    : DEV_ORIGINS;
  // The cache holds the in-flight PROMISE, not the resolved set, and its `at` is stamped
  // synchronously before the read is awaited: concurrent cold-cache callers coalesce onto one read,
  // and a slower older read can never overwrite a newer entry (single-flight). A failed read clears
  // the slot so the next call retries rather than caching the failure for the whole TTL.
  let cached: { at: number; origins: Promise<Set<string>> } | undefined;
  return async (origin) => {
    if (origin === deps.advertisedOrigin) return true;
    if (deps.devMode && devOrigins.includes(origin)) return true;
    const t = deps.now();
    if (cached === undefined || t - cached.at > ttl) {
      const entry = { at: t, origins: loadOrigins(deps.readMembership) };
      cached = entry;
      entry.origins.catch(() => {
        if (cached === entry) cached = undefined;
      });
    }
    return (await cached.origins).has(origin);
  };
}
