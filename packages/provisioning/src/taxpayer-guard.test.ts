import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  assertNoForeignTaxpayer,
  assertNoOperationalVenue,
  assertOperationalVenue,
  type TaxpayerIdentity,
} from "./taxpayer-guard.js";

const ES_A: TaxpayerIdentity = { country: "ES", taxId: "B12345678" };
const ES_B: TaxpayerIdentity = { country: "ES", taxId: "B99999999" };

describe("assertNoForeignTaxpayer", () => {
  it("passes on an empty database — the first taxpayer", () => {
    expect(() => assertNoForeignTaxpayer([], ES_A, "waitron")).not.toThrow();
  });

  it("passes when the only present identity is the SAME taxpayer", () => {
    expect(() => assertNoForeignTaxpayer([ES_A], ES_A, "waitron")).not.toThrow();
  });

  it("throws provisioning.foreign_taxpayer when a DIFFERENT taxpayer is present", () => {
    const error = (() => {
      try {
        assertNoForeignTaxpayer([ES_B], ES_A, "waitron_demo");
        return undefined;
      } catch (e: unknown) {
        return e;
      }
    })();
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.code).toBe("provisioning.foreign_taxpayer");
    expect(isAppError(error) && error.params).toEqual({ database: "waitron_demo" });
  });

  it("refuses a foreign identity even when the applied one is ALSO present", () => {
    expect(() => assertNoForeignTaxpayer([ES_A, ES_B], ES_A, "waitron")).toThrow();
  });
});

describe("operational venue guards", () => {
  it("accepts a present venue document", () => {
    expect(() => assertOperationalVenue(true)).not.toThrow();
  });

  it("refuses a trading boot with no venue document", () => {
    expect(() => assertOperationalVenue(false)).toThrowError(
      expect.objectContaining({ code: "provisioning.second_venue" }),
    );
  });

  it("requires a mirror target to contain no venue before native copy", () => {
    expect(() => assertNoOperationalVenue(false)).not.toThrow();
    expect(() => assertNoOperationalVenue(true)).toThrowError(
      expect.objectContaining({ code: "provisioning.second_venue" }),
    );
  });
});
