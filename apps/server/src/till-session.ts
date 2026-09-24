import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, isNull } from "drizzle-orm";
import { AppError, isUuid } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { hashSessionToken, sessions } from "@waitron/identity";
// Side-effect only: the file that throws `session.required` imports its registry.
import "./errors.js";

export const SESSION_COOKIE = "waitron_till_session";

export { isUuid };

/**
 * Canonicalise a UUID to the lowercase-hyphenated form `newId` mints, or `null` when the value is not
 * a UUID in any spelling. Two reasons to call it: the wrong-PIN throttle keys on the string
 * (`pin-throttle.ts`), so uncanonicalised spellings of one personId would each get a fresh back-off
 * bucket; and id columns are plain `text`, so a differently-spelled id matches no row.
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

/** `secure` comes from `TillApiDeps.secureCookies`: false when the host serves plain HTTP. */
export function setSessionCookie(c: Context, token: string, secure: boolean): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
  });
}

/** `path` must match the one `setSessionCookie` wrote with, or the browser keeps the original. */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function readSessionToken(c: Context): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null;
}

/**
 * Resolves the request's cookie to an OPEN shift session, or throws `session.required`. The lookup is
 * by the token's hash with `ended_at IS NULL`, so an unknown token and a logged-out session fail as a
 * missing cookie does. Login and logout deliberately do not call this.
 */
export async function requireSession(
  deps: { db: Database },
  c: Context,
): Promise<{ personId: string; sessionId: string }> {
  const token = readSessionToken(c);
  if (token === null || !isUuid(token)) throw new AppError("session.required", {});
  const row = await withTransaction(deps.db, async (tx) => {
    const [found] = await tx
      .select({ id: sessions.id, personId: sessions.personId })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hashSessionToken(token)), isNull(sessions.endedAt)));
    return found ?? null;
  });
  if (row === null) throw new AppError("session.required", {});
  return { personId: row.personId, sessionId: row.id };
}
