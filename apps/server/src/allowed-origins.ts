import type { SignedMembershipDocument } from "@waitron/membership";

export interface AllowedOriginsDeps {
  advertisedOrigin: string;
  readMembership: () => Promise<SignedMembershipDocument | null>;
  devMode: boolean;
  now: () => number;
  ttlMs?: number;
}

const DEV_ORIGINS = ["http://localhost:5190", "http://localhost:5191", "http://localhost:5192"];

/** A contactUrl's origin, or null when it does not parse — a malformed address allows nothing. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Which browser origins may call this node's API with credentials (till-reroute design §3.4): this
 * node's own advertised origin and the origin of every `contactUrl` in the held membership document —
 * the venue's own servers, nothing else. The document is re-read at most once per `ttlMs` (default
 * 30 s): a preflight or a cross-origin request must not cost a DB read each.
 */
export function createOriginAllowlist(deps: AllowedOriginsDeps): (origin: string) => Promise<boolean> {
  const ttl = deps.ttlMs ?? 30_000;
  let cached: { at: number; origins: Set<string> } | undefined;
  return async (origin) => {
    if (origin === deps.advertisedOrigin) return true;
    if (deps.devMode && DEV_ORIGINS.includes(origin)) return true;
    const t = deps.now();
    if (cached === undefined || t - cached.at > ttl) {
      const held = await deps.readMembership();
      const origins = new Set<string>();
      for (const n of held?.body.nodes ?? []) {
        const o = originOf(n.contactUrl);
        if (o !== null) origins.add(o);
      }
      cached = { at: t, origins };
    }
    return cached.origins.has(origin);
  };
}
