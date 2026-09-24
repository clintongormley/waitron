import { AppError } from "./errors.js";

/**
 * `declare`d because it has no runtime existence, so a branded id is the plain string at runtime.
 * A unique symbol rather than a string key, because any object literal can forge a string key.
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether the value is UUID-shaped, in either case. It does not settle the spelling: a caller that
 * stores or compares the value needs {@link normaliseUuid}.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Validates a UUID and folds it to lower case. An id column is text and compares byte for byte,
 * so an id stored in one case is not found by a lookup in the other; the spelling is settled here,
 * where an id is parsed (owner decision, 2026-09-21).
 *
 * The fold is confined to UUID-shaped values on purpose: case matters in other ids this system
 * carries (a Stripe object id, an AEAT invoice number), and those get a refusal, not a fold.
 * `kind` names the id in the refusal, and a refused value is echoed as the caller spelled it.
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
