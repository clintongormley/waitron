/**
 * Pairing mode — the venue-wide window during which anything may ask to join (design §1.1).
 *
 * IN MEMORY, ON THE PRIMARY, DELIBERATELY. It is not a table: a window is a thing an admin is doing
 * right now, not a fact about the venue, and holding it here makes it fail closed on both the events
 * that should close it — a restart, and a promotion (a node that has just taken over must not inherit
 * an open door). It also costs no migration, no classification and no grant.
 *
 * ONE holder serves BOTH surfaces (owner decision 2026-09-08): `boot.ts` builds it once and passes it
 * to the device and print mounts, so "venue-wide" is a property of the wiring rather than a rule
 * anyone has to remember.
 */

export const PAIRING_WINDOW_MS = 15 * 60 * 1000;

/** How far back `refusedRecently` looks. The dashboard renders it as "N tried to join in the last 10
 * minutes" beside the toggle, so the copy and this constant must move together. */
export const REFUSED_WINDOW_MS = 10 * 60 * 1000;

export interface PairingMode {
  /** Open the window, or extend an already-open one by a fresh TTL. */
  open(): { openUntil: string };
  close(): void;
  isOpen(): boolean;
  /** The ISO instant the window lapses, or `null` when shut. */
  openUntil(): string | null;
  /** Record a knock refused because the window was shut. Deliberately NOT a row: persisting refused
   * knocks would hand an attacker the row creation the window exists to deny (design §12). */
  noteRefused(): void;
  refusedRecently(): number;
}

export function createPairingMode(opts: { now?: () => number; ttlMs?: number } = {}): PairingMode {
  const { now = Date.now, ttlMs = PAIRING_WINDOW_MS } = opts;
  let openUntilMs = 0;
  let refusedAt: number[] = [];
  return {
    open() {
      openUntilMs = now() + ttlMs;
      return { openUntil: new Date(openUntilMs).toISOString() };
    },
    close() {
      openUntilMs = 0;
    },
    isOpen() {
      return now() < openUntilMs;
    },
    openUntil() {
      return now() < openUntilMs ? new Date(openUntilMs).toISOString() : null;
    },
    noteRefused() {
      refusedAt.push(now());
    },
    refusedRecently() {
      const cutoff = now() - REFUSED_WINDOW_MS;
      refusedAt = refusedAt.filter((t) => t > cutoff);
      return refusedAt.length;
    },
  };
}
