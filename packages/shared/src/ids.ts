import { AppError } from "./errors.js";

/**
 * Exported, `declare`d and never defined. Exported because `Branded` is exported and referencing
 * a non-exported symbol in an exported type trips TS4023 under `declaration: true`; `declare`d
 * because the symbol has no runtime existence at all — it is erased entirely, so a branded id
 * costs nothing at runtime and is byte-identical to the string it wraps.
 *
 * A `unique symbol` rather than a string-keyed marker such as `{ __brand: "TenantId" }`, because
 * a string key is forgeable: any object literal with that property satisfies the type, and the
 * key shows up in `keyof`, in autocomplete and in `JSON.stringify` output. A unique symbol
 * declared here cannot be produced anywhere else in the repo.
 *
 * Rejected alternative: wrapper classes (`class TenantId { constructor(readonly value: string) }`).
 * They brand just as well but allocate on every construction and stop the value being passed
 * straight into a Drizzle bind parameter, so every query site grows a `.value` that is easy to
 * forget in exactly one place.
 */
export declare const idBrand: unique symbol;

export type Branded<T, B extends string> = T & { readonly [idBrand]: B };

export type TenantId = Branded<string, "TenantId">;
export type LocationId = Branded<string, "LocationId">;
export type TillId = Branded<string, "TillId">;
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

function brandId<B extends string>(value: string, kind: B): Branded<string, B> {
  if (!UUID_PATTERN.test(value)) {
    throw new AppError("shared.invalid_id", { kind, value });
  }
  return value as Branded<string, B>;
}

export const tenantId = (value: string): TenantId => brandId(value, "TenantId");
export const locationId = (value: string): LocationId => brandId(value, "LocationId");
export const tillId = (value: string): TillId => brandId(value, "TillId");
export const seriesId = (value: string): SeriesId => brandId(value, "SeriesId");
export const workingOrderId = (value: string): WorkingOrderId => brandId(value, "WorkingOrderId");
export const workingOrderLineId = (value: string): WorkingOrderLineId =>
  brandId(value, "WorkingOrderLineId");
export const saleId = (value: string): SaleId => brandId(value, "SaleId");
export const saleLineId = (value: string): SaleLineId => brandId(value, "SaleLineId");
export const tenderId = (value: string): TenderId => brandId(value, "TenderId");
export const fiscalRecordId = (value: string): FiscalRecordId => brandId(value, "FiscalRecordId");
