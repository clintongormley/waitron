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

// Every id kind gets its own constructor, and each one is its own function — brandId is shared
// machinery, but the wrapper that names the kind is not, and an untested wrapper is a real gap:
// a typo in one kind's literal string (e.g. "TillId" pasted under fiscalRecordId) would not be
// caught by exercising only locationId/tillId/saleId/seriesId, which is all the constructor tests
// above this block do. `label` is the exported function's own name (for the describe title);
// `kind` is the PascalCase brand string that function passes to brandId and that a rejection
// reports back in its params — the two are deliberately not the same casing, so this table
// keeps them as two separate columns rather than deriving one from the other.
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
    // The brand is compile-time only. It must survive being handed straight to Drizzle as a
    // bind parameter, so the runtime value has to be the plain uuid with nothing wrapped
    // around it.
    expect(locationId(UUID_A)).toBe(UUID_A);
  });

  it("accepts an upper-case uuid and folds it to lower case", () => {
    // An id column is plain `text` and compares byte for byte, so the spelling that leaves this
    // constructor is the spelling that gets stored and looked up. Folding here is what makes one
    // id one row whichever case the caller sent.
    expect(tillId(UUID_A.toUpperCase())).toBe(UUID_A);
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
    expect(() => locationId("")).toThrowError(AppError);
  });

  it("rejects a uuid with trailing content", () => {
    // Anchoring the pattern is what makes this fail. An unanchored regex accepts it, and the
    // extra content then travels into a query as part of the bind value.
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
    // Per kind, not once: a wrapper that stopped delegating to brandId would keep the caller's
    // case while every other kind folded, and only this table would see it.
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
    // discriminating, which is the exact regression this scheme exists to prevent. The runtime
    // expectations merely keep noUnusedLocals quiet.
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
    // One-way assignability is the point: a LocationId is still a string, so it goes into a query
    // with no unwrapping step, while a string does not go into a LocationId slot without one.
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
    // The counter-case for the fold. Case carries no information in a uuid — every character is a
    // hex digit — which is why folding one loses nothing. It is NOT true of the case-sensitive
    // references this system also carries: a Stripe object id, a SumUp pairing code, an AEAT
    // invoice number. None of them is uuid-shaped, so `UUID_PATTERN` is what keeps them out of the
    // fold: this refuses the value instead of quietly returning "pi_3abcdefghijklmnop".
    expect(() => normaliseUuid("pi_3ABCdefGHIjklMNOP", "ProviderRef")).toThrowError(AppError);
  });

  it("echoes the caller's own spelling in the rejection, unfolded", () => {
    // A refusal exists to show the caller the bytes they sent. Folding the echoed value would
    // hand back something they never typed, and would hide the case as the thing that was wrong
    // if the pattern ever narrowed. `kind` is PascalCase and is not folded either.
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
    // Anchored: a well-formed UUID with trailing junk is rejected, or it would travel onward in a bind.
    expect(isUuid(`${UUID_A} drop table x`)).toBe(false);
  });
});
