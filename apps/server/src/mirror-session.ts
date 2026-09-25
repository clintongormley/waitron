import type { MiddlewareHandler } from "hono";
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { nowIso, withTransaction, type Database, type DeploymentMode } from "@waitron/db";
import {
  foldForUniqueness,
  hashSessionToken,
  managementSessions,
  mintSessionToken,
  persons,
} from "@waitron/identity";
import {
  clearManagementCookie,
  readManagementSessionToken,
  setManagementCookie,
} from "@waitron/server-kit";

/** Fixed ids the seed upserts on, so they must never change. Public values, so neither is ever a
 * cookie: the cookie is the token {@link ensureMirrorViewer} mints. */
export const MIRROR_VIEWER_PERSON_ID = "acce55ed-0000-4000-8000-000000000001";
export const MIRROR_VIEWER_SESSION_ID = "acce55ed-0000-4000-8000-000000000002";

/** No PIN verifies against it: `verifyPin` fails closed on a malformed hash. */
const UNUSABLE_PIN_HASH = "mirror-viewer-never-logs-in";

const KEEPALIVE_INTERVAL_MS = 60_000;

/**
 * Seeds the mirror's ambient viewer: an `admin` person and one live session. The role grants every
 * read; the read-only gate, not this role, is what keeps the mirror read-only. Idempotent in its
 * rows. Every call mints a fresh token, stores only its hash and returns it, so an earlier token
 * stops resolving and a copy of the database holds nothing that signs in.
 */
export async function ensureMirrorViewer(db: Database): Promise<string> {
  const token = mintSessionToken();
  const tokenHash = hashSessionToken(token);
  await withTransaction(db, async (tx) => {
    // Through the table definitions, not raw SQL: the `created_at`/`last_seen_at` defaults are
    // `$defaultFn` values that a raw insert never reaches.
    await tx
      .insert(persons)
      .values({
        id: MIRROR_VIEWER_PERSON_ID,
        displayName: "mirror viewer",
        displayNameFolded: foldForUniqueness("mirror viewer"),
        pinHash: UNUSABLE_PIN_HASH,
        role: "admin",
        status: "active",
      })
      .onConflictDoNothing({ target: persons.id });
    await tx
      .insert(managementSessions)
      .values({
        id: MIRROR_VIEWER_SESSION_ID,
        personId: MIRROR_VIEWER_PERSON_ID,
        tokenHash,
      })
      .onConflictDoUpdate({
        target: managementSessions.id,
        set: { tokenHash, lastSeenAt: nowIso(), endedAt: null },
      });
  });
  return token;
}

/**
 * Called on a trading boot whose mode is not `mirror`. {@link mirrorSession} is mounted only on a
 * mirror boot, so without this a promoted mirror that restarts, or a mirror's database booted as a
 * primary, would still resolve a kept cookie as this admin.
 */
export async function endMirrorViewer(db: Database): Promise<void> {
  await withTransaction(db, (tx) =>
    tx
      .update(managementSessions)
      .set({ endedAt: nowIso() })
      .where(
        and(
          eq(managementSessions.id, MIRROR_VIEWER_SESSION_ID),
          isNull(managementSessions.endedAt),
        ),
      ),
  );
}

/**
 * Ambient auth for the mirror's dashboard: sets the viewer's cookie on any request that lacks it,
 * and keeps the session from expiring on an idle mirror (throttled to one write a minute).
 *
 * `getMode` is read per request. Once the node is promoted, a request still carrying the viewer's
 * token ends the session and clears the cookie; merely not injecting it would leave a pre-promotion
 * cookie authenticated as admin the moment writes open.
 */
export function mirrorSession(
  db: Database,
  secure: boolean,
  getMode: () => DeploymentMode,
  token: string,
): MiddlewareHandler {
  return async (c, next) => {
    if (getMode() !== "mirror") {
      if (readManagementSessionToken(c) === token) {
        await withTransaction(db, (tx) =>
          tx
            .update(managementSessions)
            .set({ endedAt: nowIso() })
            .where(
              and(
                eq(managementSessions.id, MIRROR_VIEWER_SESSION_ID),
                isNull(managementSessions.endedAt),
              ),
            ),
        );
        clearManagementCookie(c);
      }
      return next();
    }
    // Also revives an ended session: gating `ended_at` behind the throttle alone would leave a
    // session ended with a fresh `last_seen_at` dead. One clock read, so stamp and cutoff agree.
    const seenAt = nowIso();
    const staleBefore = new Date(Date.parse(seenAt) - KEEPALIVE_INTERVAL_MS).toISOString();
    await withTransaction(db, (tx) =>
      tx
        .update(managementSessions)
        .set({ lastSeenAt: seenAt, endedAt: null })
        .where(
          and(
            eq(managementSessions.id, MIRROR_VIEWER_SESSION_ID),
            or(
              // Never matches: `last_seen_at` is NOT NULL.
              isNull(managementSessions.lastSeenAt),
              lt(managementSessions.lastSeenAt, staleBefore),
              isNotNull(managementSessions.endedAt),
            ),
          ),
        ),
    );
    // Any other cookie value, an earlier boot's token included, would 401; overwrite it.
    if (readManagementSessionToken(c) !== token) {
      setManagementCookie(c, token, secure);
    }
    return next();
  };
}
