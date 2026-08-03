import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import type { SaleId, TenantId } from "./ids.js";
import {
  fiscalRecordId,
  locationId,
  nodeId,
  saleId,
  saleLineId,
  seriesId,
  tenantId,
  tenderId,
  tillId,
  workingOrderId,
  workingOrderLineId,
} from "./ids.js";

const UUID_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const UUID_B = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

// Every id kind gets its own constructor, and each one is its own function — brandId is shared
// machinery, but the wrapper that names the kind is not, and an untested wrapper is a real gap:
// a typo in one kind's literal string (e.g. "TillId" pasted under fiscalRecordId) would not be
// caught by exercising only tenantId/tillId/saleId/seriesId, which is all the constructor tests
// above this block do. `label` is the exported function's own name (for the describe title);
// `kind` is the PascalCase brand string that function passes to brandId and that a rejection
// reports back in its params — the two are deliberately not the same casing, so this table
// keeps them as two separate columns rather than deriving one from the other.
const ALL_ID_CONSTRUCTORS: ReadonlyArray<[string, string, (value: string) => string]> = [
  ["tenantId", "TenantId", tenantId],
  ["locationId", "LocationId", locationId],
  ["tillId", "TillId", tillId],
  ["nodeId", "NodeId", nodeId],
  ["seriesId", "SeriesId", seriesId],
  ["workingOrderId", "WorkingOrderId", workingOrderId],
  ["workingOrderLineId", "WorkingOrderLineId", workingOrderLineId],
  ["saleId", "SaleId", saleId],
  ["saleLineId", "SaleLineId", saleLineId],
  ["tenderId", "TenderId", tenderId],
  ["fiscalRecordId", "FiscalRecordId", fiscalRecordId],
];

describe("id constructors", () => {
  it("returns the underlying string unchanged", () => {
    // The brand is compile-time only. It must survive being handed straight to Drizzle as a
    // bind parameter, so the runtime value has to be the plain uuid with nothing wrapped
    // around it.
    expect(tenantId(UUID_A)).toBe(UUID_A);
  });

  it("accepts an upper-case uuid and preserves its case", () => {
    // Postgres `uuid` comparison is case-insensitive, so normalising here would be a silent
    // reformat of a value the caller supplied — and nothing formatted is ever stored.
    expect(tillId(UUID_A.toUpperCase())).toBe(UUID_A.toUpperCase());
  });

  it("rejects a non-uuid string with shared.invalid_id", () => {
    expect(() => saleId("not-a-uuid")).toThrowError(AppError);
  });

  it("names the id kind in the rejection params", () => {
    // Without the kind, a validation failure five layers down says only "a uuid was wrong" and
    // the reader has to guess which of six ids in the same call was the bad one.
    try {
      seriesId("nope");
      expect.unreachable("seriesId should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("shared.invalid_id");
      expect((error as AppError).params).toEqual({ kind: "SeriesId", value: "nope" });
    }
  });

  it("rejects the empty string", () => {
    expect(() => tenantId("")).toThrowError(AppError);
  });

  it("rejects a uuid with trailing content", () => {
    // Anchoring the pattern is what makes this fail. An unanchored regex accepts it, and the
    // extra content then travels into a query as part of the bind value.
    expect(() => tenantId(`${UUID_A} OR 1=1`)).toThrowError(AppError);
  });

  it("rejects a uuid with leading whitespace", () => {
    expect(() => tenantId(` ${UUID_A}`)).toThrowError(AppError);
  });

  it("distinguishes two different ids of the same kind", () => {
    expect(tenantId(UUID_A)).not.toBe(tenantId(UUID_B));
  });
});

describe.each(ALL_ID_CONSTRUCTORS)("%s", (label, kind, construct) => {
  it("accepts a valid uuid", () => {
    expect(construct(UUID_A)).toBe(UUID_A);
  });

  it("rejects an invalid uuid, naming its own kind", () => {
    try {
      construct("nope");
      expect.unreachable(`${label} should have thrown`);
    } catch (error) {
      expect((error as AppError).code).toBe("shared.invalid_id");
      expect((error as AppError).params).toEqual({ kind, value: "nope" });
    }
  });
});

describe("brand assignability", () => {
  it("refuses a TillId where a SaleId is required", () => {
    // The @ts-expect-error directives below are the real assertions in this block: `tsc
    // --noEmit` fails with "Unused '@ts-expect-error' directive" if the brand ever stops
    // discriminating, which is the exact regression this scheme exists to prevent. The runtime
    // expectations merely keep noUnusedLocals quiet.
    // @ts-expect-error a TillId is not a SaleId
    const wrongKind: SaleId = tillId(UUID_A);
    expect(typeof wrongKind).toBe("string");
  });

  it("refuses a bare string where a TenantId is required", () => {
    // @ts-expect-error an unvalidated string is not a TenantId
    const unvalidated: TenantId = UUID_A;
    expect(typeof unvalidated).toBe("string");
  });

  it("allows a branded id where a plain string is required", () => {
    // One-way assignability is the point: a TenantId is still a string, so it goes into a query
    // with no unwrapping step, while a string does not go into a TenantId slot without one.
    const asPlain: string = tenantId(UUID_A);
    expect(asPlain).toBe(UUID_A);
  });
});
