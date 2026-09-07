/**
 * The standard SQL string-literal quoting rule, for a literal a utility statement must carry in its
 * own text because PostgreSQL will not bind it — the password in `CREATE ROLE … PASSWORD '…'`
 * (`@waitron/provisioning`) and the CONNECTION conninfo of `CREATE SUBSCRIPTION` (`@waitron/sync`,
 * whose conninfo carries the replication password). It lives here because both need exactly this and
 * the escaping argument must not be maintained in two copies.
 *
 * `''` always doubles a single quote, so a value can never close the literal early. The `E'…'` form
 * is for a backslash: under `standard_conforming_strings = on` (the default since 9.1) a backslash in
 * a plain literal is already itself, but the setting is PER-SESSION and can be off, and `E'…'` with
 * the backslash doubled makes the meaning explicit under both. This is what `PQescapeLiteral` and
 * `pg`'s own `Client.escapeLiteral` do, for the same reason.
 */
export function quoteLiteral(value: string): string {
  const escaped = value.replaceAll("'", "''").replaceAll("\\", "\\\\");
  return value.includes("\\") ? `E'${escaped}'` : `'${escaped}'`;
}
