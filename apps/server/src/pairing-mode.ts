import { randomUUID } from "node:crypto";
import { steadyNow } from "@waitron/shared";

/**
 * The venue-wide join window, held open by the dashboard dialogs that are open.
 *
 * IN MEMORY, ON THE PRIMARY, DELIBERATELY, not a table: a restart or a promotion forgets every hold
 * and claim, so the window starts shut. `boot.ts` builds ONE holder for the device, join and print
 * mounts. Holds lapse on the `steady` clock; the times answered, and `openSince`, are wall-clock.
 * `openSince` follows a backward wall step, never a forward one: `discardLapsedDeviceRequests`
 * deletes a device request stamped before it, and the knock route reads it before stamping, so a
 * request made after the step is kept. `opening` counts the times the window went from shut to
 * open, so the knock route tells openings apart.
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
  opening(): number | null;
  claim(requestId: string, claim: PairingClaim): void;
  claimOf(requestId: string): PairingClaim | undefined;
  orphanedClaims(): string[];
  dropClaim(requestId: string): void;
}

export function createPairingMode(
  opts: {
    now?: () => number;
    steady?: () => number;
    holdMs?: number;
    newId?: () => string;
    changed?: () => void;
  } = {},
): PairingMode {
  const {
    now = Date.now,
    steady = steadyNow,
    holdMs = PAIRING_HOLD_MS,
    newId = randomUUID,
    changed,
  } = opts;
  const holds = new Map<string, number>();
  const claims = new Map<string, PairingClaim>();
  let openSinceMs: number | null = null;
  let openings = 0;
  let lapse: ReturnType<typeof setTimeout> | undefined;

  const arm = (): void => {
    clearTimeout(lapse);
    if (changed === undefined || holds.size === 0) return;
    lapse = setTimeout(
      () => {
        prune();
        arm();
      },
      Math.max(0, Math.min(...holds.values()) - steady()),
    );
    lapse.unref();
  };

  const prune = (): void => {
    const t = steady();
    const before = holds.size;
    for (const [id, until] of holds) if (until <= t) holds.delete(id);
    if (holds.size === 0) openSinceMs = null;
    else if (openSinceMs !== null) openSinceMs = Math.min(openSinceMs, now());
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
  const wallAt = (end: number): string => iso(now() + (end - steady()));

  return {
    open() {
      prune();
      const t = now();
      if (openSinceMs === null) {
        openSinceMs = t;
        openings += 1;
      }
      const holdId = newId();
      holds.set(holdId, steady() + holdMs);
      arm();
      changed?.();
      return { holdId, openUntil: iso(t + holdMs) };
    },
    renew(holdId) {
      if (!live(holdId)) return null;
      holds.set(holdId, steady() + holdMs);
      arm();
      changed?.();
      return { openUntil: iso(now() + holdMs) };
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
      return holds.size === 0 ? null : wallAt(Math.max(...holds.values()));
    },
    openSince() {
      prune();
      return openSinceMs === null ? null : iso(openSinceMs);
    },
    opening() {
      prune();
      return holds.size === 0 ? null : openings;
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
