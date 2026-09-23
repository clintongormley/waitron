import { AppError } from "./errors.js";

/**
 * Exported, `declare`d and never defined. Exported because `Branded` is exported and referencing
 * a non-exported symbol in an exported type trips TS4023 under `declaration: true`; `declare`d
 * because the symbol has no runtime existence at all — it is erased entirely, so a branded id
 * costs nothing at runtime and is byte-identical to the string it wraps.
 *
 * A `unique symbol` rather than a string-keyed marker such as `{ __brand: "SaleId" }`, because
 * a string key is forgeable: any object literal with that property satisfies the type, and the
 * key shows up in `keyof`, in autocomplete and in `JSON.stringify` output. A unique symbol
 * declared here cannot be produced anywhere else in the repo.
 *
 * Rejected alternative: wrapper classes (`class SaleId { constructor(readonly value: string) }`).
 * They brand just as well but allocate on every construction and stop the value being passed
 * straight into a Drizzle bind parameter, so every query site grows a `.value` that is easy to
 * forget in exactly one place.
 */
export declare const idBrand: unique symbol;

export type Branded<T, B extends string> = T & { readonly [idBrand]: B };

export type LocationId = Branded<string, "LocationId">;
export type TillId = Branded<string, "TillId">;
export type NodeId = Branded<string, "NodeId">;
export type SeriesId = Branded<string, "SeriesId">;
export type WorkingOrderId = Branded<string, "WorkingOrderId">;
export type WorkingOrderLineId = Branded<string, "WorkingOrderLineId">;
export type SaleId = Branded<string, "SaleId">;
export type SaleLineId = Branded<string, "SaleLineId">;
export type TenderId = Branded<string, "TenderId">;
export type FiscalRecordId = Branded<string, "FiscalRecordId">;

// Anchored at both ends. An unanchored pattern accepts a well-formed uuid followed by anything
// at all, and the trailing content then travels onward as part of a bind value.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Anchored UUID shape check, sharing the same `UUID_PATTERN` the branded-id constructors validate
 * against. Either case passes: every character of a UUID is a hex digit, so `A` and `a` are the
 * same value. Callers screen a cookie or request id through this so a malformed one fails as a
 * clean client fault rather than travelling into a query as a bind value.
 *
 * This says only whether the value is well-formed. It does not settle its SPELLING — see
 * {@link normaliseUuid}, which is what a caller that goes on to STORE or COMPARE the value needs.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * The one place a UUID's spelling is settled: validated, then folded to lower case.
 *
 * An id column is plain `text` (`packages/db/src/schema/columns.ts`) and text compares byte for
 * byte, so an id stored in one case is not found by a lookup in the other. Folding at the boundary
 * that PARSES an id — here, and in the branded constructors below, which all route through this —
 * is what makes every column hold one spelling, so no write path has to remember (owner decision,
 * 2026-09-21).
 *
 * The fold is confined to UUID-shaped values ON PURPOSE, and the validation is what confines it.
 * Case is meaningless inside a UUID and meaningful in plenty of ids this system also carries — a
 * Stripe object id, a SumUp pairing code, an AEAT invoice number — none of which is UUID-shaped.
 * A caller that hands one of those to this function gets a refusal, not a corrupted value.
 *
 * `kind` names the id for the refusal only; a rejected value is echoed back exactly as the caller
 * spelled it, because the message exists to show them their own bytes.
 */
export function normaliseUuid(value: string, kind: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new AppError("shared.invalid_id", { kind, value });
  }
  return value.toLowerCase();
}

function brandId<B extends string>(value: string, kind: B): Branded<string, B> {
  return normaliseUuid(value, kind) as Branded<string, B>;
}

export const locationId = (value: string): LocationId => brandId(value, "LocationId");
export const tillId = (value: string): TillId => brandId(value, "TillId");
export const nodeId = (value: string): NodeId => brandId(value, "NodeId");
export const seriesId = (value: string): SeriesId => brandId(value, "SeriesId");
export const workingOrderId = (value: string): WorkingOrderId => brandId(value, "WorkingOrderId");
export const workingOrderLineId = (value: string): WorkingOrderLineId =>
  brandId(value, "WorkingOrderLineId");
export const saleId = (value: string): SaleId => brandId(value, "SaleId");
export const saleLineId = (value: string): SaleLineId => brandId(value, "SaleLineId");
export const tenderId = (value: string): TenderId => brandId(value, "TenderId");
export const fiscalRecordId = (value: string): FiscalRecordId => brandId(value, "FiscalRecordId");
