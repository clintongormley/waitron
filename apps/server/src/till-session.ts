import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, isNull } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { sessions } from "@waitron/identity";
// Side-effect only: keeps this host's `session.required` code (errors.ts) reachable from the file
// that throws it — the reachability convention `till-config.ts`/`webhook.ts` follow (a bare import,
// no value used here). See the note atop `errors.ts`.
import "./errors.js";

/**
 * The name of the till's shift-session cookie. One constant so the set/read/clear/require helpers
 * below — and any consumer Tasks 5/6 add — cannot drift on the spelling.
 */
export const SESSION_COOKIE = "waitron_till_session";

/**
 * Anchored UUID shape check for the session cookie. `sessions.id` is a Postgres `uuid` column, so a
 * cookie that is NOT a UUID makes `eq(sessions.id, id)` raise `22P02 invalid input syntax for type
 * uuid` — which `run` maps to an opaque 500. A forged non-UUID cookie is a client fault, not a server
 * one: the callers below screen the cookie's SHAPE first so a malformed value fails as `session.required`
 * (401) or is skipped (idempotent logout), never reaching the database. Anchored at both ends for the
 * reason `@waitron/shared`'s `ids.ts` records — an unanchored match would accept a UUID with trailing
 * junk. (Not reusing that module's validator: it is a private const there, unexported.)
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Writes the session id into the shift cookie. `httpOnly` so no browser script can read it (the id is
 * a bearer credential); `sameSite: "Strict"` so it never rides a cross-site request; `path: "/"` so
 * it covers the whole till app. `secure` is caller-supplied — TRUE on a production HTTPS host, FALSE
 * on loopback dev where there is no TLS to attach it to (`TillApiDeps.secureCookies`).
 */
export function setSessionCookie(c: Context, sessionId: string, secure: boolean): void {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
  });
}

/**
 * Clears the shift cookie (logout). `path` must match the one `setSessionCookie` wrote with, or the
 * browser keeps the original alongside the expiry the delete emits.
 */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** The session id carried by the request's cookie, or null when the cookie is absent. */
export function readSessionId(c: Context): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null;
}

/**
 * Resolves the request's cookie to an OPEN shift session, or throws `session.required`. This is real
 * validation against the database, not a presence check: the cookie's id is looked up as the app role
 * under the till's tenant with `ended_at IS NULL`, so a forged or guessed id, an id belonging to
 * another tenant (RLS hides it), and an already-logged-out session all fail exactly as a missing
 * cookie does — the cookie merely NAMES a session, it does not prove one is open.
 *
 * Returns the operator's `personId` (for sale attribution) and the `sessionId`. The operator-scoped
 * routes Tasks 5/6 add (`GET /api/staff`, `POST /api/sales`) call this before doing any work; the
 * login/logout routes in `till-api.ts` deliberately do NOT (logging in has no prior session, and
 * logout tolerates a missing or already-closed one).
 *
 * `deps.cfg` is typed to the ONE field this reads — `tenantId` — rather than the full `TillConfig`, so
 * both the till API (`TillApiDeps`) and the staff schedule API (`ScheduleApiDeps`, which carries only
 * `{ tenantId }`) can gate their routes on it without contriving a full till config.
 */
export async function requireSession(
  deps: { db: Database; cfg: { tenantId: string } },
  c: Context,
): Promise<{ personId: string; sessionId: string }> {
  const id = readSessionId(c);
  // Screen the cookie's SHAPE before the DB: a missing OR non-UUID cookie is `session.required` (401)
  // without a round-trip. Passing a non-UUID into the `uuid` column would raise 22P02 → an opaque 500
  // (see `isUuid`), so the shape check is what keeps a forged cookie a 401 rather than a 500.
  if (id === null || !isUuid(id)) throw new AppError("session.required", {});
  const personId = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const [row] = await tx
      .select({ personId: sessions.personId })
      .from(sessions)
      .where(and(eq(sessions.id, id), isNull(sessions.endedAt)));
    return row?.personId ?? null;
  });
  if (personId === null) throw new AppError("session.required", {});
  return { personId, sessionId: id };
}
