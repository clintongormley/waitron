// Side-effect: loads this package's errors.ts, which co-declares `management_session.required` (the
// code `requireManagementSession` below throws). Load-bearing here — `@waitron/identity` also owns and
// declares that code, but this package does not import identity, so the augmentation reaches this file
// only through this line. See the note atop `errors.ts`.
import "./errors.js";
import { AppError, isUuid } from "@waitron/shared";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

/**
 * The name of the browser management-session cookie — the till's `waitron_till_session` parallel for
 * the dashboard. One constant so the set/clear/require helpers below cannot drift on the spelling.
 */
export const MANAGEMENT_COOKIE = "waitron_management_session";

/**
 * Writes the session's token into the management cookie. `httpOnly` so no browser script can read
 * it (the token is a bearer credential; the session row stores only its hash —
 * `@waitron/identity`'s `session-token.ts`); `sameSite: "Strict"` so it never rides a cross-site
 * request; `path: "/"` so it covers the whole dashboard. `secure` is caller-supplied — TRUE on a production HTTPS host,
 * FALSE on loopback dev where there is no TLS to attach it to.
 */
export function setManagementCookie(c: Context, token: string, secure: boolean): void {
  setCookie(c, MANAGEMENT_COOKIE, token, {
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
 * The management session token carried by the request's cookie, or `null` when the cookie is
 * absent. The till's `readSessionId` parallel — the non-throwing read the idempotent logout
 * composes with `isUuid`, and the base `requireManagementSession` builds its shape check on.
 */
export function readManagementSessionId(c: Context): string | null {
  return getCookie(c, MANAGEMENT_COOKIE) ?? null;
}

/**
 * Reads the request's management cookie and returns its token, or throws
 * `management_session.required` when the cookie is absent OR not a UUID. This screens the cookie's
 * SHAPE only — the live-session lookup, by the token's hash, happens in `resolveManagementSession`
 * (`@waitron/identity`). Reuses `isUuid` from `@waitron/shared` so the anchored-UUID regex has one
 * home.
 */
export function requireManagementSession(c: Context): string {
  const id = readManagementSessionId(c);
  if (id === null || !isUuid(id)) throw new AppError("management_session.required", {});
  return id;
}
