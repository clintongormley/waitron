import { randomUUID } from "node:crypto";

/**
 * The venue-wide join window, held open by the dashboard dialogs that are open.
 *
 * IN MEMORY, ON THE PRIMARY, DELIBERATELY, not a table: a restart or a promotion forgets every hold
 * and claim, so the window starts shut. `boot.ts` builds ONE holder for the device, join and print
 * mounts.
 */
export const PAIRING_HOLD_MS = 3 * 60 * 1000;

/** Which login matched a request's number, and the hold it lives as long as. `sessionKey` is
 * `hashSessionToken` of the session, so this long-lived map never keeps a live credential. */
export interface PairingClaim {
  holdId: string;
  sessionKey: string;
  personName: string;
}

export interface PairingMode {
  open(): { holdId: string; openUntil: string };
  renew(holdId: string): { openUntil: string } | null;
  release(holdId: string): void;
  hasHold(holdId: string): boolean;
  isOpen(): boolean;
  openUntil(): string | null;
  openSince(): string | null;
  claim(requestId: string, claim: PairingClaim): void;
  claimOf(requestId: string): PairingClaim | undefined;
  orphanedClaims(): string[];
  dropClaim(requestId: string): void;
}

export function createPairingMode(
  opts: { now?: () => number; holdMs?: number; newId?: () => string; changed?: () => void } = {},
): PairingMode {
  const { now = Date.now, holdMs = PAIRING_HOLD_MS, newId = randomUUID, changed } = opts;
  const holds = new Map<string, number>();
  const claims = new Map<string, PairingClaim>();
  let openSinceMs: number | null = null;
  let lapse: ReturnType<typeof setTimeout> | undefined;

  const arm = (): void => {
    clearTimeout(lapse);
    if (changed === undefined || holds.size === 0) return;
    lapse = setTimeout(
      () => {
        prune();
        arm();
      },
      Math.max(0, Math.min(...holds.values()) - now()),
    );
    lapse.unref();
  };

  const prune = (): void => {
    const t = now();
    const before = holds.size;
    // A hold further ahead than its length was stamped before the clock stepped back: it has lapsed.
    for (const [id, until] of holds) if (until <= t || until - t > holdMs) holds.delete(id);
    if (holds.size === 0) openSinceMs = null;
    if (holds.size !== before) {
      arm();
      changed?.();
    }
  };
  const live = (holdId: string): boolean => {
    prune();
    return holds.has(holdId);
  };
  const iso = (ms: number): string => new Date(ms).toISOString();

  return {
    open() {
      prune();
      const t = now();
      if (openSinceMs === null) openSinceMs = t;
      const holdId = newId();
      holds.set(holdId, t + holdMs);
      arm();
      changed?.();
      return { holdId, openUntil: iso(t + holdMs) };
    },
    renew(holdId) {
      if (!live(holdId)) return null;
      const until = now() + holdMs;
      holds.set(holdId, until);
      arm();
      changed?.();
      return { openUntil: iso(until) };
    },
    release(holdId) {
      const removed = holds.delete(holdId);
      prune();
      if (removed) {
        arm();
        changed?.();
      }
    },
    hasHold: live,
    isOpen() {
      prune();
      return holds.size > 0;
    },
    openUntil() {
      prune();
      return holds.size === 0 ? null : iso(Math.max(...holds.values()));
    },
    openSince() {
      prune();
      return openSinceMs === null ? null : iso(openSinceMs);
    },
    claim(requestId, claim) {
      claims.set(requestId, claim);
      changed?.();
    },
    claimOf(requestId) {
      const claim = claims.get(requestId);
      return claim !== undefined && live(claim.holdId) ? claim : undefined;
    },
    orphanedClaims() {
      prune();
      return [...claims].filter(([, c]) => !holds.has(c.holdId)).map(([id]) => id);
    },
    dropClaim(requestId) {
      if (claims.delete(requestId)) changed?.();
    },
  };
}
