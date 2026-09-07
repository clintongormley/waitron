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

// The standard SQL string-literal quoting rule — moved to @waitron/shared (also needed by
// @waitron/sync's CREATE SUBSCRIPTION conninfo); see its header for the escaping argument. The one
// literal this package emits is the `CREATE ROLE … PASSWORD '…'` password: `applyInstance` and
// `InstanceAction` are EXPORTED (`index.ts`) and `InstanceAction.password` is typed `string`, so
// escaping makes the safety structural rather than a property of one caller — this repo's dominant
// defect class. For a generated base64url password (`[A-Za-z0-9_-]`) it escapes nothing.
export { quoteLiteral } from "@waitron/shared";

/**
 * The same connection string, made to open its session AS `role` — a libpq `options=-c role=<role>`
 * on the URI, which every session started from it runs under. This is how `instance` migrates and
 * does its post-migrate role work AS `waitron_migrator` over the ADMIN's own credentials, so every
 * table it creates is migrator-owned (probe A): the admin holds SET-membership on the migrator it
 * created, and the session role is that migrator.
 *
 * `role` is validated with the identifier grammar rather than quoted, the §3 rule for a value that
 * ends up embedded in a connection string rather than bound. `assertIdentifier` already refuses a
 * space, a quote or anything else libpq would mis-split, so no escaping pass is needed — and the
 * grammar is exactly the one `INSTANCE_ROLES` are drawn from.
 *
 * A URI that already carries an `options` parameter is REFUSED, not merged: this tool composes every
 * URI it hands here (`withDatabase` of the admin string), and none of them carries `options`, so a
 * pre-existing one is a programmer error. Merging two libpq option strings correctly is not
 * attempted.
 */
export function withRole(uri: string, role: string): string {
  assertIdentifier("role", role);
  const u = new URL(uri);
  if (u.searchParams.has("options")) {
    throw new Error(
      "withRole: refusing to merge into a URI that already carries an options parameter",
    );
  }
  u.searchParams.set("options", `-c role=${role}`);
  return u.toString();
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
