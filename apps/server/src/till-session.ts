import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, isNull } from "drizzle-orm";
import { AppError, isUuid } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
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

// `isUuid` now lives in `@waitron/shared` (`ids.ts`), where it shares the branded-id `UUID_PATTERN`.
// Re-exported here so the many existing `from "./till-session"` importers keep resolving.
export { isUuid };

/**
 * Canonicalise a UUID to the lowercase-hyphenated form this codebase stores — which is what `newId`
 * mints — or `null` when the value is not a UUID in any spelling. Strips optional wrapping braces and
 * every hyphen, lowercases, and rebuilds the 8-4-4-4-12 form; a value that is not exactly 32 hex
 * digits after stripping is not a UUID and returns `null`.
 *
 * TWO REASONS TO CALL IT, and only one of them is the one this function was written for. The wrong-PIN
 * throttle keys on the STRING (`pin-throttle.ts`, per `(deviceId, personId)`), so a caller that keys on
 * the raw body value lets a brute-forcer cycle spellings of one personId for a fresh back-off bucket
 * each time and evade the window (§5). That reason is unchanged.
 *
 * The second reason is new, and it is the opposite of what the old comment here said. Every id column
 * is plain `text` now and this engine folds no spellings at all: measured on Node v26.7.0 against
 * `node:sqlite`, a row stored under the lowercase-hyphenated spelling is matched by that spelling and
 * by NEITHER the uppercase one nor the dash-free one. So an uppercase id that a `uuid` column used to
 * resolve on cast now names nobody unless it is canonicalised first. One canonical value serves both.
 */
export function canonicaliseUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value
    .trim()
    .replace(/^\{(.*)\}$/, "$1")
    .replace(/-/g, "")
    .toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
 * The deployment holds one tenant per database. Resolves the request's cookie to an OPEN shift
 * session, or throws `session.required`. The lookup is by id only. This is validation against the
 * database, not a presence check: the cookie's id is looked up with `ended_at IS NULL`, so an
 * absent id and an already-logged-out session both fail exactly as a missing cookie does — the
 * cookie merely NAMES a session, it does not prove one is open.
 *
 * Returns the operator's `personId` (for sale attribution) and the `sessionId`. The operator-scoped
 * routes Tasks 5/6 add (`GET /api/staff`, `POST /api/sales`) call this before doing any work; the
 * login/logout routes in `till-api.ts` deliberately do NOT (logging in has no prior session, and
 * logout tolerates a missing or already-closed one).
 *
 * `deps` is typed to the ONE thing this reads — the database — rather than the full `TillConfig`, so
 * both the till API (`TillApiDeps`) and the staff schedule API (`ScheduleApiDeps`) can gate their
 * routes on it without contriving a till config.
 */
export async function requireSession(
  deps: { db: Database },
  c: Context,
): Promise<{ personId: string; sessionId: string }> {
  const id = readSessionId(c);
  // Screen the cookie's SHAPE before the DB: a missing OR non-UUID cookie is `session.required` (401)
  // without a round-trip. Nothing below objects to a non-UUID — `sessions.id` is plain `text`, so the
  // lookup would just match no row — so this shape check is the only thing that reads the cookie's
  // shape, and what keeps a forged cookie a clean 401 (`till-api.ts`'s note on `shared.invalid_id`).
  if (id === null || !isUuid(id)) throw new AppError("session.required", {});
  const personId = await withTransaction(deps.db, async (tx) => {
    const [row] = await tx
      .select({ personId: sessions.personId })
      .from(sessions)
      .where(and(eq(sessions.id, id), isNull(sessions.endedAt)));
    return row?.personId ?? null;
  });
  if (personId === null) throw new AppError("session.required", {});
  return { personId, sessionId: id };
}
