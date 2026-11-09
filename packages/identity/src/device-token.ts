import { createHash, timingSafeEqual } from "node:crypto";
import { nowIso, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { diskFullIn } from "@waitron/shared";

/** How stale a recorded sighting has to be before a sign-in writes a fresh one. */
export const SIGHTING_INTERVAL_MS = 60_000;

/**
 * What a device or print-agent row stores in place of its token. A fast digest rather than a
 * password KDF because the token is 32 random bytes, never chosen by a person; a database copy
 * still holds no usable token, since presenting the stored hash is hashed again.
 */
export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time. A stored value of any other shape (an old scrypt value, `""`) is `false`. */
export function deviceTokenMatches(token: string, stored: string): boolean {
  const presented = Buffer.from(hashDeviceToken(token), "utf8");
  const held = Buffer.from(stored, "utf8");
  return presented.length === held.length && timingSafeEqual(presented, held);
}

/**
 * The instant a minute before `seenAt`; a stored sighting before it is stale. The stamps are text
 * and `<` compares them as strings, which orders two instants correctly only for the one
 * `toISOString()` spelling every writer uses.
 */
export function staleBefore(seenAt: string): string {
  return new Date(Date.parse(seenAt) - SIGHTING_INTERVAL_MS).toISOString();
}

/** Whether nothing is stored yet, or `lastSeenAt` is more than a minute older than `seenAt`. */
export function sightingDue(lastSeenAt: string | null, seenAt: string): boolean {
  return lastSeenAt === null || lastSeenAt < staleBefore(seenAt);
}

interface TokenRow {
  tokenHash: string;
  lastSeenAt: string | null;
}

/**
 * Checks `token` against the row `readRow` finds and returns that row, or `null` when there is no
 * row or the token does not match. When a sighting is due and the read is not passive, the row is
 * read again under the venue's write lock before `recordSighting` runs, so a new token or a removal
 * committed in between refuses, and any other change is what is returned. A full disk refuses only
 * the sighting: the same re-check runs without a write.
 */
export async function signInWithToken<Row extends TokenRow>(
  db: Database,
  options: {
    token: string;
    readRow: (on: Database | Transaction) => Promise<Row | undefined>;
    recordSighting: (tx: Transaction, seenAt: string) => Promise<void>;
    passive?: boolean;
  },
): Promise<Row | null> {
  const { token, readRow, recordSighting } = options;
  const row = await readRow(db);
  if (row === undefined || !deviceTokenMatches(token, row.tokenHash)) return null;

  const seenAt = nowIso();
  if (options.passive === true || !sightingDue(row.lastSeenAt, seenAt)) return row;

  const stillCurrent = (current: Row | undefined) =>
    current?.tokenHash === row.tokenHash ? current : undefined;
  let locked: Row | undefined;
  try {
    locked = await withTransaction(db, async (tx) => {
      const current = stillCurrent(await readRow(tx));
      if (current !== undefined) await recordSighting(tx, seenAt);
      return current;
    });
  } catch (error) {
    if (!diskFullIn(error)) throw error;
    locked = stillCurrent(await readRow(db));
  }
  return locked ?? null;
}
