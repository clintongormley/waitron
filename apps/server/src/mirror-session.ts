import type { MiddlewareHandler } from "hono";
import { sql } from "drizzle-orm";
import { withTenant, type Database } from "@waitron/db";
import { readManagementSessionId, setManagementCookie } from "./management-session.js";

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
 * Ensures the mirror's ambient read-only viewer exists: one `admin` person (every permission, so every
 * gated dashboard read passes `authorizeManager` — the §5 gate is what enforces read-only, not this
 * role) and one live management session for it. Idempotent — safe to call on every boot. Runs under the
 * mirror's tenant as `app_user` (which already holds INSERT/UPDATE on both tables; no new grant).
 */
export async function ensureMirrorViewer(db: Database, tenantId: string): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    await tx.execute(sql`
      insert into persons (id, tenant_id, display_name, pin_hash, role, status)
      values (${MIRROR_VIEWER_PERSON_ID}, ${tenantId}, 'mirror viewer', ${UNUSABLE_PIN_HASH}, 'admin', 'active')
      on conflict (id) do nothing
    `);
    await tx.execute(sql`
      insert into management_sessions (id, tenant_id, person_id)
      values (${MIRROR_VIEWER_SESSION_ID}, ${tenantId}, ${MIRROR_VIEWER_PERSON_ID})
      on conflict (id) do update set last_seen_at = now(), ended_at = null
    `);
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
 * request's `management_sessions` writes (once here, once in `resolveManagementSession`).
 */
export function mirrorSession(db: Database, tenantId: string, secure: boolean): MiddlewareHandler {
  return async (c, next) => {
    await withTenant(db, tenantId, (tx) =>
      tx.execute(sql`update management_sessions set last_seen_at = now(), ended_at = null
                     where id = ${MIRROR_VIEWER_SESSION_ID}
                       and (last_seen_at is null or last_seen_at < now() - interval '1 minute')`),
    );
    if (readManagementSessionId(c) === null) {
      setManagementCookie(c, MIRROR_VIEWER_SESSION_ID, secure);
    }
    return next();
  };
}
