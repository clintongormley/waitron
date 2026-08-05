import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { AppError } from "@waitron/shared";
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
 * The session id, or a loud `session.required` when none is present — the gate the operator-scoped
 * routes Tasks 5/6 add (`GET /api/staff`, `POST /api/sales`) sit behind. Kept here beside the cookie
 * helpers so "what names the session" lives in one file; the login/logout routes in `till-api.ts`
 * deliberately do NOT use it (logging in has no prior session, and logout tolerates its absence).
 */
export function requireSession(c: Context): string {
  const id = readSessionId(c);
  if (id === null) throw new AppError("session.required", {});
  return id;
}
