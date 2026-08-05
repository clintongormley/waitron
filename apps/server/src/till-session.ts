import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, isNull } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { sessions } from "@waitron/identity";
import type { TillConfig } from "./till-config.js";
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
 */
export async function requireSession(
  deps: { db: Database; cfg: TillConfig },
  c: Context,
): Promise<{ personId: string; sessionId: string }> {
  const id = readSessionId(c);
  if (id === null) throw new AppError("session.required", {});
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
