import { createHash, randomUUID } from "node:crypto";

export function mintSessionToken(): string {
  return randomUUID();
}

/**
 * What a session row stores in place of its token, so a copy of the database holds no usable
 * session cookie: presenting the hash as a cookie is looked up as the hash of the hash, which names
 * no row, and the row id names none either. A fast digest rather than a password KDF because the
 * token is random, not chosen by a person.
 */
export function hashSessionToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
