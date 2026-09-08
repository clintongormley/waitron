import { isUuid } from "@waitron/shared";

// The pure name/LSN helpers native replication needs. No database and no role name — the caller
// passes the ids. Kept separate from publications.ts/subscriptions.ts so the box-status and rejoin
// guards can compute a subscription name or compare two LSNs without opening a connection.

/** A node's subscription to a peer is named after the SUBSCRIBER — the node that HOLDS the
 * subscription (C1) — and Postgres names the publisher-side slot identically, so a fenced node finds
 * the carrier's slot on itself by the CARRIER's id. `waitron_<environment>_sub_<32 hex>`: the UUID's
 * dashes are stripped to 32 hex, giving ≤ 58 chars (`preproduction` is the tightest, exactly 58),
 * inside Postgres's 63-byte identifier limit. A non-UUID is a wiring bug, refused loudly. */
export function subscriptionName(
  environment: "production" | "preproduction",
  subscriberNodeId: string,
): string {
  if (!isUuid(subscriberNodeId)) {
    throw new Error(`not a node UUID: ${JSON.stringify(subscriberNodeId)}`);
  }
  return `waitron_${environment}_sub_${subscriberNodeId.replace(/-/g, "").toLowerCase()}`;
}

/** The `pg_lsn` text shape — `high/low`, both segments hex (case-insensitive). names.ts is the LSN
 * home, so this one regex is shared by `lsnValue` here and `skipSubscriptionStatement`'s guard. */
const LSN_RE = /^([0-9A-Fa-f]+)\/([0-9A-Fa-f]+)$/;

/** Whether `s` is a valid `pg_lsn` text value (`high/low`, both hex). */
export function isLsn(s: string): boolean {
  return LSN_RE.test(s);
}

/** A `pg_lsn` as its `high/low` hex value, both segments hex. */
function lsnValue(lsn: string): bigint {
  const match = LSN_RE.exec(lsn);
  if (match === null) throw new Error(`not an LSN: ${JSON.stringify(lsn)}`);
  return (BigInt(`0x${match[1]}`) << 32n) | BigInt(`0x${match[2]}`);
}

/** `a >= b` over two `pg_lsn` text values — the pure form the drain watermark uses (Ruling C2): a
 * node compares `confirmed_flush_lsn` against the fence LSN it recorded, both monotone, with no
 * database at hand. `pg_wal_lsn_diff` is the equivalent where a `db` is available. */
export function lsnGte(a: string, b: string): boolean {
  return lsnValue(a) >= lsnValue(b);
}
