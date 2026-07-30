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
 * The standard SQL string-literal quoting rule, for the one literal this package emits: the
 * password in `CREATE ROLE … PASSWORD '…'`. `CREATE ROLE` is a utility statement and takes no bind
 * parameters, so the value has to be built into the text and there is no parameterised alternative
 * to reach for.
 *
 * **For every password this tool generates it changes nothing** — base64url's alphabet is
 * `[A-Za-z0-9_-]`, so there is no quote and no backslash, and the output is byte-identical to the
 * naive `'${value}'` this replaced. It exists because `applyInstance` and `InstanceAction` are
 * EXPORTED (`index.ts`) and `InstanceAction.password` is typed `string`, so the safety was a
 * property of one caller rather than of the code — and this package's own
 * `instance-apply.rls.test.ts` already passes a hand-written password through that path today. A
 * comment asserting a guarantee the type does not enforce is this repository's dominant defect
 * class; escaping makes it structural instead.
 *
 * `''` doubles the quote. The `E` prefix is for a backslash: under `standard_conforming_strings =
 * on` (the default since 9.1) a backslash in a plain literal is already itself, but the setting is
 * per-session and can be off, and `E'…'` then makes the doubling explicit for both. This is what
 * `PQescapeLiteral` and `pg`'s own `Client.escapeLiteral` do, for the same reason.
 */
export function quoteLiteral(value: string): string {
  const escaped = value.replaceAll("'", "''").replaceAll("\\", "\\\\");
  return value.includes("\\") ? `E'${escaped}'` : `'${escaped}'`;
}

/**
 * A generated role password. Never operator-supplied — base64url's alphabet is `[A-Za-z0-9_-]`,
 * which contains no quote, no backslash and nothing a URL would re-encode, so the same string is
 * safe in a `CREATE ROLE … PASSWORD '…'` literal (which `quoteLiteral` now escapes regardless) and
 * in the `DATABASE_URL` this tool prints.
 *
 * 24 bytes → 32 characters, 192 bits. Sized from the encoding rather than the other way round:
 * base64url of a multiple of 3 bytes carries no `=` padding.
 */
export function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}
