import { randomBytes } from "node:crypto";
import { AppError } from "@waitron/shared";
import "./errors.js";

/**
 * On LENGTH this agrees with Postgres exactly and narrows nothing: one leading character plus
 * `{0,62}` is 63, which is the `NAMEDATALEN`-derived maximum an identifier can be.
 *
 * The narrowing is the CHARACTER SET. Every name this tool creates is one it also has to embed in a
 * connection string, a SQL DDL statement and a README example, and the intersection of "legal
 * everywhere" is lower-case-and-underscores. A name outside it is refused rather than quoted into
 * working, because a database called `Waitron Prod` is a permanent papercut for whoever operates it.
 */
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

export function assertIdentifier(kind: "database" | "role", value: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new AppError("provisioning.invalid_identifier", { kind, value });
  }
}

/**
 * The standard SQL identifier quoting rule. Every DDL statement in this package goes through here
 * — `assertIdentifier` already rejects anything that would need it, so this is the second of two
 * independent defences rather than the only one.
 */
export function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * A generated role password. Never operator-supplied — that is what makes SQL literal escaping a
 * non-problem here: base64url's alphabet is `[A-Za-z0-9_-]`, which contains no quote, no
 * backslash and nothing a URL would re-encode, so the same string is safe in a `CREATE ROLE …
 * PASSWORD '…'` literal and in the `DATABASE_URL` this tool prints.
 *
 * 24 bytes → 32 characters, 192 bits. Sized from the encoding rather than the other way round:
 * base64url of a multiple of 3 bytes carries no `=` padding.
 */
export function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}
