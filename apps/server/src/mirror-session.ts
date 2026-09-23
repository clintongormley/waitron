import type { MiddlewareHandler } from "hono";
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { nowIso, withTransaction, type Database, type DeploymentMode } from "@waitron/db";
import { foldForUniqueness, managementSessions, persons } from "@waitron/identity";
import {
  clearManagementCookie,
  readManagementSessionId,
  setManagementCookie,
} from "@waitron/server-kit";

/** Fixed, stable ids so the seed is idempotent (upsert on a known PK) and the middleware can name the
 * ambient session without a lookup. Valid v4-shaped UUIDs; arbitrary but MUST never change (the seed
 * keys on them). Distinct high bytes so they are recognizable as the mirror viewer in a `persons` /
 * `management_sessions` dump. */
export const MIRROR_VIEWER_PERSON_ID = "acce55ed-0000-4000-8000-000000000001";
export const MIRROR_VIEWER_SESSION_ID = "acce55ed-0000-4000-8000-000000000002";

/** A pin hash that no PIN can ever verify against (scrypt parse fails → `false`, since `verifyPin`
 * fails CLOSED on a malformed value — @waitron/identity's verify-pin.ts). The viewer never logs in —
 * the mirror gates every login POST shut (§5) — but `persons.pin_hash` is NOT NULL with a length>0
 * CHECK, so it needs a non-empty, deliberately-unusable value. */
const UNUSABLE_PIN_HASH = "mirror-viewer-never-logs-in";

/**
 * How stale the ambient session's `last_seen_at` has to be before a request refreshes it.
 *
 * It was the SQL literal `interval '1 minute'`; it is a named millisecond count because the cutoff
 * is computed in JavaScript and bound now, not built in SQL — see the keepalive in
 * {@link mirrorSession}.
 */
const KEEPALIVE_INTERVAL_MS = 60_000;

/**
 * Ensures the mirror's ambient read-only viewer exists: one `admin` person (every permission, so every
 * gated dashboard read passes `authorizeManager` — the §5 gate is what enforces read-only, not this
 * role) and one live management session for it. Idempotent — safe to call on every boot. Runs under
 * one `withTransaction`.
 */
export async function ensureMirrorViewer(db: Database): Promise<void> {
  await withTransaction(db, async (tx) => {
    // Both rows are written through their table definitions rather than as raw SQL, so each
    // column's own generator runs: `persons.created_at` and `management_sessions.created_at` /
    // `last_seen_at` are `$defaultFn` values on this engine, and a raw insert reaches none of them
    // (`NOT NULL constraint failed`). Same change, and the same reason, as
    // `packages/db/src/testing/seed.ts`.
    await tx
      .insert(persons)
      .values({
        id: MIRROR_VIEWER_PERSON_ID,
        displayName: "mirror viewer",
        // Folded for the same reason the venue plan's admin is: the live-display-name index and
        // every lookup compare on this key, and a row without it falls back on an ASCII-only one.
        displayNameFolded: foldForUniqueness("mirror viewer"),
        pinHash: UNUSABLE_PIN_HASH,
        role: "admin",
        status: "active",
      })
      .onConflictDoNothing({ target: persons.id });
    await tx
      .insert(managementSessions)
      .values({ id: MIRROR_VIEWER_SESSION_ID, personId: MIRROR_VIEWER_PERSON_ID })
      .onConflictDoUpdate({
        target: managementSessions.id,
        // The revive: the clock is read in JavaScript and bound, because `now()` is a PostgreSQL
        // function this engine does not have. `nowIso` is the one spelling every writer of these
        // text timestamp columns uses, which is what makes the `<` comparison in the keepalive
        // below a correct time ordering (`packages/printing/src/runtime.ts` has the measurement).
        set: { lastSeenAt: nowIso(), endedAt: null },
      });
  });
}

/**
 * Per-request ambient auth for the mirror's dashboard. Keeps the ambient session live (so
 * `resolveManagementSession`'s sliding-window expiry never turns an idle mirror's first request into a
 * 401) and, when the request carries no management cookie, sets it to the ambient session — so the
 * browser never sees a login screen and the existing `requireManagementSession` gates resolve a real,
 * live session. The keepalive is an internal SQL write inside the request; it is NOT an HTTP write, so
 * the read-only gate (which gates the HTTP verb) does not block it — the reason a read-only DB role was
 * rejected (§3).
 *
 * The keepalive is THROTTLED to at most one write per minute (the `device-session.ts` /
 * `printing/agent.ts` / `sync/peers.ts` last-seen pattern), NOT written on every request:
 * `resolveManagementSession` already bumps `last_seen_at` on every gated request within its 30-minute
 * `IDLE_TIMEOUT_MS`, so the ONLY gap this middleware closes is an idle mirror (untouched > 30 min) whose
 * next request's own gate would otherwise throw `management_session.expired` before it could bump. A
 * one-minute cadence covers that with 30x headroom while removing the per-request write amplification —
 * a live dashboard polls many times a second, and an unthrottled write here would double every gated
 * request's `management_sessions` writes (once here, once in `resolveManagementSession`). All ambient
 * traffic shares the single `MIRROR_VIEWER_SESSION_ID` row, so its `resolveManagementSession` bumps
 * serialize on one row — accepted for the single-tenant DR-mirror posture (decision 4), not a bug.
 *
 * `getMode` is read PER REQUEST, exactly like the read-only gate, so promotion is a genuine flag-flip:
 * the moment the holder flips to `primary`, a promoted node requires REAL auth. Merely not-injecting is
 * not enough — a client holding a PRE-promotion ambient cookie would stay authenticated as admin the
 * instant the gate opens writes. So on promotion this middleware actively DROPS the ambient admin: when
 * the request still carries the ambient id it ENDS the ambient session (`resolveManagementSession` then
 * 401s it) and clears the cookie. Without this, promotion would be an unauthenticated-admin-write bypass.
 * A future re-mirror boot revives the ambient session via `ensureMirrorViewer`'s `ended_at = null` upsert.
 */
export function mirrorSession(
  db: Database,
  secure: boolean,
  getMode: () => DeploymentMode,
): MiddlewareHandler {
  return async (c, next) => {
    if (getMode() !== "mirror") {
      // Promoted: drop the ambient admin. Only act when the request still presents the ambient id —
      // otherwise there is nothing to end, and requireManagementSession handles the no-cookie case.
      if (readManagementSessionId(c) === MIRROR_VIEWER_SESSION_ID) {
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
    // Throttled keepalive: refresh `last_seen_at` when it is stale, OR revive a session that was somehow
    // ended (`ended_at is not null`). Clearing `ended_at` must NOT be gated behind the last_seen_at
    // throttle alone — a stamped `ended_at` with a still-fresh `last_seen_at` would otherwise keep the
    // session dead and 401 the next dashboard request.
    //
    // The clock is read once, so the stamp written and the staleness cutoff are the same moment —
    // which is what PostgreSQL's `now()`, being transaction-start time, gave for free. `last_seen_at`
    // is a text column here, so `<` on it compares SPELLINGS; `nowIso` is the spelling every writer
    // of it uses, and the measurement of the three that sort wrong is in
    // `packages/printing/src/runtime.ts`.
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
              // `last_seen_at` is NOT NULL in the schema, so the null arm can never fire — it is
              // kept because the raw statement this replaced carried it, and dropping a condition
              // is a behaviour change this conversion is not making.
              isNull(managementSessions.lastSeenAt),
              lt(managementSessions.lastSeenAt, staleBefore),
              isNotNull(managementSessions.endedAt),
            ),
          ),
        ),
    );
    // Inject the ambient cookie whenever the request does NOT already carry it — absent, corrupted, a
    // non-UUID, or a forged/foreign session id. A mirror is unauthenticated and holds only this one
    // ambient session, so overwriting any non-ambient value keeps the dashboard reachable: a corrupted
    // or forged cookie would otherwise fail `requireManagementSession`'s shape check (or resolve to no
    // row) and 401, breaking the read-only posture. A request already carrying the ambient id is left
    // untouched (no redundant Set-Cookie).
    if (readManagementSessionId(c) !== MIRROR_VIEWER_SESSION_ID) {
      setManagementCookie(c, MIRROR_VIEWER_SESSION_ID, secure);
    }
    return next();
  };
}
