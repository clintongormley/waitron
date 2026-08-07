// Side-effect only: keeps this host's error-code registry (errors.ts) loaded from the file that
// throws — the reachability convention `till-session.ts` follows (a bare import, no value used
// here). `management_session.required` itself is DECLARED in `@waitron/identity`'s errors.ts (1a),
// whose augmentation reaches this file transitively via `./till-session.js` importing from
// `@waitron/identity`. See the note atop `errors.ts`.
import "./errors.js";
import { AppError } from "@waitron/shared";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isUuid } from "./till-session.js";

/**
 * The name of the browser management-session cookie — the till's `waitron_till_session` parallel for
 * the dashboard. One constant so the set/clear/require helpers below cannot drift on the spelling.
 */
export const MANAGEMENT_COOKIE = "waitron_management_session";

/**
 * Writes the session id into the management cookie. `httpOnly` so no browser script can read it (the
 * id is a bearer credential); `sameSite: "Strict"` so it never rides a cross-site request; `path: "/"`
 * so it covers the whole dashboard. `secure` is caller-supplied — TRUE on a production HTTPS host,
 * FALSE on loopback dev where there is no TLS to attach it to.
 */
export function setManagementCookie(c: Context, sessionId: string, secure: boolean): void {
  setCookie(c, MANAGEMENT_COOKIE, sessionId, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
  });
}

/**
 * Clears the management cookie (sign-out). `path` must match the one `setManagementCookie` wrote
 * with, or the browser keeps the original alongside the expiry the delete emits.
 */
export function clearManagementCookie(c: Context): void {
  deleteCookie(c, MANAGEMENT_COOKIE, { path: "/" });
}

/**
 * The management session id carried by the request's cookie, or `null` when the cookie is absent. The
 * till's `readSessionId` parallel — the non-throwing read the idempotent logout composes with `isUuid`,
 * and the base `requireManagementSession` builds its shape check on.
 */
export function readManagementSessionId(c: Context): string | null {
  return getCookie(c, MANAGEMENT_COOKIE) ?? null;
}

/**
 * Reads the request's management cookie and returns its id, or throws `management_session.required`
 * when the cookie is absent OR not a UUID. This screens the cookie's SHAPE only — a real
 * live-session lookup happens in the route layer (Task 3/4). Reuses `isUuid` from `till-session.ts`
 * so the anchored-UUID regex has one home: a non-UUID id looked up against a Postgres `uuid` column
 * raises `22P02` → an opaque 500, so the shape check keeps a forged cookie a clean fault instead.
 */
export function requireManagementSession(c: Context): string {
  const id = readManagementSessionId(c);
  if (id === null || !isUuid(id)) throw new AppError("management_session.required", {});
  return id;
}
