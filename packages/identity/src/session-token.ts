import { createHash, randomUUID } from "node:crypto";

/**
 * A new bearer token for a session cookie. A random v4 UUID — the same generator `newId` uses for
 * every row id (`packages/db/src/schema/columns.ts`), so a cookie carries what it carried when it was
 * the row id, and keeps the shape the `isUuid` screens check (`apps/server/src/till-session.ts`,
 * `packages/server-kit/src/management-cookie.ts`).
 */
export function mintSessionToken(): string {
  return randomUUID();
}

/**
 * What a session row stores in place of its token: lowercase hex SHA-256. A copy of the database —
 * a bucket, an archive — holds only this, and presenting it as a cookie is looked up as the hash of
 * the hash, which names no row. A fast digest rather than a password KDF because the token is random,
 * not chosen by a person: the choice `google-oidc.ts` makes for its state.
 */
export function hashSessionToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
