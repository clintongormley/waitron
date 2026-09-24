import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import type { LocationId, SaleId } from "./ids.js";
import {
  fiscalRecordId,
  isUuid,
  locationId,
  nodeId,
  normaliseUuid,
  saleId,
  saleLineId,
  seriesId,
  tenderId,
  tillId,
  workingOrderId,
  workingOrderLineId,
} from "./ids.js";

const UUID_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const UUID_B = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

const ALL_ID_CONSTRUCTORS: ReadonlyArray<[string, string, (value: string) => string]> = [
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
    expect(locationId(UUID_A)).toBe(UUID_A);
  });

  it("accepts an upper-case uuid and folds it to lower case", () => {
    expect(tillId(UUID_A.toUpperCase())).toBe(UUID_A);
  });

  it("rejects a non-uuid string with shared.invalid_id", () => {
    expect(() => saleId("not-a-uuid")).toThrowError(AppError);
  });

  it("names the id kind in the rejection params", () => {
    try {
      seriesId("nope");
      expect.unreachable("seriesId should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("shared.invalid_id");
      expect((error as AppError).params).toEqual({ kind: "SeriesId", value: "nope" });
    }
  });

  it("rejects the empty string", () => {
    expect(() => locationId("")).toThrowError(AppError);
  });

  it("rejects a uuid with trailing content", () => {
    expect(() => locationId(`${UUID_A} OR 1=1`)).toThrowError(AppError);
  });

  it("rejects a uuid with leading whitespace", () => {
    expect(() => locationId(` ${UUID_A}`)).toThrowError(AppError);
  });

  it("distinguishes two different ids of the same kind", () => {
    expect(locationId(UUID_A)).not.toBe(locationId(UUID_B));
  });
});

describe.each(ALL_ID_CONSTRUCTORS)("%s", (label, kind, construct) => {
  it("accepts a valid uuid", () => {
    expect(construct(UUID_A)).toBe(UUID_A);
  });

  it("folds an upper-case uuid", () => {
    expect(construct(UUID_A.toUpperCase())).toBe(UUID_A);
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
    // discriminating.
    // @ts-expect-error a TillId is not a SaleId
    const wrongKind: SaleId = tillId(UUID_A);
    expect(typeof wrongKind).toBe("string");
  });

  it("refuses a bare string where a LocationId is required", () => {
    // @ts-expect-error an unvalidated string is not a LocationId
    const unvalidated: LocationId = UUID_A;
    expect(typeof unvalidated).toBe("string");
  });

  it("allows a branded id where a plain string is required", () => {
    const asPlain: string = locationId(UUID_A);
    expect(asPlain).toBe(UUID_A);
  });
});

describe("normaliseUuid", () => {
  it("folds an upper-case uuid to lower case", () => {
    expect(normaliseUuid(UUID_A.toUpperCase(), "ProductId")).toBe(UUID_A);
  });

  it("returns an already lower-case uuid unchanged", () => {
    expect(normaliseUuid(UUID_A, "ProductId")).toBe(UUID_A);
  });

  it("refuses a value that is not a uuid rather than folding it", () => {
    expect(() => normaliseUuid("pi_3ABCdefGHIjklMNOP", "ProviderRef")).toThrowError(AppError);
  });

  it("echoes the caller's own spelling in the rejection, unfolded", () => {
    try {
      normaliseUuid("NOT-A-UUID", "ProductId");
      expect.unreachable("normaliseUuid should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("shared.invalid_id");
      expect((error as AppError).params).toEqual({ kind: "ProductId", value: "NOT-A-UUID" });
    }
  });

  it("rejects the empty string and a uuid with trailing content", () => {
    expect(() => normaliseUuid("", "ProductId")).toThrowError(AppError);
    expect(() => normaliseUuid(`${UUID_A} drop table x`, "ProductId")).toThrowError(AppError);
  });
});

describe("isUuid", () => {
  it("accepts a well-formed UUID, in either case", () => {
    expect(isUuid(UUID_A)).toBe(true);
    expect(isUuid("6BA7B810-9DAD-11D1-80B4-00C04FD430C8")).toBe(true);
  });
  it("rejects a malformed or unanchored value", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(`${UUID_A} drop table x`)).toBe(false);
  });
});
