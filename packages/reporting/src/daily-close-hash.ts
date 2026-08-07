import { createHash } from "node:crypto";
import type { DailyCloseSnapshot } from "./close-types.js";

/**
 * The tamper-evidence chain hash over the frozen daily close (cierre Z, design §"The close
 * operation"). Pure and DB-free on purpose — hashing is LOGIC, unit-tested directly here and
 * exercised through the append path on a DB in Task 3, never against a real-role Postgres
 * (CLAUDE.md §4). The DB side — the row-locked head, the append, the retry — lives in Task 3's
 * record operation; the chain re-walk in Task 4's verification.
 *
 * Mirrors `packages/workforce/src/chain-hash.ts` (itself the fiscal `huella.ts` precedent): an
 * ORDERED array of name/value pairs joined into a canonical string, SHA-256, uppercase hex. English
 * field names throughout — this chain is generic (`entry_hash`/`prev_entry_hash`/`sequence_no`),
 * unlike the fiscal chain whose vocabulary is a regime concept.
 */

/**
 * The identity fields of one close plus its frozen snapshot — everything the `entry_hash` commits
 * to except the predecessor hash, which is passed separately. `tenantId`/`nodeId`/`closedBy` are
 * plain strings (branded ids are assignable), so the hash module stays decoupled from the id brands.
 */
export interface CloseHashContent {
  tenantId: string;
  nodeId: string;
  /** Local calendar date of the business day, "YYYY-MM-DD". */
  businessDay: string;
  /** 1-based chain position within the (tenant, node) chain. */
  sequenceNo: number;
  /** When the close was frozen. Hashed as the INSTANT truncated to whole seconds (see
   * {@link toEpochSeconds}), so the stored `closed_at` and the read-back value recompute the same
   * digest even though Postgres stores sub-second precision the read-back may drop. A `Date` or an
   * ISO-8601 string are accepted equivalently. */
  closedAt: Date | string;
  /** The counting actor (identity person id). */
  closedBy: string;
  /** The frozen close document — VAT-exact figures, cash-up, counts, and the cash reconciliation. */
  snapshot: DailyCloseSnapshot;
}

/**
 * Joins ordered name/value pairs into the canonical hash input — `name=value` pairs `&`-joined, no
 * trailing separator (the `joinCampos` shape from `huella.ts`). The key is never omitted; the
 * separator count is fixed regardless of any value.
 */
function joinFields(fields: ReadonlyArray<readonly [string, string]>): string {
  return fields.map(([name, value]) => `${name}=${value}`).join("&");
}

/**
 * Whole-second epoch of a close instant. Truncating (not rounding) matches the read-back: Postgres
 * `timestamptz` keeps sub-second precision that a second-granular projection drops, so hashing at
 * whole-second granularity is what keeps the committed digest and the recomputed one identical. A
 * `Date` and its ISO string yield the same instant, so both are accepted.
 */
function toEpochSeconds(when: Date | string): number {
  const ms = typeof when === "string" ? Date.parse(when) : when.getTime();
  return Math.floor(ms / 1000);
}

/**
 * A deterministic serialization of an arbitrary jsonb-shaped value: object keys sorted recursively,
 * array order preserved. Object KEY order is what a jsonb round-trip does not preserve — the stored
 * snapshot Task 4 reads back to re-verify presents its keys in jsonb's own order, not write order —
 * so sorting keys here is what makes the recomputed digest match. Array order IS preserved by jsonb,
 * so it is left intact (the caller normalises the one array whose order is not intrinsic; see
 * {@link canonicalSnapshot}). Numbers and strings serialize via `JSON.stringify`; money is already
 * stored as `Decimal` strings, so no float representation ever reaches the digest.
 *
 * No `null`/`undefined` branch: the only value ever passed is a fully-populated `DailyCloseSnapshot`,
 * whose every field — through `DailyClose`, `VatSummary`, `CashUp`, `TillReconciliation` — is
 * required and non-nullable (grep the types: no `| null`, no `?`), so neither can reach here. A
 * jsonb read-back cannot introduce one either, since nothing nullable was ever stored.
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
 * is sorted by `tillId` — its order is not intrinsic (the caller builds it, and nothing downstream
 * relies on a particular order), so pinning it makes the digest independent of how the tills were
 * enumerated. Everything else keeps its order: the close's own arrays (`vat.byRate`,
 * `cash.byTill`) are produced deterministically by `computeDailyClose` and preserved verbatim by
 * jsonb, so re-sorting them would only risk diverging from the stored bytes.
 */
function canonicalSnapshot(snapshot: DailyCloseSnapshot): unknown {
  // Branch-free code-unit compare (never `localeCompare`, which is locale-sensitive): the write and
  // the read-back must sort identically across environments for the digest to reproduce.
  const byTill = [...snapshot.cashReconciliation.byTill].sort(
    (a, b) => Number(a.tillId > b.tillId) - Number(a.tillId < b.tillId),
  );
  return {
    close: snapshot.close,
    cashReconciliation: { byTill, nodeVariance: snapshot.cashReconciliation.nodeVariance },
  };
}

/**
 * The canonical string for one close — the exact bytes SHA-256 digests. The field ORDER is free (no
 * chain data exists yet, so nothing is bound to a prior layout) but FIXED and documented: the
 * identity fields in schema order, then the whole snapshot as one stably-serialized value, then
 * `PrevEntryHash` last so the chain link reads at the end. Changing this order changes every digest,
 * so it must not move once real chains exist.
 */
function canonicalString(content: CloseHashContent, prevEntryHash: string): string {
  return joinFields([
    ["TenantId", content.tenantId],
    ["NodeId", content.nodeId],
    ["BusinessDay", content.businessDay],
    ["SequenceNo", String(content.sequenceNo)],
    // The close instant as an absolute epoch second, never its wall-clock string — see `closedAt`.
    ["ClosedAtSeconds", String(toEpochSeconds(content.closedAt))],
    ["ClosedBy", content.closedBy],
    // The whole frozen document, key-order-independent so a jsonb read-back recomputes identically.
    ["Snapshot", stableStringify(canonicalSnapshot(content.snapshot))],
    // The PREVIOUS close's hash — "" for the genesis close — never this close's own hash.
    ["PrevEntryHash", prevEntryHash],
  ]);
}

/**
 * SHA-256 over the UTF-8 canonical string, uppercase hex — the `computeHuella` shape from huella.ts.
 * `prevEntryHash` is "" for the genesis close, exactly as the fiscal huella hashes an empty
 * predecessor for `PrimerRegistro`.
 */
export function computeCloseEntryHash(content: CloseHashContent, prevEntryHash: string): string {
  return createHash("sha256")
    .update(canonicalString(content, prevEntryHash), "utf8")
    .digest("hex")
    .toUpperCase();
}
