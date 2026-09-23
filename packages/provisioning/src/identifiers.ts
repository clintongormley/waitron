import { randomBytes } from "node:crypto";
import { AppError } from "@waitron/shared";
import "./errors.js";

/**
 * On LENGTH this agrees with Postgres exactly and narrows nothing: one leading character plus
 * `{0,62}` is 63, which is the `NAMEDATALEN`-derived maximum an identifier can be.
 *
 * The narrowing is the CHARACTER SET, and the reason is historical: every database name this tool
 * created had to be embeddable in a connection string, a SQL DDL statement and a README example, and
 * the intersection of "legal everywhere" is lower-case-and-underscores. A name outside it was
 * refused rather than quoted into working, because a database called `Waitron Prod` is a permanent
 * papercut for whoever operates it.
 *
 * This engine has no database name — a venue is a DIRECTORY, resolved by `resolveVenueDir`
 * (`./cli.ts`) — so nothing in the tree calls this now: the only names of it are `./identifiers.test.ts`
 * and the barrel re-export in `./index.ts`.
 */
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

export function assertIdentifier(kind: "database", value: string): void {
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

// The standard SQL string-literal quoting rule — moved to @waitron/shared so the escaping is written
// once; see its header for the argument. This package emits no literal of its own any more: the
// `CREATE ROLE … PASSWORD '…'` it was re-exported for went with the instance path: neither
// `applyInstance` nor `InstanceAction` is DECLARED anywhere in the tree any more, and the only
// `quoteLiteral` call left in product code is the change feed's
// (`packages/db/src/change-feed.ts:45`). The re-export stays because `identifiers.test.ts` pins the escaping rule here,
// and because escaping is a property of the function rather than of whoever calls it.
export { quoteLiteral } from "@waitron/shared";

/**
 * A generated secret, never operator-supplied — base64url's alphabet is `[A-Za-z0-9_-]`, which
 * contains no quote, no backslash and nothing a URL would re-encode, so it needs no escaping
 * wherever it is embedded. It was sized for a `CREATE ROLE … PASSWORD '…'` literal and the
 * `DATABASE_URL` this tool printed beside it, and this tool has neither now; its one caller in the
 * tree is the break-glass secret (`apps/server/src/break-glass.ts`).
 *
 * 24 bytes → 32 characters, 192 bits. Sized from the encoding rather than the other way round:
 * base64url of a multiple of 3 bytes carries no `=` padding.
 */
export function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}
