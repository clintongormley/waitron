import { createHash } from "node:crypto";
import type { DailyCloseSnapshot } from "./close-types.js";

/**
 * The tamper-evidence chain hash over the frozen daily close (cierre Z): an ORDERED list of
 * name/value pairs joined into a canonical string, SHA-256, uppercase hex. Pure and database-free;
 * `recordDailyClose` appends with it and `verifyDailyCloseChain` re-walks with it.
 */

/**
 * The identity fields of one close plus its frozen snapshot — everything the `entry_hash` commits
 * to except the predecessor hash, which is passed separately. `nodeId`/`closedBy` are plain strings
 * (branded ids are assignable), so the hash module stays decoupled from the id brands.
 */
export interface CloseHashContent {
  nodeId: string;
  /** Local calendar date of the business day, "YYYY-MM-DD". */
  businessDay: string;
  /** 1-based chain position within the node's chain. */
  sequenceNo: number;
  /** When the close was frozen. Hashed as the INSTANT truncated to whole seconds
   * ({@link toEpochSeconds}); a `Date` or an ISO-8601 string are accepted equivalently. */
  closedAt: Date | string;
  /** The counting actor (identity person id). */
  closedBy: string;
  /** The frozen close document — VAT-exact figures, cash-up, counts, and the cash reconciliation. */
  snapshot: DailyCloseSnapshot;
}

/**
 * Joins ordered name/value pairs into the canonical hash input — `name=value` pairs `&`-joined, no
 * trailing separator. The key is never omitted; the separator count is fixed regardless of any value.
 */
function joinFields(fields: ReadonlyArray<readonly [string, string]>): string {
  return fields.map(([name, value]) => `${name}=${value}`).join("&");
}

/** Whole-second epoch of a close instant, truncated. A `Date` and its ISO string yield the same. */
function toEpochSeconds(when: Date | string): number {
  const ms = typeof when === "string" ? Date.parse(when) : when.getTime();
  return Math.floor(ms / 1000);
}

/**
 * A deterministic serialization of a JSON-shaped value: object keys sorted recursively, so the
 * digest does not depend on key order; array order preserved (the caller normalises the one array
 * whose order is not intrinsic, {@link canonicalSnapshot}). Money is `Decimal` strings, so no float
 * representation reaches the digest.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Normalises the snapshot so equal closes serialize identically. The reconciliation `byTill` array
 * is sorted by `tillId`, since its order is not intrinsic. The close's own arrays (`vat.byRate`,
 * `cash.byTill`) keep their order: `computeDailyClose` produces them deterministically.
 */
function canonicalSnapshot(snapshot: DailyCloseSnapshot): unknown {
  // Code-unit compare, never `localeCompare`, which is locale-sensitive: the write and the
  // read-back must sort identically across environments.
  const byTill = [...snapshot.cashReconciliation.byTill].sort(
    (a, b) => Number(a.tillId > b.tillId) - Number(a.tillId < b.tillId),
  );
  return {
    close: snapshot.close,
    cashReconciliation: { byTill, nodeVariance: snapshot.cashReconciliation.nodeVariance },
  };
}

/**
 * The canonical string for one close — the exact bytes SHA-256 digests. Changing the field order
 * or list changes every digest, so neither may move once real chains exist.
 */
function canonicalString(content: CloseHashContent, prevEntryHash: string): string {
  return joinFields([
    ["NodeId", content.nodeId],
    ["BusinessDay", content.businessDay],
    ["SequenceNo", String(content.sequenceNo)],
    // The close instant as an absolute epoch second, never its wall-clock string — see `closedAt`.
    ["ClosedAtSeconds", String(toEpochSeconds(content.closedAt))],
    ["ClosedBy", content.closedBy],
    ["Snapshot", stableStringify(canonicalSnapshot(content.snapshot))],
    // The PREVIOUS close's hash — "" for the genesis close — never this close's own hash.
    ["PrevEntryHash", prevEntryHash],
  ]);
}

/**
 * SHA-256 over the UTF-8 canonical string, uppercase hex. `prevEntryHash` is "" for the genesis
 * close.
 */
export function computeCloseEntryHash(content: CloseHashContent, prevEntryHash: string): string {
  return createHash("sha256")
    .update(canonicalString(content, prevEntryHash), "utf8")
    .digest("hex")
    .toUpperCase();
}
